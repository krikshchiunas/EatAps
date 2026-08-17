-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ПОЛНАЯ УСТАНОВКА БАЗЫ, ОДИН ФАЙЛ.
--
-- Что это: schema.sql и все шесть миграций, склеенные в правильном порядке.
-- Вставить целиком в Supabase → SQL Editor → Run. Одного прогона достаточно.
--
-- Безопасно для базы с данными. Файл идемпотентен целиком:
--   • таблицы создаются через create table if not exists;
--   • политики и функции — через drop/create или create or replace;
--   • бэкфилл прочтения сообщений срабатывает только при первом появлении
--     колонки read_at;
--   • перевыдача публичных ID трогает только коды старого формата.
-- Повторный прогон ничего не ломает и не перевыдаёт заново.
--
-- ЕДИНСТВЕННОЕ ЗАМЕТНОЕ ПОСЛЕДСТВИЕ: если в базе ещё лежат последовательные
-- публичные ID (AA000001 и подобные), они будут заменены на случайные
-- 12-символьные. Ранее розданные коды перестанут работать — свой новый нужно
-- взять в «Профиль → Редактировать профиль». Это обязательный шаг: по
-- последовательным кодам перебором находились все аккаунты.
--
-- После прогона выполните supabase/verify.sql — 54 проверки, только чтение.
-- Все строки должны быть ✔.
--
-- Файл собран из этих источников, править нужно ИХ, а не копию:
--   supabase/schema.sql
--   supabase/migrations/2026-08-06_account_sync.sql
--   supabase/migrations/2026-08-07_friend_privacy.sql
--   supabase/migrations/2026-08-08_hardening.sql
--   supabase/migrations/2026-08-08_chat_reactions.sql
--   supabase/migrations/2026-08-09_unpredictable_public_id.sql
--   supabase/migrations/2026-08-11_profile_and_thoughts.sql
-- ═══════════════════════════════════════════════════════════════════════════



-- ###########################################################################
-- ИСТОЧНИК: supabase/schema.sql
-- ###########################################################################

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

-- ---------------- Публичные ID (12 символов, случайные) ----------------
-- Короткий код для добавления в друзья. Единственное, что по нему можно
-- сделать, — найти UUID владельца и отправить заявку.
--
-- ID выдаётся СЛУЧАЙНО из 32-символьного алфавита длиной 12 символов:
-- 32^12 ≈ 1.15·10^18 вариантов. Так было не всегда: сначала коды выдавались
-- подряд (AA000001, AA000002…), и перебор находил всех зарегистрированных
-- пользователей за столько запросов, сколько их в базе. Подробности и
-- перевыдача старых кодов — в migrations/2026-08-09_unpredictable_public_id.sql.

create table if not exists public.profiles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  public_id text unique not null
);

-- Приведение пользовательского ввода к каноническому виду: разделители,
-- пробелы и регистр значения не имеют, неоднозначные буквы сворачиваются по
-- Крокфорду (I и L → 1, O → 0). Зеркало живёт в src/lib/publicId.js — алфавит
-- и длина обязаны совпадать.
create or replace function public.normalize_public_id(p_raw text)
returns text
language sql
immutable
as $$
  select v from (
    select translate(
             upper(regexp_replace(coalesce(p_raw, ''), '[^0-9A-Za-z]', '', 'g')),
             'ILO', '110'
           ) as v
  ) t
  where v ~ '^[0-9A-HJKMNP-TV-Z]{12}$';
$$;

revoke all on function public.normalize_public_id(text) from public, anon;
grant execute on function public.normalize_public_id(text) to authenticated;

create or replace function public.generate_public_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Крокфордов base32: цифры и латиница без I, L, O и U.
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  hex       text;
  candidate text;
  byte      int;
  i         int;
  attempt   int := 0;
begin
  loop
    -- gen_random_uuid() — функция ядра PostgreSQL 13+, доступна всегда.
    -- gen_random_bytes() из pgcrypto здесь не годится: в Supabase расширение
    -- живёт в схеме extensions, а тут закреплён search_path = public, и вызов
    -- упал бы прямо в триггере регистрации. md5 — не защита, а равномерный
    -- расширитель двух uuid (по 122 бита случайности) до 128 бит.
    hex := md5(gen_random_uuid()::text || gen_random_uuid()::text);
    candidate := '';
    for i in 1..12 loop
      byte := ('x' || substr(hex, i * 2 - 1, 2))::bit(8)::int;  -- 0..255
      -- 256 делится на 32 нацело — остаток не смещает распределение.
      candidate := candidate || substr(alphabet, 1 + (byte % 32), 1);
    end loop;

    exit when not exists (select 1 from public.profiles where public_id = candidate);

    attempt := attempt + 1;
    if attempt >= 20 then
      raise exception 'could not generate a unique public id after % attempts', attempt;
    end if;
  end loop;
  return candidate;
