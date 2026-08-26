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
