-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — расход токенов AI-ассистента.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- Зачем не «сообщений в день». Лимит в штуках врёт: разбор месяца стоит как
-- двадцать коротких вопросов. Поэтому считаем деньги — в целых микродолларах
-- (1e-6 USD), без плавающей точки: доли цента, помноженные на десятки тысяч
-- запросов, это уже реальные деньги.
--
-- Строка на пользователя и календарный месяц UTC. Прошлые месяцы не чистим:
-- это единственный источник правды о том, сколько стоил каждый тариф.
--
-- Писать сюда может ТОЛЬКО сервер (service_role). Если бы расход мог править
-- клиент, лимит обнулялся бы одним запросом из консоли браузера.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  period      text not null check (period ~ '^\d{4}-\d{2}$'), -- 'YYYY-MM', UTC
  spent_micro bigint not null default 0 check (spent_micro >= 0),
  requests    integer not null default 0 check (requests >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, period)
);

create index if not exists ai_usage_period_idx on public.ai_usage (period);

alter table public.ai_usage enable row level security;

-- Пользователь видит только свой расход — фронту это нужно, чтобы показать
-- «осталось столько-то» и не отправлять заведомо отказной запрос.
drop policy if exists "ai_usage select own" on public.ai_usage;
create policy "ai_usage select own" on public.ai_usage
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE политик нет намеренно: с anon-ключом запись невозможна,
-- service_role обходит RLS.

-- Атомарный инкремент. Именно функция, а не «прочитали → сложили → записали»:
-- два параллельных запроса пользователя (например, с телефона и планшета)
-- иначе затёрли бы расход друг друга, и лимит стал бы обходимым.
--
-- p_micro может быть ОТРИЦАТЕЛЬНЫМ — это возврат неизрасходованного резерва.
-- Сервер сначала резервирует верхнюю оценку стоимости, и только потом идёт в
-- модель; иначе пять вкладок, отправленные одновременно, прошли бы проверку по
-- одному и тому же остатку и вместе перебрали бы месячный лимит. После ответа
-- резерв корректируется до фактической цены.
--
-- p_count = false у корректировок: это не новый запрос, а уточнение прежнего.
--
-- Сигнатура сменилась (добавился p_count), поэтому старую версию сносим явно:
-- create or replace оставил бы рядом трёхаргументную перегрузку, и вызов с
-- тремя параметрами стал бы неоднозначным для Postgres.
drop function if exists public.ai_usage_add(uuid, text, bigint);

create or replace function public.ai_usage_add(
  p_user_id uuid,
  p_period text,
  p_micro bigint,
  p_count boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  -- greatest(0, ...) — страховка от того, что возврат резерва уведёт счётчик в
  -- минус (например, если корректировка пришла дважды после ретрая).
  insert into public.ai_usage (user_id, period, spent_micro, requests, updated_at)
  values (
    p_user_id,
    p_period,
    greatest(0, p_micro),
    case when p_count then 1 else 0 end,
    now()
  )
  on conflict (user_id, period) do update
    set spent_micro = greatest(0, public.ai_usage.spent_micro + p_micro),
        requests    = public.ai_usage.requests + case when p_count then 1 else 0 end,
        updated_at  = now()
  returning spent_micro into v_total;

  return v_total;
end $$;

-- Вызывать может только сервер.
revoke all on function public.ai_usage_add(uuid, text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.ai_usage_add(uuid, text, bigint, boolean) to service_role;