end;
$$;

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
-- Если ввод не похож на публичный ID, normalize_public_id вернёт NULL, сравнение
-- с NULL не даст ни одной строки — функция честно ответит «не найдено».
create or replace function public.find_user_by_public_id(p_public_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.profiles
  where public_id = public.normalize_public_id(p_public_id)
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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-06_account_sync.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — надёжная синхронизация аккаунта между устройствами.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ supabase/schema.sql.
-- Идемпотентно: можно прогонять повторно, данные не удаляются.
--
-- Что решает:
--   1. Раньше клиент делал upsert всего блоба app_state.state. Два устройства,
--      открытые одновременно, затирали правки друг друга без следа (lost
--      update). Теперь запись возможна ТОЛЬКО через save_app_state() с
--      compare-and-swap по revision: обновление применяется, если с момента
--      чтения никто другой не писал. Иначе клиент получает актуальную версию,
--      сливает её со своей и повторяет.
--   2. Прямые INSERT/UPDATE на app_state отозваны у клиентских ролей — слепая
--      перезапись становится физически невозможной, а не «не должна случаться».
--   3. updated_at проставляет сервер (now()), а не клиент: часы устройств
--      расходятся, и клиентское время нельзя использовать как порядок записей.
--   4. «Был(а) в сети» переехал из app_state в отдельную таблицу presence.
--      Иначе heartbeat раз в минуту трогал бы строку app_state и рассылал по
--      Realtime весь блоб состояния каждому устройству.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Версия строки состояния
-- ─────────────────────────────────────────────────────────────────────────
-- default 1: существующие строки получают revision = 1, а «0/NULL» на клиенте
-- однозначно означает «я ещё не видел строку», а не «видел версию ноль».
alter table public.app_state
  add column if not exists revision bigint not null default 1;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Присутствие (последняя активность) — отдельно от состояния
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.presence (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now()
);

alter table public.presence enable row level security;

-- Видеть можно себя и принятых друзей — тот же круг, что и для app_state.
drop policy if exists "presence select self or friends" on public.presence;
create policy "presence select self or friends" on public.presence
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = presence.user_id)
          or (f.addressee = auth.uid() and f.requester = presence.user_id)
        )
    )
  );

-- Писать напрямую нельзя — только через touch_last_seen().
revoke insert, update, delete on public.presence from authenticated, anon;

-- Переносим уже накопленные отметки из app_state (одноразово, без потерь).
insert into public.presence (user_id, last_seen)
select user_id, last_seen from public.app_state where last_seen is not null
on conflict (user_id) do update set last_seen = greatest(public.presence.last_seen, excluded.last_seen);

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.presence (user_id, last_seen)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen = now();
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

create or replace function public.get_last_seen(p_user_id uuid)
returns timestamptz
language sql
stable
security invoker          -- RLS presence решает, кому можно; чужое вернёт NULL
set search_path = public
as $$
  select last_seen from public.presence where user_id = p_user_id;
$$;

revoke all on function public.get_last_seen(uuid) from public, anon;
grant execute on function public.get_last_seen(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Единственный путь записи состояния: compare-and-swap
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER, потому что прямая запись в app_state ролям отозвана (см.
-- п.4). Функция трогает ИСКЛЮЧИТЕЛЬНО строку auth.uid() — user_id никогда не
-- берётся из аргументов, поэтому подставить чужой ID невозможно.
--
-- Контракт: p_base_revision — версия, на которой основана правка.
--   • NULL / <= 0  → «строки не было»: вставляем. Если строка всё-таки есть —
--                    это конфликт, отдаём актуальную.
--   • N            → обновляем, только если revision всё ещё N.
-- При успехе out_state = NULL: клиенту и так известно, что он записал, а гонять
-- весь блоб обратно на каждое сохранение — лишний трафик на мобильной сети.
-- Состояние возвращается только при конфликте, когда его действительно нужно
-- слить.
-- Всегда возвращает актуальную версию и флаг conflict.
create or replace function public.save_app_state(
  p_state jsonb,
  p_base_revision bigint default null
)
returns table (
  out_revision   bigint,
  out_updated_at timestamptz,
  out_state      jsonb,
  out_conflict   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_at  timestamptz;
  v_st  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'state must be a json object' using errcode = '22023';
  end if;

  if p_base_revision is null or p_base_revision <= 0 then
    insert into public.app_state (user_id, state, revision, updated_at)
    values (v_uid, p_state, 1, now())
    on conflict (user_id) do nothing
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  else
    update public.app_state
       set state      = p_state,
           revision   = revision + 1,
           updated_at = now()
     where user_id = v_uid
       and revision = p_base_revision
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  end if;

  -- Не применилось → кто-то опередил (или строку удалили). Отдаём то, что есть,
  -- чтобы клиент слил и повторил. Молча ничего не перезаписываем.
  select a.revision, a.updated_at, a.state into v_rev, v_at, v_st
    from public.app_state a where a.user_id = v_uid;

  return query select coalesce(v_rev, 0::bigint), v_at, v_st, true;
end;
$$;

revoke all on function public.save_app_state(jsonb, bigint) from public, anon;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Закрываем прямую запись в app_state
-- ─────────────────────────────────────────────────────────────────────────
-- После этого ни один клиент (даже с валидным токеном) не может перезаписать
-- своё состояние в обход проверки версии. SELECT (своё + друзья) и DELETE
-- (право на удаление данных) остаются.
revoke insert, update on public.app_state from authenticated, anon;

-- Политики insert/update больше не нужны: грант отозван, а RPC работает как
-- definer. Оставляем их на месте — они безвредны и пригодятся, если грант
-- когда-нибудь вернут (тогда ограничение auth.uid() = user_id снова в силе).

-- Страховка на уровне БД: revision монотонно растёт, updated_at ставит сервер.
create or replace function public.guard_app_state_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  if new.state is distinct from old.state and new.revision <= old.revision then
    raise exception 'revision must increase when state changes';
  end if;
  if new.state is distinct from old.state then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists app_state_update_guard on public.app_state;
create trigger app_state_update_guard
  before update on public.app_state
  for each row execute function public.guard_app_state_update();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Realtime для app_state — чтобы правки приезжали на другие устройства
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state'
  ) then
    execute 'alter publication supabase_realtime add table public.app_state';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Чистка legacy-колонки last_seen
-- ─────────────────────────────────────────────────────────────────────────
-- Колонку НЕ удаляем: старые вкладки, открытые в момент деплоя, ещё могут её
-- читать (fetchLastSeen). Данные уже скопированы в presence, писать в неё
-- больше некому. Удалить можно вручную позже:
--   alter table public.app_state drop column if exists last_seen;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Ужесточение прав на messages
-- ─────────────────────────────────────────────────────────────────────────
-- Получателю разрешено ставить read_at и только его. Прежний триггер не
-- проверял reply_to/reply_snapshot/forwarded_name и позволял снять отметку
-- прочтения обратно в NULL.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name then
      raise exception 'Only read_at can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Индексы
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists friendships_requester_idx on public.friendships (requester, status);


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-07_friend_privacy.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — друг видит ровно то, что показано в интерфейсе, и ничего больше.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-08-06_account_sync.sql.
-- Идемпотентно, данные не трогает.
--
-- Что решает:
--   1. Политика SELECT на app_state пускала принятого друга ко ВСЕЙ строке
--      состояния. В интерфейсе друга видно имя, фото, био, любимые места, цель
--      по калориям и дневник — но прочитать из строки можно было заодно вес,
--      возраст, рост, пол, все настройки и историю поиска. Разрыв между
--      «что показано» и «что доступно» — это и есть утечка.
--      Теперь SELECT на app_state только свой, а друзьям отдаёт выборку через
--      функцию, которая физически не возвращает лишних полей.
--   2. Если триггер handle_new_user когда-то не отработал, у человека навсегда
--      не было public_id — и его нельзя было добавить в друзья, без единого
--      признака проблемы. Добавлен ensure_public_id(): выдаёт ID и чинит
--      пропуск при первом же обращении.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Состояние друга — только видимая часть
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: RLS обойдён намеренно, авторизация — проверка принятой
-- дружбы внутри функции. p_user_id участвует только в этой проверке и в
-- выборке; подставить произвольный ID и получить чужие данные нельзя.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid() or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = p_user_id)
          or (f.addressee = auth.uid() and f.requester = p_user_id)
        )
    )
    then jsonb_strip_nulls(jsonb_build_object(
      -- Профиль: только поля, которые реально рисуются в FriendAccount.
      -- Вес, рост, возраст, пол, цель и уровень активности сюда НЕ входят.
      'profile', jsonb_build_object(
        'name',          a.state->'profile'->'name',
        'avatar',        a.state->'profile'->'avatar',
        'bio',           a.state->'profile'->'bio',
        'favRestaurant', a.state->'profile'->'favRestaurant',
        'favDish',       a.state->'profile'->'favDish',
        'targets',       jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
      ),
      'days', coalesce(a.state->'days', '{}'::jsonb),
      -- Составные блюда нужны, чтобы раскрыть состав записи в дневнике.
      -- Обычные свои продукты и ингредиенты другу не отдаём.
      'customFoods', coalesce((
        select jsonb_agg(f)
        from jsonb_array_elements(coalesce(a.state->'customFoods', '[]'::jsonb)) f
        where f->>'kind' = 'composite' and f ? 'recipe'
      ), '[]'::jsonb)
    ))
    else null
  end
  from public.app_state a
  where a.user_id = p_user_id;
