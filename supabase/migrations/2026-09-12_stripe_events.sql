-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — вебхук Stripe становится устойчивым к повторам и переупорядочиванию.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- Обработчик делал безусловный upsert строки подписки на каждое событие:
--
--     await admin().from('subscriptions').upsert({ user_id, tier, status, ... })
--
-- Ни идентификатор события, ни время его создания нигде не хранились. Отсюда
-- два разных отказа:
--
--   1. ПОВТОРНАЯ ДОСТАВКА. Stripe повторяет событие, пока не получит 200.
--      Повтор проходил весь путь заново. Для upsert это, как правило,
--      безобидно, но любой побочный эффект (а они появляются) выполнился бы
--      дважды.
--
--   2. ПЕРЕУПОРЯДОЧИВАНИЕ. Stripe прямо предупреждает, что порядок доставки
--      не гарантирован. Последовательность «updated (active) → deleted
--      (canceled)», пришедшая наоборот, оставляла в базе ЖИВОЙ тариф у
--      отменённой подписки. Платный доступ после отмены — это уже деньги.
--
-- ЧТО ВВОДИТСЯ
--
--   • Журнал обработанных событий: одно событие обрабатывается один раз.
--     Заявка и завершение разнесены, поэтому падение на середине НЕ помечает
--     событие обработанным — следующая доставка подхватит его заново.
--
--   • Время последнего применённого события прямо в строке подписки. Запись
--     более старого события отбрасывается — это и есть защита от
--     переупорядочивания, и работает она независимо от того, сколько
--     экземпляров функции выполняются одновременно.
--
-- Проверка подписи запроса в обработчике остаётся как была — она отсекает
-- подделку, а этот журнал отвечает только за доставку.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Журнал событий
-- ---------------------------------------------------------------------------
-- Полезную нагрузку события НЕ храним: в ней платёжные и персональные данные,
-- а для идемпотентности достаточно идентификатора. Храним ровно столько,
-- сколько нужно, чтобы разобраться, почему событие не применилось.
create table if not exists public.stripe_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  event_created timestamptz,
  status        text not null default 'processing'
                check (status in ('processing', 'processed', 'failed')),
  attempts      integer not null default 1,
  last_error    text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

alter table public.stripe_webhook_events enable row level security;
-- Политик нет намеренно: журнал принадлежит серверу (service_role, которому
-- RLS не писан). Клиенту он не нужен ни на чтение, ни на запись.

create index if not exists stripe_webhook_events_unfinished_idx
  on public.stripe_webhook_events (received_at)
  where status <> 'processed';

-- ---------------------------------------------------------------------------
-- 2. Заявка на обработку
-- ---------------------------------------------------------------------------
-- Возвращает, что делать вызывающему:
--   'claimed'   — событие новое, обрабатываем;
--   'duplicate' — уже обработано, второй раз не надо (отвечаем Stripe 200);
--   'retry'     — заявка была, но обработка не завершилась; пробуем снова.
--
-- Ключевое свойство — атомарность: insert ... on conflict выполняется одним
-- оператором, поэтому два параллельных экземпляра функции не могут оба
-- получить 'claimed' на одно событие.
create or replace function public.stripe_event_claim(
  p_event_id   text,
  p_event_type text,
  p_created    timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, event_created)
  values (p_event_id, coalesce(p_event_type, 'unknown'), p_created)
  on conflict (event_id) do nothing;

  if found then
    return 'claimed';
  end if;

  -- Строка уже была. Смотрим, чем кончилась прошлая попытка.
  update public.stripe_webhook_events
     set attempts = attempts + 1,
         status = case when status = 'processed' then 'processed' else 'processing' end
   where event_id = p_event_id
  returning status into v_status;

  return case when v_status = 'processed' then 'duplicate' else 'retry' end;
end;
$$;

