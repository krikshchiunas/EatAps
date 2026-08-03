-- EatAps — Supabase schema
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Safe to re-run: it only adds what's missing and replaces policies.
-- Local-first model: the whole app state is stored as one JSON blob per user.

-- ---------------- Tables ----------------

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Дружба между пользователями. ID друга = его auth.users.id.
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  requester_name text,
  created_at timestamptz not null default now(),
  unique (requester, addressee)
);

alter table public.app_state enable row level security;
alter table public.friendships enable row level security;

-- ---------------- app_state policies ----------------

-- Читать своё состояние можно всегда; состояние друга — только если между
-- вами есть принятая дружба.
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
create policy "state select self or friends" on public.app_state
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
  );

drop policy if exists "own state insert" on public.app_state;
create policy "own state insert" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own state update" on public.app_state;
create policy "own state update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own state delete" on public.app_state;
create policy "own state delete" on public.app_state
  for delete using (auth.uid() = user_id);

-- ---------------- friendships policies ----------------

-- Видеть строки, где вы участвуете.
drop policy if exists "friendship select" on public.friendships;
create policy "friendship select" on public.friendships
  for select using (auth.uid() = requester or auth.uid() = addressee);

-- Отправить запрос можно только от своего имени и не самому себе.
drop policy if exists "friendship insert" on public.friendships;
create policy "friendship insert" on public.friendships
  for insert with check (auth.uid() = requester and requester <> addressee);

-- Принять запрос может только адресат.
drop policy if exists "friendship update" on public.friendships;
create policy "friendship update" on public.friendships
  for update using (auth.uid() = addressee) with check (auth.uid() = addressee);

-- Удалить/отклонить/отменить дружбу может любая из сторон.
drop policy if exists "friendship delete" on public.friendships;
create policy "friendship delete" on public.friendships
  for delete using (auth.uid() = requester or auth.uid() = addressee);

-- ---------------- Публичные ID (серия AA + 6 цифр) ----------------
-- Читаемый ID для добавления в друзья: AA000001, AA000002, … AA999999,
-- затем AB000001 и так далее. Выдаётся по порядку регистрации.

create sequence if not exists public.public_id_seq start 1;

create or replace function public.generate_public_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n          bigint;
  series_idx int;
  num        int;
begin
  n          := nextval('public.public_id_seq');
  series_idx := ((n - 1) / 999999)::int;
  num        := ((n - 1) % 999999 + 1)::int;
  return chr(65 + series_idx / 26) || chr(65 + series_idx % 26) || lpad(num::text, 6, '0');
end;
$$;

create table if not exists public.profiles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  public_id text unique not null
);

alter table public.profiles enable row level security;

drop policy if exists "read own public_id" on public.profiles;
create policy "read own public_id" on public.profiles
  for select using (auth.uid() = user_id);

-- Автовыдача ID при регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, public_id)
  values (new.id, public.generate_public_id());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Поиск UUID по публичному ID (для заявок в друзья; обходит RLS).
create or replace function public.find_user_by_public_id(p_public_id text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select user_id from public.profiles
  where public_id = upper(trim(p_public_id))
  limit 1;
$$;

revoke all on function public.find_user_by_public_id(text) from public, anon;
grant execute on function public.find_user_by_public_id(text) to authenticated;

-- Бэкфилл: выдать ID существующим пользователям по порядку регистрации.
insert into public.profiles (user_id, public_id)
select id, public.generate_public_id()
from auth.users
where id not in (select user_id from public.profiles)
order by created_at;

-- ---------------- Удаление аккаунта (DSGVO Art. 17) ----------------
-- Пользователь удаляет сам себя. Удаление auth.users каскадно стирает
-- app_state и friendships (ON DELETE CASCADE выше).
create or replace function public.delete_current_user()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_current_user() from public, anon;
grant execute on function public.delete_current_user() to authenticated;