$$;

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Имя и фото друзей списком — одним запросом, без остального состояния
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.friend_briefs(p_user_ids uuid[])
returns table (user_id uuid, name text, avatar text)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         a.state->'profile'->>'name',
         a.state->'profile'->>'avatar'
  from public.app_state a
  where a.user_id = any(p_user_ids)
    and (
      a.user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester = auth.uid() and f.addressee = a.user_id)
            or (f.addressee = auth.uid() and f.requester = a.user_id)
          )
      )
    );
$$;

revoke all on function public.friend_briefs(uuid[]) from public, anon;
grant execute on function public.friend_briefs(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Закрываем прямое чтение чужого состояния
-- ─────────────────────────────────────────────────────────────────────────
-- ВАЖНО, ПОРЯДОК: сначала задеплойте фронтенд, потом выполните этот файл.
-- Новый фронтенд работает и до, и после миграции: он пробует RPC и при её
-- отсутствии откатывается на прямой запрос. А вот СТАРЫЙ фронтенд после смены
-- политики покажет карточку друга пустой — данные целы, но читать их он не
-- умеет. Поэтому фронтенд идёт первым.
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "own state select" on public.app_state;
create policy "own state select" on public.app_state
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Самолечение публичного ID
-- ─────────────────────────────────────────────────────────────────────────
-- Возвращает public_id текущего пользователя, при отсутствии — выдаёт.
-- Раньше сбой триггера handle_new_user означал, что человека навсегда нельзя
-- добавить в друзья, и заметить это было нечем.
create or replace function public.ensure_public_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select public_id into v_id from public.profiles where user_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.profiles (user_id, public_id)
  values (v_uid, public.generate_public_id())
  on conflict (user_id) do nothing
  returning public_id into v_id;

  -- Параллельный вызов успел вставить строку первым — читаем её.
  if v_id is null then
    select public_id into v_id from public.profiles where user_id = v_uid;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_public_id() from public, anon;
grant execute on function public.ensure_public_id() to authenticated;

-- Разовый добор для тех, у кого ID не выдался раньше.
insert into public.profiles (user_id, public_id)
select u.id, public.generate_public_id()
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
order by u.created_at
on conflict (user_id) do nothing;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-08_hardening.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — устранение слабостей, найденных при аудите системы аккаунтов.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Имя в заявке в друзья больше нельзя подделать
-- ─────────────────────────────────────────────────────────────────────────
-- requester_name приходил из тела запроса и показывался адресату как есть.
-- То есть заявку можно было подписать любым именем — «Мама», «Поддержка
-- EatAps», именем другого пользователя. Классическая социальная инженерия:
-- человек принимает заявку, думая, что знает отправителя, и открывает ему
-- свой дневник.
--
-- Теперь имя берётся на сервере из профиля самого отправителя, а присланное
-- значение игнорируется.
create or replace function public.set_requester_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select nullif(trim(a.state->'profile'->>'name'), '')
    into new.requester_name
  from public.app_state a
  where a.user_id = new.requester;
  return new;
end;
$$;

drop trigger if exists friendships_set_requester_name on public.friendships;
create trigger friendships_set_requester_name
  before insert or update of requester_name on public.friendships
  for each row execute function public.set_requester_name();

-- Разовая чистка уже сохранённых имён: приводим к настоящим.
update public.friendships f
set requester_name = (
  select nullif(trim(a.state->'profile'->>'name'), '')
  from public.app_state a where a.user_id = f.requester
)
where f.status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ограничение размера состояния
-- ─────────────────────────────────────────────────────────────────────────
-- save_app_state принимала jsonb любого размера. Один аккаунт мог записать
-- сотни мегабайт и раздуть базу — ни платного тарифа, ни квоты это не
-- спрашивает. 5 МБ с огромным запасом покрывают годы дневника: аватар
-- сжимается до пары сотен килобайт, запись о продукте весит десятки байт.
create or replace function public.save_app_state(
  p_state jsonb,
  p_base_revision bigint default null
)
returns table (
  out_revision   bigint,
  out_updated_at timestamptz,
  out_state      jsonb,
  out_conflict   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_at  timestamptz;
  v_st  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'state must be a json object' using errcode = '22023';
  end if;

  if octet_length(p_state::text) > 5 * 1024 * 1024 then
    raise exception 'state is too large' using errcode = '54000';
  end if;

  if p_base_revision is null or p_base_revision <= 0 then
    insert into public.app_state (user_id, state, revision, updated_at)
    values (v_uid, p_state, 1, now())
    on conflict (user_id) do nothing
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  else
    update public.app_state
       set state      = p_state,
           revision   = revision + 1,
           updated_at = now()
     where user_id = v_uid
       and revision = p_base_revision
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  end if;

  select a.revision, a.updated_at, a.state into v_rev, v_at, v_st
    from public.app_state a where a.user_id = v_uid;

  return query select coalesce(v_rev, 0::bigint), v_at, v_st, true;
end;
$$;

revoke all on function public.save_app_state(jsonb, bigint) from public, anon;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Ограничение размера запроса имён друзей
-- ─────────────────────────────────────────────────────────────────────────
-- friend_briefs принимала массив любой длины: сто тысяч идентификаторов в
-- одном вызове — дешёвый способ нагрузить базу. Больше 500 друзей у человека
-- всё равно не бывает.
create or replace function public.friend_briefs(p_user_ids uuid[])
returns table (user_id uuid, name text, avatar text)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         a.state->'profile'->>'name',
         a.state->'profile'->>'avatar'
  from public.app_state a
  where a.user_id = any(p_user_ids[1:500])
    and (
      a.user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester = auth.uid() and f.addressee = a.user_id)
            or (f.addressee = auth.uid() and f.requester = a.user_id)
          )
      )
    );
