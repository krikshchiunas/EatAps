-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ОБНОВЛЕНИЕ ОТ 2026-08-26: тариф Carrot Premium + ФИКС дневного лимита.
-- Вставить целиком в Supabase → SQL Editor → Run.
--
-- ⚠️ БЕЗ ЭТОГО ФАЙЛА АССИСТЕНT НЕ РАБОТАЕТ. Приложение считает лимит токенов
-- ПО ДНЯМ и пишет период в формате 'YYYY-MM-DD', а таблица ai_usage до сих пор
-- разрешала только 'YYYY-MM' (месяц). Каждая запись расхода проваливала CHECK,
-- сервер получал ошибку учёта и отвечал «ассистент временно недоступен» на
-- любой запрос. Этот файл снимает старый CHECK и ставит дневной.
--
-- Это ДОБАВКА к уже установленной базе: существующие данные не трогаются.
-- Идемпотентно — повторный прогон безопасен. Три блока, порядок важен:
--   1) 2026-08-26_ai_premium_tier.sql        — тариф AI_PREMIUM в CHECK-ах;
--   2) 2026-08-26_daily_usage_and_premium_admin.sql — ДНЕВНОЙ период (ключевой фикс);
--   3) 2026-08-26_admin_subscriptions_writable.sql  — правка тарифа через SQL Editor.
--
-- После прогона откройте вкладку AI и задайте вопрос — должно отвечать.
-- ═══════════════════════════════════════════════════════════════════════════



-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_ai_premium_tier.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — добавление тарифа AI_PREMIUM (Carrot Premium, €24.99).
--
-- До этой миграции tier был жёстко ограничен ('FREE','AI','AI_PLUS') на трёх
-- таблицах. Из-за этого:
--   • вебхук Stripe не мог записать AI_PREMIUM после реальной покупки —
--     upsert падал на CHECK, и покупатель Carrot Premium не получал доступ;
--   • промокод на AI_PREMIUM не выдавался (тот же CHECK на promo_codes/grants);
--   • ручное редактирование tier='AI_PREMIUM' в Table Editor тоже отклонялось.
--
-- Запускать в Supabase SQL Editor. Идемпотентно — можно гонять повторно.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.subscriptions
  drop constraint if exists subscriptions_tier_check;
alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('FREE','AI','AI_PLUS','AI_PREMIUM'));

alter table public.promo_codes
  drop constraint if exists promo_codes_tier_check;
alter table public.promo_codes
  add constraint promo_codes_tier_check
  check (tier in ('AI','AI_PLUS','AI_PREMIUM'));

alter table public.promo_grants
  drop constraint if exists promo_grants_tier_check;
alter table public.promo_grants
  add constraint promo_grants_tier_check
  check (tier in ('AI','AI_PLUS','AI_PREMIUM'));

-- ---------------- Ручное управление подписками из Table Editor ----------------
-- subscriptions.status не имеет CHECK — можно свободно ставить в Table Editor
-- любую из строк, которые понимает фронт (src/lib/subscription.js STATUS):
--   'inactive' | 'active' | 'trialing' | 'past_due' | 'canceled'
--   | 'incomplete' | 'incomplete_expired' | 'unpaid'
--
-- Чтобы вручную выдать человеку тариф без Stripe и без промокода — открыть
-- Table Editor → subscriptions → найти строку по user_id (или вставить новую)
-- и поставить:
--   tier   = 'FREE' | 'AI' | 'AI_PLUS' | 'AI_PREMIUM'
--   status = 'active'
-- current_period_end можно оставить пустым (isActive() смотрит только на tier
-- и status) либо поставить дату окончания вручную. Фронт подхватит изменение
-- сразу — таблица в Realtime-публикации.
--
-- Если у человека ещё нет строки в subscriptions (он не покупал раньше и не
-- гасил промокод), нужно сначала создать её через Table Editor → Insert row,
-- указав его user_id (взять из auth.users по email), остальные поля —
-- как выше.


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_daily_usage_and_premium_admin.sql
-- ###########################################################################

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
alter table public.ai_usage
  drop constraint if exists ai_usage_period_check;
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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_admin_subscriptions_writable.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — admin_subscriptions доступен для UPDATE через SQL Editor.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- ⚠️ Table Editor (сетка с ячейками) НИКОГДА не даёт редактировать VIEW —
-- это правило интерфейса Supabase Studio, а не вопрос прав или триггеров.
-- Даже с INSTEAD OF-триггером ниже строка в гриде останется помечена
-- «read-only». Это ограничение Studio для любых представлений в принципе.
--
-- Что это решает: SQL Editor (вкладка слева, «SQL Editor», не Table Editor)
-- умеет выполнять UPDATE по любой таблице/view. INSTEAD OF-триггер учит
-- Postgres, куда физически девать такой UPDATE по admin_subscriptions:
-- он перекладывается в public.subscriptions (реальную таблицу).
--
-- Пример использования — открыть SQL Editor и выполнить:
--   update public.admin_subscriptions
--   set stripe_tier = 'AI_PLUS', stripe_status = 'active'
--   where email = 'friend@example.com';
--
-- Это удобнее, чем руками искать user_id по email в таблице subscriptions.
-- Столбцы, которые реально что-то меняют: stripe_tier, stripe_status,
-- until, cancel_at_period_end. Столбцы tier/source — целиком вычисляемые
-- (лучшее из Stripe и промокода), их редактировать бессмысленно.
--
-- ВАЖНО: во внешнем SELECT view нет колонки stripe_until — только until
-- (уже посчитанный «эффективный» срок). Если в этот момент активен более
-- старший промокод, until покажет его срок, а не срок Stripe-подписки —
-- при записи just that until уйдёт в subscriptions.current_period_end.
--
-- Если у пользователя действует промокод СТАРШЕ того тарифа, что вы здесь
-- поставите, эффективный tier всё равно останется от промокода (тот же
-- bestTier, что в src/lib/subscription.js). Чтобы это тарифы не спорили —
-- удалите активный грант в promo_grants или дождитесь его истечения.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_subscriptions_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (
    user_id, tier, status, current_period_end, cancel_at_period_end, updated_at
  )
  values (
    NEW.user_id,
    coalesce(NEW.stripe_tier, 'FREE'),
    coalesce(NEW.stripe_status, 'active'),
    NEW.until,
    coalesce(NEW.cancel_at_period_end, false),
    now()
  )
  on conflict (user_id) do update
    set tier                 = excluded.tier,
        status               = excluded.status,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at           = now();
  return NEW;
end;
$$;

drop trigger if exists admin_subscriptions_instead_of_update on public.admin_subscriptions;
create trigger admin_subscriptions_instead_of_update
  instead of update on public.admin_subscriptions
  for each row execute function public.admin_subscriptions_apply();
