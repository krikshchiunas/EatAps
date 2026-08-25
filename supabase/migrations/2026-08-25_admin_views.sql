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
  -- Значения латиницей намеренно. Кириллица в ДАННЫХ проходит через буфер
  -- обмена, редактор и SQL-консоль — на любом стыке она может побиться, и
  -- в таблице появятся кракозябры вместо слов. Комментарии на русском такой
  -- проблемы не создают: они никуда не отдаются.
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'promo' else
      case when stripe_tier = 'FREE' then 'none' else 'stripe' end
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
  -- Тоже латиницей и по той же причине.
  case
    when c.expires_at is not null and c.expires_at <= now() then 'expired'
    when c.used >= c.max_uses then 'used_up'
    else 'active'
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
