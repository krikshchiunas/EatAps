-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ОБНОВЛЕНИЕ ОТ 2026-08-23. Вставить целиком в Supabase → SQL Editor → Run.
--
-- Это ДОБАВКА к уже установленной базе: schema.sql и прошлые миграции трогать
-- не нужно, они остаются как есть. Если база ставится с нуля — используйте
-- supabase/setup_all.sql, там это обновление уже включено в конец.
--
-- Что появится:
--   • bans + support_messages   — модерация и обращения в поддержку;
--   • coaches + coach_links     — роль тренера и доступ к дневнику клиента;
--   • day_comments              — комментарии тренера к конкретному дню;
--   • challenges + ...          — совместные челленджи и лидерборд.
--
-- Безопасно для базы с данными: всё через create table if not exists и
-- drop/create для политик. Повторный прогон ничего не ломает.
--
-- ⚠️ ОДНО ЗАМЕТНОЕ ИЗМЕНЕНИЕ: политика чтения app_state заменяется — к своим
-- данным и данным друзей добавляется доступ принятого тренера. Права друзей
-- при этом не меняются, старое правило целиком входит в новое.
--
-- После прогона выполните supabase/verify.sql — там появились новые проверки.
--
-- Собран из этих файлов, править нужно ИХ:
--   supabase/migrations/2026-08-23_moderation_and_coach.sql
--   supabase/migrations/2026-08-23_challenges.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-23_moderation_and_coach.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — модерация (баны), обращения в поддержку и роль тренера.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно: повторный прогон ничего не ломает и данные не трогает.
--
-- Что здесь и зачем:
--   1. bans               — кто и до какого момента лишён права писать;
--   2. support_messages   — обращения в поддержку и заявки на роль тренера;
--   3. coach_links        — доступ тренера к дневнику клиента и комментарии;
--   4. day_comments       — комментарии тренера к конкретному дню.
--
-- Ключевое решение по правам: писать в bans и support_messages может ТОЛЬКО
-- сервер (service_role, из функций api/). Клиенту оставлен минимум на чтение
-- своего — иначе забаненный мог бы снять себе бан, а любой желающий —
-- прочитать чужие обращения.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Баны
-- ─────────────────────────────────────────────────────────────────────────
-- until = NULL означает «навсегда». Отдельный флаг forever не заводим: одно
-- поле с одним смыслом невозможно рассогласовать.
create table if not exists public.bans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  until      timestamptz,
  reason     text,
  banned_by  text,
  created_at timestamptz not null default now()
);

create index if not exists bans_until_idx on public.bans (until);

alter table public.bans enable row level security;

-- Человек видит СВОЙ бан: интерфейс обязан честно сказать, почему нельзя
-- писать и до какого числа, а не молча глотать сообщения.
drop policy if exists "ban select own" on public.bans;
create policy "ban select own" on public.bans
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE политик нет вовсе: значит, клиенту это запрещено
-- полностью. Пишет только service_role, для которого RLS не действует.

-- Действует ли бан прямо сейчас. Истёкший бан строку не удаляет (история
-- нарушений полезна), но перестаёт запрещать.
create or replace function public.is_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = p_user
      and (b.until is null or b.until > now())
  );
$$;

revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

-- Свой бан для интерфейса: срок и причина.
create or replace function public.my_ban()
returns table (until timestamptz, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select b.until, b.reason
  from public.bans b
  where b.user_id = auth.uid()
    and (b.until is null or b.until > now());
$$;

revoke all on function public.my_ban() from public, anon;
grant execute on function public.my_ban() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Обращения: поддержка и заявки на роль тренера
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'support' check (kind in ('support', 'coach_application')),
  text       text not null,
  created_at timestamptz not null default now()
);

-- Индекс под проверку «не чаще раза в час»: выборка последнего обращения
-- пользователя должна быть мгновенной, а не сканом таблицы.
create index if not exists support_user_time_idx
  on public.support_messages (user_id, created_at desc);

alter table public.support_messages enable row level security;

drop policy if exists "support select own" on public.support_messages;
create policy "support select own" on public.support_messages
  for select using (auth.uid() = user_id);

-- Записи создаёт только сервер: там же проверяются бан и частота. Разреши мы
-- вставку клиенту — лимит «раз в час» обходился бы прямым запросом к базе.

-- Когда человеку снова можно писать. Возвращает NULL, если можно уже сейчас.
-- Считает сервер, но функция доступна и клиенту: интерфейс показывает таймер
-- заранее, а не после отправки.
create or replace function public.support_next_allowed_at()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(created_at) + interval '1 hour'
  from public.support_messages
  where user_id = auth.uid()
    and created_at > now() - interval '1 hour';
