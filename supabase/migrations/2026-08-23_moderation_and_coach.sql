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