$$;

revoke all on function public.friend_briefs(uuid[]) from public, anon;
grant execute on function public.friend_briefs(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ограничения бакета с фотографиями чата
-- ─────────────────────────────────────────────────────────────────────────
-- Политика разрешала любому авторизованному класть в свою папку файл любого
-- размера и любого типа. Ограничение «сжимаем до 1280px и JPEG» жило только
-- в клиентском коде, то есть не было ограничением вовсе: прямым запросом
-- можно было залить гигабайты чего угодно и использовать хранилище проекта
-- как бесплатный файлообменник.
update storage.buckets
set file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'chat-images';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Заявки в друзья: защита от массовой рассылки
-- ─────────────────────────────────────────────────────────────────────────
-- Публичные ID выдаются подряд (AA000001, AA000002…), а find_user_by_public_id
-- отдаёт по ним UUID любому авторизованному. Это позволяет перебрать всех
-- пользователей и завалить их заявками. Читать чужие данные при этом нельзя —
-- RLS не пускает, — но спам возможен. Ограничиваем частоту исходящих заявок.
--
-- ОБНОВЛЕНИЕ: сама причина устранена в migrations/2026-08-09_unpredictable_public_id.sql —
-- ID стал случайным, и перебор больше ничего не находит. Ограничение частоты
-- ниже остаётся вторым слоем: оно осмысленно и против того, кто раздобыл
-- список ID иначе.
create or replace function public.limit_friend_requests()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.friendships
  where requester = new.requester
    and created_at > now() - interval '1 hour';

  if v_recent >= 30 then
    raise exception 'too many friend requests, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit
  before insert on public.friendships
  for each row execute function public.limit_friend_requests();

create index if not exists friendships_requester_created_idx
  on public.friendships (requester, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Друг не получает настроение, самочувствие и личную заметку дня
-- ─────────────────────────────────────────────────────────────────────────
-- friend_state отдавала объект дня целиком. На экране друга видно только
-- список еды, но в объекте лежат также mood, wellbeing и note — а это куда
-- более личные вещи, чем перечень продуктов: «болит голова», «плохо спал»,
-- свободная заметка о самочувствии. Отдавать то, что не отображается, — это
-- раздача данных без причины. Оставляем из дня ровно meals.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid() or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = p_user_id)
          or (f.addressee = auth.uid() and f.requester = p_user_id)
        )
    )
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',          a.state->'profile'->'name',
        'avatar',        a.state->'profile'->'avatar',
        'bio',           a.state->'profile'->'bio',
        'favRestaurant', a.state->'profile'->'favRestaurant',
        'favDish',       a.state->'profile'->'favDish',
        'targets',       jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
      ),
      'days', coalesce((
        select jsonb_object_agg(d.key, jsonb_build_object('meals', coalesce(d.value->'meals', '[]'::jsonb)))
        from jsonb_each(coalesce(a.state->'days', '{}'::jsonb)) d
      ), '{}'::jsonb),
      'customFoods', coalesce((
        select jsonb_agg(f)
        from jsonb_array_elements(coalesce(a.state->'customFoods', '[]'::jsonb)) f
        where f->>'kind' = 'composite' and f ? 'recipe'
      ), '[]'::jsonb)
    ))
    else null
  end
  from public.app_state a
  where a.user_id = p_user_id;
