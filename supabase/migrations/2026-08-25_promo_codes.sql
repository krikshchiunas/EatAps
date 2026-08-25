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
