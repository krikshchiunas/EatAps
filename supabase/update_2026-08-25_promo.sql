-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ОБНОВЛЕНИЕ ОТ 2026-08-25: промокоды и панель управления доступом.
-- Вставить целиком в Supabase → SQL Editor → Run.
--
-- Это ДОБАВКА к уже установленной базе: существующие таблицы, политики и
-- функции НЕ затрагиваются. Если база ставится с нуля — используйте
-- supabase/setup_all.sql, там это уже включено.
--
-- Что появится:
--   • promo_codes / promo_grants / redeem_promo — сами промокоды и их гашение;
--   • admin_subscriptions — кто каким доступом обладает, одной таблицей;
--   • admin_promo_codes   — как расходятся выпущенные коды;
--   • issue_promo         — выпуск кода без ручного INSERT.
--
-- Подписки Stripe не трогаются: промокод живёт отдельно, а действующий тариф
-- считается как лучший из двух источников.
--
-- Безопасно для базы с данными и для повторного прогона.
--
-- После прогона выполните supabase/verify.sql — там появились проверки 77–85.
--
-- Собран из этих файлов, править нужно ИХ:
--   supabase/migrations/2026-08-25_promo_codes.sql
--   supabase/migrations/2026-08-25_admin_views.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-25_promo_codes.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — промокоды на платные тарифы.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- Зачем отдельная таблица, а не запись тарифа в subscriptions. Строку в
-- subscriptions владеет вебхук Stripe: он делает upsert ЦЕЛИКОМ на каждое
-- событие и, например, при отмене подписки принудительно ставит tier = 'FREE'.
-- Выданный промокодом доступ там просто стёрся бы — молча и в произвольный
-- момент. Поэтому источников доступа два, они независимы, а действующий тариф
-- считается как лучший из них (см. bestTier в src/lib/subscription.js).
--
-- Промокод НЕ создаёт подписку в Stripe и не списывает денег. Это ровно выдача
-- доступа на срок.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------- Сами коды ----------------
-- Создаёт владелец приложения вручную через SQL Editor (см. README).
create table if not exists public.promo_codes (
  code       text primary key,
  tier       text not null check (tier in ('AI', 'AI_PLUS')),
  days       integer not null check (days between 1 and 3650),
  max_uses   integer not null check (max_uses between 1 and 1000000),
  used       integer not null default 0 check (used >= 0),
  expires_at timestamptz,  -- когда сам код перестаёт приниматься; null = бессрочно
  note       text,         -- для чего выпущен: «блогер X», «компенсация за сбой»
  created_at timestamptz not null default now(),

  -- Жёсткая граница на уровне БД, а не только в коде гашения: даже если в
  -- функции появится ошибка, число гашений не сможет превысить лимит.
  constraint promo_codes_uses_within_limit check (used <= max_uses)
);

alter table public.promo_codes enable row level security;

-- Политик SELECT нет намеренно: с anon-ключом таблица недоступна целиком.
-- Иначе любой желающий выгрузил бы список действующих кодов одним запросом.
-- Проверка и гашение идут через redeem_promo (security definer).

-- ---------------- Выданный доступ ----------------
create table if not exists public.promo_grants (
  user_id       uuid not null references auth.users(id) on delete cascade,
  code          text not null references public.promo_codes(code) on delete cascade,
  tier          text not null check (tier in ('AI', 'AI_PLUS')),
  granted_until timestamptz not null,
  created_at    timestamptz not null default now(),

  -- Один код — одно гашение на человека. Это ограничение БД, а не проверка в
  -- коде: повторный вызов не пройдёт даже при гонке двух вкладок.
  primary key (user_id, code)
);

alter table public.promo_grants enable row level security;

-- Свои выдачи человек видит: фронту нужно показать «AI+ до 30 сентября».
drop policy if exists "promo grants select own" on public.promo_grants;
create policy "promo grants select own" on public.promo_grants
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE политик нет: выдачу создаёт только redeem_promo.