$$;

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-08_chat_reactions.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — реакция на сообщение в чате (двойной тап → 🥕).
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Колонка реакций
-- ─────────────────────────────────────────────────────────────────────────
-- {user_id: emoji} — в 1-на-1 чате ключей максимум два (отправитель и
-- получатель), поэтому отдельный лимит размера не нужен: объект физически не
-- может разрастись.
alter table public.messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Переключение реакции — единственный штатный путь записи
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: обходит RLS так же, как mark_messages_read. Проверка
-- участника — вручную внутри функции, по auth.uid(). Реакция ограничена одним
-- разрешённым значением намеренно: это не открытый ввод текста в приватное
-- поле, а фиксированный набор из одного эмодзи (морковка). Расширить набор
-- позже — значит расширить список допустимых значений здесь и в guard-триггере
-- ниже, а не открывать поле нараспашку.
--
-- Переключение делает СЕРВЕР, а не клиент: клиент всегда просит «переключить
-- на 🥕», а прочитает ли он это как «добавить» или «убрать» — решает текущее
-- состояние строки на сервере. Так двойной тап с двух устройств почти
-- одновременно не может рассинхронизировать результат сильнее, чем на один
-- лишний клик, который тут же поправит realtime-событие.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_row public.messages%rowtype;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_emoji is distinct from '🥕' then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;

  select * into v_row from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_uid <> v_row.sender and v_uid <> v_row.recipient then
    raise exception 'not a participant of this conversation' using errcode = '42501';
  end if;

  v_key := v_uid::text;
  if v_row.reactions->>v_key = p_emoji then
    v_next := v_row.reactions - v_key;
  else
    v_next := jsonb_set(v_row.reactions, array[v_key], to_jsonb(p_emoji), true);
  end if;

  update public.messages set reactions = v_next where id = p_message_id;
  return v_next;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Guard-триггер: получателю можно менять ТОЛЬКО свой ключ реакции
-- ─────────────────────────────────────────────────────────────────────────
-- RLS у "messages mark read" разрешает получателю UPDATE строки без разбора
-- по колонкам — единственное, что раньше ограничивало его правки, это guard-
-- триггер (список разрешённых полей: только read_at). Если просто добавить
-- reactions в список разрешённых полей, получатель сможет обойти RPC выше и
-- отправить произвольный UPDATE напрямую через клиент — с любым текстом под
-- любым ключом, включая ключ отправителя. Поэтому здесь не "разрешить менять
-- reactions", а точечно: разрешить менять ТОЛЬКО собственный ключ и только на
-- разрешённое значение — тогда даже прямой запрос в обход RPC ничего лишнего
-- сделать не сможет.
--
-- Сторона отправителя отдельной проверки не требует: для неё нет RLS-политики
-- UPDATE вообще, прямой запрос от отправителя отклоняется на уровне RLS раньше,
-- чем дойдёт до этого триггера — правки от его имени идут только через RPC.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
declare
  v_key text := auth.uid()::text;
begin
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name then
      raise exception 'Only read_at and own reaction can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
    if new.reactions is distinct from old.reactions then
      if (old.reactions - v_key) is distinct from (new.reactions - v_key) then
        raise exception 'Only your own reaction key can change';
      end if;
      if new.reactions ? v_key and new.reactions->>v_key is distinct from '🥕' then
        raise exception 'unsupported reaction';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- messages уже в публикации supabase_realtime (см. schema.sql) — публикация
-- задана на уровне таблицы, новая колонка доезжает автоматически, отдельного
-- шага не требует. Строка ниже на случай, если кто-то прогоняет только этот
-- файл на пустой базе.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-09_unpredictable_public_id.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — публичный ID перестаёт быть предсказуемым.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно: повторный прогон не перевыдаёт уже нормальные ID.
--
-- Что решает:
--   Публичные ID выдавались подряд — AA000001, AA000002, AA000003… Перебор от
--   AA000001 через find_user_by_public_id находил ВСЕХ зарегистрированных
--   пользователей ровно за столько запросов, сколько их в базе, и возвращал по
--   каждому его auth-UUID. Читать чужие данные это не давало (RLS не пускает),
--   но давало полный список аккаунтов и возможность завалить каждого заявками
--   в друзья. Ограничение частоты заявок из миграции hardening било по
--   следствию; здесь убирается причина.
--
--   Теперь ID берётся из 32-символьного алфавита длиной 12 символов:
--   32^12 ≈ 1.15·10^18 ≈ 2^60 вариантов. Перебор перестаёт давать что-либо.
--
-- ВАЖНО: у всех существующих пользователей ID выдаётся заново — старые
-- последовательные скомпрометированы самим фактом того, что они
-- последовательные. Ранее розданные коды перестанут работать; на этапе MVP это
-- дешевле, чем оставлять перечислимые идентификаторы.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Приведение пользовательского ввода к каноническому виду
-- ─────────────────────────────────────────────────────────────────────────
-- Разделители, пробелы и регистр значения не имеют. Неоднозначные буквы
-- сворачиваются по Крокфорду: I и L — это 1, O — это 0. U в алфавит не входит
-- вовсе, поэтому код с ним честнее отклонить, чем угадывать.
--
-- Зеркало этой функции живёт в src/lib/publicId.js — наборы символов и длина
-- обязаны совпадать, иначе клиент и база разойдутся в том, что считать
-- корректным ID.
create or replace function public.normalize_public_id(p_raw text)
returns text
language sql
immutable
as $$
  select v from (
    select translate(
             upper(regexp_replace(coalesce(p_raw, ''), '[^0-9A-Za-z]', '', 'g')),
             'ILO', '110'
           ) as v
  ) t
  where v ~ '^[0-9A-HJKMNP-TV-Z]{12}$';
