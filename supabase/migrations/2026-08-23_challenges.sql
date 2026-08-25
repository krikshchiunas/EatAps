-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — совместные челленджи с друзьями и лидерборд.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- Устройство. Челлендж — это набор дней и правило, что считать «зачётным
-- днём». Прогресс НЕ хранится: он вычисляется на клиенте из дневника, который
-- участники и так открывают друг другу. Хранить копию прогресса значило бы
-- завести второй источник правды, который неизбежно разойдётся с дневником —
-- и лидерборд начал бы показывать не то, что видит сам человек.
--
-- Поэтому в базе только: сам челлендж, кто в нём и его ежедневная отметка
-- (score за день), которую пишет владелец отметки сам.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  title       text not null check (length(title) between 1 and 80),
  kind        text not null default 'log_streak'
              check (kind in ('log_streak', 'calorie_target', 'protein_target', 'no_sugar')),
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index if not exists challenges_owner_idx on public.challenges (owner);

create table if not exists public.challenge_members (
  challenge   uuid not null references public.challenges(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (challenge, user_id)
);

create index if not exists challenge_members_user_idx on public.challenge_members (user_id);

-- Ежедневная отметка участника: 1 — день зачтён, 0 — нет. Пишет только сам
-- участник и только про себя (см. политику ниже): иначе «победить» можно было
-- бы, проставив зачёты соседу задним числом или себе — за чужие дни.
create table if not exists public.challenge_days (
  challenge   uuid not null references public.challenges(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  scored      boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (challenge, user_id, day)
);

alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.challenge_days enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Кто участник — базовый вопрос для всех политик ниже.
-- Отдельная функция, а не подзапрос в каждой политике: с подзапросом внутри
-- политики самой challenge_members получается рекурсия (политика читает ту же
-- таблицу, к которой применяется). SECURITY DEFINER её разрывает.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.in_challenge(p_challenge uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.challenge_members m
    where m.challenge = p_challenge and m.user_id = p_user
  );
$$;

revoke all on function public.in_challenge(uuid, uuid) from public, anon;
grant execute on function public.in_challenge(uuid, uuid) to authenticated;

-- ── challenges ───────────────────────────────────────────────────────────
drop policy if exists "challenge select" on public.challenges;
create policy "challenge select" on public.challenges
  for select using (auth.uid() = owner or public.in_challenge(id, auth.uid()));

drop policy if exists "challenge insert" on public.challenges;
create policy "challenge insert" on public.challenges
  for insert with check (auth.uid() = owner);

-- Менять и удалять челлендж может только создатель.
drop policy if exists "challenge update" on public.challenges;
create policy "challenge update" on public.challenges
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "challenge delete" on public.challenges;
create policy "challenge delete" on public.challenges
  for delete using (auth.uid() = owner);

-- ── challenge_members ────────────────────────────────────────────────────
drop policy if exists "member select" on public.challenge_members;
create policy "member select" on public.challenge_members
  for select using (public.in_challenge(challenge, auth.uid()));

-- Присоединиться человек может только сам за себя. Владелец добавляет других
-- не напрямую, а приглашением через чат — то есть добровольно с их стороны.
drop policy if exists "member join" on public.challenge_members;
create policy "member join" on public.challenge_members
  for insert with check (auth.uid() = user_id);

-- Выйти можно самому; владелец может исключить участника.
drop policy if exists "member leave" on public.challenge_members;
create policy "member leave" on public.challenge_members
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.challenges c where c.id = challenge and c.owner = auth.uid())
  );

-- ── challenge_days ───────────────────────────────────────────────────────
-- Читают все участники: в этом и смысл лидерборда.
drop policy if exists "cday select" on public.challenge_days;
create policy "cday select" on public.challenge_days
  for select using (public.in_challenge(challenge, auth.uid()));

-- Пишет только про себя и только будучи участником.
drop policy if exists "cday upsert" on public.challenge_days;
create policy "cday upsert" on public.challenge_days
  for insert with check (auth.uid() = user_id and public.in_challenge(challenge, auth.uid()));

drop policy if exists "cday update" on public.challenge_days;
create policy "cday update" on public.challenge_days
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cday delete" on public.challenge_days;
create policy "cday delete" on public.challenge_days
  for delete using (auth.uid() = user_id);

-- Отметки вне окна челленджа бессмысленны и позволяли бы «добрать» очки
-- задним числом за пределами срока. Проверяем на сервере, а не в интерфейсе.
create or replace function public.guard_challenge_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s date;
  e date;
begin
  select starts_on, ends_on into s, e from public.challenges where id = new.challenge;
  if s is null then
    raise exception 'Челлендж не найден';
  end if;
  if new.day < s or new.day > e then
    raise exception 'День вне срока челленджа';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists challenge_day_guard on public.challenge_days;
create trigger challenge_day_guard
  before insert or update on public.challenge_days
  for each row execute function public.guard_challenge_day();

-- Лидерборд одним запросом: сколько зачётных дней у каждого участника.
-- Имя берём из app_state — ту же строку участники и так видят как друзья.
create or replace function public.challenge_board(p_challenge uuid)
returns table (user_id uuid, name text, scored int)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    -- max() по одной строке: у app_state первичный ключ user_id, поэтому имя
    -- одно. Группировка по самому JSON-полю (как было) заставляла бы Postgres
    -- сравнивать весь блоб состояния ради одного имени.
    max(s.state -> 'profile' ->> 'name') as name,
    coalesce(count(d.day) filter (where d.scored), 0)::int as scored
  from public.challenge_members m
  left join public.app_state s on s.user_id = m.user_id
  left join public.challenge_days d on d.challenge = m.challenge and d.user_id = m.user_id
  where m.challenge = p_challenge
    and public.in_challenge(p_challenge, auth.uid())  -- посторонний не увидит чужой лидерборд
  group by m.user_id
  order by scored desc, name nulls last;
$$;

revoke all on function public.challenge_board(uuid) from public, anon;
grant execute on function public.challenge_board(uuid) to authenticated;
