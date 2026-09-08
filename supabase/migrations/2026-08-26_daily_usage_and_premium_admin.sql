-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — фикс дневного периода ai_usage + AI_PREMIUM в админ-панели.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-08-26_ai_premium_tier.sql.
-- Идемпотентно.
--
-- Что чинит:
--
-- 1) ai_usage.period имел CHECK на формат 'YYYY-MM' (месяц). Приложение с
--    недавнего изменения считает лимиты ПО ДНЯМ и пишет period в формате
--    'YYYY-MM-DD'. Каждая запись расхода токенов проваливала CHECK и молча
--    не сохранялась (ошибка только в логах) — из-за этого spentThisPeriod
--    всегда читал 0, и дневной лимит FREE/AI фактически не работал.
--
-- 2) admin_subscriptions ранжировал тарифы только AI_PLUS/AI — человек с
--    AI_PREMIUM в этой панели попадал в 'else 0', то есть отображался как
--    FREE. Ранжирование переписано на FREE=0/AI=1/AI_PLUS=2/AI_PREMIUM=3.
--
-- 3) admin_subscriptions джойнил ai_usage по текущему месяцу — с переходом
--    на дневной период это всегда давало ai_spent_usd = 0. Джойн переведён
--    на текущий день UTC.
--
-- 4) issue_promo() отклонял tier = 'AI_PREMIUM' явной проверкой в коде —
--    код на Premium нельзя было выпустить даже после снятия CHECK на
--    таблицах. Список разрешённых тиров расширен.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------- 1) Дневной период в ai_usage ----------------
-- ⚠ СМЕНА ОГРАНИЧЕНИЯ БЕЗ ПЕРЕНОСА ДАННЫХ НЕ РАБОТАЕТ.
--
-- В первой редакции этой миграции стояли просто drop constraint + add
-- constraint. На пустой таблице проходит; на живой Postgres проверяет новое
-- условие по ВСЕМ существующим строкам и отвечает
--   23514: check constraint "ai_usage_period_check" of relation "ai_usage"
--          is violated by some row
-- потому что в таблице лежат строки старого, месячного формата ('2026-08').
-- Ошибка вылезала на середине setup_all.sql и роняла весь прогон.
--
-- Строки не выбрасываем: ai_usage — единственный источник правды о том,
-- сколько стоил каждый тариф, и терять накопленный расход ради смены формата
-- нельзя. Месяц переносим на его первое число: суммы сохраняются полностью,
-- меняется только гранулярность, которой у этих строк и так не было.
--
-- Порядок обязателен: сначала снять старое ограничение, потом переносить
-- (иначе вставка '2026-08-01' упрётся в ещё живой месячный CHECK), и только
-- потом ставить новое.

alter table public.ai_usage
  drop constraint if exists ai_usage_period_check;

-- Если у человека уже есть строка за первое число месяца, склеиваем: первичный
-- ключ (user_id, period) не допускает двух, а расход должен сойтись.
insert into public.ai_usage (user_id, period, spent_micro, requests, updated_at)
select user_id, period || '-01', spent_micro, requests, updated_at
from public.ai_usage
where period ~ '^\d{4}-\d{2}$'
on conflict (user_id, period) do update
  set spent_micro = public.ai_usage.spent_micro + excluded.spent_micro,
      requests    = public.ai_usage.requests    + excluded.requests,
      updated_at  = greatest(public.ai_usage.updated_at, excluded.updated_at);

delete from public.ai_usage where period ~ '^\d{4}-\d{2}$';

-- Всё, что не месяц и не день, — не наш формат вовсе. Молча удалять учётные
-- строки нельзя, поэтому останавливаемся с внятным сообщением: разбираться с
-- ними должен человек, а не миграция.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad from public.ai_usage where period !~ '^\d{4}-\d{2}-\d{2}$';
  if v_bad > 0 then
    raise exception
      'ai_usage: % строк с периодом неизвестного формата. Посмотрите: select distinct period from public.ai_usage where period !~ ''^\d{4}-\d{2}-\d{2}$'';',
      v_bad;
  end if;
end $$;

alter table public.ai_usage
  add constraint ai_usage_period_check
  check (period ~ '^\d{4}-\d{2}-\d{2}$');

-- ---------------- 2+3) admin_subscriptions: AI_PREMIUM + дневной ai_usage ----
drop view if exists public.admin_subscriptions;
create view public.admin_subscriptions as
with live as (
  select
    u.id  as user_id,
    u.email,
    u.created_at as registered_at,
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
  left join lateral (
    select pg.code, pg.tier, pg.granted_until
    from public.promo_grants pg
    where pg.user_id = u.id and pg.granted_until > now()
    order by case pg.tier
               when 'AI_PREMIUM' then 3
               when 'AI_PLUS' then 2
               when 'AI' then 1
               else 0
             end desc,
             pg.granted_until desc
    limit 1
  ) g on true
  -- Дневной расход (сегодня, UTC) — тот же period_key, что пишет приложение.
  left join public.ai_usage a
    on a.user_id = u.id and a.period = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
)
select
  user_id,
  email,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_tier else stripe_tier
  end as tier,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'promo' else
      case when stripe_tier = 'FREE' then 'none' else 'stripe' end
  end as source,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_until else stripe_until
  end as until,
  stripe_tier,
  stripe_status,
  cancel_at_period_end,
  promo_code,
  nullif(promo_tier,'FREE') as promo_tier,
  promo_until,
  -- Расход на ассистента СЕГОДНЯ (UTC), в долларах — лимит теперь дневной.
  round(coalesce(spent_micro,0) / 1000000.0, 4) as ai_spent_usd_today,
  coalesce(requests,0) as ai_requests_today,
  registered_at
from live;

revoke all on public.admin_subscriptions from anon, authenticated;
grant select on public.admin_subscriptions to service_role;

-- ---------------- 4) issue_promo: разрешить AI_PREMIUM ----------------
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
  if p_tier not in ('AI','AI_PLUS','AI_PREMIUM') then
    raise exception 'issue_promo: тариф должен быть AI, AI_PLUS или AI_PREMIUM, получено %', p_tier;
  end if;

  if p_code is not null then
    insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
    values (upper(btrim(p_code)), p_tier, p_days, p_max_uses, p_expires_at, p_note)
    returning * into v_row;
    return v_row;
  end if;

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

revoke all on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  to service_role;

-- ---------------- Ручное редактирование доступа ----------------
-- admin_subscriptions — ПРЕДСТАВЛЕНИЕ (JOIN + CASE), Table Editor не даёт его
-- редактировать («Cannot edit in read-only editor») — это ожидаемо для любого
-- непростого view в Postgres, не баг миграции.
--
-- Чтобы поменять тариф человеку вручную — редактировать саму таблицу:
--   Table Editor → subscriptions (не admin_subscriptions!) → строка по user_id
--   → tier = 'FREE' | 'AI' | 'AI_PLUS' | 'AI_PREMIUM', status = 'active'.
-- Если строки нет — Insert row с этим user_id (найти в auth.users по email).
-- admin_subscriptions обновится сам — это просто отражение subscriptions
-- и promo_grants, лучшее из двух.