$$;

revoke all on function public.normalize_public_id(text) from public, anon;
grant execute on function public.normalize_public_id(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Случайный генератор вместо последовательности
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.generate_public_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Крокфордов base32: цифры и латиница без I, L, O (неотличимы от 1 и 0) и
  -- без U. Ровно тот же набор, что в src/lib/publicId.js.
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  hex       text;
  candidate text;
  byte      int;
  i         int;
  attempt   int := 0;
begin
  loop
    -- Источник случайности — gen_random_uuid(): функция ядра PostgreSQL 13+,
    -- она есть всегда. gen_random_bytes() из pgcrypto здесь намеренно НЕ
    -- используется: в Supabase расширение живёт в схеме extensions, а у этой
    -- функции закреплён search_path = public — вызов упал бы прямо в триггере
    -- регистрации, то есть люди не смогли бы зарегистрироваться.
    --
    -- md5 здесь не средство защиты, а равномерный расширитель: на входе два
    -- uuid (по 122 бита случайности каждый), на выходе 128 бит, из которых
    -- берутся 12 байт.
    hex := md5(gen_random_uuid()::text || gen_random_uuid()::text);
    candidate := '';
    for i in 1..12 loop
      byte := ('x' || substr(hex, i * 2 - 1, 2))::bit(8)::int;  -- 0..255
      -- 256 делится на 32 нацело, поэтому остаток не смещает распределение.
      candidate := candidate || substr(alphabet, 1 + (byte % 32), 1);
    end loop;

    exit when not exists (select 1 from public.profiles where public_id = candidate);

    attempt := attempt + 1;
    if attempt >= 20 then
      raise exception 'could not generate a unique public id after % attempts', attempt;
    end if;
  end loop;
  return candidate;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Поиск по ID — через нормализацию
-- ─────────────────────────────────────────────────────────────────────────
-- Если ввод не похож на публичный ID, normalize_public_id вернёт NULL, сравнение
-- с NULL не даст ни одной строки, и функция честно ответит «не найдено».
create or replace function public.find_user_by_public_id(p_public_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.profiles
  where public_id = public.normalize_public_id(p_public_id)
  limit 1;
$$;

revoke all on function public.find_user_by_public_id(text) from public, anon;
grant execute on function public.find_user_by_public_id(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Перевыдача уже существующих ID
-- ─────────────────────────────────────────────────────────────────────────
-- Условие делает шаг идемпотентным: трогаются только ID старого формата, а
-- повторный прогон файла никому ничего не меняет.
--
-- generate_public_id() объявлена volatile, поэтому вызывается для каждой
-- строки отдельно. Проверка уникальности внутри неё видит снимок на начало
-- запроса и не знает про коды, выданные соседним строкам того же UPDATE, —
-- но при 2^60 вариантах и десятках пользователей совпадение исключено
-- практически, а если бы и случилось, уникальный индекс отклонил бы весь
-- запрос и файл достаточно было бы прогнать ещё раз.
update public.profiles
set public_id = public.generate_public_id()
where public_id !~ '^[0-9A-HJKMNP-TV-Z]{12}$';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Формат закреплён на уровне базы
-- ─────────────────────────────────────────────────────────────────────────
-- Ставится ПОСЛЕ перевыдачи: до неё в таблице ещё лежат коды старого формата.
-- Дальше ни один путь записи не сможет вернуть последовательный ID незаметно.
alter table public.profiles drop constraint if exists profiles_public_id_format;
alter table public.profiles add constraint profiles_public_id_format
  check (public_id ~ '^[0-9A-HJKMNP-TV-Z]{12}$');

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Последовательность больше не нужна
-- ─────────────────────────────────────────────────────────────────────────
-- Оставлять её — значит оставлять на виду готовый механизм выдачи
-- предсказуемых ID.
drop sequence if exists public.public_id_seq;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-11_profile_and_thoughts.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — публичный профиль: списки «не ем»/«люблю» и «Мои мысли».
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
--
-- Порядок деплоя не важен в обе стороны:
--   • старый фронтенд + новая база — ничего не меняется, новые таблицы никто
--     не читает;
--   • новый фронтенд + старая база — вкладка «Мысли» покажет, что раздел пока
--     недоступен (RPC нет → клиент это переживает), списки «не ем»/«люблю» у
--     друга просто не отобразятся, свои сохранятся в app_state как обычно.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Друг видит списки «не ем» и «люблю»
-- ─────────────────────────────────────────────────────────────────────────
-- Это осознанное расширение видимого, а не побочный эффект нового экрана:
-- noGos/toGos по смыслу то же самое «пара слов о себе», что и bio, только
-- структурированное, и рисуются они на том же экране профиля. Всё остальное
-- (вес, рост, возраст, пол, цель, активность, настроение и заметки дня)
-- остаётся закрытым — список полей по-прежнему белый.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid() or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = p_user_id)
          or (f.addressee = auth.uid() and f.requester = p_user_id)
        )
    )
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',          a.state->'profile'->'name',
        'avatar',        a.state->'profile'->'avatar',
        'bio',           a.state->'profile'->'bio',
        'favRestaurant', a.state->'profile'->'favRestaurant',
        'favDish',       a.state->'profile'->'favDish',
        'noGos',         a.state->'profile'->'noGos',
        'toGos',         a.state->'profile'->'toGos',
        'targets',       jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
      ),
      'days', coalesce((
        select jsonb_object_agg(d.key, jsonb_build_object('meals', coalesce(d.value->'meals', '[]'::jsonb)))
        from jsonb_each(coalesce(a.state->'days', '{}'::jsonb)) d
      ), '{}'::jsonb),
      'customFoods', coalesce((
        select jsonb_agg(f)
        from jsonb_array_elements(coalesce(a.state->'customFoods', '[]'::jsonb)) f
        where f->>'kind' = 'composite' and f ? 'recipe'
      ), '[]'::jsonb)
    ))
    else null
  end
  from public.app_state a
  where a.user_id = p_user_id;