create or replace function public.stripe_event_finish(
  p_event_id text,
  p_ok       boolean,
  p_error    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_webhook_events
     set status = case when p_ok then 'processed' else 'failed' end,
         processed_at = case when p_ok then now() else processed_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where event_id = p_event_id;
$$;

revoke all on function public.stripe_event_claim(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.stripe_event_finish(text, boolean, text) from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, text, timestamptz) to service_role;
grant execute on function public.stripe_event_finish(text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Время последнего применённого события — прямо в подписке
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists last_event_created timestamptz;
alter table public.subscriptions
  add column if not exists last_event_id text;

-- ---------------------------------------------------------------------------
-- 4. Запись подписки с защитой от устаревшего события
-- ---------------------------------------------------------------------------
-- Вся проверка и запись — один оператор. Именно поэтому здесь функция, а не
-- «прочитать, сравнить в JavaScript, записать»: между чтением и записью
-- успевает вклиниться параллельный экземпляр, и более старое событие затирает
-- более новое. Ровно та же ошибка, что уже была разобрана в save_app_state.
--
-- Возвращает true, если состояние применено, и false, если отброшено как
-- устаревшее. Отброшенное событие — это НЕ ошибка: обработчик отвечает Stripe
-- успехом, иначе тот будет повторять его до бесконечности.
create or replace function public.stripe_subscription_sync(
  p_user_id              uuid,
  p_tier                 text,
  p_status               text,
  p_customer_id          text,
  p_subscription_id      text,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created        timestamptz,
  p_event_id             text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied boolean := false;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  insert into public.subscriptions as s (
    user_id, tier, status, stripe_customer_id, stripe_subscription_id,
    current_period_end, cancel_at_period_end, updated_at,
    last_event_created, last_event_id
  )
  values (
    p_user_id, coalesce(p_tier, 'FREE'), coalesce(p_status, 'inactive'),
    p_customer_id, p_subscription_id,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), now(),
    p_event_created, p_event_id
  )
  on conflict (user_id) do update
    set tier                 = excluded.tier,
        status               = excluded.status,
        -- Идентификатор клиента Stripe не затираем пустым значением: часть
        -- событий приходит без него, а потерять связь с клиентом значит
        -- потерять возможность открыть человеку портал управления подпиской.
        stripe_customer_id   = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
        stripe_subscription_id = excluded.stripe_subscription_id,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at           = now(),
        last_event_created   = excluded.last_event_created,
        last_event_id        = excluded.last_event_id
    where s.last_event_created is null
       or excluded.last_event_created is null
       or excluded.last_event_created >= s.last_event_created
  returning true into v_applied;

  return coalesce(v_applied, false);
end;
$$;

revoke all on function public.stripe_subscription_sync(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.stripe_subscription_sync(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Один клиент Stripe на пользователя
-- ---------------------------------------------------------------------------
-- Прежний порядок в checkout был: прочитать stripe_customer_id → если пусто,
-- создать клиента в Stripe → записать. Два одновременных нажатия «оплатить»
-- читали пустоту оба и создавали ДВУХ клиентов; второй затирал первого, и у
-- человека оставалась подписка, привязанная к потерянному клиенту.
--
-- Эта функция делает шаг «записать, если ещё не записано» атомарным и всегда
-- возвращает ПОБЕДИВШЕЕ значение. Проигравшая гонку сторона получает чужой
-- (первый) идентификатор и обязана свой лишний объект в Stripe не
-- использовать. Вторая половина защиты — ключ идемпотентности при создании
-- клиента на стороне Stripe, см. api/stripe/checkout.js.
create or replace function public.stripe_customer_claim(p_user_id uuid, p_customer_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_user_id is null or p_customer_id is null or p_customer_id = '' then
    raise exception 'user id and customer id are required' using errcode = '22023';
  end if;

  insert into public.subscriptions (user_id, tier, status, stripe_customer_id, updated_at)
  values (p_user_id, 'FREE', 'inactive', p_customer_id, now())
  on conflict (user_id) do update
    set stripe_customer_id = coalesce(public.subscriptions.stripe_customer_id, excluded.stripe_customer_id),
        updated_at = now()
  returning stripe_customer_id into v_existing;

  return v_existing;
end;
$$;

revoke all on function public.stripe_customer_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.stripe_customer_claim(uuid, text) to service_role;

comment on table public.stripe_webhook_events is
  'Идемпотентность вебхука Stripe: одно событие обрабатывается один раз. Полезная нагрузка не хранится.';
