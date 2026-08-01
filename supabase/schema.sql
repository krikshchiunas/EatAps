-- EatAps — Supabase schema
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Local-first model: the whole app state is stored as one JSON blob per user.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: a user can only read/write their own row.
alter table public.app_state enable row level security;

drop policy if exists "own state select" on public.app_state;
create policy "own state select" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "own state insert" on public.app_state;
create policy "own state insert" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own state update" on public.app_state;
create policy "own state update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own state delete" on public.app_state;
create policy "own state delete" on public.app_state
  for delete using (auth.uid() = user_id);