$$;

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. «Мои мысли» — посты
-- ─────────────────────────────────────────────────────────────────────────
-- Отдельная таблица, а НЕ поле в app_state. app_state — один блоб на
-- пользователя с версионированием (compare-and-swap) и лимитом 5 МБ: посты
-- растут бесконечно, читаются чужими людьми и должны иметь собственные права
-- доступа. Внутри блоба ни того, ни другого не сделать.
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text,
  image_url  text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  check (text is not null or image_url is not null),
  check (text is null or char_length(text) <= 2000),
  check (image_url is null or char_length(image_url) <= 500)
);

create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);

alter table public.posts enable row level security;

-- Читать пост может автор или принятый друг автора. Тот же предикат, что у
-- app_state: круг «кто меня видит» в приложении ровно один, и заводить второй
-- (публичные посты, подписчики) означало бы новую модель приватности.
drop policy if exists "posts select" on public.posts;
create policy "posts select" on public.posts
  for select using (
    auth.uid() = posts.user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = posts.user_id)
          or (f.addressee = auth.uid() and f.requester = posts.user_id)
        )
    )
  );

-- Писать можно только от своего имени: user_id из тела запроса обязан
-- совпасть с auth.uid(), подделать авторство нельзя.
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts
  for delete using (auth.uid() = user_id);

-- Автор правит текст и фото, но не авторство и не дату создания: иначе пост
-- можно было бы «состарить» или переписать на другого человека. edited_at
-- ставит сервер — клиент об этом не спрашивают.
create or replace function public.guard_post_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'post ownership and creation time are immutable';
  end if;
  if new.text is distinct from old.text or new.image_url is distinct from old.image_url then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists posts_update_guard on public.posts;
create trigger posts_update_guard
  before update on public.posts
  for each row execute function public.guard_post_update();

-- Защита от заливки мусора: тот же приём, что у заявок в друзья.
create or replace function public.limit_posts()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.posts
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'too many posts, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.limit_posts();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Общая проверка «мне виден этот пост»
-- ─────────────────────────────────────────────────────────────────────────
-- Нужна в политиках реакций и комментариев. SECURITY DEFINER намеренно:
-- функция обязана читать posts НАПРЯМУЮ. Обычная функция внутри политики
-- смотрела бы на posts через RLS и утащила бы за собой рекурсию политик.
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.friendships f
          where f.status = 'accepted'
            and (
              (f.requester = auth.uid() and f.addressee = p.user_id)
              or (f.addressee = auth.uid() and f.requester = p.user_id)
            )
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Реакции: 🥕 «мне нравится» и 🥦 «не моё»
-- ─────────────────────────────────────────────────────────────────────────
-- Одна реакция на человека и пост (первичный ключ), поэтому «переключить»
-- всегда однозначно. Набор значений закрыт списком, как у реакции в чате:
-- это не поле свободного ввода, которое пишется в чужую строку.
create table if not exists public.post_reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reaction   text not null check (reaction in ('🥕', '🥦')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_reactions_post_idx on public.post_reactions (post_id);

alter table public.post_reactions enable row level security;

-- ЧИТАТЬ можно ТОЛЬКО свою реакцию. Это не мелочь: если разрешить читать все
-- строки поста, то, открыв пост друга, я получу user_id всех, кто на него
-- отреагировал, — то есть кусок списка друзей автора, включая людей, которых
-- я не знаю. Наружу отдаются только счётчики, и делает это RPC ниже.
drop policy if exists "post reactions select own" on public.post_reactions;
create policy "post reactions select own" on public.post_reactions
  for select using (auth.uid() = user_id);

-- Штатный путь записи — toggle_post_reaction. Политики ниже существуют как
-- второй слой: даже прямым запросом нельзя поставить реакцию под чужим
-- именем или на пост, которого не видно.
drop policy if exists "post reactions insert own" on public.post_reactions;
create policy "post reactions insert own" on public.post_reactions
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id));

drop policy if exists "post reactions update own" on public.post_reactions;
create policy "post reactions update own" on public.post_reactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "post reactions delete own" on public.post_reactions;
create policy "post reactions delete own" on public.post_reactions
  for delete using (auth.uid() = user_id);

