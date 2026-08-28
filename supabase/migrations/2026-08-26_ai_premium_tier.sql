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