$$;

revoke all on function public.support_next_allowed_at() from public, anon;
grant execute on function public.support_next_allowed_at() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Роль тренера
-- ─────────────────────────────────────────────────────────────────────────
-- Признак «этот пользователь одобрен как тренер». Ставит только сервер после
-- решения в телеграм-боте.
create table if not exists public.coaches (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by text,
  note       text
);

alter table public.coaches enable row level security;

-- Кто тренер — не секрет: клиент должен видеть бейдж у собеседника.
drop policy if exists "coach select all" on public.coaches;
create policy "coach select all" on public.coaches
  for select using (auth.role() = 'authenticated');

-- Связь «тренер ↔ клиент». Приглашение всегда исходит от КЛИЕНТА: доступ к
-- своему дневнику отдаёт только он сам, тренер не может подписаться сам.
create table if not exists public.coach_links (
  id         uuid primary key default gen_random_uuid(),
  coach      uuid not null references auth.users(id) on delete cascade,
  client     uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (coach, client),
  check (coach <> client)
);

create index if not exists coach_links_coach_idx on public.coach_links (coach, status);
create index if not exists coach_links_client_idx on public.coach_links (client, status);

alter table public.coach_links enable row level security;

drop policy if exists "coach link select" on public.coach_links;
create policy "coach link select" on public.coach_links
  for select using (auth.uid() = coach or auth.uid() = client);

-- Приглашает клиент, и только одобренного тренера. Проверка членства в
-- coaches здесь, а не в приложении: иначе доступ к чужому дневнику зависел бы
-- от того, что нарисовано в интерфейсе.
drop policy if exists "coach link invite" on public.coach_links;
create policy "coach link invite" on public.coach_links
  for insert with check (
    auth.uid() = client
    and coach <> client
    and exists (select 1 from public.coaches c where c.user_id = coach)
  );

-- Принять приглашение может только тренер.
drop policy if exists "coach link accept" on public.coach_links;
create policy "coach link accept" on public.coach_links
  for update using (auth.uid() = coach) with check (auth.uid() = coach);

-- Разорвать связь может любая сторона: клиент забирает доступ в любой момент.
drop policy if exists "coach link delete" on public.coach_links;
create policy "coach link delete" on public.coach_links
  for delete using (auth.uid() = coach or auth.uid() = client);

-- Тренер читает дневник клиента. Расширяем ту же select-политику app_state,
-- где уже описан доступ друзей: держать два разных правила доступа к одной
-- таблице — верный способ разойтись между ними при следующей правке.
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;
create policy "state select self, friends or coach" on public.app_state
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = app_state.user_id)
          or (f.addressee = auth.uid() and f.requester = app_state.user_id)
        )
    )
    or exists (
      select 1 from public.coach_links l
      where l.status = 'accepted'
        and l.coach = auth.uid()
        and l.client = app_state.user_id
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Комментарии тренера к дню
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.day_comments (
  id         uuid primary key default gen_random_uuid(),
  client     uuid not null references auth.users(id) on delete cascade,
  author     uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  text       text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists day_comments_client_day_idx
  on public.day_comments (client, day, created_at);

alter table public.day_comments enable row level security;

-- Видят комментарий обе стороны связи.
drop policy if exists "day comment select" on public.day_comments;
create policy "day comment select" on public.day_comments
  for select using (
    auth.uid() = client
    or exists (
      select 1 from public.coach_links l
      where l.status = 'accepted' and l.coach = auth.uid() and l.client = day_comments.client
    )
  );

-- Писать может клиент у себя и его принятый тренер. Автор всегда я сам —
-- подделать авторство нельзя.
drop policy if exists "day comment insert" on public.day_comments;
create policy "day comment insert" on public.day_comments
  for insert with check (
    auth.uid() = author
    and (
      auth.uid() = client
      or exists (
        select 1 from public.coach_links l
        where l.status = 'accepted' and l.coach = auth.uid() and l.client = day_comments.client
      )
    )
  );

drop policy if exists "day comment delete" on public.day_comments;
create policy "day comment delete" on public.day_comments
  for delete using (auth.uid() = author or auth.uid() = client);

-- Профиль собеседника по id — имя и публичный ID для интерфейса тренера.
create or replace function public.user_brief(p_user uuid)
returns table (public_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.public_id, (s.state -> 'profile' ->> 'name')
  from public.profiles p
  left join public.app_state s on s.user_id = p.user_id
  where p.user_id = p_user;
$$;

revoke all on function public.user_brief(uuid) from public, anon;
grant execute on function public.user_brief(uuid) to authenticated;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-23_challenges.sql
-- ###########################################################################

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