-- Переключение делает СЕРВЕР по auth.uid(): p_user_id клиент не передаёт и
-- передать не может. Повторная та же реакция снимает её, другая — заменяет.
create or replace function public.toggle_post_reaction(p_post_id uuid, p_reaction text)
returns table (carrots int, broccoli int, mine text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_reaction is distinct from '🥕' and p_reaction is distinct from '🥦' then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'post not visible' using errcode = '42501';
  end if;

  select r.reaction into v_cur
  from public.post_reactions r
  where r.post_id = p_post_id and r.user_id = v_uid
  for update;

  if v_cur = p_reaction then
    delete from public.post_reactions where post_id = p_post_id and user_id = v_uid;
  else
    insert into public.post_reactions (post_id, user_id, reaction)
    values (p_post_id, v_uid, p_reaction)
    on conflict (post_id, user_id) do update
      set reaction = excluded.reaction, created_at = now();
  end if;

  return query
    select
      (select count(*) from public.post_reactions r where r.post_id = p_post_id and r.reaction = '🥕')::int,
      (select count(*) from public.post_reactions r where r.post_id = p_post_id and r.reaction = '🥦')::int,
      (select r.reaction from public.post_reactions r where r.post_id = p_post_id and r.user_id = v_uid);
end;
$$;

revoke all on function public.toggle_post_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_post_reaction(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Ответы на мысль
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

drop policy if exists "post comments select" on public.post_comments;
create policy "post comments select" on public.post_comments
  for select using (public.can_view_post(post_id));

drop policy if exists "post comments insert own" on public.post_comments;
create policy "post comments insert own" on public.post_comments
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id));

-- UPDATE-политики нет вовсе: комментарий нельзя отредактировать — ни чужой,
-- ни свой. Отсутствие политики означает запрет для всех, и это надёжнее
-- любого списка разрешённых полей.

-- Удалить может автор комментария или владелец поста: свою ветку человек
-- должен уметь чистить сам, иначе единственным модератором остаёмся мы.
drop policy if exists "post comments delete" on public.post_comments;
create policy "post comments delete" on public.post_comments
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.posts p where p.id = post_comments.post_id and p.user_id = auth.uid())
  );

create or replace function public.limit_post_comments()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.post_comments
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 120 then
    raise exception 'too many comments, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists post_comments_rate_limit on public.post_comments;
create trigger post_comments_rate_limit
  before insert on public.post_comments
  for each row execute function public.limit_post_comments();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Чтение ленты
-- ─────────────────────────────────────────────────────────────────────────
-- Отдаём посты вместе со СЧЁТЧИКАМИ реакций и своей реакцией. Именно поэтому
-- это RPC, а не обычный select со связанными таблицами: связанный select
-- вернул бы строки реакций, то есть поимённый список отреагировавших (см.
-- политику в разделе 4). Проверка дружбы — внутри, как в friend_state.
create or replace function public.list_posts(
  p_user_id uuid,
  p_limit   int default 20,
  p_before  timestamptz default null
)
returns table (
  id             uuid,
  user_id        uuid,
  text           text,
  image_url      text,
  created_at     timestamptz,
  edited_at      timestamptz,
  carrots        int,
  broccoli       int,
  my_reaction    text,
  comments_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.user_id, p.text, p.image_url, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    (select count(*) from public.post_comments c where c.post_id = p.id)::int
  from public.posts p
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and (
      p_user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester = auth.uid() and f.addressee = p_user_id)
            or (f.addressee = auth.uid() and f.requester = p_user_id)
          )
      )
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;

-- Ответы вместе с именем и фото автора.
--
-- ВАЖНО, что это значит для приватности: отвечая на мысль друга, человек
-- показывает своё имя и аватар остальным друзьям автора — в том числе тем,
-- с кем он сам не дружит. Для ветки ответов это неизбежно (без имени ответ
-- не имеет смысла), но это осознанный шаг, а не случайность: наружу уходят
-- ровно имя и фото — те же два поля, что и в friend_briefs, и ничего больше.
create or replace function public.list_post_comments(p_post_id uuid, p_limit int default 100)
returns table (
  id            uuid,
  user_id       uuid,
  text          text,
  created_at    timestamptz,
  author_name   text,
  author_avatar text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.user_id, c.text, c.created_at,
         a.state->'profile'->>'name',
         a.state->'profile'->>'avatar'
  from public.post_comments c
  left join public.app_state a on a.user_id = c.user_id
  where c.post_id = p_post_id
    and public.can_view_post(p_post_id)
  order by c.created_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_post_comments(uuid, int) from public, anon;
grant execute on function public.list_post_comments(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Бакет для фотографий из «Мыслей»
-- ─────────────────────────────────────────────────────────────────────────
-- Устроен так же, как chat-images: заливать можно только в свою папку {uid}/,
-- размер и типы ограничены на стороне базы, а не только в клиенте.
--
-- Бакет публичный на чтение — как и у чата. Это значит: у кого есть точный
-- URL, тот увидит картинку без проверки дружбы. Сам URL содержит uuid и не
-- перебирается, ссылку на него не отдаёт ни один запрос без прав, но
-- рассчитывать на бакет как на границу доступа нельзя — границей остаётся RLS
-- на posts.
insert into storage.buckets (id, name, public)
  values ('post-images', 'post-images', true)
  on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'post-images';

drop policy if exists "post-images read" on storage.objects;
create policy "post-images read" on storage.objects
  for select using (bucket_id = 'post-images');

drop policy if exists "post-images write own" on storage.objects;
create policy "post-images write own" on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-images delete own" on storage.objects;
create policy "post-images delete own" on storage.objects
  for delete using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
