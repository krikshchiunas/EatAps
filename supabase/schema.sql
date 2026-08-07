-- EatAps — Supabase schema
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Safe to re-run: it only adds what's missing and replaces policies.
-- Local-first model: the whole app state is stored as one JSON blob per user.
--
-- ВАЖНО: сразу после этого файла выполните
--   supabase/migrations/2026-08-06_account_sync.sql
-- Он добавляет версионирование состояния (revision + compare-and-swap),
-- переносит «был(а) в сети» в отдельную таблицу presence и закрывает прямую
-- запись в app_state. Без него синхронизация между устройствами работает по
-- старой схеме «кто последний записал, тот и прав» и теряет чужие правки.
-- Порядок обязателен: schema.sql → migrations/2026-08-06_account_sync.sql.

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

-- «Был(а) в сети». Исторически жило в app_state; миграция account_sync
-- переносит отметку в отдельную таблицу presence, чтобы heartbeat раз в минуту
-- не трогал строку состояния и не рассылал по Realtime весь блоб.
alter table public.app_state add column if not exists last_seen timestamptz;

-- Легаси-версию функции создаём ТОЛЬКО если миграция ещё не прогонялась.
-- Иначе повторный запуск этого файла после миграции откатил бы функцию на
-- старую колонку и тихо сломал «был(а) в сети» — порядок запуска файлов не
-- должен иметь значения.
do $$
begin
  if to_regclass('public.presence') is null then
    execute $fn$
      create or replace function public.touch_last_seen()
      returns void
      language sql
      security definer
      set search_path = public
      as $body$
        update public.app_state set last_seen = now() where user_id = auth.uid();
      $body$;
    $fn$;
    execute 'revoke all on function public.touch_last_seen() from public, anon';
    execute 'grant execute on function public.touch_last_seen() to authenticated';
  end if;
end $$;

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

-- ---------------- Чат между друзьями ----------------
-- Сообщения хранятся в отдельной таблице; фотографии — в бакете Storage.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  text text,
  image_url text,
  meal_ref jsonb,
  created_at timestamptz not null default now(),
  check (text is not null or image_url is not null or meal_ref is not null)
);

-- Ответы (reply) и пересылка (forward). Связь по ID + денормализованный снимок
-- цитаты (reply_snapshot), чтобы цитата корректно рисовалась даже если оригинал
-- удалён (reply_to тогда становится NULL по on delete set null).
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists reply_snapshot jsonb;
alter table public.messages add column if not exists forwarded_name text;

create index if not exists messages_pair_idx
  on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_recipient_idx
  on public.messages (recipient, created_at desc);

alter table public.messages enable row level security;

-- Видеть сообщение может только его отправитель или получатель.
drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select using (auth.uid() = sender or auth.uid() = recipient);

-- Отправить может только сам себе не самому, и только принятому другу.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and sender <> recipient
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = sender and f.addressee = recipient)
          or (f.addressee = sender and f.requester = recipient)
        )
    )
  );

-- Удалить своё сообщение может только автор (получатель не удаляет чужие).
drop policy if exists "messages delete" on public.messages;
create policy "messages delete" on public.messages
  for delete using (auth.uid() = sender);

-- Статус прочтения: получатель проставляет read_at, отправитель видит «вилку».
-- Бэкфилл делаем ТОЛЬКО в момент первого добавления колонки: вся переписка,
-- существовавшая до появления фичи, считается прочитанной. Иначе при повторном
-- прогоне схемы мы бы затёрли настоящие непрочитанные.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'read_at'
  ) then
    alter table public.messages add column read_at timestamptz;
    update public.messages set read_at = created_at;
  end if;
end $$;

create index if not exists messages_unread_idx
  on public.messages (recipient, read_at) where read_at is null;

-- Обновлять строку может только получатель — и только чтобы отметить прочтение.
-- Триггер ниже страхует: получателю разрешено менять исключительно read_at.
drop policy if exists "messages mark read" on public.messages;
create policy "messages mark read" on public.messages
  for update using (auth.uid() = recipient) with check (auth.uid() = recipient);

create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  -- Получатель не может подменить содержимое — только выставить read_at.
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text is distinct from old.text
       or new.image_url is distinct from old.image_url
       or new.meal_ref is distinct from old.meal_ref
       or new.sender is distinct from old.sender
       or new.recipient is distinct from old.recipient
       or new.created_at is distinct from old.created_at then
      raise exception 'Only read_at can be updated by the recipient';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_update_guard on public.messages;
create trigger messages_update_guard
  before update on public.messages
  for each row execute function public.guard_message_update();

-- Отметить прочитанными все входящие от конкретного собеседника.
create or replace function public.mark_messages_read(p_sender uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
  set read_at = now()
  where recipient = auth.uid() and sender = p_sender and read_at is null;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- Realtime: включить публикацию для этой таблицы (для supabase.channel).
-- Идемпотентно: alter publication add table падает, если таблица уже там.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

-- REPLICA IDENTITY FULL нужен, чтобы realtime-фильтры (sender=eq.…) работали
-- на UPDATE-событиях: иначе в WAL уезжает только PK и фильтр не матчится.
-- Без этого статус прочтения не долетал бы до отправителя в реальном времени.
alter table public.messages replica identity full;

-- ---------------- Бакет для фото из чата ----------------
insert into storage.buckets (id, name, public)
  values ('chat-images', 'chat-images', true)
  on conflict (id) do nothing;

-- Читать фото могут все (URL всё равно уникальный, публичный бакет).
drop policy if exists "chat-images read" on storage.objects;
create policy "chat-images read" on storage.objects
  for select using (bucket_id = 'chat-images');

-- Заливать может только авторизованный, и только в свою папку {uid}/…
drop policy if exists "chat-images write own" on storage.objects;
create policy "chat-images write own" on storage.objects
  for insert with check (
    bucket_id = 'chat-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "chat-images delete own" on storage.objects;
create policy "chat-images delete own" on storage.objects
  for delete using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------- Подписки Stripe ----------------
-- Одна строка на пользователя. Пишет только сервер (webhook) через
-- service_role — RLS ему не мешает; пользователю оставляем только SELECT
-- своей строки. Тир хранится как FREE/AI/AI_PLUS, отдельные детали Stripe
-- (customer_id, subscription_id, current_period_end) — здесь же.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'FREE' check (tier in ('FREE','AI','AI_PLUS')),
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists subs_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

drop policy if exists "sub select own" on public.subscriptions;
create policy "sub select own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Realtime: чтобы фронт получал апдейты статуса сразу после вебхука.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriptions'
  ) then
    execute 'alter publication supabase_realtime add table public.subscriptions';
  end if;
end $$;

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