-- ---------------- Гашение ----------------
-- Возвращает jsonb: { ok: true, tier, until } либо { ok: false, error }.
-- Ошибку отдаём значением, а не exception: причина отказа («код не найден»,
-- «уже использован») — часть нормального сценария, её нужно показать человеку,
-- а не ловить как сбой.
create or replace function public.redeem_promo(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_code  public.promo_codes%rowtype;
  v_until timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  -- Человек напечатает как угодно: с пробелами, в нижнем регистре.
  -- for update блокирует строку до конца транзакции — два одновременных
  -- гашения последнего оставшегося использования не пройдут оба.
  select * into v_code
  from public.promo_codes
  where code = upper(btrim(p_code))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_code.used >= v_code.max_uses then
    return jsonb_build_object('ok', false, 'error', 'exhausted');
  end if;

  if exists (
    select 1 from public.promo_grants
    where user_id = v_user and code = v_code.code
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  v_until := now() + make_interval(days => v_code.days);

  insert into public.promo_grants (user_id, code, tier, granted_until)
  values (v_user, v_code.code, v_code.tier, v_until);

  update public.promo_codes set used = used + 1 where code = v_code.code;

  return jsonb_build_object('ok', true, 'tier', v_code.tier, 'until', v_until);
end $$;

revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-25_admin_views.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — панель управления доступом для владельца приложения.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- Отдельного админ-экрана в приложении нет и не заводится: администрирование
-- здесь исторически идёт через SQL Editor (так же ставятся баны). Поэтому
-- «панель» — это два представления и функция выпуска кодов.
--
-- ⚠️ ПРАВА. Представления читают auth.users, то есть почты живых людей. В
-- Supabase новым таблицам и представлениям по умолчанию раздаются права на
-- anon и authenticated — если их не отозвать, любой вошедший выгрузит список
-- всех пользователей с почтами одним запросом. Поэтому ниже стоит явный
-- revoke, а доступ оставлен только service_role и владельцу базы (это вы в
-- SQL Editor).
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------- Кто каким доступом обладает ----------------
-- Одна строка на пользователя: подписка Stripe, промокод и действующий тариф —
-- тот, который выше. Логика «лучший из двух» повторяет bestTier из
-- src/lib/subscription.js: это единственное место, где она дублируется, и
-- менять её нужно в обоих.
-- drop + create, а не create or replace: замена представления требует того же
-- набора колонок в том же порядке, и любая будущая правка состава полей
-- ломала бы повторный прогон.
drop view if exists public.admin_subscriptions;
create view public.admin_subscriptions as
with live as (
  select
    u.id  as user_id,
    u.email,
    u.created_at as registered_at,
    -- Тариф Stripe засчитываем только при живом статусе.
    case
      when s.status in ('active','trialing','past_due') then coalesce(s.tier,'FREE')
      else 'FREE'
    end as stripe_tier,
    s.status as stripe_status,
    s.current_period_end as stripe_until,
    s.cancel_at_period_end,
    g.code as promo_code,
    coalesce(g.tier,'FREE') as promo_tier,
    g.granted_until as promo_until,
    a.spent_micro,
    a.requests
  from auth.users u
  left join public.subscriptions s on s.user_id = u.id
  -- Лучшая действующая выдача: сначала по старшинству тарифа, потом по сроку.
  left join lateral (
    select pg.code, pg.tier, pg.granted_until
    from public.promo_grants pg
    where pg.user_id = u.id and pg.granted_until > now()
    order by case pg.tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end desc,
             pg.granted_until desc
    limit 1
  ) g on true
  left join public.ai_usage a
    on a.user_id = u.id and a.period = to_char(now() at time zone 'utc', 'YYYY-MM')
)
select
  user_id,
  email,
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_tier else stripe_tier
  end as tier,
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'промокод' else
      case when stripe_tier = 'FREE' then '—' else 'stripe' end
  end as source,
  -- До какого числа действует то, что человек имеет сейчас.
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_until else stripe_until
  end as until,
  stripe_tier,
  stripe_status,
  cancel_at_period_end,
  promo_code,
  nullif(promo_tier,'FREE') as promo_tier,
  promo_until,
  -- Расход на ассистента в текущем месяце, в долларах.
  round(coalesce(spent_micro,0) / 1000000.0, 4) as ai_spent_usd,
  coalesce(requests,0) as ai_requests,
  registered_at
from live;

-- ---------------- Как расходятся коды ----------------
drop view if exists public.admin_promo_codes;
create view public.admin_promo_codes as
select
  c.code,
  c.tier,
  c.days,
  c.used,
  c.max_uses,
  c.max_uses - c.used as left_uses,
  c.expires_at,
  case
    when c.expires_at is not null and c.expires_at <= now() then 'просрочен'
    when c.used >= c.max_uses then 'разобран'
    else 'действует'
  end as state,
  c.note,
  c.created_at,
  (select count(*) from public.promo_grants g
    where g.code = c.code and g.granted_until > now()) as active_now
from public.promo_codes c;

-- ---------------- Выпуск кода ----------------
-- Избавляет от ручного INSERT и от придумывания кода. Возвращает созданную
-- строку — код виден сразу в результате запроса.
--
-- Алфавит без 0/O и 1/I: код диктуют голосом и переписывают от руки, и эти
-- пары путают чаще всего.
create or replace function public.issue_promo(
  p_tier       text,
  p_days       integer,
  p_max_uses   integer default 1,
  p_expires_at timestamptz default null,
  p_note       text default null,
  p_code       text default null
)
returns public.promo_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_row  public.promo_codes%rowtype;
  i integer;
begin
  if p_tier not in ('AI','AI_PLUS') then
    raise exception 'issue_promo: тариф должен быть AI или AI_PLUS, получено %', p_tier;
  end if;

  -- Заданный вручную код используем как есть, иначе генерируем.
  if p_code is not null then
    insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
    values (upper(btrim(p_code)), p_tier, p_days, p_max_uses, p_expires_at, p_note)
    returning * into v_row;
    return v_row;
  end if;

  -- Десять попыток на случай совпадения: при 32^8 вариантов это защита от
  -- астрономически редкого столкновения, а не рабочий сценарий.
  for attempt in 1..10 loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    begin
      insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
      values (v_code, p_tier, p_days, p_max_uses, p_expires_at, p_note)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- код занят, пробуем следующий
    end;
  end loop;

  raise exception 'issue_promo: не удалось подобрать свободный код за 10 попыток';
end $$;

-- ---------------- Права ----------------
-- Оба представления и функция — инструменты владельца, не приложения.
revoke all on public.admin_subscriptions from anon, authenticated;
revoke all on public.admin_promo_codes  from anon, authenticated;
grant select on public.admin_subscriptions to service_role;
grant select on public.admin_promo_codes  to service_role;

revoke all on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  to service_role;
