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
-- После прогона выполните supabase/verify.sql — 85 проверок, только чтение.
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
--   supabase/migrations/2026-08-23_moderation_and_coach.sql
--   supabase/migrations/2026-08-23_challenges.sql
--   supabase/migrations/2026-08-24_ai_usage.sql
--   supabase/migrations/2026-08-25_promo_codes.sql
--   supabase/migrations/2026-08-25_admin_views.sql
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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-24_ai_usage.sql
-- ###########################################################################

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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-25_promo_codes.sql
-- ###########################################################################

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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-25_admin_views.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — панель управления доступом для владельца приложения.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- Отдельного админ-экрана в приложении нет и не заводится: администрирование
-- здесь исторически идёт через SQL Editor (так же ставятся баны). Поэтому
-- «панель» — это два представления и функция выпуска кодов.
--
-- ⚠️ ПРАВА. Представления читают auth.users, то есть почты живых людей. В
-- Supabase новым таблицам и представлениям по умолчанию раздаются права на
-- anon и authenticated — если их не отозвать, любой вошедший выгрузит список
-- всех пользователей с почтами одним запросом. Поэтому ниже стоит явный
-- revoke, а доступ оставлен только service_role и владельцу базы (это вы в
-- SQL Editor).
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------- Кто каким доступом обладает ----------------
-- Одна строка на пользователя: подписка Stripe, промокод и действующий тариф —
-- тот, который выше. Логика «лучший из двух» повторяет bestTier из
-- src/lib/subscription.js: это единственное место, где она дублируется, и
-- менять её нужно в обоих.
-- drop + create, а не create or replace: замена представления требует того же
-- набора колонок в том же порядке, и любая будущая правка состава полей
-- ломала бы повторный прогон.
drop view if exists public.admin_subscriptions;
create view public.admin_subscriptions as
with live as (
  select
    u.id  as user_id,
    u.email,
    u.created_at as registered_at,
    -- Тариф Stripe засчитываем только при живом статусе.
    case
      when s.status in ('active','trialing','past_due') then coalesce(s.tier,'FREE')
      else 'FREE'
    end as stripe_tier,
    s.status as stripe_status,
    s.current_period_end as stripe_until,
    s.cancel_at_period_end,
    g.code as promo_code,
    coalesce(g.tier,'FREE') as promo_tier,
    g.granted_until as promo_until,
    a.spent_micro,
    a.requests
  from auth.users u
  left join public.subscriptions s on s.user_id = u.id
  -- Лучшая действующая выдача: сначала по старшинству тарифа, потом по сроку.
  left join lateral (
    select pg.code, pg.tier, pg.granted_until
    from public.promo_grants pg
    where pg.user_id = u.id and pg.granted_until > now()
    order by case pg.tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end desc,
             pg.granted_until desc
    limit 1
  ) g on true
  left join public.ai_usage a
    on a.user_id = u.id and a.period = to_char(now() at time zone 'utc', 'YYYY-MM')
)
select
  user_id,
  email,
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_tier else stripe_tier
  end as tier,
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'промокод' else
      case when stripe_tier = 'FREE' then '—' else 'stripe' end
  end as source,
  -- До какого числа действует то, что человек имеет сейчас.
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_until else stripe_until
  end as until,
  stripe_tier,
  stripe_status,
  cancel_at_period_end,
  promo_code,
  nullif(promo_tier,'FREE') as promo_tier,
  promo_until,
  -- Расход на ассистента в текущем месяце, в долларах.
  round(coalesce(spent_micro,0) / 1000000.0, 4) as ai_spent_usd,
  coalesce(requests,0) as ai_requests,
  registered_at
from live;

-- ---------------- Как расходятся коды ----------------
drop view if exists public.admin_promo_codes;
create view public.admin_promo_codes as
select
  c.code,
  c.tier,
  c.days,
  c.used,
  c.max_uses,
  c.max_uses - c.used as left_uses,
  c.expires_at,
  case
    when c.expires_at is not null and c.expires_at <= now() then 'просрочен'
    when c.used >= c.max_uses then 'разобран'
    else 'действует'
  end as state,
  c.note,
  c.created_at,
  (select count(*) from public.promo_grants g
    where g.code = c.code and g.granted_until > now()) as active_now
from public.promo_codes c;

-- ---------------- Выпуск кода ----------------
-- Избавляет от ручного INSERT и от придумывания кода. Возвращает созданную
-- строку — код виден сразу в результате запроса.
--
-- Алфавит без 0/O и 1/I: код диктуют голосом и переписывают от руки, и эти
-- пары путают чаще всего.
create or replace function public.issue_promo(
  p_tier       text,
  p_days       integer,
  p_max_uses   integer default 1,
  p_expires_at timestamptz default null,
  p_note       text default null,
  p_code       text default null
)
returns public.promo_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_row  public.promo_codes%rowtype;
  i integer;
begin
  if p_tier not in ('AI','AI_PLUS') then
    raise exception 'issue_promo: тариф должен быть AI или AI_PLUS, получено %', p_tier;
  end if;

  -- Заданный вручную код используем как есть, иначе генерируем.
  if p_code is not null then
    insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
    values (upper(btrim(p_code)), p_tier, p_days, p_max_uses, p_expires_at, p_note)
    returning * into v_row;
    return v_row;
  end if;

  -- Десять попыток на случай совпадения: при 32^8 вариантов это защита от
  -- астрономически редкого столкновения, а не рабочий сценарий.
  for attempt in 1..10 loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    begin
      insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
      values (v_code, p_tier, p_days, p_max_uses, p_expires_at, p_note)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- код занят, пробуем следующий
    end;
  end loop;

  raise exception 'issue_promo: не удалось подобрать свободный код за 10 попыток';
end $$;

-- ---------------- Права ----------------
-- Оба представления и функция — инструменты владельца, не приложения.
revoke all on public.admin_subscriptions from anon, authenticated;
revoke all on public.admin_promo_codes  from anon, authenticated;
grant select on public.admin_subscriptions to service_role;
grant select on public.admin_promo_codes  to service_role;

revoke all on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  to service_role;
