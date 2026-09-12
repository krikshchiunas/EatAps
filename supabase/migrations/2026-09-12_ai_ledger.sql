-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — учёт расхода AI становится атомарным и переживает обрывы.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ОШИБКА ПЕРВАЯ: РЕШЕНИЕ ПРИНИМАЛОСЬ ПО УСТАРЕВШЕМУ ЧИСЛУ
--
-- Порядок в api/ai/* был такой:
--
--     spent = await spentThisPeriod(user)     -- 1. прочитали расход
--     check = checkBudget({ spent, ... })     -- 2. решили по прочитанному
--     await reserve(user, check.needed)       -- 3. списали
--
-- Шаги 1 и 3 разнесены во времени, а между ними нет ничего, что мешало бы
-- другому запросу прочитать ТО ЖЕ САМОЕ число. Сто запросов, отправленных
-- одновременно, читали spent = 0, все сто проходили проверку и все сто уходили
-- в модель. Дневной лимит FREE — три запроса; платил за остальные владелец
-- ключа.
--
-- Самое обидное: атомарный примитив уже существовал. ai_usage_add выполняет
-- insert ... on conflict do update и ВОЗВРАЩАЕТ новый итог. Но вызывающий код
-- разбирал ответ как `const { error } = ...` и выбрасывал data. То есть
-- результат атомарной операции просто терялся по дороге.
--
-- ЗДЕСЬ ЭТО ЧИНИТСЯ ТАК: решение принимается ВНУТРИ той же операции, что и
-- списание. Функция сначала списывает, затем смотрит на получившийся итог и,
-- если он вышел за потолок, возвращает резерв и отказывает. Гонка невозможна
-- не потому, что «мы успеваем», а потому, что проверять нечего: число, по
-- которому принимается решение, получено из самой записи.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ОШИБКА ВТОРАЯ: ОБРЫВ МЕЖДУ РЕЗЕРВОМ И РАСЧЁТОМ
--
--     1. резерв списан          — успех
--     2. запрос к модели        — успех
--     3. возврат неизрасходованного — НЕ ДОШЁЛ (упала функция, отвалилась база)
--
-- Человек терял разницу между верхней оценкой и фактической ценой. Она
-- намеренно пессимистична, поэтому потеря заметная: списывается максимально
-- возможный ответ, а тратится обычно втрое меньше.
--
-- Отсюда журнал запросов: у каждого резерва есть строка со своим
-- идентификатором. Не рассчитанные вовремя строки видны, и их возвращает
-- отдельный проход (ai_reconcile). Расчёт при этом идемпотентен: повторный
-- вызов по тому же идентификатору ничего не делает, поэтому повтор запроса
-- не может списать дважды.
--
-- Содержимое переписки с моделью здесь НЕ хранится: журнал существует ради
-- правильного счёта, а не ради логов. Личные данные в него не попадают.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_requests (
  request_id     uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  period         text not null,
  kind           text not null default 'chat' check (kind in ('chat', 'vision', 'digest')),
  reserved_micro bigint not null check (reserved_micro >= 0),
  actual_micro   bigint,
  status         text not null default 'reserved'
                 check (status in ('reserved', 'settled', 'denied', 'reconciled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.ai_requests enable row level security;

-- Свои запросы человек видеть вправе: на этом можно построить честный экран
-- «на что ушёл лимит». Писать в таблицу нельзя никому — только функциям ниже.
drop policy if exists "ai requests select own" on public.ai_requests;
create policy "ai requests select own" on public.ai_requests
  for select using (auth.uid() = user_id);

create index if not exists ai_requests_stale_idx
  on public.ai_requests (created_at) where status = 'reserved';
create index if not exists ai_requests_user_period_idx
  on public.ai_requests (user_id, period);

-- ---------------------------------------------------------------------------
-- Резерв: списать и тут же решить по получившемуся итогу
-- ---------------------------------------------------------------------------
-- p_budget — дневной потолок в микродолларах; null означает «без потолка».
--
-- Возвращает jsonb:
--   { ok: true,  spent, remaining }              — можно звать модель
--   { ok: false, reason: 'exhausted', spent }    — лимит исчерпан
--   { ok: true,  duplicate: true, spent }        — повтор того же запроса
--
-- Отказ возвращается ЗНАЧЕНИЕМ, а не исключением: «лимит кончился» — обычный
-- ответ, который нужно показать человеку, а не сбой.
create or replace function public.ai_reserve(
  p_request_id uuid,
  p_user_id    uuid,
  p_period     text,
  p_micro      bigint,
  p_budget     bigint default null,
  p_kind       text default 'chat'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent bigint;
begin
  if p_request_id is null or p_user_id is null or p_period is null then
    raise exception 'request id, user id and period are required' using errcode = '22023';
  end if;
  if p_micro is null or p_micro < 0 then
    raise exception 'reserve must be non-negative' using errcode = '22023';
  end if;

  -- Повторная заявка с тем же идентификатором не списывает второй раз.
  -- Это делает безопасным повтор запроса после сетевого обрыва.
  insert into public.ai_requests (request_id, user_id, period, reserved_micro, kind)
  values (p_request_id, p_user_id, p_period, p_micro, coalesce(p_kind, 'chat'))
  on conflict (request_id) do nothing;

  if not found then
    select coalesce(spent_micro, 0) into v_spent
      from public.ai_usage where user_id = p_user_id and period = p_period;
    return jsonb_build_object('ok', true, 'duplicate', true, 'spent', coalesce(v_spent, 0));
  end if;

  -- Списание и получение НОВОГО итога — одним оператором. Строка ai_usage
  -- блокируется на время обновления, поэтому параллельные вызовы выстраиваются
  -- в очередь и каждый видит результат предыдущего, а не общее старое число.
  insert into public.ai_usage (user_id, period, spent_micro, requests, updated_at)
  values (p_user_id, p_period, greatest(0, p_micro), 1, now())
  on conflict (user_id, period) do update
    set spent_micro = greatest(0, public.ai_usage.spent_micro + p_micro),
        requests    = public.ai_usage.requests + 1,
        updated_at  = now()
  returning spent_micro into v_spent;

  -- Решение по ФАКТИЧЕСКОМУ итогу, а не по прочитанному заранее.
  if p_budget is not null and v_spent > p_budget then
    update public.ai_usage
       set spent_micro = greatest(0, spent_micro - p_micro),
           requests    = greatest(0, requests - 1),
           updated_at  = now()
     where user_id = p_user_id and period = p_period
    returning spent_micro into v_spent;

    update public.ai_requests
       set status = 'denied', actual_micro = 0, updated_at = now()
     where request_id = p_request_id;

    return jsonb_build_object('ok', false, 'reason', 'exhausted', 'spent', coalesce(v_spent, 0));
  end if;

  return jsonb_build_object(
    'ok', true,
    'spent', v_spent,
    'remaining', case when p_budget is null then null else greatest(0, p_budget - v_spent) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Расчёт по факту
-- ---------------------------------------------------------------------------
-- Идемпотентен по построению: строка берётся for update, и рассчитать её
-- можно ровно один раз. Двойной вызов (повтор, гонка, ретрай) второй раз
-- ничего не спишет и не вернёт.
create or replace function public.ai_settle(p_request_id uuid, p_actual_micro bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.ai_requests;
  v_actual bigint := greatest(0, coalesce(p_actual_micro, 0));
  v_spent  bigint;
begin
  select * into v_row from public.ai_requests
   where request_id = p_request_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_request');
  end if;
  if v_row.status <> 'reserved' then
    -- Уже рассчитан (или отказан). Повтор — не ошибка, просто ничего не делаем.
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.ai_usage
     set spent_micro = greatest(0, spent_micro + (v_actual - v_row.reserved_micro)),
         updated_at  = now()
   where user_id = v_row.user_id and period = v_row.period
  returning spent_micro into v_spent;

  update public.ai_requests
     set status = 'settled', actual_micro = v_actual, updated_at = now()
   where request_id = p_request_id;

  return jsonb_build_object('ok', true, 'spent', coalesce(v_spent, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Возврат зависших резервов
-- ---------------------------------------------------------------------------
-- Строка остаётся в состоянии 'reserved', если функция не дожила до расчёта:
-- платформа убила её по таймауту, упала сеть до базы, отключили питание.
-- Резерв в этом случае списан, а фактическая цена неизвестна — но она заведомо
-- не больше зарезервированной, и держать разницу на человеке нельзя.
--
-- Возвращаем резерв ЦЕЛИКОМ. Это сознательно в пользу пользователя: запрос мог
-- и не дойти до модели вовсе, а выяснить это задним числом нечем.
--
-- Порог по умолчанию — 15 минут: собственный таймаут обращения к модели 60
-- секунд, так что живых запросов старше этого не бывает.
create or replace function public.ai_reconcile(p_older_than interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.ai_requests;
  v_count integer := 0;
begin
  for v_row in
    select * from public.ai_requests
     where status = 'reserved' and created_at < now() - p_older_than
     order by created_at
     limit 500
     for update skip locked
  loop
    update public.ai_usage
       set spent_micro = greatest(0, spent_micro - v_row.reserved_micro),
           updated_at  = now()
     where user_id = v_row.user_id and period = v_row.period;

    update public.ai_requests
       set status = 'reconciled', actual_micro = 0, updated_at = now()
     where request_id = v_row.request_id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Вызывать всё это может только сервер: клиент не должен уметь ни
-- резервировать, ни рассчитывать, ни возвращать себе лимит.
revoke all on function public.ai_reserve(uuid, uuid, text, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.ai_settle(uuid, bigint) from public, anon, authenticated;
revoke all on function public.ai_reconcile(interval) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, bigint, bigint, text) to service_role;
grant execute on function public.ai_settle(uuid, bigint) to service_role;
grant execute on function public.ai_reconcile(interval) to service_role;

comment on table public.ai_requests is
  'Журнал резервов AI: обеспечивает атомарную проверку лимита и возврат зависших резервов. Содержимое запросов не хранится.';
