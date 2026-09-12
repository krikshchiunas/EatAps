-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ПОЛНАЯ УСТАНОВКА БАЗЫ, ОДИН ФАЙЛ.
--
-- ⚠ ФАЙЛ СОБИРАЕТСЯ АВТОМАТИЧЕСКИ. Не правьте его руками — правки затрёт
--   следующая сборка, а ручная склейка уже однажды разъехалась и оставила
--   файл невыполнимым. Правьте ИСТОЧНИКИ (список ниже) и запускайте
--       node scripts/build-setup-all.mjs
--
-- Что это: все миграции, склеенные в правильном порядке, от самой первой.
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
-- ЗАМЕТНЫЕ ПОСЛЕДСТВИЯ ПРОГОНА:
--
--   • Публичные ID (7K4M-9XPQ-2RTV и старые AA000001) удаляются вместе с
--     колонкой. Единственный адрес человека — ник, он же username.
--
--   • Заявки в друзья исчезают как класс. Друзьями становятся те, кто подписан
--     друг на друга; дневник питания и личные сообщения открываются им же.
--
--   • Дружба перестаёт быть таблицей-источником: права считаются по подпискам
--     (2026-09-05_social_hardening), а строка friendships остаётся только
--     якорем уведомления «теперь вы друзья».
--
-- После прогона выполните supabase/verify.sql, supabase/verify_social.sql и
-- supabase/verify_nickname.sql — все строки должны быть ✔.
--
-- Файл собран из этих источников, править нужно ИХ, а не копию:
--   supabase/migrations/2026-08-05_initial.sql
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
--   supabase/migrations/2026-08-25_social_graph.sql
--   supabase/migrations/2026-08-26_nickname_identity.sql
--   supabase/migrations/2026-08-26_ai_premium_tier.sql
--   supabase/migrations/2026-08-26_daily_usage_and_premium_admin.sql
--   supabase/migrations/2026-08-26_admin_subscriptions_writable.sql
--   supabase/migrations/2026-08-28_profile_rework.sql
--   supabase/migrations/2026-09-05_social_hardening.sql
--   supabase/migrations/2026-09-07_open_messaging_and_diary_privacy.sql
--   supabase/migrations/2026-09-08_notification_upsert_fix.sql
--   supabase/migrations/2026-09-09_social_graph_v2.sql
--   supabase/migrations/2026-09-09_conversations.sql
--   supabase/migrations/2026-09-11_fav_restaurant.sql
--   supabase/migrations/2026-09-12_private_media.sql
--   supabase/migrations/2026-09-12_stripe_events.sql
--   supabase/migrations/2026-09-12_ai_ledger.sql
--   supabase/migrations/2026-09-12_rate_limits.sql
--   supabase/migrations/2026-09-12_restore_post_visibility.sql
--   supabase/migrations/2026-09-12_media_path_ownership.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-05_initial.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ПЕРВАЯ миграция. Раньше файл назывался supabase/schema.sql, и это
-- имя вводило в заблуждение: он описывает не текущее устройство базы, а её
-- состояние на 2026-08-05. Значительная часть того, что здесь создаётся,
-- ПОЗЖЕ ОТМЕНЯЕТСЯ следующими миграциями:
--
--   • profiles.public_id и четыре функции вокруг него удалены целиком
--     (2026-08-26_nickname_identity) — единственный адрес человека теперь ник;
--   • заявки в друзья (friendship insert/update/delete) демонтированы там же:
--     дружба стала производной от взаимной подписки;
--   • прямая запись в app_state отозвана (2026-08-06_account_sync) —
--     единственный путь сохранения состояния это save_app_state();
--   • app_state.last_seen заменён таблицей presence (там же);
--   • select-политика app_state переписана трижды и в итоге считает права
--     через is_friend_with (2026-09-05_social_hardening).
--
-- ⚠ ОТДЕЛЬНО ЭТОТ ФАЙЛ НЕ ЗАПУСКАЮТ. Он имеет смысл только как первый шаг
--   полной цепочки. Для установки базы с нуля берут supabase/setup_all.sql —
--   в нём этот файл и все миграции склеены в единственно верном порядке.
--
-- Что в базе на самом деле — supabase/docs/catalog.md (генерируется из
-- исходников, врать не может). Зачем так — supabase/docs/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

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
-- ⚠ ВЫПОЛНЯЕТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА profiles.public_id.
--
-- Её удаляет 2026-08-26_nickname_identity. На базе, где та миграция уже
-- прошла, всё, что читает или пишет эту колонку, падает с
--   42703: column "public_id" does not exist
-- причём у функций на language sql — прямо при СОЗДАНИИ: их тело проверяется
-- в этот момент, а не при вызове. Прогон setup_all.sql вставал на этой строке.
--
-- Поэтому историческая часть ставится под условием: на свежей базе она нужна
-- как шаг истории, на уже мигрированной — пропускается целиком.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute $fn$
      create or replace function public.find_user_by_public_id(p_public_id text)
      returns uuid
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select user_id from public.profiles
        where public_id = public.normalize_public_id(p_public_id)
        limit 1;
      $body$;
    $fn$;
    execute 'revoke all on function public.find_user_by_public_id(text) from public, anon';
    execute 'grant execute on function public.find_user_by_public_id(text) to authenticated';

    -- Бэкфилл: выдать ID существующим пользователям по порядку регистрации.
    insert into public.profiles (user_id, public_id)
    select id, public.generate_public_id()
    from auth.users
    where id not in (select user_id from public.profiles)
    order by created_at;
  end if;
end $$;

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
-- Запускать в Supabase SQL Editor ПОСЛЕ supabase/migrations/2026-08-05_initial.sql.
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

-- ⚠ ВЫПОЛНЯЕТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА profiles.public_id.
--
-- Её удаляет 2026-08-26_nickname_identity. На базе, где та миграция уже
-- прошла, всё, что читает или пишет эту колонку, падает с
--   42703: column "public_id" does not exist
-- причём у функций на language sql — прямо при СОЗДАНИИ: их тело проверяется
-- в этот момент, а не при вызове. Прогон setup_all.sql вставал на этой строке.
--
-- Поэтому историческая часть ставится под условием: на свежей базе она нужна
-- как шаг истории, на уже мигрированной — пропускается целиком.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    -- Разовый добор для тех, у кого ID не выдался раньше.
    insert into public.profiles (user_id, public_id)
    select u.id, public.generate_public_id()
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where p.user_id is null
    order by u.created_at
    on conflict (user_id) do nothing;
  end if;
end $$;


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
-- messages уже в публикации supabase_realtime (см. 2026-08-05_initial.sql) — публикация
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
-- ⚠ ВЫПОЛНЯЕТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА profiles.public_id.
--
-- Её удаляет 2026-08-26_nickname_identity. На базе, где та миграция уже
-- прошла, всё, что читает или пишет эту колонку, падает с
--   42703: column "public_id" does not exist
-- причём у функций на language sql — прямо при СОЗДАНИИ: их тело проверяется
-- в этот момент, а не при вызове. Прогон setup_all.sql вставал на этой строке.
--
-- Поэтому историческая часть ставится под условием: на свежей базе она нужна
-- как шаг истории, на уже мигрированной — пропускается целиком.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute $fn$
      create or replace function public.find_user_by_public_id(p_public_id text)
      returns uuid
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select user_id from public.profiles
        where public_id = public.normalize_public_id(p_public_id)
        limit 1;
      $body$;
    $fn$;
    execute 'revoke all on function public.find_user_by_public_id(text) from public, anon';
    execute 'grant execute on function public.find_user_by_public_id(text) to authenticated';
  end if;
end $$;

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
-- ⚠ ВЫПОЛНЯЕТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА profiles.public_id.
--
-- Её удаляет 2026-08-26_nickname_identity. На базе, где та миграция уже
-- прошла, всё, что читает или пишет эту колонку, падает с
--   42703: column "public_id" does not exist
-- причём у функций на language sql — прямо при СОЗДАНИИ: их тело проверяется
-- в этот момент, а не при вызове. Прогон setup_all.sql вставал на этой строке.
--
-- Поэтому историческая часть ставится под условием: на свежей базе она нужна
-- как шаг истории, на уже мигрированной — пропускается целиком.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    update public.profiles
    set public_id = public.generate_public_id()
    where public_id !~ '^[0-9A-HJKMNP-TV-Z]{12}$';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Формат закреплён на уровне базы
-- ─────────────────────────────────────────────────────────────────────────
-- Ставится ПОСЛЕ перевыдачи: до неё в таблице ещё лежат коды старого формата.
-- Дальше ни один путь записи не сможет вернуть последовательный ID незаметно.
-- ⚠ ВЫПОЛНЯЕТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА profiles.public_id.
--
-- Её удаляет 2026-08-26_nickname_identity. На базе, где та миграция уже
-- прошла, всё, что читает или пишет эту колонку, падает с
--   42703: column "public_id" does not exist
-- причём у функций на language sql — прямо при СОЗДАНИИ: их тело проверяется
-- в этот момент, а не при вызове. Прогон setup_all.sql вставал на этой строке.
--
-- Поэтому историческая часть ставится под условием: на свежей базе она нужна
-- как шаг истории, на уже мигрированной — пропускается целиком.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute 'alter table public.profiles drop constraint if exists profiles_public_id_format';
    execute 'alter table public.profiles add constraint profiles_public_id_format
      check (public_id ~ ''^[0-9A-HJKMNP-TV-Z]{12}$'')';
  end if;
end $$;

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
-- ⚠ DROP перед CREATE обязателен, и вот почему. Позже visibility добавит в
-- возвращаемый набор ещё одну колонку (2026-08-25), а набор OUT-параметров —
-- часть типа функции: create or replace сменить его не умеет и отвечает
--   42P13: cannot change return type of existing function
-- На чистой базе этого не видно — функции ещё нет. Ломался ПОВТОРНЫЙ прогон
-- setup_all.sql поверх уже мигрированной базы: здесь пытались создать версию
-- на десять колонок поверх живой на одиннадцать, и весь файл вставал на этой
-- строке. Права выдаются заново сразу после создания — drop забирает их с собой.
drop function if exists public.list_posts(uuid, int, timestamptz);

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
-- Тот же приём и по той же причине: 2026-09-05 добавит сюда курсор и ник автора.
-- Здесь сигнатура ещё двухаргументная, поэтому без drop повторный прогон оставил
-- бы рядом две перегрузки — и вызов стал бы неоднозначным для Postgres.
drop function if exists public.list_post_comments(uuid, int);

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
-- ⚠ ЭТА ВЕРСИЯ СОЗДАЁТСЯ ТОЛЬКО ПОКА ЖИВА КОЛОНКА public_id.
--
-- Колонку удаляет 2026-08-26_nickname_identity, а вместе с ней меняется и набор
-- колонок этой функции: (public_id, name) → (username, name). Для повторного
-- прогона setup_all.sql поверх уже мигрированной базы это две ошибки сразу:
--   42P13 — create or replace не меняет набор OUT-параметров;
--   42703 — тело на language sql проверяется при создании, а p.public_id нет.
-- Поэтому старая редакция ставится под условием: на свежей базе она нужна как
-- шаг истории, на мигрированной — пропускается, и в силе остаётся версия из
-- 2026-08-26. Тот же приём, что у touch_last_seen в первой миграции.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute $fn$
      create or replace function public.user_brief(p_user uuid)
      returns table (public_id text, name text)
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select p.public_id, (s.state -> 'profile' ->> 'name')
        from public.profiles p
        left join public.app_state s on s.user_id = p.user_id
        where p.user_id = p_user;
      $body$;
    $fn$;
    execute 'revoke all on function public.user_brief(uuid) from public, anon';
    execute 'grant execute on function public.user_brief(uuid) to authenticated';
  end if;
end $$;


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
  -- Значения латиницей намеренно. Кириллица в ДАННЫХ проходит через буфер
  -- обмена, редактор и SQL-консоль — на любом стыке она может побиться, и
  -- в таблице появятся кракозябры вместо слов. Комментарии на русском такой
  -- проблемы не создают: они никуда не отдаются.
  case
    when case promo_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'promo' else
      case when stripe_tier = 'FREE' then 'none' else 'stripe' end
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
  -- Тоже латиницей и по той же причине.
  case
    when c.expires_at is not null and c.expires_at <= now() then 'expired'
    when c.used >= c.max_uses then 'used_up'
    else 'active'
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


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-25_social_graph.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — социальный граф: подписки, блокировки, публичные профили,
-- видимость постов, лента и серверные уведомления.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЭТА МИГРАЦИЯ МЕНЯЕТ ПРИНЦИПИАЛЬНО
--
-- До неё в приложении был ровно один круг доступа: принятая дружба. Она же
-- отвечала на все три разных вопроса сразу:
--   • «мы в социальной связи?»
--   • «я вижу твой контент?»
--   • «я могу тебе написать?»
-- Это было записано в комментариях к 2026-08-11 как осознанный выбор.
--
-- Теперь эти три вопроса разделены:
--
--   FOLLOW      — односторонний интерес. A→B не создаёт B→A.
--   FRIENDSHIP  — взаимная связь, по-прежнему через заявку и подтверждение.
--   PERMISSION  — производная от visibility поста, follow, дружбы и блокировок,
--                 а НЕ синоним дружбы.
--
-- Дружба продолжает существовать и продолжает давать самый широкий доступ
-- (дневник питания, личные сообщения). Подписка даёт доступ только к тому,
-- что автор пометил как followers/public.
--
-- ───────────────────────────────────────────────────────────────────────────
-- РЕШЕНИЯ ПО ПРИВАТНОСТИ, ПРИНЯТЫЕ ВЛАДЕЛЬЦЕМ ПРОДУКТА ЯВНО
--
-- 1. username, display_name и avatar_url становятся ПУБЛИЧНЫМИ: их читает
--    любой авторизованный пользователь, и все существующие аккаунты попадают
--    в поиск. Это сознательное расширение по сравнению с прежней моделью, где
--    имя и аватар лежали внутри приватного app_state и отдавались только
--    друзьям через friend_briefs.
--
--    Цена решения названа прямо: поиск по имени — это перебор пользовательской
--    базы. Миграция 2026-08-09 закрывала ровно эту дыру со стороны публичных
--    ID (последовательные коды позволяли найти всех). Здесь она открывается
--    заново с другой стороны, и защищает нас только rate limit в search_users
--    плюс требование минимум трёх символов — не сама модель.
--
-- 2. Существующие посты переводятся в visibility='followers', а не остаются
--    'friends'. Люди писали их, когда «увидеть» мог только принятый друг;
--    теперь их увидит и подписчик. Это ретроактивное расширение аудитории уже
--    написанного текста.
--
--    ВАЖНО для DSGVO: оба пункта расширяют обработку персональных данных
--    существующих пользователей. docs/compliance/verzeichnis-verarbeitungs-
--    taetigkeiten.md нужно обновить, а пользователей — уведомить до того, как
--    фронтенд с этой моделью уедет в прод.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Публичный профиль: username, отображаемое имя, аватар
-- ─────────────────────────────────────────────────────────────────────────
-- Таблица profiles уже существует (user_id + public_id) и до сих пор читалась
-- ТОЛЬКО владельцем. Расширяем её и переворачиваем политику чтения.
--
-- Почему username хранится как text, а не citext: citext в Supabase живёт в
-- схеме extensions, а все наши функции закреплены на search_path = public.
-- Тот же капкан уже ловили с gen_random_bytes (см. 2026-08-09). Вместо
-- расширения — жёсткий инвариант «в базе всегда нижний регистр», закреплённый
-- check-constraint'ом, и нормализация на входе.

alter table public.profiles add column if not exists username      text;
alter table public.profiles add column if not exists display_name  text;
alter table public.profiles add column if not exists avatar_url    text;
alter table public.profiles add column if not exists created_at    timestamptz not null default now();

-- 3–20 символов, латиница/цифры/подчёркивание, только нижний регистр.
-- Регистр закреплён в базе, чтобы «Andrej» и «andrej» не сосуществовали:
-- уникальный индекс по text различал бы их, и два человека получили бы
-- визуально неотличимые адреса профиля.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 60);

-- Аватар в EatAps — НЕ ссылка, а data URL: src/lib/avatar.js кадрирует фото в
-- квадрат 256×256 и кладёт в JSON профиля как base64 JPEG (см. комментарий
-- «чтобы аватар помещался в синхронизируемый JSON-профиль»). Это десятки
-- килобайт строки, а не 500 символов.
--
-- Лимит здесь не ради экономии места, а как потолок: он ловит попытку записать
-- в публичную таблицу мегабайтную картинку, но не мешает штатному аватару.
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len
  check (avatar_url is null or char_length(avatar_url) <= 300000);

create unique index if not exists profiles_username_key on public.profiles (username);

-- Префиксный поиск: индекс работает для username LIKE 'abc%'. text_pattern_ops
-- нужен потому, что в не-C локали обычный btree для LIKE не используется.
create index if not exists profiles_username_prefix_idx
  on public.profiles (username text_pattern_ops);
create index if not exists profiles_display_name_prefix_idx
  on public.profiles (lower(display_name) text_pattern_ops);


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Выдача username существующим пользователям
-- ─────────────────────────────────────────────────────────────────────────
-- Каждому нужен адрес профиля. Базой берём имя из app_state (то, что человек
-- сам про себя написал), приводим к допустимому виду; если после очистки
-- ничего не осталось или занято — добавляем суффикс из публичного ID, который
-- уже гарантированно уникален.

create or replace function public.slugify_username(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(
    substr(
      regexp_replace(
        regexp_replace(lower(coalesce(p_raw, '')), '[^a-z0-9_]+', '_', 'g'),
        '^_+|_+$', '', 'g'
      ),
    1, 20),
  '');
$$;

create or replace function public.claim_username(p_user_id uuid, p_hint text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base   text := public.slugify_username(p_hint);
  v_pub    text;
  v_try    text;
  v_n      int := 0;
begin
  select public_id into v_pub from public.profiles where user_id = p_user_id;

  -- Слишком короткая или пустая основа — берём хвост публичного ID. Он уже
  -- случайный и уникальный, так что коллизий по построению не будет.
  if v_base is null or char_length(v_base) < 3 then
    v_base := 'eater_' || lower(right(coalesce(v_pub, replace(p_user_id::text, '-', '')), 6));
  end if;

  v_try := v_base;
  loop
    exit when not exists (
      select 1 from public.profiles where username = v_try and user_id <> p_user_id
    );
    v_n := v_n + 1;
    if v_n > 50 then
      v_try := 'eater_' || lower(right(replace(gen_random_uuid()::text, '-', ''), 10));
      exit;
    end if;
    -- Обрезаем основу так, чтобы вместе с суффиксом уложиться в 20 символов.
    v_try := substr(v_base, 1, 19 - char_length(v_n::text)) || '_' || v_n::text;
  end loop;

  return v_try;
end;
$$;

revoke all on function public.claim_username(uuid, text) from public, anon;

-- Бэкфилл. Выполняется один раз: у кого username уже есть — не трогаем, чтобы
-- повторный прогон файла не переименовал людей.
do $$
declare
  r record;
begin
  for r in
    select p.user_id, a.state->'profile'->>'name' as nm, a.state->'profile'->>'avatar' as av
    from public.profiles p
    left join public.app_state a on a.user_id = p.user_id
    where p.username is null
  loop
    update public.profiles
       set username     = public.claim_username(r.user_id, r.nm),
           display_name = coalesce(display_name, left(r.nm, 60)),
           -- Аватар сверх потолка НЕ обрезаем, а пропускаем: обрезанный base64
           -- — это не «картинка поменьше», а битая строка, которую браузер не
           -- покажет. Пусто честнее: Avatar в интерфейсе нарисует инициал.
           avatar_url   = coalesce(avatar_url,
                            case when char_length(coalesce(r.av, '')) between 1 and 300000
                                 then r.av end)
     where user_id = r.user_id;
  end loop;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Зеркалирование имени и аватара из app_state в профиль
-- ─────────────────────────────────────────────────────────────────────────
-- Источник истины для имени и аватара остаётся внутри app_state: там их пишет
-- существующий экран профиля, и переучивать весь фронтенд ради этой миграции
-- незачем. Публичная копия обновляется триггером.
--
-- Триггер висит на app_state, а не внутри save_app_state, намеренно: путей
-- записи в состояние исторически было несколько (RPC, прямой upsert у старых
-- клиентов), и копия обязана обновиться по любому из них.

create or replace function public.sync_profile_from_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(coalesce(new.state->'profile'->>'name', ''), 60), '');
  v_raw  text := new.state->'profile'->>'avatar';
  -- Имя обрезать можно: слишком длинное имя остаётся именем. Аватар — нельзя:
  -- это base64-строка, и обрезанная она не картинка, а мусор. Поэтому сверх
  -- потолка пишем NULL, и интерфейс рисует инициал.
  v_av   text := case when char_length(coalesce(v_raw, '')) between 1 and 300000
                      then v_raw end;
begin
  update public.profiles
     set display_name = v_name,
         avatar_url   = v_av
   where user_id = new.user_id
     and (display_name is distinct from v_name or avatar_url is distinct from v_av);
  return null;
end;
$$;

drop trigger if exists app_state_profile_sync on public.app_state;
create trigger app_state_profile_sync
  after insert or update of state on public.app_state
  for each row execute function public.sync_profile_from_state();


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Регистрация: профиль сразу с username
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub text := public.generate_public_id();
begin
  -- Сначала строка профиля (public_id уникален по построению), затем username
  -- через claim_username. Наивное 'eater_' || right(public_id, 6) здесь не
  -- годится: хвост из шести символов не наследует уникальность целого кода, и
  -- на десятках тысяч аккаунтов совпадения появятся по парадоксу дней рождения
  -- — регистрация падала бы с нарушением уникального индекса.
  insert into public.profiles (user_id, public_id) values (new.id, v_pub);
  update public.profiles
     set username = public.claim_username(new.id, null)
   where user_id = new.id;
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Подписки
-- ─────────────────────────────────────────────────────────────────────────
-- Односторонняя связь. Первичный ключ по паре делает повторную подписку
-- невозможной на уровне базы, а не на уровне «клиент не должен нажимать
-- дважды»: без него быстрый двойной тап давал бы две строки и удвоенный
-- счётчик подписчиков.

-- Таблица блокировок создаётся ЗДЕСЬ, до политик follows, а не в своём
-- разделе ниже: политика «нельзя подписаться на заблокировавшего» ссылается на
-- public.blocks, а Postgres проверяет выражение политики в момент её создания.
-- При обратном порядке миграция падает на relation does not exist.
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

create table if not exists public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id, created_at desc);
create index if not exists follows_follower_idx  on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;

-- Подписки читаются всеми авторизованными: списки «подписчики» и «подписки» —
-- часть публичного профиля в выбранной модели. Скрыть их означало бы, что
-- счётчики на профиле нечем посчитать.
drop policy if exists "follows select" on public.follows;
create policy "follows select" on public.follows
  for select using (auth.role() = 'authenticated');

-- Подписаться можно только от своего имени и только на того, кто не заблокировал
-- вас и кого не заблокировали вы.
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = following_id and b.blocked_id = follower_id)
         or (b.blocker_id = follower_id  and b.blocked_id = following_id)
    )
  );

-- Отписаться может подписчик. Также объект подписки может удалить чужую
-- подписку на себя — это «убрать подписчика» без блокировки.
drop policy if exists "follows delete" on public.follows;
create policy "follows delete" on public.follows
  for delete using (auth.uid() = follower_id or auth.uid() = following_id);

-- UPDATE-политики нет: строка подписки неизменяема, менять в ней нечего.
-- Отсутствие политики надёжнее списка разрешённых полей.

-- Защита от массовой автоподписки — тем же приёмом, что и заявки в друзья
-- в 2026-08-08_hardening.
create or replace function public.limit_follows()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.follows
  where follower_id = new.follower_id and created_at > now() - interval '1 hour';

  if v_recent >= 200 then
    raise exception 'too many follows, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists follows_rate_limit on public.follows;
create trigger follows_rate_limit
  before insert on public.follows
  for each row execute function public.limit_follows();


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Блокировки
-- ─────────────────────────────────────────────────────────────────────────
-- Блокировка — жёсткий разрыв: она сносит подписки в обе стороны и дружбу.
-- Иначе заблокированный остался бы подписчиком и продолжал получать контент,
-- а счётчики показывали бы несуществующую связь.

-- Читать можно ТОЛЬКО свои блокировки. Если бы заблокированный видел строку,
-- блокировка перестала бы быть тихой и превратилась бы в уведомление
-- «вас заблокировали» — ровно то, чего от неё не ждут.
drop policy if exists "blocks select own" on public.blocks;
create policy "blocks select own" on public.blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists "blocks insert own" on public.blocks;
create policy "blocks insert own" on public.blocks
  for insert with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

drop policy if exists "blocks delete own" on public.blocks;
create policy "blocks delete own" on public.blocks
  for delete using (auth.uid() = blocker_id);

create or replace function public.apply_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);

  delete from public.friendships
   where (requester = new.blocker_id and addressee = new.blocked_id)
      or (requester = new.blocked_id and addressee = new.blocker_id);

  -- Уведомления от заблокированного тоже убираем: иначе в центре событий
  -- остаётся висеть «X отреагировал» от человека, которого больше нет.
  delete from public.notifications
   where recipient_id = new.blocker_id and actor_id = new.blocked_id;

  return new;
end;
$$;

drop trigger if exists blocks_apply on public.blocks;
create trigger blocks_apply
  after insert on public.blocks
  for each row execute function public.apply_block();


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Единая проверка «есть ли блокировка между двумя»
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER обязателен: политика blocks отдаёт только свои строки, а
-- проверять нужно обе стороны. Без обхода RLS функция внутри политики видела
-- бы половину картины и пропускала бы контент заблокировавшего.

create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

create or replace function public.is_friend_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = p_a and f.addressee = p_b)
        or (f.requester = p_b and f.addressee = p_a))
  );
$$;

revoke all on function public.is_friend_with(uuid, uuid) from public, anon;
grant execute on function public.is_friend_with(uuid, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Уведомления
-- ─────────────────────────────────────────────────────────────────────────
-- Единая серверная таблица. До неё «уведомления» существовали только как
-- локальный Notification API в браузере (src/lib/notifications.js): событие
-- показывалось один раз на том устройстве, где вкладка была открыта, и нигде
-- не сохранялось. Открыв приложение на другом телефоне, человек не узнавал
-- ничего. Непрочитанное считалось по messages и по ключу в localStorage.
--
-- Теперь источник истины — эта таблица, а localStorage остаётся только для
-- UI-предпочтений (закрепления, заглушения).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'FOLLOW', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED',
      'POST_REACTION', 'POST_COMMENT', 'MESSAGE'
    );
  end if;
end $$;

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete cascade,
  type         public.notification_type not null,
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint notifications_not_self check (actor_id is null or actor_id <> recipient_id),
  constraint notifications_entity_type check (
    entity_type is null or entity_type in ('post', 'comment', 'user', 'friendship', 'message')
  )
);

-- Лента событий читается «сначала новые», непрочитанные считаются отдельно.
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

-- Одно и то же событие не должно порождать две строки: лайк, снятый и
-- поставленный заново, — это по-прежнему один факт «X отреагировал на пост Y».
-- Частичный уникальный индекс делает дедупликацию свойством базы, а не
-- дисциплиной вызывающего кода.
--
-- Для MESSAGE ключом служит id собеседника, а не id сообщения. Это не мелочь:
-- строка на каждое сообщение росла бы вместе со всей перепиской и дублировала
-- бы уже существующий серверный счётчик непрочитанных по messages.read_at.
-- Здесь нужен другой факт — «в этом диалоге есть новое», — и вести он должен
-- к диалогу, а не к отдельной реплике (см. требование «message → conversation»).
create unique index if not exists notifications_dedup_idx
  on public.notifications (recipient_id, actor_id, type, entity_id)
  where entity_id is not null;

alter table public.notifications enable row level security;

-- Читать — только свои.
drop policy if exists "notifications select own" on public.notifications;
create policy "notifications select own" on public.notifications
  for select using (auth.uid() = recipient_id);

-- INSERT-ПОЛИТИКИ НЕТ ВОВСЕ. Это главная защита таблицы: клиент не может
-- создать уведомление никому, включая себя. Единственный путь записи —
-- SECURITY DEFINER триггеры ниже, которые выполняются от владельца таблицы и
-- потому RLS не подчиняются. Требование «user A cannot create notification for
-- arbitrary user» выполняется отсутствием политики, а не проверкой в политике.

-- Пометить прочитанным может только получатель. Guard-триггер следит, чтобы
-- через этот же UPDATE нельзя было переписать содержимое события.
drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete using (auth.uid() = recipient_id);

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if new.recipient_id is distinct from old.recipient_id
     or new.actor_id    is distinct from old.actor_id
     or new.type        is distinct from old.type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id   is distinct from old.entity_id
     or new.metadata    is distinct from old.metadata
     or new.created_at  is distinct from old.created_at then
    raise exception 'only read_at can be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_update_guard on public.notifications;
create trigger notifications_update_guard
  before update on public.notifications
  for each row execute function public.guard_notification_update();

-- Общая точка записи для всех триггеров. Молча ничего не делает, если актор и
-- получатель совпадают или между ними блокировка.
create or replace function public.push_notification(
  p_recipient   uuid,
  p_actor       uuid,
  p_type        public.notification_type,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked_between(p_recipient, p_actor) then
    return;
  end if;

  insert into public.notifications
    (recipient_id, actor_id, type, entity_type, entity_id, metadata)
  values
    (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (recipient_id, actor_id, type, entity_id)
    where entity_id is not null
  do update set created_at = now(), read_at = null, metadata = excluded.metadata;
end;
$$;

revoke all on function public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb)
  from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Триггеры событий
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_notification(
    new.following_id, new.follower_id, 'FOLLOW', 'user', new.follower_id
  );
  return new;
end;
$$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

-- Заявка в друзья и её принятие — два разных события двум разным людям.
create or replace function public.notify_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      perform public.push_notification(
        new.addressee, new.requester, 'FRIEND_REQUEST', 'friendship', new.id
      );
    elsif new.status = 'accepted' then
      perform public.push_notification(
        new.addressee, new.requester, 'FRIEND_ACCEPTED', 'friendship', new.id
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    -- Принял адресат — узнать должен тот, кто заявку отправлял.
    perform public.push_notification(
      new.requester, new.addressee, 'FRIEND_ACCEPTED', 'friendship', new.id
    );
    -- Сама заявка больше не событие: она обработана.
    delete from public.notifications
     where type = 'FRIEND_REQUEST' and entity_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify
  after insert or update on public.friendships
  for each row execute function public.notify_on_friendship();

-- Заявку отозвали или отклонили — уведомление о ней снимаем.
create or replace function public.cleanup_friendship_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications where entity_id = old.id and entity_type = 'friendship';
  return old;
end;
$$;

drop trigger if exists friendships_notify_cleanup on public.friendships;
create trigger friendships_notify_cleanup
  after delete on public.friendships
  for each row execute function public.cleanup_friendship_notifications();

create or replace function public.notify_on_post_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select user_id into v_author from public.posts where id = new.post_id;
  perform public.push_notification(
    v_author, new.user_id, 'POST_REACTION', 'post', new.post_id,
    jsonb_build_object('reaction', new.reaction)
  );
  return new;
end;
$$;

drop trigger if exists post_reactions_notify on public.post_reactions;
create trigger post_reactions_notify
  after insert or update on public.post_reactions
  for each row execute function public.notify_on_post_reaction();

-- Реакцию сняли — событие исчезает. Иначе «X отреагировал» остаётся висеть
-- после того, как реакции под постом уже нет, и вести с него некуда.
create or replace function public.cleanup_post_reaction_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where type = 'POST_REACTION' and entity_id = old.post_id and actor_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists post_reactions_notify_cleanup on public.post_reactions;
create trigger post_reactions_notify_cleanup
  after delete on public.post_reactions
  for each row execute function public.cleanup_post_reaction_notification();

-- Комментарий, в отличие от реакции, — отдельный факт на каждую реплику:
-- дедупликация по (recipient, actor, type, post) свернула бы десять ответов
-- в одну строку. Поэтому entity_id тут — id комментария, а не поста, и путь
-- из уведомления ведёт к конкретной реплике.
create or replace function public.notify_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select user_id into v_author from public.posts where id = new.post_id;
  perform public.push_notification(
    v_author, new.user_id, 'POST_COMMENT', 'comment', new.id,
    jsonb_build_object('post_id', new.post_id, 'excerpt', left(new.text, 140))
  );
  return new;
end;
$$;

drop trigger if exists post_comments_notify on public.post_comments;
create trigger post_comments_notify
  after insert on public.post_comments
  for each row execute function public.notify_on_post_comment();

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- entity_id = отправитель: одна строка на диалог, обновляемая каждым новым
  -- сообщением. id самого сообщения уезжает в metadata — он нужен только для
  -- пуша, но не для навигации.
  perform public.push_notification(
    new.recipient, new.sender, 'MESSAGE', 'message', new.sender,
    jsonb_build_object('message_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_message();


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Видимость постов
-- ─────────────────────────────────────────────────────────────────────────
-- Ключевой разрыв связи «дружба = доступ». Теперь доступ определяет автор для
-- каждого поста, а дружба — лишь один из способов его получить.
--
--   public    — любой авторизованный
--   followers — подписчики и друзья
--   friends   — только принятые друзья (прежнее поведение)
--   private   — только автор
--
-- Существующие посты переводятся в 'followers' по явному решению владельца
-- продукта: написаны они были при правиле «видит только друг», и подписчик
-- получает к ним доступ задним числом. См. шапку файла.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'post_visibility') then
    create type public.post_visibility as enum ('public', 'followers', 'friends', 'private');
  end if;
end $$;

-- Колонку добавляем со значением по умолчанию 'friends', чтобы уже
-- существующие строки не переехали в момент ALTER, и только потом переводим их
-- осознанным UPDATE. Так «что произошло со старыми постами» — отдельный шаг,
-- который видно в диффе, а не побочный эффект значения по умолчанию.
alter table public.posts
  add column if not exists visibility public.post_visibility not null default 'friends';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'visibility_migrated'
  ) then
    alter table public.posts add column visibility_migrated boolean not null default false;
    update public.posts set visibility = 'followers', visibility_migrated = true;
  end if;
end $$;

-- Новые посты по умолчанию для подписчиков.
alter table public.posts alter column visibility set default 'followers';

create index if not exists posts_visibility_created_idx
  on public.posts (visibility, created_at desc);
create index if not exists posts_author_created_idx
  on public.posts (user_id, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- 11. can_view_post — переписан под новую модель
-- ─────────────────────────────────────────────────────────────────────────
-- Единственное место, где живёт ответ «вижу ли я этот пост». Его используют
-- политики posts, post_reactions и post_comments, а также все RPC чтения.
-- SECURITY DEFINER по той же причине, что и раньше: функция обязана читать
-- posts напрямую, иначе политика смотрела бы на posts через RLS и утащила бы
-- за собой рекурсию.
--
-- Блокировка проверяется ПЕРВОЙ и перекрывает всё, включая visibility='public':
-- заблокировавший не должен видеть контент заблокированного и наоборот.

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
        or (
          not public.is_blocked_between(p.user_id, auth.uid())
          and (
            p.visibility = 'public'
            or (p.visibility = 'followers' and (
                  exists (select 1 from public.follows f
                           where f.follower_id = auth.uid() and f.following_id = p.user_id)
                  or public.is_friend_with(auth.uid(), p.user_id)
               ))
            or (p.visibility = 'friends' and public.is_friend_with(auth.uid(), p.user_id))
          )
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;

-- Политика чтения постов повторяет ту же логику предикатом. Дублирование с
-- can_view_post намеренное: вызвать здесь функцию нельзя — она сама читает
-- posts, и политика на posts, вызывающая её, зациклилась бы.
drop policy if exists "posts select" on public.posts;
create policy "posts select" on public.posts
  for select using (
    auth.uid() = posts.user_id
    or (
      not public.is_blocked_between(posts.user_id, auth.uid())
      and (
        posts.visibility = 'public'
        or (posts.visibility = 'followers' and (
              exists (select 1 from public.follows f
                       where f.follower_id = auth.uid() and f.following_id = posts.user_id)
              or public.is_friend_with(auth.uid(), posts.user_id)
           ))
        or (posts.visibility = 'friends' and public.is_friend_with(auth.uid(), posts.user_id))
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 12. friend_state — дневник питания остаётся привилегией дружбы
-- ─────────────────────────────────────────────────────────────────────────
-- Здесь модель НЕ размывается: подписка не даёт доступа к тому, что человек
-- ел. Это самые чувствительные данные в приложении, и расширять их аудиторию
-- решение о ленте не уполномочивает. Добавлена только проверка блокировки.

create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid()
      or (not public.is_blocked_between(p_user_id, auth.uid())
          and public.is_friend_with(auth.uid(), p_user_id))
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
-- 13. Профили становятся публично читаемыми
-- ─────────────────────────────────────────────────────────────────────────
-- Прежняя политика отдавала строку только владельцу. Переворачиваем её —
-- с одной существенной оговоркой: public_id остаётся приватным.
--
-- Это не формальность. public_id — код для заявки в друзья, и весь смысл
-- миграции 2026-08-09 был в том, чтобы его нельзя было получить, не зная
-- человека. Отдавать его в публичном профиле означало бы обнулить ту работу.
-- Поэтому наружу через RPC уходят username/display_name/avatar, а прямое
-- чтение таблицы по-прежнему доступно только владельцу строки.

drop policy if exists "read own public_id" on public.profiles;
drop policy if exists "profiles select" on public.profiles;
-- Снимаем и то имя, которое сейчас создаём: без этой строки повторный прогон
-- setup_all.sql отвечает 42710 «policy already exists». Правило общее —
-- create policy обязан быть под своим же drop policy if exists.
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select using (auth.uid() = user_id);

-- Менять username и bio может владелец. display_name и avatar_url сюда не
-- входят: их зеркалит триггер из app_state, и ручная правка разошлась бы с
-- источником истины.
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ⚠ СОЗДАЁТСЯ, ТОЛЬКО ПОКА ЖИВА КОЛОНКА public_id.
--
-- Эта редакция читает new.public_id. Тело plpgsql компилируется без разрешения
-- имён, поэтому файл прогоняется без единой жалобы — а падает потом, на КАЖДОМ
-- update по profiles, с 42703. Именно так оно и вышло на живой базе после
-- 2026-08-26: ломались и смена ника, и сохранение состояния (см. разбор в
-- 2026-09-05_social_hardening §11.1).
--
-- На мигрированной базе шаг пропускается: правильную версию функции всё равно
-- создаёт 2026-09-05, и она же стоит в итоге.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute $fn$
      create or replace function public.guard_profile_update()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        if new.user_id is distinct from old.user_id or new.public_id is distinct from old.public_id then
          raise exception 'user_id and public_id are immutable';
        end if;
        -- Зеркальные поля клиент менять не может: их источник — app_state.
        if auth.uid() is not null and (
             new.display_name is distinct from old.display_name
          or new.avatar_url   is distinct from old.avatar_url
        ) then
          new.display_name := old.display_name;
          new.avatar_url   := old.avatar_url;
        end if;
        return new;
      end;
      $body$;
    $fn$;
  end if;
end $$;

drop trigger if exists profiles_update_guard on public.profiles;
create trigger profiles_update_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Смена username. Отдельный RPC, а не UPDATE из клиента: нужно нормализовать
-- ввод, проверить занятость и вернуть внятную причину отказа.
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := lower(btrim(coalesce(p_username, '')));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_new !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars of a-z, 0-9, _' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = v_new and user_id <> v_uid) then
    raise exception 'username is taken' using errcode = '23505';
  end if;

  update public.profiles set username = v_new where user_id = v_uid;
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Публичная карточка пользователя
-- ─────────────────────────────────────────────────────────────────────────
-- Единственный способ узнать имя и аватар чужого человека. Отдаёт ровно четыре
-- поля и никогда — public_id.
--
-- Потолок в 200 идентификаторов — не про нагрузку на базу, а про размер
-- ответа: avatar_url здесь это base64-картинка на десятки килобайт, и запрос
-- на 500 человек весил бы больше десяти мегабайт. По той же причине у
-- list_followers/list_following лимит 50, а не 100.

-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.user_cards(uuid[]);

create or replace function public.user_cards(p_user_ids uuid[])
returns table (user_id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where p.user_id = any(p_user_ids[1:200])
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_cards(uuid[]) from public, anon;
grant execute on function public.user_cards(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 15. Отношение между двумя пользователями — единый источник
-- ─────────────────────────────────────────────────────────────────────────
-- Вся логика «кто мы друг другу» живёт здесь и больше нигде. Раньше её
-- собирали по кускам в компонентах: listFriendships раскладывал строки на
-- friends/incoming/outgoing, а экран сам догадывался, какую кнопку рисовать.
-- С появлением подписок и блокировок состояний стало восемь, и размазывать их
-- по React-компонентам означало бы восемь мест, где можно разойтись.

-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-07 (добавились can_message, conversation, can_view_diary), а
-- create or replace сменить его не умеет — 42P13. На чистой базе не видно,
-- ломается повторный прогон setup_all.sql поверх живой.
drop function if exists public.get_relationship(uuid);

create or replace function public.get_relationship(p_user_id uuid)
returns table (
  following                boolean,
  followed_by              boolean,
  mutual_follow            boolean,
  friend                   boolean,
  incoming_friend_request  boolean,
  outgoing_friend_request  boolean,
  blocked                  boolean,
  blocked_by               boolean,
  friendship_id            uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  fo as (
    select
      exists (select 1 from public.follows f, me where f.follower_id = me.uid and f.following_id = p_user_id) as fwing,
      exists (select 1 from public.follows f, me where f.follower_id = p_user_id and f.following_id = me.uid) as fwed
  ),
  fr as (
    select f.id, f.status, f.requester, f.addressee
    from public.friendships f, me
    where (f.requester = me.uid and f.addressee = p_user_id)
       or (f.requester = p_user_id and f.addressee = me.uid)
    limit 1
  ),
  bl as (
    select
      exists (select 1 from public.blocks b, me where b.blocker_id = me.uid and b.blocked_id = p_user_id) as i_blocked,
      exists (select 1 from public.blocks b, me where b.blocker_id = p_user_id and b.blocked_id = me.uid) as they_blocked
  )
  select
    fo.fwing,
    fo.fwed,
    fo.fwing and fo.fwed,
    coalesce((select status = 'accepted' from fr), false),
    coalesce((select status = 'pending' and addressee = (select uid from me) from fr), false),
    coalesce((select status = 'pending' and requester = (select uid from me) from fr), false),
    bl.i_blocked,
    bl.they_blocked,
    (select id from fr)
  from fo, bl;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 16. Профиль пользователя со счётчиками
-- ─────────────────────────────────────────────────────────────────────────
-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.user_profile(uuid);

create or replace function public.user_profile(p_user_id uuid)
returns table (
  user_id         uuid,
  username        text,
  display_name    text,
  avatar_url      text,
  followers_count int,
  following_count int,
  friends_count   int,
  posts_count     int
)
language sql
stable
security definer
set search_path = public
as $$
  with rel as (
    select
      p_user_id = auth.uid()                          as is_me,
      public.is_friend_with(auth.uid(), p_user_id)     as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  )
  select
    p.user_id, p.username, p.display_name, p.avatar_url,
    (select count(*) from public.follows f where f.following_id = p.user_id)::int,
    (select count(*) from public.follows f where f.follower_id  = p.user_id)::int,
    (select count(*) from public.friendships f
      where f.status = 'accepted' and (f.requester = p.user_id or f.addressee = p.user_id))::int,
    -- Считаем только видимые спрашивающему посты: общий счётчик выдавал бы
    -- сам факт существования скрытых записей. Предикат тот же, что в
    -- list_posts, и вычисляется один раз через rel, а не на каждый пост.
    (select count(*) from public.posts po, rel
      where po.user_id = p.user_id
        and (rel.is_me
             or po.visibility = 'public'
             or (po.visibility = 'followers' and (rel.is_following or rel.is_friend))
             or (po.visibility = 'friends'   and rel.is_friend)))::int
  from public.profiles p
  where p.user_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_profile(uuid) from public, anon;
grant execute on function public.user_profile(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 17. Поиск людей
-- ─────────────────────────────────────────────────────────────────────────
-- Осознанно ограниченный: минимум 3 символа и только совпадение С НАЧАЛА
-- строки. Поиск подстрокой ('%a%') вернул бы почти всю базу по одной букве и
-- превратил бы функцию в выгрузку списка пользователей.
--
-- Это смягчение, а не решение: при публичных профилях перебор всё равно
-- возможен, просто дороже. См. шапку файла.

-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as v)
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p, q
  where char_length(q.v) >= 3
    and p.user_id <> auth.uid()
    and (p.username like q.v || '%' or lower(p.display_name) like q.v || '%')
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    -- Точное совпадение по username выше префиксного, дальше по алфавиту:
    -- предсказуемый порядок важнее релевантности на такой выборке.
    (p.username = q.v) desc,
    (p.username like q.v || '%') desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 18. Списки подписчиков и подписок
-- ─────────────────────────────────────────────────────────────────────────
-- Отдают сразу карточку человека, а не голые id: иначе клиент, получив сто
-- идентификаторов, пошёл бы за именами вторым запросом на каждого.

create or replace function public.list_followers(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.follower_id
  where f.following_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.list_following(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_followers(uuid, int, int) from public, anon;
revoke all on function public.list_following(uuid, int, int) from public, anon;
grant execute on function public.list_followers(uuid, int, int) to authenticated;
grant execute on function public.list_following(uuid, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 19. Лента
-- ─────────────────────────────────────────────────────────────────────────
-- Один запрос отдаёт всё, что нужно для отрисовки: пост, карточку автора,
-- счётчики реакций, собственную реакцию и число ответов. Именно поэтому это
-- RPC, а не select со связанными таблицами.
--
-- Причина та же, что была у list_posts в 2026-08-11, и она не изменилась:
-- связанный select вернул бы СТРОКИ реакций, то есть поимённый список тех,
-- кто отреагировал. Политика post_reactions отдаёт только свою строку, наружу
-- уходят исключительно счётчики.
--
-- Пагинация — keyset по (created_at, id), а не offset. На offset лента с
-- дописываемым верхом показывает дубли: пока человек листает, сверху приезжают
-- новые посты и сдвигают окно.

-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.list_feed(int, timestamptz, uuid);

create or replace function public.list_feed(
  p_limit     int default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id             uuid,
  user_id        uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  text           text,
  image_url      text,
  visibility     public.post_visibility,
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
  with me as (select auth.uid() as uid),
  -- Друзья, подписки и блокировки собираются ОДИН раз в множества, а не
  -- проверяются функцией на каждую строку поста. Разница не косметическая:
  -- при limit 50 повызовный вариант делал бы порядка сотни обращений к
  -- friendships и blocks на один показ ленты. Здесь это три индексных скана и
  -- хеш-полусоединения поверх них.
  blocked as (
    select b.blocked_id as id from public.blocks b, me where b.blocker_id = me.uid
    union
    select b.blocker_id from public.blocks b, me where b.blocked_id = me.uid
  ),
  friends as (
    select case when f.requester = me.uid then f.addressee else f.requester end as id
    from public.friendships f, me
    where f.status = 'accepted' and (f.requester = me.uid or f.addressee = me.uid)
  ),
  followed as (
    select f.following_id as id from public.follows f, me where f.follower_id = me.uid
  ),
  -- Круг ленты: я, мои подписки и мои друзья. Друзья входят даже без подписки —
  -- иначе сразу после миграции лента у всех оказалась бы пустой: подписок в
  -- базе ещё нет ни одной, а дружбы есть.
  circle as (
    select uid as id from me
    union select id from followed
    union select id from friends
  )
  select
    p.id, p.user_id, pr.username, pr.display_name, pr.avatar_url,
    p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = (select uid from me)),
    (select count(*) from public.post_comments c where c.post_id = p.id)::int
  from public.posts p
  join circle             on circle.id = p.user_id
  join public.profiles pr on pr.user_id = p.user_id
  where
    (p_before_at is null
      or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and p.user_id not in (select id from blocked)
    and (
      p.user_id = (select uid from me)
      or p.visibility = 'public'
      or (p.visibility = 'followers'
          and (p.user_id in (select id from followed) or p.user_id in (select id from friends)))
      or (p.visibility = 'friends' and p.user_id in (select id from friends))
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_feed(int, timestamptz, uuid) from public, anon;
grant execute on function public.list_feed(int, timestamptz, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20. Посты одного человека — с учётом новой видимости
-- ─────────────────────────────────────────────────────────────────────────
-- list_posts существует с миграции 2026-08-11, и здесь у неё МЕНЯЕТСЯ состав
-- возвращаемых колонок: добавилась visibility. create or replace на такое не
-- способен — Postgres отвечает
--   42P13: cannot change return type of existing function
-- потому что тип строки задан OUT-параметрами. Поэтому сначала удаляем.
--
-- Удаление безопасно: функция вызывается только клиентом через RPC, никакие
-- вью и политики на неё не опираются. Права выдаются заново сразу после
-- создания, ниже по файлу.
drop function if exists public.list_posts(uuid, int, timestamptz);

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
  visibility     public.post_visibility,
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
  -- Автор здесь ровно один, поэтому дружба и блокировка вычисляются ОДИН раз
  -- и дальше применяются как константы. Прежняя версия звала can_view_post()
  -- на каждый пост, а та каждый раз заново читала posts и friendships.
  with rel as (
    select
      p_user_id = auth.uid()                                       as is_me,
      public.is_blocked_between(p_user_id, auth.uid())              as is_blocked,
      public.is_friend_with(auth.uid(), p_user_id)                  as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  )
  select
    p.id, p.user_id, p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    (select count(*) from public.post_comments c where c.post_id = p.id)::int
  from public.posts p, rel
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and (
      rel.is_me
      or (not rel.is_blocked and (
            p.visibility = 'public'
            or (p.visibility = 'followers' and (rel.is_following or rel.is_friend))
            or (p.visibility = 'friends'   and rel.is_friend)
         ))
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 21. Чтение уведомлений
-- ─────────────────────────────────────────────────────────────────────────
-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.list_notifications(int, timestamptz);

create or replace function public.list_notifications(
  p_limit int default 40, p_before timestamptz default null
)
returns table (
  id            uuid,
  type          public.notification_type,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb,
  created_at    timestamptz,
  read_at       timestamptz,
  actor_id      uuid,
  actor_name    text,
  actor_avatar  text,
  actor_username text
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.type, n.entity_type, n.entity_id, n.metadata, n.created_at, n.read_at,
         n.actor_id, p.display_name, p.avatar_url, p.username
  from public.notifications n
  left join public.profiles p on p.user_id = n.actor_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.created_at < p_before)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

create or replace function public.unread_notification_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.notifications
  where recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
  where id = p_id and recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.list_notifications(int, timestamptz) from public, anon;
revoke all on function public.unread_notification_count() from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.list_notifications(int, timestamptz) to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 22. Личные сообщения: блокировка перекрывает дружбу
-- ─────────────────────────────────────────────────────────────────────────
-- Право переписки НАМЕРЕННО остаётся у дружбы, а не у взаимной подписки.
-- Требование «не предполагай автоматически friend = can message» выполнено
-- тем, что это теперь отдельно записанное правило, а не побочный эффект
-- единственного круга доступа. Открывать личку взаимным подписчикам —
-- продуктовое решение с последствиями для спама, и эта миграция его не
-- принимает: существующее поведение сохранено.

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and sender <> recipient
    and public.is_friend_with(sender, recipient)
    and not public.is_blocked_between(sender, recipient)
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 23. Realtime
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

alter table public.notifications replica identity full;


-- ─────────────────────────────────────────────────────────────────────────
-- 24. Заделка стыка с миграцией тренеров (2026-08-23_moderation_and_coach)
-- ─────────────────────────────────────────────────────────────────────────
-- Та миграция завела user_brief(uuid) → (public_id, name) и выдала EXECUTE
-- всем authenticated. Сама по себе функция была почти безопасна: чтобы её
-- позвать, нужен UUID собеседника, а взять его посторонний человек практически
-- не мог.
--
-- Поиск людей из этого файла ломает ровно эту предпосылку: search_users отдаёт
-- user_id любого пользователя по трём буквам имени. В паре с user_brief это
-- превращается в выгрузку public_id всей базы, а public_id — код добавления в
-- друзья. Именно его миграция 2026-08-09 делала неугадываемым, и обнулять ту
-- работу побочным эффектом ленты нельзя.
--
-- Поэтому public_id здесь снова закрывается: его получают только тот, кому он
-- принадлежит, и тренер с принятой связью — то есть те, для кого функция и
-- писалась («для интерфейса тренера»). Имя остаётся доступным всем: оно и так
-- публично после этой миграции.
--
-- Сигнатура и набор колонок не меняются, поэтому вызывающий код (на момент
-- написания — отсутствующий) не ломается.
-- ⚠ ЭТА ВЕРСИЯ СОЗДАЁТСЯ ТОЛЬКО ПОКА ЖИВА КОЛОНКА public_id.
--
-- Колонку удаляет 2026-08-26_nickname_identity, а вместе с ней меняется и набор
-- колонок этой функции: (public_id, name) → (username, name). Для повторного
-- прогона setup_all.sql поверх уже мигрированной базы это две ошибки сразу:
--   42P13 — create or replace не меняет набор OUT-параметров;
--   42703 — тело на language sql проверяется при создании, а p.public_id нет.
-- Поэтому старая редакция ставится под условием: на свежей базе она нужна как
-- шаг истории, на мигрированной — пропускается, и в силе остаётся версия из
-- 2026-08-26. Тот же приём, что у touch_last_seen в первой миграции.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
  ) then
    execute $fn$
      create or replace function public.user_brief(p_user uuid)
      returns table (public_id text, name text)
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select
          case
            when p_user = auth.uid() then p.public_id
            when exists (
              select 1 from public.coach_links cl
              where cl.status = 'accepted' and cl.coach = auth.uid() and cl.client = p_user
            ) then p.public_id
            else null
          end,
          p.display_name
        from public.profiles p
        where p.user_id = p_user
          and not public.is_blocked_between(p.user_id, auth.uid());
      $body$;
    $fn$;
    execute 'revoke all on function public.user_brief(uuid) from public, anon';
    execute 'grant execute on function public.user_brief(uuid) to authenticated';
  end if;
end $$;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_nickname_identity.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ник вместо публичного ID, дружба вместо заявок.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Единственное, что удаляется безвозвратно, — колонка
-- profiles.public_id и незакрытые заявки в друзья (они превращаются в
-- подписки, см. раздел 5).
--
-- ВНИМАНИЕ: после этого файла НЕЛЬЗЯ прогонять по отдельности
-- 2026-08-09_unpredictable_public_id.sql — он пишет в колонку, которой больше
-- нет. В составе setup_all.sql порядок соблюдён и всё сходится.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЭТА МИГРАЦИЯ МЕНЯЕТ ПРИНЦИПИАЛЬНО
--
-- 1. У человека остаётся ОДИН адрес — ник (profiles.username). Уникальный,
--    редактируемый, единственный способ найти другого человека. Публичный
--    12-символьный код (7K4M-9XPQ-2RTV) исчезает целиком: колонка, четыре
--    функции вокруг неё и весь клиентский код.
--
--    Зачем: код существовал ровно для одной задачи — «дай мне себя найти, не
--    раскрывая себя поиску». Ту же задачу решает ник, но его человек выбирает
--    сам, диктует вслух и помнит. Два разных адреса у одного профиля означали
--    два способа найти человека и две поверхности, которые надо защищать.
--
--    Цена решения названа прямо: код был неугадываемым (2^60 вариантов), а ник
--    — угадываемым по построению. Перебор ников найдёт зарегистрированные
--    аккаунты. Но эта дверь уже открыта миграцией 2026-08-25: поиск по
--    префиксу имени и ника доступен любому авторизованному. Здесь она не
--    открывается заново, а сужается — искать теперь можно ТОЛЬКО по нику
--    целиком или по его началу, но не по отображаемому имени.
--
-- 2. ДРУЖБА = ВЗАИМНАЯ ПОДПИСКА. Заявок и подтверждений больше нет.
--
--    До этого файла дружба была отдельной сущностью с заявкой, ожиданием и
--    подтверждением. Теперь она производная: A подписан на B и B подписан на A
--    — значит, друзья. Отписался кто угодно из двоих — дружба кончилась.
--
--    Таблица friendships при этом ОСТАЁТСЯ и остаётся не случайно: на неё
--    ссылаются восемь живых политик и функций из ранних миграций (чтение
--    app_state друга, политики post_reactions и post_comments, friend_briefs,
--    тренерская проверка). drop table ... cascade снёс бы вместе с ней эти
--    политики, то есть открыл бы данные, а не закрыл. Поэтому таблица
--    превращается в ПРОИЗВОДНУЮ: её пишет триггер на follows, а клиентские
--    INSERT/UPDATE/DELETE-политики закрываются. Без этого клиент мог бы
--    вставить строку дружбы сам и получить право переписки, которого ему никто
--    не давал.
--
--    ⚠ ПОСЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ. Дневник питания и личные сообщения
--    открыты друзьям. «Подписаться в ответ» — жест куда более лёгкий, чем
--    «принять заявку»: раньше между чужим человеком и дневником стояло
--    осознанное подтверждение, теперь — одно нажатие в ответ на чужую
--    подписку. Круг доступа к дневнику расширяется. Решение владельца
--    продукта, принятое явно; правило «дневник и личка — друзьям» не
--    меняется, меняется определение друга.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ник перестаёт зависеть от публичного ID
-- ─────────────────────────────────────────────────────────────────────────
-- claim_username брала хвост public_id как гарантированно уникальную основу
-- для запасного ника. Колонки не будет, поэтому основой становится хвост
-- UUID: он уникален по построению ровно так же.

create or replace function public.claim_username(p_user_id uuid, p_hint text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.slugify_username(p_hint);
  v_try  text;
  v_n    int := 0;
begin
  -- Слишком короткая или пустая основа — берём хвост UUID пользователя.
  -- Восемь шестнадцатеричных знаков на порядки перекрывают любое обозримое
  -- число аккаунтов, а цикл ниже добьёт даже такое совпадение.
  if v_base is null or char_length(v_base) < 3 then
    v_base := 'eater_' || lower(right(replace(p_user_id::text, '-', ''), 8));
  end if;

  v_try := v_base;
  loop
    exit when not exists (
      select 1 from public.profiles where username = v_try and user_id <> p_user_id
    );
    v_n := v_n + 1;
    if v_n > 50 then
      v_try := 'eater_' || lower(right(replace(gen_random_uuid()::text, '-', ''), 10));
      exit;
    end if;
    -- Обрезаем основу так, чтобы вместе с суффиксом уложиться в 20 символов.
    v_try := substr(v_base, 1, 19 - char_length(v_n::text)) || '_' || v_n::text;
  end loop;

  return v_try;
end;
$$;

revoke all on function public.claim_username(uuid, text) from public, anon;


-- Регистрация: строка профиля создаётся сразу с ником, одним INSERT.
-- Двухшаговый вариант (вставить, потом обновить) после NOT NULL на username
-- падал бы на первом же шаге.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, public.claim_username(new.id, null))
  on conflict (user_id) do nothing;
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. user_brief переезжает с кода на ник
-- ─────────────────────────────────────────────────────────────────────────
-- Функция отдавала (public_id, name) и пряталa код от посторонних. Прятать
-- больше нечего: ник и так публичен — его отдаёт поиск. Меняется набор
-- колонок, поэтому нужен DROP, а не CREATE OR REPLACE.

drop function if exists public.user_brief(uuid);

create or replace function public.user_brief(p_user uuid)
returns table (username text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.username, p.display_name
  from public.profiles p
  where p.user_id = p_user
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_brief(uuid) from public, anon;
grant execute on function public.user_brief(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Публичный ID удаляется
-- ─────────────────────────────────────────────────────────────────────────
-- Порядок обязателен: сначала функции, которые читают колонку, потом сама
-- колонка. Иначе DROP COLUMN упрётся в зависимости.

drop function if exists public.find_user_by_public_id(text);
drop function if exists public.ensure_public_id();
drop function if exists public.generate_public_id();
drop function if exists public.normalize_public_id(text);

alter table public.profiles drop constraint if exists profiles_public_id_format;
alter table public.profiles drop column if exists public_id;

-- Последовательность старого формата убрана ещё в 2026-08-09; строка ниже —
-- на случай базы, где тот файл не прогоняли.
drop sequence if exists public.public_id_seq;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ник — обязательный и единственный адрес
-- ─────────────────────────────────────────────────────────────────────────

-- Профиль без строки в profiles — человек, которого нельзя ни найти, ни
-- показать. Такое случалось при сбое триггера регистрации; раньше это чинила
-- ensure_public_id при первом обращении, теперь чиним разом.
--
-- Ник здесь НЕ выдаём: claim_username проверяет занятость обычным SELECT, а он
-- не видит строки, вставляемые этим же запросом. Два человека с одинаковым
-- именем получили бы один ник и уронили бы вставку на уникальном индексе.
-- Поэтому ники раздаёт цикл ниже — по одному, и каждый следующий видит
-- предыдущего.
insert into public.profiles (user_id)
select u.id
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

-- Ник тем, у кого его ещё нет. Цикл, а не один UPDATE: claim_username должна
-- видеть ники, выданные на предыдущих шагах, иначе два пустых профиля с
-- одинаковым именем получили бы один и тот же ник.
do $$
declare
  r record;
begin
  for r in
    select p.user_id, a.state->'profile'->>'name' as nm
    from public.profiles p
    left join public.app_state a on a.user_id = p.user_id
    where p.username is null
  loop
    update public.profiles
       set username = public.claim_username(r.user_id, r.nm)
     where user_id = r.user_id;
  end loop;
end $$;

-- Теперь ник есть у всех, и это можно закрепить. NOT NULL здесь — не
-- формальность: ник стал единственным способом найти человека, и профиль без
-- него невидим для всего приложения.
alter table public.profiles alter column username set not null;

-- Раз NULL невозможен, ветка «username is null or …» в ограничении формата
-- лишняя. Регистр по-прежнему только нижний: уникальный индекс по text
-- различал бы «Andrej» и «andrej», и два человека получили бы визуально
-- неотличимые адреса.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,20}$');


-- Смена ника. Ведущая «собака» снимается на входе: человек, привыкший к
-- @nickname в других приложениях, вставит её по привычке, и отказ «недопустимый
-- символ» был бы придиркой, а не защитой. В базе и в интерфейсе ник живёт без
-- приставки.
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_new !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars of a-z, 0-9, _' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = v_new and user_id <> v_uid) then
    raise exception 'username is taken' using errcode = '23505';
  end if;

  update public.profiles set username = v_new where user_id = v_uid;
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;


-- Найти человека по нику целиком. Занимает место find_user_by_public_id:
-- ровно та же роль — превратить то, что человек продиктовал, в UUID.
-- Нужна там, где нельзя пройти через поиск: приглашение тренера.
create or replace function public.find_user_by_username(p_username text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.profiles p
  where p.username = lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')))
    and not public.is_blocked_between(p.user_id, auth.uid())
  limit 1;
$$;

revoke all on function public.find_user_by_username(text) from public, anon;
grant execute on function public.find_user_by_username(text) to authenticated;


-- Поиск людей — ТОЛЬКО по нику.
--
-- Отображаемое имя выпадает из условия поиска намеренно. Во-первых, оно
-- неуникально: по запросу «Денис» вернулся бы десяток одинаковых строк, и
-- выбрать среди них нужного человека не по чему. Во-вторых, имя человек не
-- выбирал как адрес — он писал его для друзей, а не для того, чтобы по нему
-- его находили посторонние. Ник он выбирает именно как адрес.
--
-- Совпадение по-прежнему только С НАЧАЛА строки и от трёх символов: поиск
-- подстрокой ('%a%') вернул бы почти всю базу по одной букве.
-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-09, а create or replace на смену OUT-параметров отвечает 42P13.
-- Без него повторный прогон setup_all.sql поверх мигрированной базы падал
-- бы здесь — на строке, которая на чистой базе отрабатывает без нареканий.
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', ''))) as v
  )
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p, q
  where char_length(q.v) >= 3
    and p.user_id <> auth.uid()
    and p.username like q.v || '%'
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    -- Точное совпадение выше префиксного, дальше по алфавиту.
    (p.username = q.v) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;

-- Индекс по имени больше не обслуживает ни одного запроса.
drop index if exists public.profiles_display_name_prefix_idx;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Дружба становится производной от подписок
-- ─────────────────────────────────────────────────────────────────────────

-- 5.1. Клиент теряет право писать в friendships.
-- Строку теперь создаёт и удаляет только сервер. Оставленная INSERT-политика
-- была бы дырой: право переписки проверяется через дружбу, и клиент,
-- вставивший строку сам, выписал бы себе доступ в чужую личку.
drop policy if exists "friendship insert" on public.friendships;
drop policy if exists "friendship update" on public.friendships;
drop policy if exists "friendship delete" on public.friendships;
-- SELECT остаётся: свои связи человек читать должен.

-- 5.2. Механика заявок демонтируется.
-- Ограничение частоты заявок и подстановка имени заявителя не просто
-- бесполезны — они вредны: оба триггера срабатывали бы на строки, которые
-- теперь пишет сервер, и лимит «30 в час» ронял бы обычное «подписаться в
-- ответ» тридцать первому человеку.
drop trigger if exists friendships_rate_limit on public.friendships;
drop trigger if exists friendships_set_requester_name on public.friendships;
drop function if exists public.limit_friend_requests();
drop function if exists public.set_requester_name();

-- Колонка requester_name остаётся пустой, но не удаляется: на неё ссылается
-- разовый UPDATE в 2026-08-08_hardening.sql, и её удаление сломало бы
-- повторный прогон того файла. Пустая неиспользуемая колонка дешевле, чем
-- миграция, после которой ранние файлы перестают быть идемпотентными.

-- 5.3. Триггеры подписок снимаются на время переноса данных.
-- follows_rate_limit иначе оборвал бы бэкфилл на 200-й подписке, а
-- follows_notify разослал бы уведомление «на вас подписались» за каждую
-- дружбу, которой уже год.
drop trigger if exists follows_rate_limit on public.follows;
drop trigger if exists follows_notify on public.follows;

-- Принятая дружба → две подписки. Без этого шага все существующие друзья
-- перестали бы быть друзьями и потеряли бы доступ к переписке.
insert into public.follows (follower_id, following_id)
select f.requester, f.addressee
from public.friendships f
where f.status = 'accepted' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

insert into public.follows (follower_id, following_id)
select f.addressee, f.requester
from public.friendships f
where f.status = 'accepted' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

-- Незакрытая заявка → односторонняя подписка заявителя. Это ровно то, что он
-- выражал: интерес к человеку. Согласия адресата подписка не требует и в
-- новой модели, так что ничего сверх уже возможного заявитель не получает —
-- он мог бы нажать «Подписаться» и сам.
insert into public.follows (follower_id, following_id)
select f.requester, f.addressee
from public.friendships f
where f.status = 'pending' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

-- Сами заявки и уведомления о них больше не существуют как класс.
delete from public.notifications where type = 'FRIEND_REQUEST';
delete from public.friendships where status = 'pending';

-- 5.4. Единственный источник ответа «друзья ли мы» — подписки.
-- Определение живёт здесь, а не в материализованной таблице, намеренно: даже
-- если строка friendships почему-то разойдётся с графом, права будут
-- посчитаны по графу.
create or replace function public.is_friend_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (
       select 1 from public.follows f
       where f.follower_id = p_a and f.following_id = p_b
     )
     and exists (
       select 1 from public.follows f
       where f.follower_id = p_b and f.following_id = p_a
     );
$$;

revoke all on function public.is_friend_with(uuid, uuid) from public, anon;
grant execute on function public.is_friend_with(uuid, uuid) to authenticated;

-- 5.5. Материализация: строка friendships появляется и исчезает вместе со
-- взаимностью подписки.
create or replace function public.sync_friendship_from_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Дружба возникает только в момент, когда подписка стала взаимной.
    if exists (
      select 1 from public.follows f
      where f.follower_id = new.following_id and f.following_id = new.follower_id
    ) then
      -- requester — тот, кто подписался ПЕРВЫМ (объект нынешней подписки).
      -- Это не бухгалтерия: именно он должен получить уведомление «теперь вы
      -- друзья», потому что второй только что нажал кнопку сам и всё знает.
      insert into public.friendships (requester, addressee, status)
      select new.following_id, new.follower_id, 'accepted'
      where not exists (
        select 1 from public.friendships f
        where (f.requester = new.follower_id  and f.addressee = new.following_id)
           or (f.requester = new.following_id and f.addressee = new.follower_id)
      );
    end if;
    return new;
  end if;

  -- Отписка любой из сторон — дружба кончилась.
  delete from public.friendships f
   where (f.requester = old.follower_id  and f.addressee = old.following_id)
      or (f.requester = old.following_id and f.addressee = old.follower_id);
  return old;
end;
$$;

-- 5.6. Уведомление о дружбе. Промежуточного состояния «заявка» больше нет,
-- поэтому и веток стало на две меньше: дружба может только появиться.
create or replace function public.notify_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_notification(
    new.requester, new.addressee, 'FRIEND_ACCEPTED', 'friendship', new.id
  );
  return new;
end;
$$;

-- 5.7. Приведение таблицы к инварианту — ДО того, как включены триггеры
-- уведомлений. Иначе каждая пара, дружившая до миграции, получила бы
-- уведомление «теперь вы друзья» о дружбе годовой давности.
drop trigger if exists friendships_notify on public.friendships;

-- Дружба без взаимной подписки (например, та, где блокировка помешала
-- бэкфиллу) — не дружба.
delete from public.friendships f
 where not public.is_friend_with(f.requester, f.addressee);

-- Взаимная подписка без строки — недостающая дружба. Кто из двоих
-- «requester», для уже существующих связей значения не имеет: уведомления по
-- ним не рассылаются, а все чтения симметричны. Берём пару в порядке UUID,
-- чтобы результат не зависел от порядка строк.
insert into public.friendships (requester, addressee, status)
select distinct least(f.follower_id, f.following_id), greatest(f.follower_id, f.following_id), 'accepted'
from public.follows f
join public.follows r
  on r.follower_id = f.following_id and r.following_id = f.follower_id
where not exists (
  select 1 from public.friendships x
  where (x.requester = f.follower_id  and x.addressee = f.following_id)
     or (x.requester = f.following_id and x.addressee = f.follower_id)
)
on conflict (requester, addressee) do nothing;

-- 5.8. Все триггеры обратно. Порядок именно такой: сначала данные приведены в
-- порядок, потом включается автоматика.
create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friendship();

create trigger follows_rate_limit
  before insert on public.follows
  for each row execute function public.limit_follows();

create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

drop trigger if exists follows_sync_friendship_ins on public.follows;
create trigger follows_sync_friendship_ins
  after insert on public.follows
  for each row execute function public.sync_friendship_from_follows();

drop trigger if exists follows_sync_friendship_del on public.follows;
create trigger follows_sync_friendship_del
  after delete on public.follows
  for each row execute function public.sync_friendship_from_follows();


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отношение между двумя людьми
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок сохранён, чтобы не переучивать вызывающий код, но два поля
-- про заявки теперь всегда false: заявок не существует. Признак дружбы
-- считается из подписок, а не из материализованной строки, — по той же
-- причине, что и в is_friend_with.
-- DROP обязателен: набор возвращаемых колонок у этой функции меняется в
-- 2026-09-07 (добавились can_message, conversation, can_view_diary), а
-- create or replace сменить его не умеет — 42P13. На чистой базе не видно,
-- ломается повторный прогон setup_all.sql поверх живой.
drop function if exists public.get_relationship(uuid);

create or replace function public.get_relationship(p_user_id uuid)
returns table (
  following                boolean,
  followed_by              boolean,
  mutual_follow            boolean,
  friend                   boolean,
  incoming_friend_request  boolean,
  outgoing_friend_request  boolean,
  blocked                  boolean,
  blocked_by               boolean,
  friendship_id            uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  fo as (
    select
      exists (select 1 from public.follows f, me where f.follower_id = me.uid and f.following_id = p_user_id) as fwing,
      exists (select 1 from public.follows f, me where f.follower_id = p_user_id and f.following_id = me.uid) as fwed
  ),
  fr as (
    select f.id
    from public.friendships f, me
    where (f.requester = me.uid and f.addressee = p_user_id)
       or (f.requester = p_user_id and f.addressee = me.uid)
    limit 1
  ),
  bl as (
    select
      exists (select 1 from public.blocks b, me where b.blocker_id = me.uid and b.blocked_id = p_user_id) as i_blocked,
      exists (select 1 from public.blocks b, me where b.blocker_id = p_user_id and b.blocked_id = me.uid) as they_blocked
  )
  select
    fo.fwing,
    fo.fwed,
    fo.fwing and fo.fwed,
    fo.fwing and fo.fwed,
    false,
    false,
    bl.i_blocked,
    bl.they_blocked,
    (select id from fr)
  from fo, bl;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Список друзей
-- ─────────────────────────────────────────────────────────────────────────
-- Отдаёт сразу карточку человека — как list_followers и list_following.
-- Раньше клиент читал friendships напрямую и шёл вторым запросом в
-- friend_briefs за именами; теперь имя и аватар публичны, и второй запрос
-- перестал быть нужен.
create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.requester = p_user_id then f.addressee else f.requester end
  where f.status = 'accepted'
    and (f.requester = p_user_id or f.addressee = p_user_id)
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_friends(uuid, int, int) from public, anon;
grant execute on function public.list_friends(uuid, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Личные сообщения
-- ─────────────────────────────────────────────────────────────────────────
-- Политика не меняется ни на символ — меняется смысл is_friend_with под ней.
-- Переписка по-прежнему только между друзьями, но «друзья» отныне означает
-- «подписаны друг на друга». Пересоздаём её здесь, чтобы это было записано в
-- том же файле, что и смена определения, а не додумывалось при чтении.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and sender <> recipient
    and public.is_friend_with(sender, recipient)
    and not public.is_blocked_between(sender, recipient)
  );


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_ai_premium_tier.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — добавление тарифа AI_PREMIUM (Carrot Premium, €24.99).
--
-- До этой миграции tier был жёстко ограничен ('FREE','AI','AI_PLUS') на трёх
-- таблицах. Из-за этого:
--   • вебхук Stripe не мог записать AI_PREMIUM после реальной покупки —
--     upsert падал на CHECK, и покупатель Carrot Premium не получал доступ;
--   • промокод на AI_PREMIUM не выдавался (тот же CHECK на promo_codes/grants);
--   • ручное редактирование tier='AI_PREMIUM' в Table Editor тоже отклонялось.
--
-- Запускать в Supabase SQL Editor. Идемпотентно — можно гонять повторно.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.subscriptions
  drop constraint if exists subscriptions_tier_check;
alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('FREE','AI','AI_PLUS','AI_PREMIUM'));

alter table public.promo_codes
  drop constraint if exists promo_codes_tier_check;
alter table public.promo_codes
  add constraint promo_codes_tier_check
  check (tier in ('AI','AI_PLUS','AI_PREMIUM'));

alter table public.promo_grants
  drop constraint if exists promo_grants_tier_check;
alter table public.promo_grants
  add constraint promo_grants_tier_check
  check (tier in ('AI','AI_PLUS','AI_PREMIUM'));

-- ---------------- Ручное управление подписками из Table Editor ----------------
-- subscriptions.status не имеет CHECK — можно свободно ставить в Table Editor
-- любую из строк, которые понимает фронт (src/lib/subscription.js STATUS):
--   'inactive' | 'active' | 'trialing' | 'past_due' | 'canceled'
--   | 'incomplete' | 'incomplete_expired' | 'unpaid'
--
-- Чтобы вручную выдать человеку тариф без Stripe и без промокода — открыть
-- Table Editor → subscriptions → найти строку по user_id (или вставить новую)
-- и поставить:
--   tier   = 'FREE' | 'AI' | 'AI_PLUS' | 'AI_PREMIUM'
--   status = 'active'
-- current_period_end можно оставить пустым (isActive() смотрит только на tier
-- и status) либо поставить дату окончания вручную. Фронт подхватит изменение
-- сразу — таблица в Realtime-публикации.
--
-- Если у человека ещё нет строки в subscriptions (он не покупал раньше и не
-- гасил промокод), нужно сначала создать её через Table Editor → Insert row,
-- указав его user_id (взять из auth.users по email), остальные поля —
-- как выше.


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_daily_usage_and_premium_admin.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — фикс дневного периода ai_usage + AI_PREMIUM в админ-панели.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-08-26_ai_premium_tier.sql.
-- Идемпотентно.
--
-- Что чинит:
--
-- 1) ai_usage.period имел CHECK на формат 'YYYY-MM' (месяц). Приложение с
--    недавнего изменения считает лимиты ПО ДНЯМ и пишет period в формате
--    'YYYY-MM-DD'. Каждая запись расхода токенов проваливала CHECK и молча
--    не сохранялась (ошибка только в логах) — из-за этого spentThisPeriod
--    всегда читал 0, и дневной лимит FREE/AI фактически не работал.
--
-- 2) admin_subscriptions ранжировал тарифы только AI_PLUS/AI — человек с
--    AI_PREMIUM в этой панели попадал в 'else 0', то есть отображался как
--    FREE. Ранжирование переписано на FREE=0/AI=1/AI_PLUS=2/AI_PREMIUM=3.
--
-- 3) admin_subscriptions джойнил ai_usage по текущему месяцу — с переходом
--    на дневной период это всегда давало ai_spent_usd = 0. Джойн переведён
--    на текущий день UTC.
--
-- 4) issue_promo() отклонял tier = 'AI_PREMIUM' явной проверкой в коде —
--    код на Premium нельзя было выпустить даже после снятия CHECK на
--    таблицах. Список разрешённых тиров расширен.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------- 1) Дневной период в ai_usage ----------------
-- ⚠ СМЕНА ОГРАНИЧЕНИЯ БЕЗ ПЕРЕНОСА ДАННЫХ НЕ РАБОТАЕТ.
--
-- В первой редакции этой миграции стояли просто drop constraint + add
-- constraint. На пустой таблице проходит; на живой Postgres проверяет новое
-- условие по ВСЕМ существующим строкам и отвечает
--   23514: check constraint "ai_usage_period_check" of relation "ai_usage"
--          is violated by some row
-- потому что в таблице лежат строки старого, месячного формата ('2026-08').
-- Ошибка вылезала на середине setup_all.sql и роняла весь прогон.
--
-- Строки не выбрасываем: ai_usage — единственный источник правды о том,
-- сколько стоил каждый тариф, и терять накопленный расход ради смены формата
-- нельзя. Месяц переносим на его первое число: суммы сохраняются полностью,
-- меняется только гранулярность, которой у этих строк и так не было.
--
-- Порядок обязателен: сначала снять старое ограничение, потом переносить
-- (иначе вставка '2026-08-01' упрётся в ещё живой месячный CHECK), и только
-- потом ставить новое.

alter table public.ai_usage
  drop constraint if exists ai_usage_period_check;

-- Если у человека уже есть строка за первое число месяца, склеиваем: первичный
-- ключ (user_id, period) не допускает двух, а расход должен сойтись.
insert into public.ai_usage (user_id, period, spent_micro, requests, updated_at)
select user_id, period || '-01', spent_micro, requests, updated_at
from public.ai_usage
where period ~ '^\d{4}-\d{2}$'
on conflict (user_id, period) do update
  set spent_micro = public.ai_usage.spent_micro + excluded.spent_micro,
      requests    = public.ai_usage.requests    + excluded.requests,
      updated_at  = greatest(public.ai_usage.updated_at, excluded.updated_at);

delete from public.ai_usage where period ~ '^\d{4}-\d{2}$';

-- Всё, что не месяц и не день, — не наш формат вовсе. Молча удалять учётные
-- строки нельзя, поэтому останавливаемся с внятным сообщением: разбираться с
-- ними должен человек, а не миграция.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad from public.ai_usage where period !~ '^\d{4}-\d{2}-\d{2}$';
  if v_bad > 0 then
    raise exception
      'ai_usage: % строк с периодом неизвестного формата. Посмотрите: select distinct period from public.ai_usage where period !~ ''^\d{4}-\d{2}-\d{2}$'';',
      v_bad;
  end if;
end $$;

alter table public.ai_usage
  add constraint ai_usage_period_check
  check (period ~ '^\d{4}-\d{2}-\d{2}$');

-- ---------------- 2+3) admin_subscriptions: AI_PREMIUM + дневной ai_usage ----
drop view if exists public.admin_subscriptions;
create view public.admin_subscriptions as
with live as (
  select
    u.id  as user_id,
    u.email,
    u.created_at as registered_at,
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
  left join lateral (
    select pg.code, pg.tier, pg.granted_until
    from public.promo_grants pg
    where pg.user_id = u.id and pg.granted_until > now()
    order by case pg.tier
               when 'AI_PREMIUM' then 3
               when 'AI_PLUS' then 2
               when 'AI' then 1
               else 0
             end desc,
             pg.granted_until desc
    limit 1
  ) g on true
  -- Дневной расход (сегодня, UTC) — тот же period_key, что пишет приложение.
  left join public.ai_usage a
    on a.user_id = u.id and a.period = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
)
select
  user_id,
  email,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_tier else stripe_tier
  end as tier,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then 'promo' else
      case when stripe_tier = 'FREE' then 'none' else 'stripe' end
  end as source,
  case
    when case promo_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end >
         case stripe_tier
           when 'AI_PREMIUM' then 3 when 'AI_PLUS' then 2 when 'AI' then 1 else 0 end
    then promo_until else stripe_until
  end as until,
  stripe_tier,
  stripe_status,
  cancel_at_period_end,
  promo_code,
  nullif(promo_tier,'FREE') as promo_tier,
  promo_until,
  -- Расход на ассистента СЕГОДНЯ (UTC), в долларах — лимит теперь дневной.
  round(coalesce(spent_micro,0) / 1000000.0, 4) as ai_spent_usd_today,
  coalesce(requests,0) as ai_requests_today,
  registered_at
from live;

revoke all on public.admin_subscriptions from anon, authenticated;
grant select on public.admin_subscriptions to service_role;

-- ---------------- 4) issue_promo: разрешить AI_PREMIUM ----------------
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
  if p_tier not in ('AI','AI_PLUS','AI_PREMIUM') then
    raise exception 'issue_promo: тариф должен быть AI, AI_PLUS или AI_PREMIUM, получено %', p_tier;
  end if;

  if p_code is not null then
    insert into public.promo_codes (code, tier, days, max_uses, expires_at, note)
    values (upper(btrim(p_code)), p_tier, p_days, p_max_uses, p_expires_at, p_note)
    returning * into v_row;
    return v_row;
  end if;

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

revoke all on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_promo(text, integer, integer, timestamptz, text, text)
  to service_role;

-- ---------------- Ручное редактирование доступа ----------------
-- admin_subscriptions — ПРЕДСТАВЛЕНИЕ (JOIN + CASE), Table Editor не даёт его
-- редактировать («Cannot edit in read-only editor») — это ожидаемо для любого
-- непростого view в Postgres, не баг миграции.
--
-- Чтобы поменять тариф человеку вручную — редактировать саму таблицу:
--   Table Editor → subscriptions (не admin_subscriptions!) → строка по user_id
--   → tier = 'FREE' | 'AI' | 'AI_PLUS' | 'AI_PREMIUM', status = 'active'.
-- Если строки нет — Insert row с этим user_id (найти в auth.users по email).
-- admin_subscriptions обновится сам — это просто отражение subscriptions
-- и promo_grants, лучшее из двух.


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-26_admin_subscriptions_writable.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — admin_subscriptions доступен для UPDATE через SQL Editor.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций. Идемпотентно.
--
-- ⚠️ Table Editor (сетка с ячейками) НИКОГДА не даёт редактировать VIEW —
-- это правило интерфейса Supabase Studio, а не вопрос прав или триггеров.
-- Даже с INSTEAD OF-триггером ниже строка в гриде останется помечена
-- «read-only». Это ограничение Studio для любых представлений в принципе.
--
-- Что это решает: SQL Editor (вкладка слева, «SQL Editor», не Table Editor)
-- умеет выполнять UPDATE по любой таблице/view. INSTEAD OF-триггер учит
-- Postgres, куда физически девать такой UPDATE по admin_subscriptions:
-- он перекладывается в public.subscriptions (реальную таблицу).
--
-- Пример использования — открыть SQL Editor и выполнить:
--   update public.admin_subscriptions
--   set stripe_tier = 'AI_PLUS', stripe_status = 'active'
--   where email = 'friend@example.com';
--
-- Это удобнее, чем руками искать user_id по email в таблице subscriptions.
-- Столбцы, которые реально что-то меняют: stripe_tier, stripe_status,
-- until, cancel_at_period_end. Столбцы tier/source — целиком вычисляемые
-- (лучшее из Stripe и промокода), их редактировать бессмысленно.
--
-- ВАЖНО: во внешнем SELECT view нет колонки stripe_until — только until
-- (уже посчитанный «эффективный» срок). Если в этот момент активен более
-- старший промокод, until покажет его срок, а не срок Stripe-подписки —
-- при записи just that until уйдёт в subscriptions.current_period_end.
--
-- Если у пользователя действует промокод СТАРШЕ того тарифа, что вы здесь
-- поставите, эффективный tier всё равно останется от промокода (тот же
-- bestTier, что в src/lib/subscription.js). Чтобы это тарифы не спорили —
-- удалите активный грант в promo_grants или дождитесь его истечения.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_subscriptions_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (
    user_id, tier, status, current_period_end, cancel_at_period_end, updated_at
  )
  values (
    NEW.user_id,
    coalesce(NEW.stripe_tier, 'FREE'),
    coalesce(NEW.stripe_status, 'active'),
    NEW.until,
    coalesce(NEW.cancel_at_period_end, false),
    now()
  )
  on conflict (user_id) do update
    set tier                 = excluded.tier,
        status               = excluded.status,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at           = now();
  return NEW;
end;
$$;

drop trigger if exists admin_subscriptions_instead_of_update on public.admin_subscriptions;
create trigger admin_subscriptions_instead_of_update
  instead of update on public.admin_subscriptions
  for each row execute function public.admin_subscriptions_apply();


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-08-28_profile_rework.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переработка профиля: одна актуальная модель вместо двух
--
-- ЧТО МЕНЯЕТСЯ. Профиль на клиенте состоит из имени, аватара, ника, био и
-- одного поля про еду — «MY guilty pleasure». Строки «Я это обожаю» и «Ок»
-- считаются по дневнику, а не заполняются руками, поэтому полей под них нет.
--
-- Старая модель (favDish, favRestaurant и списки noGos/toGos — «да в еде» /
-- «нет в еде») удалена из приложения целиком: её нечем заполнить и негде
-- показать. Пока friend_state продолжает их отдавать, удалённая модель живёт
-- дальше в трафике — друг получает поля, которых нет ни на одном экране.
-- Здесь это и закрывается: список полей сужается до видимого.
--
-- ЧТО ЭТО НЕ ДЕЛАЕТ. Строки app_state не переписываются. У давних аккаунтов
-- старые ключи остаются лежать в блобе до первого сохранения профиля — клиент
-- затирает их при сохранении сам (MyProfileSheet), а до тех пор их не
-- показывает и не отдаёт: friendView.js отбрасывает лишнее вторым слоем.
-- Массовый update чужого JSON ради косметики опаснее, чем безвредный остаток.
--
-- СОВМЕСТИМОСТЬ. Состав ключей внутри 'profile' не является контрактом
-- PostgREST: функция возвращает jsonb целиком. Старый фронтенд с новой базой
-- просто не найдёт favDish/noGos и не покажет соответствующие строки — ровно
-- то же самое он делает для аккаунта, где эти поля не заполнены. Новый
-- фронтенд со старой базой получит лишние ключи и отбросит их в friendView.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- friend_state — только те поля профиля, которые рисует вкладка «О себе»
-- ─────────────────────────────────────────────────────────────────────────
-- Тело функции повторяет версию из 2026-08-25_social_graph.sql: проверка
-- блокировки и дружбы, дневник только по дням с 'meals', составные блюда.
-- Изменён ровно один фрагмент — список ключей 'profile'.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid()
      or (not public.is_blocked_between(p_user_id, auth.uid())
          and public.is_friend_with(auth.uid(), p_user_id))
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',           a.state->'profile'->'name',
        'avatar',         a.state->'profile'->'avatar',
        'bio',            a.state->'profile'->'bio',
        'guiltyPleasure', a.state->'profile'->'guiltyPleasure',
        'targets',        jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
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
-- ИСТОЧНИК: supabase/migrations/2026-09-05_social_hardening.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — укрепление социальной системы: гонки, блокировки, пагинация,
-- идемпотентность сообщений.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет, кроме заведомого мусора: дублей строк
-- дружбы и уведомлений, ведущих в никуда.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЭТА МИГРАЦИЯ ИСПРАВЛЯЕТ И ПОЧЕМУ
--
-- 1. ДРУЖБА МОГЛА НЕ ВОЗНИКНУТЬ ВОВСЕ. С 2026-08-26 дружба — это взаимная
--    подписка, а строку friendships пишет триггер: вставили подписку — он
--    смотрит, есть ли встречная. Пока два человека подписываются друг на друга
--    ПО ОЧЕРЕДИ, всё сходится. Но если обе вставки идут одновременно, ни одна
--    транзакция не видит незакоммиченную строку другой (READ COMMITTED), и
--    условие «есть встречная подписка» ложно у обеих. Итог: взаимная подписка
--    есть, строки дружбы нет.
--
--    Это не теоретическая беда. От строки friendships зависели ЧТЕНИЕ ЧУЖОГО
--    ДНЕВНИКА (политика app_state), список друзей и счётчик друзей, а право
--    переписки считалось уже по подпискам. То есть пара оказывалась в
--    состоянии «переписываться можно, дневник не виден, в списке друзей друг
--    друга нет» — и починить это человек не мог никак.
--
--    Лечим с двух сторон:
--      • сериализуем пару advisory-локом ДО вставки в follows, чтобы вторая
--        транзакция дождалась первой и увидела её строку;
--      • снимаем зависимость прав от материализованной строки: и политика
--        дневника, и списки, и счётчики считаются теперь по подпискам, тем же
--        предикатом is_friend_with, что и переписка. Строка friendships
--        остаётся ровно одним: якорем уведомления «теперь вы друзья».
--
-- 2. БЛОКИРОВКА ОБХОДИЛАСЬ ЧЕРЕЗ СПИСКИ. list_followers/list_following
--    прятали из выдачи отдельных заблокированных людей, но не проверяли, а
--    имеет ли спрашивающий право вообще смотреть на ЭТОТ профиль.
--    Заблокировавший меня человек закрыт для меня в user_profile и в
--    list_posts — но его подписчиков и подписки я по-прежнему мог перечислить
--    прямым вызовом RPC. Это дыра именно в блокировке: интерфейс её не
--    показывал, но интерфейс и не является границей доступа.
--
-- 3. ОТВЕТЫ ЗАБЛОКИРОВАННЫХ БЫЛИ ВИДНЫ. Под общим постом третьего человека
--    ответ заблокированного отображался как ни в чём не бывало, и счётчик
--    ответов его учитывал. Блокировка должна работать везде, а не только там,
--    где люди встречаются напрямую.
--
-- 4. У СООБЩЕНИЙ НЕ БЫЛО ИДЕМПОТЕНТНОСТИ. Отправка — обычный INSERT: если
--    ответ потерялся в сети, клиент повторял вставку и в переписке появлялись
--    два одинаковых сообщения. Причём именно на плохой сети, то есть ровно
--    тогда, когда это заметнее всего. Вводим client_id, который клиент
--    придумывает ОДИН раз на сообщение и переиспользует при каждом повторе.
--
-- 5. ЛЕНТА ОТВЕТОВ И ПЕРЕПИСКА НЕ ИМЕЛИ ПАГИНАЦИИ. list_post_comments отдавала
--    первые 100 и на этом всё; история чата читалась запросом
--    «order by created_at asc limit 300», то есть в длинной переписке человек
--    получал САМЫЕ СТАРЫЕ триста сообщений и не видел ни одного свежего.
--
-- 6. N+1 НА СПИСКАХ ЛЮДЕЙ. Экран со списком спрашивал get_relationship по
--    одному человеку: пятьдесят строк — пятьдесят обращений к базе. Добавлен
--    пакетный relationships_with.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Дружба: пара уникальна независимо от порядка
-- ─────────────────────────────────────────────────────────────────────────
-- Существующее ограничение unique (requester, addressee) не мешает паре
-- (A,B) сосуществовать с (B,A): для базы это разные строки. Пока дружбу
-- создавал человек заявкой, вторая строка была невозможна по смыслу. Теперь
-- её создаёт триггер по обеим подпискам — и без ограничения на неупорядоченную
-- пару гонка даёт две строки дружбы и два уведомления об одном событии.

-- Дедупликация ДО индекса: оставляем самую раннюю строку на пару.
delete from public.friendships f
using public.friendships g
where least(f.requester, f.addressee)    = least(g.requester, g.addressee)
  and greatest(f.requester, f.addressee) = greatest(g.requester, g.addressee)
  and (f.created_at, f.id) > (g.created_at, g.id);

create unique index if not exists friendships_pair_uniq
  on public.friendships (least(requester, addressee), greatest(requester, addressee));


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Сериализация пары подписок
-- ─────────────────────────────────────────────────────────────────────────
-- Ключ здесь один: лок берётся в BEFORE-триггере, то есть ДО вставки строки.
-- Тогда вторая транзакция по той же паре ждёт первую, а когда дожидается —
-- её AFTER-триггер выполняет НОВЫЙ запрос, получает свежий снимок и видит уже
-- закоммиченную встречную подписку. Advisory-лок в AFTER-триггере эту задачу
-- не решил бы: снимок ко второй транзакции всё равно приехал бы старый.
--
-- Лок транзакционный (xact) — снимается сам на commit/rollback, забыть его
-- отпустить невозможно. Область — только эта пара людей, поэтому подписки
-- разных людей друг другу не мешают.
create or replace function public.lock_follow_pair()
returns trigger
language plpgsql
as $$
declare
  a uuid;
  b uuid;
begin
  -- Ветвление по tg_op обязательно: в DELETE-триггере NEW не назначен вовсе,
  -- и coalesce(new.follower_id, old.follower_id) упал бы на обращении к полю,
  -- а не вернул бы второй аргумент.
  if tg_op = 'INSERT' then
    a := new.follower_id;  b := new.following_id;
  else
    a := old.follower_id;  b := old.following_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(a, b)::text || '|' || greatest(a, b)::text, 20260905)
  );

  if tg_op = 'INSERT' then return new; end if;
  return old;
end;
$$;

-- Имя триггера выбрано так, чтобы он шёл ПЕРВЫМ: BEFORE-триггеры Postgres
-- выполняет в алфавитном порядке, а 'follows_aa_pair_lock' < 'follows_rate_limit'.
-- Лок должен быть взят раньше любой другой проверки, иначе смысла в нём нет.
drop trigger if exists follows_aa_pair_lock on public.follows;
create trigger follows_aa_pair_lock
  before insert or delete on public.follows
  for each row execute function public.lock_follow_pair();


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Приведение строки дружбы к графу — одна функция на все случаи
-- ─────────────────────────────────────────────────────────────────────────
-- Идемпотентна: сколько раз ни позови, состояние сходится к «строка есть
-- тогда и только тогда, когда подписка взаимна». Поэтому её безопасно звать
-- и из триггера подписки, и из ремонтного прохода, и повторно.
--
-- p_a — тот, кто подписался ПЕРВЫМ: он становится requester и получает
-- уведомление «теперь вы друзья». Второй нажал кнопку сам и всё знает.
create or replace function public.reconcile_friendship(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    return;
  end if;

  if public.is_friend_with(p_a, p_b) then
    insert into public.friendships (requester, addressee, status)
    values (p_a, p_b, 'accepted')
    on conflict do nothing;
  else
    delete from public.friendships f
     where least(f.requester, f.addressee)    = least(p_a, p_b)
       and greatest(f.requester, f.addressee) = greatest(p_a, p_b);
  end if;
end;
$$;

revoke all on function public.reconcile_friendship(uuid, uuid) from public, anon, authenticated;

-- Триггер подписки больше не решает сам, что делать, — он только сообщает,
-- какая пара изменилась. Вся логика в одном месте.
create or replace function public.sync_friendship_from_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.reconcile_friendship(new.following_id, new.follower_id);
    return new;
  end if;
  perform public.reconcile_friendship(old.follower_id, old.following_id);
  return old;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Разовый ремонт уже разъехавшихся пар
-- ─────────────────────────────────────────────────────────────────────────
-- Уведомления на время ремонта сняты: иначе каждая пара, которой гонка не
-- дала строку месяц назад, получила бы сегодня «теперь вы друзья».
drop trigger if exists friendships_notify on public.friendships;

-- Строка без взаимной подписки — не дружба.
delete from public.friendships f
 where not public.is_friend_with(f.requester, f.addressee);

-- Взаимная подписка без строки — потерянная дружба. Порядок пары берём по
-- UUID: для уже существующих связей «кто первый подписался» неизвестно, а
-- уведомления по ним всё равно не рассылаются.
insert into public.friendships (requester, addressee, status)
select distinct least(f.follower_id, f.following_id), greatest(f.follower_id, f.following_id), 'accepted'
from public.follows f
join public.follows r
  on r.follower_id = f.following_id and r.following_id = f.follower_id
on conflict do nothing;

create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friendship();


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Права перестают зависеть от материализованной строки
-- ─────────────────────────────────────────────────────────────────────────
-- Раньше «друг» имел два разных определения: is_friend_with (подписки) для
-- переписки и строка friendships для дневника, списков и счётчиков. Два
-- определения одного и того же — это две вещи, которые рано или поздно
-- разойдутся; собственно, они и разошлись (см. шапку). Остаётся одно.

-- 5.1. Дневник питания.
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;
create policy "state select self, friends or coach" on public.app_state
  for select using (
    auth.uid() = app_state.user_id
    or (
      public.is_friend_with(auth.uid(), app_state.user_id)
      and not public.is_blocked_between(auth.uid(), app_state.user_id)
    )
    or exists (
      select 1 from public.coach_links l
      where l.status = 'accepted'
        and l.coach = auth.uid()
        and l.client = app_state.user_id
    )
  );

-- 5.1.2. ПРОВЕРКА БЛОКИРОВКИ В ПОЛИТИКЕ ПОДПИСКИ НЕ РАБОТАЛА.
--
-- Политика «follows insert own» с 2026-08-25 выглядела так:
--
--     and not exists (
--       select 1 from public.blocks b
--       where (b.blocker_id = following_id and b.blocked_id = follower_id)
--          or (b.blocker_id = follower_id  and b.blocked_id = following_id)
--     )
--
-- Замысел: подписаться нельзя ни на того, кого заблокировал я, ни на того, кто
-- заблокировал меня. Работала только первая половина.
--
-- Причина в том, что выражение политики выполняется ОТ ИМЕНИ ВЫЗЫВАЮЩЕГО, и
-- обращение к public.blocks внутри него подчиняется политике самой blocks:
--
--     for select using (auth.uid() = blocker_id)
--
-- То есть строка «он заблокировал меня» для меня невидима, подзапрос её не
-- находит, и первая ветка условия всегда ложна. Заблокированный человек мог
-- спокойно подписаться на того, кто его заблокировал: контент ему всё равно не
-- показывался (can_view_post и posts select зовут is_blocked_between, а она
-- SECURITY DEFINER и видит обе стороны), но он появлялся в списке подписчиков
-- блокирующего и накручивал ему счётчик — то есть блокировка переставала быть
-- тихой ровно для того, кто её поставил.
--
-- Лечится тем же способом, каким уже решён этот вопрос везде: единственной
-- функцией, которой видны обе стороны.
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not public.is_blocked_between(follower_id, following_id)
  );


-- 5.1.3. «Был(а) в сети» — тот же круг и то же определение.
-- Политика presence осталась с 2026-08-06 и читала friendships напрямую: при
-- потерянной гонке двое переписывались, но не видели присутствия друг друга.
-- Круг доступа не меняется (себя и друзей) — меняется способ спросить.
drop policy if exists "presence select self or friends" on public.presence;
create policy "presence select self or friends" on public.presence
  for select using (
    auth.uid() = presence.user_id
    or (
      public.is_friend_with(auth.uid(), presence.user_id)
      and not public.is_blocked_between(auth.uid(), presence.user_id)
    )
  );

-- 5.2. Имя и аватар друга (используется пушем о новом сообщении).
-- ПОЧЕМУ ЗДЕСЬ DROP, А НЕ ПРОСТО CREATE OR REPLACE.
--
-- У функции, возвращающей таблицу, набор OUT-параметров — часть её типа, и
-- create or replace менять его не умеет:
--     42P13: cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
-- Причём достаточно расхождения в ОДНОМ имени или типе колонки.
--
-- Знать заранее, какой формы функция лежит в конкретной базе, нельзя: историю
-- этого проекта накатывали по-разному — отдельными миграциями, склеенным
-- setup_all.sql (который какое-то время был испорчен) и правками из редактора.
-- Поэтому не полагаемся на совпадение формы, а снимаем функцию и создаём
-- заново. Права выдаются тут же, следом за созданием, — drop их забирает.
--
-- Безопасно: все функции ниже вызываются только клиентом через RPC. На них не
-- ссылается ни одна политика и ни одно представление — в политиках живут
-- is_friend_with, is_blocked_between и can_view_post, а их этот файл не трогает.

drop function if exists public.friend_briefs(uuid[]);

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
  where a.user_id = any(p_user_ids[1:200])
    and (a.user_id = auth.uid() or public.is_friend_with(auth.uid(), a.user_id));
$$;

revoke all on function public.friend_briefs(uuid[]) from public, anon;
grant execute on function public.friend_briefs(uuid[]) to authenticated;

-- 5.3. Список друзей — прямо из подписок.
-- «Дружим с» — это момент, когда подписка стала взаимной, то есть более
-- поздняя из двух. Раньше сюда попадала дата строки friendships, которой при
-- потерянной гонке просто не существовало.
--
-- Добавлена и проверка блокировки на владельца списка: без неё человек,
-- который меня заблокировал, оставался для меня перечислимым — см. п. 2 шапки.
drop function if exists public.list_friends(uuid, int, int);

create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url,
         greatest(f.created_at, r.created_at)
  from public.follows f
  join public.follows r
    on r.follower_id = f.following_id and r.following_id = f.follower_id
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by greatest(f.created_at, r.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_friends(uuid, int, int) from public, anon;
grant execute on function public.list_friends(uuid, int, int) to authenticated;

-- 5.3.1. САМА ТАБЛИЦА ПОДПИСОК ЗАКРЫВАЕТСЯ ОТ ПОСТОРОННИХ.
--
-- Проверки блокировки в list_followers/list_following, добавленные ниже, без
-- этого шага не стоят ничего. Политика на follows звучала так:
--
--     for select using (auth.role() = 'authenticated')
--
-- то есть ЛЮБОЙ вошедший читал таблицу целиком обычным запросом PostgREST:
--
--     GET /rest/v1/follows?follower_id=eq.<uuid>
--
-- Заблокировавший меня человек оставался полностью перечислимым — со всеми
-- своими подписками и подписчиками, — просто мимо RPC. Ужесточать функции и
-- оставлять открытой таблицу под ними — это охранять дверь при снятой стене.
--
-- Обоснование прежней политики («счётчики на профиле нечем посчитать») больше
-- не действует: и счётчики, и списки давно считает user_profile /
-- list_followers / list_following — SECURITY DEFINER-функции, которым RLS не
-- препятствует. Прямого чтения follows в клиенте нет ни одного: там только
-- insert (подписаться) и delete (отписаться, убрать подписчика).
--
-- Оставляем ровно своё: строки, где я одна из сторон. Это не ограничивает
-- продуктовую модель — чужие подписчики по-прежнему видны через RPC, но уже с
-- проверкой блокировки.
drop policy if exists "follows select" on public.follows;
drop policy if exists "follows select own" on public.follows;
create policy "follows select own" on public.follows
  for select using (auth.uid() = follower_id or auth.uid() = following_id);

-- 5.4. Подписчики и подписки — та же проверка «а можно ли смотреть на этого
-- человека вообще».
drop function if exists public.list_followers(uuid, int, int);

create or replace function public.list_followers(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.follower_id
  where f.following_id = p_user_id
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

drop function if exists public.list_following(uuid, int, int);

create or replace function public.list_following(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_followers(uuid, int, int) from public, anon;
revoke all on function public.list_following(uuid, int, int) from public, anon;
grant execute on function public.list_followers(uuid, int, int) to authenticated;
grant execute on function public.list_following(uuid, int, int) to authenticated;

-- 5.5. Профиль со счётчиками. Друзья считаются по взаимным подпискам.
drop function if exists public.user_profile(uuid);

create or replace function public.user_profile(p_user_id uuid)
returns table (
  user_id         uuid,
  username        text,
  display_name    text,
  avatar_url      text,
  followers_count int,
  following_count int,
  friends_count   int,
  posts_count     int
)
language sql
stable
security definer
set search_path = public
as $$
  with rel as (
    select
      p_user_id = auth.uid()                                                    as is_me,
      public.is_friend_with(auth.uid(), p_user_id)                              as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  )
  select
    p.user_id, p.username, p.display_name, p.avatar_url,
    (select count(*) from public.follows f where f.following_id = p.user_id)::int,
    (select count(*) from public.follows f where f.follower_id  = p.user_id)::int,
    (select count(*) from public.follows f
      join public.follows r on r.follower_id = f.following_id and r.following_id = f.follower_id
      where f.follower_id = p.user_id)::int,
    (select count(*) from public.posts po, rel
      where po.user_id = p.user_id
        and (rel.is_me
             or po.visibility = 'public'
             or (po.visibility = 'followers' and (rel.is_following or rel.is_friend))
             or (po.visibility = 'friends'   and rel.is_friend)))::int
  from public.profiles p
  where p.user_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_profile(uuid) from public, anon;
grant execute on function public.user_profile(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отношение сразу с несколькими людьми
-- ─────────────────────────────────────────────────────────────────────────
-- Ровно то же, что get_relationship, но на список. Экран с пятьюдесятью
-- людьми делал пятьдесят запросов; здесь это один запрос и четыре индексных
-- скана, ограниченных теми же пятьюдесятью идентификаторами.
--
-- Набор колонок повторяет get_relationship, чтобы клиент разбирал ответ той
-- же функцией и не завёл вторую трактовку одних и тех же флагов.
drop function if exists public.relationships_with(uuid[]);

create or replace function public.relationships_with(p_user_ids uuid[])
returns table (
  user_id       uuid,
  following     boolean,
  followed_by   boolean,
  mutual_follow boolean,
  friend        boolean,
  blocked       boolean,
  blocked_by    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  ids as (
    select distinct u as id from unnest(p_user_ids[1:200]) u where u is not null
  ),
  fo as (
    select f.following_id as id from public.follows f, me
    where f.follower_id = me.uid and f.following_id in (select id from ids)
  ),
  fb as (
    select f.follower_id as id from public.follows f, me
    where f.following_id = me.uid and f.follower_id in (select id from ids)
  ),
  bl as (
    select b.blocked_id as id from public.blocks b, me
    where b.blocker_id = me.uid and b.blocked_id in (select id from ids)
  ),
  bb as (
    select b.blocker_id as id from public.blocks b, me
    where b.blocked_id = me.uid and b.blocker_id in (select id from ids)
  )
  select
    ids.id,
    ids.id in (select id from fo),
    ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from bl),
    ids.id in (select id from bb)
  from ids, me
  where ids.id <> me.uid;
$$;

revoke all on function public.relationships_with(uuid[]) from public, anon;
grant execute on function public.relationships_with(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Ответы: блокировка, профиль как источник имени, пагинация
-- ─────────────────────────────────────────────────────────────────────────
-- Три исправления в одной функции.
--
--   • Заблокированные исчезают из ветки. Раньше блокировка работала только
--     там, где люди встречались напрямую, а под общим постом ответ
--     заблокированного был виден.
--
--   • Имя и аватар берутся из profiles, а не из app_state. profiles — и есть
--     публичная витрина (её наполняет триггер app_state_profile_sync); чтение
--     чужого блоба состояния ради двух полей было лишним обращением к самым
--     чувствительным данным приложения. Заодно появился ник — без него в
--     ветке нельзя отличить двух Денисов.
--
--   • Пагинация курсором и порядок «сначала новые». Отдаём последние N;
--     клиент переворачивает список и догружает более ранние по курсору.
--     Прежние «первые 100 по возрастанию» означали, что в популярной ветке
--     свежих ответов не видно вовсе.
--
-- Набор колонок меняется, поэтому нужен DROP: create or replace на смену
-- OUT-параметров отвечает 42P13.
-- Снимаем ОБЕ возможные формы: старую двухаргументную и новую — на случай,
-- если предыдущий прогон этого файла оборвался на более позднем шаге и
-- четырёхаргументная версия уже успела появиться.
drop function if exists public.list_post_comments(uuid, int);
drop function if exists public.list_post_comments(uuid, int, timestamptz, uuid);

create or replace function public.list_post_comments(
  p_post_id   uuid,
  p_limit     int default 30,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id              uuid,
  user_id         uuid,
  text            text,
  created_at      timestamptz,
  author_name     text,
  author_avatar   text,
  author_username text
)
language sql
stable
security definer
set search_path = public
as $$
  with blocked as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = auth.uid()
    union
    select b.blocker_id     from public.blocks b where b.blocked_id = auth.uid()
  )
  select c.id, c.user_id, c.text, c.created_at,
         p.display_name, p.avatar_url, p.username
  from public.post_comments c
  left join public.profiles p on p.user_id = c.user_id
  where c.post_id = p_post_id
    and public.can_view_post(p_post_id)
    and c.user_id not in (select id from blocked)
    and (
      p_before_at is null
      or (c.created_at, c.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.list_post_comments(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_post_comments(uuid, int, timestamptz, uuid) to authenticated;


-- Политика самой таблицы ответов — тем же правилом, что и функция чтения.
--
-- Без этого фильтр по блокировке в list_post_comments обходится так же, как
-- обходились списки подписчиков: обычным запросом PostgREST
--     GET /rest/v1/post_comments?post_id=eq.<uuid>
-- Политика пускала по can_view_post и ничего не знала про блокировки, то есть
-- ответ заблокированного человека приезжал в обход функции. Клиент прямых
-- чтений этой таблицы не делает — только insert и delete, — поэтому
-- ужесточение ничего не ломает.
drop policy if exists "post comments select" on public.post_comments;
create policy "post comments select" on public.post_comments
  for select using (
    public.can_view_post(post_id)
    and not public.is_blocked_between(post_comments.user_id, auth.uid())
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Лента: друзья из подписок, счётчик ответов без заблокированных
-- ─────────────────────────────────────────────────────────────────────────
-- Тело повторяет версию из 2026-08-25 с тремя правками: CTE friends считается
-- по взаимным подпискам, а не по строкам friendships; счётчик ответов не
-- учитывает заблокированных; из круга ленты убран union с friends — после
-- смены определения друзья и так подмножество подписок, и лишняя ветка
-- union'а только сбивала планировщик.
drop function if exists public.list_feed(int, timestamptz, uuid);

create or replace function public.list_feed(
  p_limit     int default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id             uuid,
  user_id        uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  text           text,
  image_url      text,
  visibility     public.post_visibility,
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
  with me as (select auth.uid() as uid),
  blocked as (
    select b.blocked_id as id from public.blocks b, me where b.blocker_id = me.uid
    union
    select b.blocker_id from public.blocks b, me where b.blocked_id = me.uid
  ),
  followed as (
    select f.following_id as id from public.follows f, me where f.follower_id = me.uid
  ),
  friends as (
    select f.following_id as id
    from public.follows f, me
    where f.follower_id = me.uid
      and exists (
        select 1 from public.follows r
        where r.follower_id = f.following_id and r.following_id = me.uid
      )
  ),
  circle as (
    select uid as id from me
    union select id from followed
  )
  select
    p.id, p.user_id, pr.username, pr.display_name, pr.avatar_url,
    p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = (select uid from me)),
    (select count(*) from public.post_comments c
      where c.post_id = p.id and c.user_id not in (select id from blocked))::int
  from public.posts p
  join circle             on circle.id = p.user_id
  join public.profiles pr on pr.user_id = p.user_id
  where
    (p_before_at is null
      or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and p.user_id not in (select id from blocked)
    and (
      p.user_id = (select uid from me)
      or p.visibility = 'public'
      or (p.visibility = 'followers' and p.user_id in (select id from followed))
      or (p.visibility = 'friends'   and p.user_id in (select id from friends))
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_feed(int, timestamptz, uuid) from public, anon;
grant execute on function public.list_feed(int, timestamptz, uuid) to authenticated;

-- Посты одного человека — тот же счётчик ответов без заблокированных.
drop function if exists public.list_posts(uuid, int, timestamptz);

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
  visibility     public.post_visibility,
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
  with rel as (
    select
      p_user_id = auth.uid()                                       as is_me,
      public.is_blocked_between(p_user_id, auth.uid())              as is_blocked,
      public.is_friend_with(auth.uid(), p_user_id)                  as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  ),
  blocked as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = auth.uid()
    union
    select b.blocker_id     from public.blocks b where b.blocked_id = auth.uid()
  )
  select
    p.id, p.user_id, p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    (select count(*) from public.post_comments c
      where c.post_id = p.id and c.user_id not in (select id from blocked))::int
  from public.posts p, rel
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and (
      rel.is_me
      or (not rel.is_blocked and (
            p.visibility = 'public'
            or (p.visibility = 'followers' and (rel.is_following or rel.is_friend))
            or (p.visibility = 'friends'   and rel.is_friend)
         ))
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Уведомления не переживают того, о чём рассказывали
-- ─────────────────────────────────────────────────────────────────────────
-- entity_id у уведомления — не внешний ключ (типы сущностей разные), поэтому
-- каскад его не чистит. В итоге после удаления поста в центре событий
-- оставалось «X отреагировал на вашу мысль», ведущее в никуда. Чистим
-- триггерами — там же, где сущность исчезает.

create or replace function public.cleanup_post_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications n
   where (n.entity_type = 'post' and n.entity_id = old.id)
      or (n.entity_type = 'comment'
          and n.metadata ? 'post_id'
          and n.metadata->>'post_id' = old.id::text);
  return old;
end;
$$;

drop trigger if exists posts_notify_cleanup on public.posts;
create trigger posts_notify_cleanup
  after delete on public.posts
  for each row execute function public.cleanup_post_notifications();

create or replace function public.cleanup_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where entity_type = 'comment' and entity_id = old.id;
  return old;
end;
$$;

drop trigger if exists post_comments_notify_cleanup on public.post_comments;
create trigger post_comments_notify_cleanup
  after delete on public.post_comments
  for each row execute function public.cleanup_comment_notification();

-- Блокировка чистила события только у того, кто блокировал. У второго
-- оставалось «X подписался на вас» от человека, чей профиль ему больше не
-- открыть, — нажатие вело в пустоту. Блокировка симметрична по последствиям,
-- даже если она односторонняя по смыслу.
create or replace function public.apply_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);

  delete from public.friendships
   where (requester = new.blocker_id and addressee = new.blocked_id)
      or (requester = new.blocked_id and addressee = new.blocker_id);

  delete from public.notifications
   where (recipient_id = new.blocker_id and actor_id = new.blocked_id)
      or (recipient_id = new.blocked_id and actor_id = new.blocker_id);

  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Частота реакций и ответов
-- ─────────────────────────────────────────────────────────────────────────
-- У постов, ответов, подписок и заявок лимит частоты был, у реакций — нет.
-- А реакция ещё и переводит уведомление обратно в непрочитанное (upsert в
-- push_notification), то есть переключением 🥕/🥦 можно было безостановочно
-- дёргать чужой бейдж. Потолок высокий: живой человек до него не доберётся.
create or replace function public.limit_post_reactions()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.post_reactions
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 300 then
    raise exception 'too many reactions, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists post_reactions_rate_limit on public.post_reactions;
create trigger post_reactions_rate_limit
  before insert or update on public.post_reactions
  for each row execute function public.limit_post_reactions();

-- Заодно закрываем щель в политике реакций. INSERT проверял can_view_post, а
-- UPDATE — только авторство строки:
--
--     for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- То есть поставив реакцию на пост, пока он был виден, человек мог менять её и
-- после того, как автор сузил видимость или заблокировал его. Счётчик под
-- чужим постом продолжал бы дёргаться от того, кому этот пост больше не
-- показывают. Разница невелика, но правило «право на действие проверяется в
-- момент действия» не должно иметь исключений без причины.
drop policy if exists "post reactions update own" on public.post_reactions;
create policy "post reactions update own" on public.post_reactions
  for update using (auth.uid() = user_id and public.can_view_post(post_id))
          with check (auth.uid() = user_id and public.can_view_post(post_id));

-- Оба лимита частоты считают строки по user_id за час, а индекса под этот
-- счёт не было ни у реакций, ни у ответов: каждая вставка means seq scan по
-- всей таблице. На тысяче строк незаметно, на миллионе — это цена каждого
-- лайка.
create index if not exists post_reactions_user_time_idx
  on public.post_reactions (user_id, created_at desc);
create index if not exists post_comments_user_time_idx
  on public.post_comments (user_id, created_at desc);

-- Индекс по (visibility, created_at) не обслуживает ни одного запроса: и
-- list_feed, и list_posts начинают с user_id, а visibility — колонка из
-- четырёх значений, по которой начинать сканирование бессмысленно. Лишний
-- индекс — это замедление каждой публикации ради нуля выигрыша на чтении.
drop index if exists public.posts_visibility_created_idx;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Ник нельзя менять как перчатки
-- ─────────────────────────────────────────────────────────────────────────
-- Ник — единственный адрес человека, и по нему его узнают. Ничем не
-- ограниченная смена означает, что освободившийся ник тут же занимает другой
-- человек, а переписка и упоминания начинают вести не туда. Сутки — не
-- препятствие тому, кто выбирает себе имя, но препятствие тому, кто
-- перебирает чужие.
alter table public.profiles add column if not exists username_changed_at timestamptz;

create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_new  text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  v_cur  text;
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_new !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars of a-z, 0-9, _' using errcode = '22023';
  end if;

  select username, username_changed_at into v_cur, v_last
  from public.profiles where user_id = v_uid;

  -- Сохранение без изменения — не смена ника и под ограничение не попадает:
  -- человек мог просто нажать «Сохранить» в редакторе профиля.
  if v_cur = v_new then
    return v_new;
  end if;

  if v_last is not null and v_last > now() - interval '1 day' then
    raise exception 'username was changed recently' using errcode = '54000';
  end if;

  if exists (select 1 from public.profiles where username = v_new and user_id <> v_uid) then
    raise exception 'username is taken' using errcode = '23505';
  end if;

  perform set_config('eataps.trusted_profile_write', 'on', true);
  update public.profiles
     set username = v_new, username_changed_at = now()
   where user_id = v_uid;
  perform set_config('eataps.trusted_profile_write', 'off', true);
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11.1. ДВЕ СЛОМАННЫЕ ВЕЩИ В ОДНОМ ТРИГГЕРЕ
-- ─────────────────────────────────────────────────────────────────────────
-- guard_profile_update с 2026-08-25 не переписывался, и в нём накопилось два
-- отказа — оба тихих, оба в самом центре регистрации.
--
-- ПЕРВЫЙ: ссылка на колонку, которой больше нет.
--
--     if new.user_id is distinct from old.user_id
--        or new.public_id is distinct from old.public_id then
--
-- Колонку public_id удалила миграция 2026-08-26_nickname_identity, а триггер
-- остался прежним. PL/pgSQL разрешает обращения к полям записи во время
-- выполнения, поэтому файл прогонялся без единой жалобы, а падало уже потом —
-- КАЖДЫЙ UPDATE по profiles, с 42703 «record "new" has no field public_id».
--
-- Что это ломало на живой базе:
--   • смену ника — set_username делает UPDATE и получает эту ошибку;
--   • сохранение состояния — save_app_state дёргает триггер
--     app_state_profile_sync, тот делает UPDATE по profiles, и падение
--     уносит всю транзакцию сохранения.
--
-- Почему это не заметили сразу: sync_profile_from_state обновляет строку
-- только когда имя или аватар РАСХОДЯТСЯ с копией. Существующим аккаунтам
-- копию проставил разовый бэкфилл той же миграции, у них расхождения нет и
-- UPDATE не выполняется вовсе. Ошибку встречает ровно тот, кто ЗАВЁЛ аккаунт
-- после миграции или изменил имя либо фото. То есть каждый новый человек.
--
-- ВТОРОЙ: защита зеркальных полей отменяла сама зеркалирование.
--
--     if auth.uid() is not null and (new.display_name is distinct from old...)
--       then new.display_name := old.display_name;
--
-- Замысел верный: display_name и avatar_url — копия из app_state, и клиент не
-- должен править их прямым запросом. Но условие «есть auth.uid()» истинно и
-- внутри sync_profile_from_state: SECURITY DEFINER меняет роль, а не JWT, и
-- auth.uid() внутри триггера — по-прежнему тот, кто сохранил состояние.
-- Поэтому единственная законная запись в эти колонки откатывалась вместе с
-- незаконными, и после первой миграции публичная витрина не обновлялась
-- больше никогда: у новых аккаунтов имя и аватар оставались пустыми, и лента,
-- поиск и списки людей показывали «Без имени» с буквой вместо фотографии.
--
-- Различаем законную запись явным признаком, а не косвенным. Признак ставит
-- сама зеркалирующая функция и тут же снимает; он транзакционный (третий
-- аргумент set_config — true), поэтому не переживает запрос и не может
-- утечь на соседний через пул соединений.
create or replace function public.sync_profile_from_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(coalesce(new.state->'profile'->>'name', ''), 60), '');
  v_raw  text := new.state->'profile'->>'avatar';
  -- Имя обрезать можно: слишком длинное имя остаётся именем. Аватар — нельзя:
  -- это base64-строка, и обрезанная она не картинка, а мусор. Поэтому сверх
  -- потолка пишем NULL, и интерфейс рисует инициал.
  v_av   text := case when char_length(coalesce(v_raw, '')) between 1 and 300000
                      then v_raw end;
begin
  perform set_config('eataps.trusted_profile_write', 'on', true);
  update public.profiles
     set display_name = v_name,
         avatar_url   = v_av
   where user_id = new.user_id
     and (display_name is distinct from v_name or avatar_url is distinct from v_av);
  perform set_config('eataps.trusted_profile_write', 'off', true);
  return null;
end;
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;

  -- Всё, что не пришло от доверенной серверной функции, откатывается целиком.
  -- Ник в этом списке не случайно: политика «profiles update own» разрешала
  -- клиенту PATCH по своей строке без разбора колонок, то есть ник можно было
  -- сменить прямым запросом мимо set_username — без снятия «собаки», без
  -- проверки частоты и без нормализации. Уникальность и формат ловили бы
  -- ограничения таблицы, но не подмену адреса раз в минуту.
  if auth.uid() is not null
     and coalesce(current_setting('eataps.trusted_profile_write', true), 'off') <> 'on' then
    new.username            := old.username;
    new.username_changed_at := old.username_changed_at;
    new.display_name        := old.display_name;
    new.avatar_url          := old.avatar_url;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_update_guard on public.profiles;
create trigger profiles_update_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- И вторым слоем — сама возможность прямой записи убирается. После правок
-- выше клиентский UPDATE не может изменить НИ ОДНОЙ колонки profiles: всё
-- откатывается триггером. Политика, которая не разрешает ничего, — это не
-- политика, а обещание, что когда-нибудь кто-нибудь добавит в таблицу колонку
-- и забудет про guard. Пишут в profiles только SECURITY DEFINER-функции
-- (set_username, sync_profile_from_state, claim_username при регистрации), а
-- им политики не нужны.
drop policy if exists "profiles update own" on public.profiles;

-- Разовое восстановление витрины для всех, кого сломал прежний триггер.
-- В SQL Editor auth.uid() пуст и guard не вмешался бы и так, но полагаться на
-- это не будем: файл могут прогнать инструментом, который передаёт JWT.
select set_config('eataps.trusted_profile_write', 'on', false);

update public.profiles p
   set display_name = nullif(left(coalesce(a.state->'profile'->>'name', ''), 60), ''),
       avatar_url   = case
                        when char_length(coalesce(a.state->'profile'->>'avatar', '')) between 1 and 300000
                        then a.state->'profile'->>'avatar'
                      end
  from public.app_state a
 where a.user_id = p.user_id
   and (
     p.display_name is distinct from nullif(left(coalesce(a.state->'profile'->>'name', ''), 60), '')
     or p.avatar_url is distinct from case
          when char_length(coalesce(a.state->'profile'->>'avatar', '')) between 1 and 300000
          then a.state->'profile'->>'avatar'
        end
   );

select set_config('eataps.trusted_profile_write', 'off', false);


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Поиск: сначала те, с кем уже есть связь
-- ─────────────────────────────────────────────────────────────────────────
-- Условие отбора не меняется (ник, с начала строки, от трёх символов) —
-- меняется только порядок. Человек, которого я ищу по трём буквам, чаще всего
-- тот, на кого я уже подписан или кто подписан на меня.
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', ''))) as v
  )
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p, q
  where char_length(q.v) >= 3
    and p.user_id <> auth.uid()
    and p.username like q.v || '%'
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    (p.username = q.v) desc,
    (exists (select 1 from public.follows f
              where f.follower_id = auth.uid() and f.following_id = p.user_id)) desc,
    (exists (select 1 from public.follows f
              where f.follower_id = p.user_id and f.following_id = auth.uid())) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Сообщения: идемпотентность, границы, пагинация
-- ─────────────────────────────────────────────────────────────────────────

-- 13.1. Ключ идемпотентности.
-- Клиент придумывает его ОДИН раз на сообщение и повторяет при каждой попытке
-- отправки. Тогда «ответ потерялся, шлём ещё раз» — это повтор той же строки,
-- а не второе сообщение. Частичный уникальный индекс: у старых сообщений
-- ключа нет и не будет, а NULL'ы в уникальный индекс не должны попадать
-- вовсе — их там были бы миллионы.
alter table public.messages add column if not exists client_id uuid;

create unique index if not exists messages_sender_client_idx
  on public.messages (sender, client_id) where client_id is not null;

-- 13.2. Потолок длины текста.
-- Его не было вообще: колонка text без ограничения означает, что одним
-- запросом можно положить в чужую переписку мегабайт. Ставим ограничение
-- только если существующие данные ему удовлетворяют — иначе миграция упала бы
-- на чьей-нибудь длинной цитате, а чинить это в разгар прогона нечем.
do $$
begin
  if not exists (select 1 from public.messages where char_length(text) > 4000) then
    alter table public.messages drop constraint if exists messages_text_len;
    alter table public.messages add constraint messages_text_len
      check (text is null or char_length(text) <= 4000);
  else
    raise notice 'messages_text_len не поставлен: есть сообщения длиннее 4000 символов';
  end if;
end $$;

-- 13.3. Отправка через RPC.
--
-- Почему не прямой INSERT, как раньше:
--   • sender приходил из тела запроса. Подделать его не давала политика
--     (auth.uid() = sender), но правило «сервер определяет, кто действует»
--     не должно держаться на том, что проверку не забыли написать;
--   • повтор при обрыве сети давал дубликат — теперь его снимает client_id;
--   • reply_to не проверялся ничем. Можно было ответить на сообщение из
--     ЧУЖОЙ переписки: сама цитата рисуется из reply_snapshot, который тоже
--     присылает клиент, так что содержимого это не раскрывало, — но связывало
--     сообщение с посторонней строкой и оставляло след в базе.
--
-- Функция намеренно SECURITY INVOKER (по умолчанию): вставку по-прежнему
-- проверяет политика messages — дружба и отсутствие блокировки. Дублировать
-- эти условия внутри значило бы завести второе место, где они могут разойтись.
drop function if exists public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid);

create or replace function public.send_message(
  p_recipient      uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_recipient is null or p_recipient = v_uid then
    raise exception 'bad recipient' using errcode = '22023';
  end if;
  if v_text is null and p_image_url is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  -- Карточка блюда — это снимок из дневника, а не место для произвольного
  -- JSON. Потолок мягкий, но он есть.
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;

  -- Уже отправляли — возвращаем ту же строку. Это и есть идемпотентность:
  -- повтор не создаёт второго сообщения и не выглядит для клиента ошибкой.
  if p_client_id is not null then
    select * into v_row from public.messages m
     where m.sender = v_uid and m.client_id = p_client_id
     limit 1;
    if found then
      return v_row;
    end if;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to
       and least(m.sender, m.recipient)    = least(v_uid, p_recipient)
       and greatest(m.sender, m.recipient) = greatest(v_uid, p_recipient)
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '42501';
  end if;

  insert into public.messages
    (sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, client_id)
  values
    (v_uid, p_recipient, v_text, p_image_url, p_meal_ref, p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id)
  returning * into v_row;

  return v_row;

exception when unique_violation then
  -- Гонка двух попыток с одним ключом: победила соседняя. Отдаём её строку —
  -- для человека это ровно то, чего он добивался.
  select * into v_row from public.messages m
   where m.sender = v_uid and m.client_id = p_client_id
   limit 1;
  if found then
    return v_row;
  end if;
  raise;
end;
$$;

revoke all on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) to authenticated;

-- 13.4. Чтение истории — курсором и с конца.
--
-- Прежний клиентский запрос читал историю так:
--     .order('created_at', { ascending: true }).limit(300)
-- То есть брал САМЫЕ СТАРЫЕ триста сообщений. В переписке короче трёхсот
-- реплик разницы не видно, и ошибка прожила незамеченной; в переписке длиннее
-- человек открывал чат и не находил в нём ни одного свежего сообщения.
--
-- Здесь порядок обратный (сначала новые) и есть курсор по (created_at, id) —
-- клиент переворачивает страницу и догружает более ранние при прокрутке вверх.
--
-- Условие по паре записано через least/greatest не для красоты: ровно в таком
-- виде лежит индекс messages_pair_idx, и запрос ложится на него целиком.
-- Форма «(sender=a and recipient=b) or (sender=b and recipient=a)», которой
-- пользовался клиент, этим индексом воспользоваться не может.
drop function if exists public.list_messages(uuid, int, timestamptz, uuid);

create or replace function public.list_messages(
  p_peer      uuid,
  p_limit     int default 40,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.messages m
  where auth.uid() is not null
    and p_peer is not null
    and least(m.sender, m.recipient)    = least(auth.uid(), p_peer)
    and greatest(m.sender, m.recipient) = greatest(auth.uid(), p_peer)
    and auth.uid() in (m.sender, m.recipient)
    and (
      p_before_at is null
      or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_messages(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_messages(uuid, int, timestamptz, uuid) to authenticated;

-- 13.5. Список диалогов.
--
-- Клиент собирал его так: выгрузить последние 200 сообщений по всем перепискам
-- и сгруппировать на месте. Два изъяна. Первый: активная переписка с одним
-- человеком вытесняет из выборки всех остальных, и диалог с редким
-- собеседником просто исчезает из списка. Второй: по сети едет текст двухсот
-- сообщений ради двух десятков строк предпросмотра.
--
-- DISTINCT ON по собеседнику берёт по одному последнему сообщению на диалог —
-- ровно то, что нужно списку, и ни строкой больше.
--
-- Форма запроса — union all из двух половин (что я отправил, что получил), а
-- не одно `where sender = me or recipient = me`. Причина в индексах: условие
-- через OR не ложится ни на один из них и приводит к чтению всей таблицы
-- сообщений — ВСЕХ пользователей, не только своих. Две половины ложатся на
-- messages_sender_time_idx и messages_recipient_idx каждая.
create index if not exists messages_sender_time_idx
  on public.messages (sender, created_at desc);

drop function if exists public.list_conversations(int);

create or replace function public.list_conversations(p_limit int default 100)
returns table (
  peer_id      uuid,
  last_id      uuid,
  last_sender  uuid,
  last_text    text,
  last_image   text,
  last_meal    boolean,
  last_at      timestamptz,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select m.recipient as peer_id, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null) as has_meal, m.created_at
    from public.messages m
    where m.sender = auth.uid()
    union all
    select m.sender, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null), m.created_at
    from public.messages m
    where m.recipient = auth.uid()
  ),
  conv as (
    select distinct on (peer_id) peer_id, id, sender, text, image_url, has_meal, created_at
    from mine
    order by peer_id, created_at desc, id desc
  )
  select c.peer_id, c.id, c.sender, c.text, c.image_url, c.has_meal, c.created_at,
         (select count(*)::int from public.messages u
           where u.recipient = auth.uid() and u.sender = c.peer_id and u.read_at is null)
  from conv c
  where not public.is_blocked_between(c.peer_id, auth.uid())
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_conversations(int) from public, anon;
grant execute on function public.list_conversations(int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- messages и notifications уже в публикации (2026-08-05_initial.sql и 2026-08-25).
-- Здесь только страховка на случай базы, поднятой в другом порядке.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-07_open_messaging_and_diary_privacy.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переписка открывается всем, дневник получает собственную настройку.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО МЕНЯЕТСЯ ПРИНЦИПИАЛЬНО
--
-- 1. ДРУЖБА ПЕРЕСТАЁТ БЫТЬ ПРАВОМ. Понятие «друзья» уходит из продукта: есть
--    только подписки. Взаимная подписка больше ничего не открывает сама по
--    себе — ни переписку, ни дневник. Она остаётся ровно тем, чем и является:
--    фактом, что два человека подписаны друг на друга.
--
--    Таблица friendships и функция is_friend_with НЕ удаляются: на них
--    завязаны видимость постов 'friends' (теперь читается как «взаимным
--    подпискам») и уведомление о взаимной подписке. Удалять их значило бы
--    трогать половину цепочки ради переименования.
--
-- 2. НАПИСАТЬ МОЖНО КОМУ УГОДНО. Сообщение доходит всегда. Но если получатель
--    не подписан на отправителя, диалог попадает к нему во вкладку «Запросы»,
--    а не в основной список: он видит сообщение и решает — разрешить или
--    запретить писать.
--
--    «Запретить» здесь НЕ блокировка. Человек остаётся подписчиком, видит
--    посты и профиль — он просто больше не может отправлять сообщения.
--    Полная блокировка остаётся отдельной кнопкой в профиле: отказ от
--    навязчивого сообщения не должен стоить человеку так дорого.
--
--    ⚠ ЭТО СНИМАЕТ ЕДИНСТВЕННЫЙ БАРЬЕР ОТ СПАМА В ЛИЧКЕ. Раньше им была
--    дружба. Поэтому здесь же вводятся квоты: до принятия запроса можно
--    отправить не больше 5 сообщений, и не больше 20 новых собеседников в час
--    (см. раздел 5). Без них открытая личка — это готовый инструмент рассылки.
--
-- 3. ДНЕВНИК ПОЛУЧАЕТ СОБСТВЕННУЮ НАСТРОЙКУ. Раньше его круг был жёстко зашит
--    («друзьям») и совпадал с кругом переписки. Теперь это выбор человека:
--
--      public    — любой авторизованный
--      followers — подписчики (ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ)
--      mutuals   — только взаимные подписки
--      private   — никто, кроме меня
--
--    ⚠ ПОСЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ. По умолчанию дневник видят ВСЕ
--    ПОДПИСЧИКИ. Подписка односторонняя и согласия владельца не требует —
--    значит, любой человек открывает себе доступ к тому, что ты ешь, одним
--    нажатием. Прежний круг (взаимная подписка) требовал согласия обеих
--    сторон. Это решение владельца продукта, принятое явно; кто хочет
--    прежнего поведения — ставит 'mutuals' в настройках.
--
--    Существующим аккаунтам ставится 'mutuals', а не 'followers': менять
--    круг доступа к чужим личным данным задним числом нельзя. Значение по
--    умолчанию действует только для тех, кто заведётся после миграции.
--
-- 4. Тем же переключателем управляется «был(а) в сети»: это часть того же
--    вопроса «кто меня наблюдает», и две отдельные настройки для него только
--    множили бы состояния.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Настройка видимости дневника
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'diary_audience') then
    create type public.diary_audience as enum ('public', 'followers', 'mutuals', 'private');
  end if;
end $$;

-- Колонку добавляем со значением 'mutuals', чтобы существующие строки не
-- переехали в момент ALTER: сегодняшний круг доступа к дневнику — это ровно
-- взаимная подписка, и он обязан сохраниться. Значение по умолчанию для НОВЫХ
-- аккаунтов ставится отдельным шагом ниже, и это видно в диффе.
alter table public.profiles
  add column if not exists diary_visibility public.diary_audience not null default 'mutuals';

alter table public.profiles alter column diary_visibility set default 'followers';

-- Смена настройки. Отдельный RPC, а не UPDATE из клиента: прямой записи в
-- profiles у клиента нет вовсе с 2026-09-05, и заводить её заново ради одной
-- колонки значило бы открыть таблицу целиком.
create or replace function public.set_diary_visibility(p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_value not in ('public', 'followers', 'mutuals', 'private') then
    raise exception 'unknown diary visibility: %', p_value using errcode = '22023';
  end if;

  update public.profiles
     set diary_visibility = p_value::public.diary_audience
   where user_id = v_uid;

  return p_value;
end;
$$;

revoke all on function public.set_diary_visibility(text) from public, anon;
grant execute on function public.set_diary_visibility(text) to authenticated;

create or replace function public.my_diary_visibility()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select diary_visibility::text from public.profiles where user_id = auth.uid();
$$;

revoke all on function public.my_diary_visibility() from public, anon;
grant execute on function public.my_diary_visibility() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Единственный ответ на вопрос «вижу ли я дневник этого человека»
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER обязателен по той же причине, что и у is_blocked_between:
-- функции нужно видеть follows и profiles целиком, а политики этих таблиц
-- отдают вызывающему только его собственные строки.
--
-- Блокировка проверяется ПЕРВОЙ и перекрывает всё, включая 'public'.
-- Доступ тренера сохранён здесь же: держать два разных правила доступа к
-- одной таблице — верный способ разойтись между ними при следующей правке.
create or replace function public.can_view_diary(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    when public.is_blocked_between(p_owner, auth.uid()) then false
    else
      coalesce((
        select case v.diary_visibility
          when 'public' then true
          when 'followers' then exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = p_owner
          )
          when 'mutuals' then public.is_friend_with(auth.uid(), p_owner)
          else false
        end
        from public.profiles v where v.user_id = p_owner
      ), false)
      -- Тренер с принятой связью видит дневник независимо от настройки:
      -- клиент сам отдал ему доступ, и настройка публичности к этому
      -- отношения не имеет.
      or exists (
        select 1 from public.coach_links l
        where l.status = 'accepted' and l.coach = auth.uid() and l.client = p_owner
      )
  end;
$$;

revoke all on function public.can_view_diary(uuid) from public, anon;
grant execute on function public.can_view_diary(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Дневник и присутствие переходят на настройку
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;
drop policy if exists "state select by diary visibility" on public.app_state;
create policy "state select by diary visibility" on public.app_state
  for select using (
    auth.uid() = app_state.user_id
    or public.can_view_diary(app_state.user_id)
  );

drop policy if exists "presence select self or friends" on public.presence;
drop policy if exists "presence select by diary visibility" on public.presence;
create policy "presence select by diary visibility" on public.presence
  for select using (
    auth.uid() = presence.user_id
    or public.can_view_diary(presence.user_id)
  );

-- Выборка дневника для чужого экрана. Имя friend_state осталось от модели, где
-- круг доступа назывался дружбой; смысла «только друзьям» в нём больше нет.
-- Заводим внятное имя, а старое оставляем тонкой обёрткой: фронтенд может
-- выкатываться и до, и после этой миграции.
create or replace function public.visible_diary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.can_view_diary(p_user_id)
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',           a.state->'profile'->'name',
        'avatar',         a.state->'profile'->'avatar',
        'bio',            a.state->'profile'->'bio',
        'guiltyPleasure', a.state->'profile'->'guiltyPleasure',
        'targets',        jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
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

revoke all on function public.visible_diary(uuid) from public, anon;
grant execute on function public.visible_diary(uuid) to authenticated;

create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.visible_diary(p_user_id);
$$;

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Разрешения на переписку
-- ─────────────────────────────────────────────────────────────────────────
-- Строка появляется только когда получатель ПРИНЯЛ решение. Состояние
-- «запрос висит» не хранится вовсе: оно вычисляется как «решения нет и
-- получатель не подписан на отправителя». Так нельзя рассинхронизировать
-- таблицу с графом подписок, и не нужен триггер, создающий строку на каждое
-- первое сообщение.
create table if not exists public.message_grants (
  owner_id   uuid not null references auth.users(id) on delete cascade,  -- получатель, он решает
  peer_id    uuid not null references auth.users(id) on delete cascade,  -- отправитель
  state      text not null check (state in ('accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (owner_id, peer_id),
  constraint message_grants_no_self check (owner_id <> peer_id)
);

create index if not exists message_grants_peer_idx on public.message_grants (peer_id, state);

alter table public.message_grants enable row level security;

-- Читать можно обе свои стороны: получателю нужно видеть свои решения,
-- отправителю — понимать, почему он больше не может писать.
drop policy if exists "message grants select own" on public.message_grants;
create policy "message grants select own" on public.message_grants
  for select using (auth.uid() = owner_id or auth.uid() = peer_id);

-- INSERT/UPDATE/DELETE-политик нет: решение принимается только через RPC ниже.
-- Иначе отправитель вписал бы себе 'accepted' прямым запросом.

-- Существующие переписки не должны задним числом уехать в «Запросы»: люди уже
-- общаются, и предъявлять им запрос на разговор, который идёт полгода, — это
-- поломка, а не приватность. Проставляем согласие по факту существующей
-- переписки, в обе стороны.
insert into public.message_grants (owner_id, peer_id, state)
select distinct m.recipient, m.sender, 'accepted'
from public.messages m
where m.recipient <> m.sender
on conflict (owner_id, peer_id) do nothing;

insert into public.message_grants (owner_id, peer_id, state)
select distinct m.sender, m.recipient, 'accepted'
from public.messages m
where m.recipient <> m.sender
on conflict (owner_id, peer_id) do nothing;


-- Состояние диалога глазами его владельца.
--   accepted — общаемся: владелец подписан на собеседника или принял его;
--   declined — владелец запретил писать;
--   pending  — сообщение пришло, решения ещё нет. Это и есть «Запрос».
create or replace function public.conversation_state(p_owner uuid, p_peer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select g.state from public.message_grants g
                    where g.owner_id = p_owner and g.peer_id = p_peer), '') = 'declined'
      then 'declined'
    when exists (select 1 from public.message_grants g
                  where g.owner_id = p_owner and g.peer_id = p_peer and g.state = 'accepted')
      then 'accepted'
    -- Подписка владельца на собеседника — это уже согласие его слушать.
    -- Отдельного нажатия «разрешить» она не требует.
    when exists (select 1 from public.follows f
                  where f.follower_id = p_owner and f.following_id = p_peer)
      then 'accepted'
    else 'pending'
  end;
$$;

revoke all on function public.conversation_state(uuid, uuid) from public, anon;
grant execute on function public.conversation_state(uuid, uuid) to authenticated;


-- Право отправить сообщение. Открыто всем, КРОМЕ двух случаев: полная
-- блокировка и явный отказ получателя.
create or replace function public.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_sender is not null
     and p_recipient is not null
     and p_sender <> p_recipient
     and not public.is_blocked_between(p_sender, p_recipient)
     and not exists (
       select 1 from public.message_grants g
       where g.owner_id = p_recipient and g.peer_id = p_sender and g.state = 'declined'
     );
$$;

revoke all on function public.can_message(uuid, uuid) from public, anon;
grant execute on function public.can_message(uuid, uuid) to authenticated;

-- Переписка больше не привилегия взаимной подписки.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and public.can_message(sender, recipient)
  );


-- Разрешить и запретить. Обе — от имени получателя и только про себя:
-- p_peer участвует лишь как вторая половина ключа, подставить чужой owner_id
-- невозможно по построению.
create or replace function public.accept_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'accepted')
  on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();

  return 'accepted';
end;
$$;

create or replace function public.decline_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'declined')
  on conflict (owner_id, peer_id) do update set state = 'declined', created_at = now();

  -- Уведомления от него убираем: человек только что сказал, что не хочет
  -- этого разговора, и бейдж о нём — продолжение того же разговора.
  delete from public.notifications
   where recipient_id = v_uid and actor_id = p_peer and type = 'MESSAGE';

  return 'declined';
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
revoke all on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;
grant execute on function public.decline_message_request(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Квоты: то, что раньше делала дружба
-- ─────────────────────────────────────────────────────────────────────────
-- Пока личка была открыта только друзьям, спам в ней был невозможен по
-- построению — написать мог лишь тот, кого впустили. Теперь написать может
-- каждый, и без ограничений это готовый инструмент рассылки: перебрать ники
-- поиском и разослать всем по сообщению.
--
-- Два потолка, оба высокие для живого человека и низкие для рассылки:
--   • до принятия запроса — не больше 5 сообщений одному человеку. Донести
--     мысль хватает; завалить непрочитанным — нет;
--   • не больше 20 НОВЫХ собеседников в час. Переписка с теми, кто уже
--     ответил или подписан, не ограничена ничем.
create or replace function public.limit_unaccepted_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_new_peers int;
begin
  -- Диалог уже принят — никаких ограничений.
  if public.conversation_state(new.recipient, new.sender) = 'accepted' then
    return new;
  end if;

  select count(*) into v_pending
  from public.messages m
  where m.sender = new.sender and m.recipient = new.recipient;

  if v_pending >= 5 then
    raise exception 'Пока человек не ответил, можно отправить не больше 5 сообщений'
      using errcode = '54000';
  end if;

  -- Скольким новым людям я написал за час. Считаем по первому сообщению
  -- каждому: продолжение начатого разговора новым собеседником не является.
  select count(distinct m.recipient) into v_new_peers
  from public.messages m
  where m.sender = new.sender
    and m.created_at > now() - interval '1 hour'
    and not exists (
      select 1 from public.messages e
      where e.sender = m.recipient and e.recipient = m.sender
    );

  if v_new_peers >= 20 then
    raise exception 'Слишком много новых собеседников за час, попробуйте позже'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_request_quota on public.messages;
create trigger messages_request_quota
  before insert on public.messages
  for each row execute function public.limit_unaccepted_messages();

-- Под оба счёта нужен индекс по паре в прямом направлении: messages_pair_idx
-- построен по неупорядоченной паре и для «сколько я написал ЕМУ» не годится.
create index if not exists messages_sender_recipient_idx
  on public.messages (sender, recipient, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Список диалогов знает про состояние
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок меняется (добавились state и карточка собеседника), поэтому
-- нужен DROP: create or replace на смену OUT-параметров отвечает 42P13.
-- Карточка здесь не роскошь — без неё клиент шёл бы за именами вторым
-- запросом на каждого собеседника, а в «Запросах» это заведомо незнакомые
-- люди, которых в кэше нет.
drop function if exists public.list_conversations(int);
drop function if exists public.list_conversations(int, text);

create or replace function public.list_conversations(
  p_limit int default 100,
  p_state text default null          -- null = все, 'accepted' | 'pending' | 'declined'
)
returns table (
  peer_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  state        text,
  last_id      uuid,
  last_sender  uuid,
  last_text    text,
  last_image   text,
  last_meal    boolean,
  last_at      timestamptz,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select m.recipient as peer_id, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null) as has_meal, m.created_at
    from public.messages m
    where m.sender = auth.uid()
    union all
    select m.sender, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null), m.created_at
    from public.messages m
    where m.recipient = auth.uid()
  ),
  conv as (
    select distinct on (peer_id) peer_id, id, sender, text, image_url, has_meal, created_at
    from mine
    order by peer_id, created_at desc, id desc
  )
  select c.peer_id, p.username, p.display_name, p.avatar_url,
         public.conversation_state(auth.uid(), c.peer_id),
         c.id, c.sender, c.text, c.image_url, c.has_meal, c.created_at,
         (select count(*)::int from public.messages u
           where u.recipient = auth.uid() and u.sender = c.peer_id and u.read_at is null)
  from conv c
  left join public.profiles p on p.user_id = c.peer_id
  where not public.is_blocked_between(c.peer_id, auth.uid())
    and (p_state is null or public.conversation_state(auth.uid(), c.peer_id) = p_state)
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_conversations(int, text) from public, anon;
grant execute on function public.list_conversations(int, text) to authenticated;

-- Счётчик для бейджа на вкладке «Запросы». Отдельная функция, а не длина
-- списка: бейдж спрашивают часто, а тащить ради числа все карточки с
-- аватарами по десятку килобайт каждая — расточительно.
create or replace function public.pending_request_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.sender)::int
  from public.messages m
  where m.recipient = auth.uid()
    and public.conversation_state(auth.uid(), m.sender) = 'pending'
    and not public.is_blocked_between(m.sender, auth.uid());
$$;

revoke all on function public.pending_request_count() from public, anon;
grant execute on function public.pending_request_count() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Отправка: понятный отказ вместо «нарушение политики»
-- ─────────────────────────────────────────────────────────────────────────
-- send_message остаётся SECURITY INVOKER: вставку по-прежнему проверяет
-- политика messages, и дублировать её условия внутри значило бы завести второе
-- место, где они могут разойтись. Добавлена только ранняя проверка с внятным
-- текстом — иначе человек видит «new row violates row-level security policy»
-- и не понимает, что произошло.
create or replace function public.send_message(
  p_recipient      uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_recipient is null or p_recipient = v_uid then
    raise exception 'bad recipient' using errcode = '22023';
  end if;
  if not public.can_message(v_uid, p_recipient) then
    raise exception 'Этот человек не принимает от вас сообщения' using errcode = '42501';
  end if;
  if v_text is null and p_image_url is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;

  if p_client_id is not null then
    select * into v_row from public.messages m
     where m.sender = v_uid and m.client_id = p_client_id
     limit 1;
    if found then
      return v_row;
    end if;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to
       and least(m.sender, m.recipient)    = least(v_uid, p_recipient)
       and greatest(m.sender, m.recipient) = greatest(v_uid, p_recipient)
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '42501';
  end if;

  insert into public.messages
    (sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, client_id)
  values
    (v_uid, p_recipient, v_text, p_image_url, p_meal_ref, p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id)
  returning * into v_row;

  return v_row;

exception when unique_violation then
  select * into v_row from public.messages m
   where m.sender = v_uid and m.client_id = p_client_id
   limit 1;
  if found then
    return v_row;
  end if;
  raise;
end;
$$;

revoke all on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Отношение: право писать больше не следует из взаимной подписки
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок сохранён, чтобы не переучивать вызывающий код; поля про
-- заявки в друзья как были всегда false, так и остались. Добавлено ровно то,
-- что теперь решает: можно ли писать и в каком состоянии диалог.
drop function if exists public.get_relationship(uuid);

create or replace function public.get_relationship(p_user_id uuid)
returns table (
  following                boolean,
  followed_by              boolean,
  mutual_follow            boolean,
  friend                   boolean,
  incoming_friend_request  boolean,
  outgoing_friend_request  boolean,
  blocked                  boolean,
  blocked_by               boolean,
  friendship_id            uuid,
  can_message              boolean,
  conversation             text,
  can_view_diary           boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  fo as (
    select
      exists (select 1 from public.follows f, me where f.follower_id = me.uid and f.following_id = p_user_id) as fwing,
      exists (select 1 from public.follows f, me where f.follower_id = p_user_id and f.following_id = me.uid) as fwed
  ),
  bl as (
    select
      exists (select 1 from public.blocks b, me where b.blocker_id = me.uid and b.blocked_id = p_user_id) as i_blocked,
      exists (select 1 from public.blocks b, me where b.blocker_id = p_user_id and b.blocked_id = me.uid) as they_blocked
  )
  select
    fo.fwing,
    fo.fwed,
    fo.fwing and fo.fwed,
    fo.fwing and fo.fwed,
    false,
    false,
    bl.i_blocked,
    bl.they_blocked,
    (select f.id from public.friendships f, me
      where (f.requester = me.uid and f.addressee = p_user_id)
         or (f.requester = p_user_id and f.addressee = me.uid)
      limit 1),
    public.can_message((select uid from me), p_user_id),
    public.conversation_state((select uid from me), p_user_id),
    public.can_view_diary(p_user_id)
  from fo, bl;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;

-- Пакетная версия — тем же набором признаков.
drop function if exists public.relationships_with(uuid[]);

create or replace function public.relationships_with(p_user_ids uuid[])
returns table (
  user_id       uuid,
  following     boolean,
  followed_by   boolean,
  mutual_follow boolean,
  friend        boolean,
  blocked       boolean,
  blocked_by    boolean,
  can_message   boolean,
  conversation  text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  ids as (
    select distinct u as id from unnest(p_user_ids[1:200]) u where u is not null
  ),
  fo as (
    select f.following_id as id from public.follows f, me
    where f.follower_id = me.uid and f.following_id in (select id from ids)
  ),
  fb as (
    select f.follower_id as id from public.follows f, me
    where f.following_id = me.uid and f.follower_id in (select id from ids)
  ),
  bl as (
    select b.blocked_id as id from public.blocks b, me
    where b.blocker_id = me.uid and b.blocked_id in (select id from ids)
  ),
  bb as (
    select b.blocker_id as id from public.blocks b, me
    where b.blocked_id = me.uid and b.blocker_id in (select id from ids)
  )
  select
    ids.id,
    ids.id in (select id from fo),
    ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from bl),
    ids.id in (select id from bb),
    public.can_message(me.uid, ids.id),
    public.conversation_state(me.uid, ids.id)
  from ids, me
  where ids.id <> me.uid;
$$;

revoke all on function public.relationships_with(uuid[]) from public, anon;
grant execute on function public.relationships_with(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- Решение по запросу должно доезжать до отправителя сразу: пока он видит
-- «сообщение не отправляется», причину знает только получатель.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_grants'
  ) then
    execute 'alter publication supabase_realtime add table public.message_grants';
  end if;
end $$;

alter table public.message_grants replica identity full;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-08_notification_upsert_fix.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — второе сообщение человеку не отправлялось.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не трогает.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО БЫЛО СЛОМАНО
--
-- Отправка сообщения падала с
--   P0001: only read_at can be updated
-- и человек видел «! повторить» под своим сообщением. Причём выборочно: одним
-- собеседникам написать можно, другим — нет, и объяснить разницу было нечем.
--
-- Механика. Вставка сообщения дёргает триггер messages_notify, тот зовёт
-- push_notification, а она делает upsert в notifications:
--
--     on conflict (recipient_id, actor_id, type, entity_id)
--       where entity_id is not null
--     do update set created_at = now(), read_at = null, metadata = excluded.metadata;
--
-- Замысел верный: одно и то же событие («в этом диалоге есть новое») — одна
-- строка, которая поднимается наверх и снова становится непрочитанной.
--
-- Но на ветке DO UPDATE срабатывает BEFORE UPDATE-триггер той же таблицы, а он
-- с 2026-08-25 запрещал менять всё, кроме read_at, — включая created_at и
-- metadata, которые этот upsert как раз и меняет. Сервер сам себе запрещал
-- запись, исключение уносило всю транзакцию, и сообщение не сохранялось.
--
-- ПОЧЕМУ ЭТО ВЫГЛЯДЕЛО КАК «НЕ МОГУ ПИСАТЬ ТОЛЬКО ЕМУ». Первое сообщение
-- проходит: строки уведомления ещё нет, срабатывает INSERT, а на нём
-- BEFORE UPDATE-триггера нет. Ломается ВТОРОЕ и все следующие — но только
-- пока строка уведомления жива. Стоит собеседнику открыть приложение и
-- разобрать события, строка исчезает, и переписка снова работает.
--
-- То есть отправка ломалась ровно к тем, кто давно не заходил. Именно это и
-- сбивало с толку: с активными собеседниками всё работало.
--
-- ЭТО НЕ РЕГРЕССИЯ 2026-09-07. Ошибка живёт с 2026-08-25, просто до открытия
-- переписки всем её встречали реже.
--
-- ───────────────────────────────────────────────────────────────────────────
-- КАК ЧИНИМ
--
-- Не ослаблением guard'а. Его смысл остаётся прежним и нужным: ПОЛУЧАТЕЛЬ не
-- должен уметь переписать содержимое события — политика «notifications mark
-- read» разрешает ему UPDATE строки без разбора по колонкам, и единственное,
-- что мешает подменить actor_id или текст, это триггер.
--
-- Различаем законную серверную запись явным признаком — тем же приёмом, что
-- уже применён к profiles в 2026-09-05 §11.1. Полагаться на auth.uid() здесь
-- нельзя: SECURITY DEFINER меняет роль, но не JWT, и внутри push_notification
-- auth.uid() — это по-прежнему тот, кто отправил сообщение.
--
-- Признак транзакционный (третий аргумент set_config = true): он не переживает
-- запрос и не может утечь на соседний через пул соединений.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.push_notification(
  p_recipient   uuid,
  p_actor       uuid,
  p_type        public.notification_type,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked_between(p_recipient, p_actor) then
    return;
  end if;

  -- Признак снимается и в случае ошибки: он транзакционный, и откат
  -- транзакции уносит его вместе с собой.
  perform set_config('eataps.trusted_notification_write', 'on', true);

  insert into public.notifications
    (recipient_id, actor_id, type, entity_type, entity_id, metadata)
  values
    (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (recipient_id, actor_id, type, entity_id)
    where entity_id is not null
  do update set created_at = now(), read_at = null, metadata = excluded.metadata;

  perform set_config('eataps.trusted_notification_write', 'off', true);
end;
$$;

revoke all on function public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb)
  from public, anon, authenticated;


-- Guard остаётся ровно таким же строгим для клиента и пропускает только
-- запись, помеченную самим сервером.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_notification_write', true), 'off') = 'on' then
    return new;
  end if;

  if new.recipient_id is distinct from old.recipient_id
     or new.actor_id    is distinct from old.actor_id
     or new.type        is distinct from old.type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id   is distinct from old.entity_id
     or new.metadata    is distinct from old.metadata
     or new.created_at  is distinct from old.created_at then
    raise exception 'only read_at can be updated';
  end if;
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- Разовая чистка залипших событий
-- ─────────────────────────────────────────────────────────────────────────
-- Пока баг был жив, уведомление о новом сообщении переставало обновляться:
-- строка осталась от самого первого сообщения, а все последующие до неё не
-- доходили. Поэтому у части людей в центре событий висит «вам написали» с
-- датой месячной давности, хотя переписка шла и позже.
--
-- Чинить пересчётом не будем — правильную дату всё равно взять неоткуда, а
-- сам счётчик непрочитанных считается по messages.read_at, а не по этим
-- строкам. Просто подтягиваем время события к последнему сообщению в
-- диалоге: так переход из уведомления ведёт туда же, куда и раньше, но
-- список событий перестаёт врать о времени.
-- Признак ставим и здесь: этот UPDATE меняет created_at, то есть упирается
-- ровно в тот триггер, который чиним. Третий аргумент false — на всю сессию,
-- потому что это отдельный оператор верхнего уровня, а не тело функции.
select set_config('eataps.trusted_notification_write', 'on', false);

update public.notifications n
   set created_at = m.last_at
  from (
    select recipient, sender, max(created_at) as last_at
    from public.messages
    group by recipient, sender
  ) m
 where n.type = 'MESSAGE'
   and n.recipient_id = m.recipient
   and n.actor_id     = m.sender
   and n.entity_id    = m.sender
   and n.created_at < m.last_at;

select set_config('eataps.trusted_notification_write', 'off', false);


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-09_social_graph_v2.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — социальный граф уровня современной соцсети.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет и НЕ РАСШИРЯЕТ доступ задним числом.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЗАЧЕМ ЭТА МИГРАЦИЯ
--
-- До сих пор в EatAps было ровно два состояния связи — «подписан» и
-- «заблокирован», — и одно право («писать можно всем, кроме отказавших»).
-- Этого хватало, пока аккаунты были открыты по построению. Теперь у человека
-- появляется закрытый аккаунт, а значит и всё, что из него следует:
--
--   • ЗАПРОС НА ПОДПИСКУ. На закрытый аккаунт нельзя подписаться нажатием —
--     можно только попросить. До решения владельца подписки НЕТ, и никакие
--     права она не даёт;
--   • БЛИЗКИЕ ДРУЗЬЯ. Односторонний список владельца: отдельный круг для
--     постов и (по желанию) для дневника;
--   • ОГРАНИЧЕНИЕ (restrict). Не блокировка: человек ничего не узнаёт, но его
--     сообщения уходят в «Запросы», а присутствие от него скрыто;
--   • ЗАГЛУШЕНИЕ (mute). Подписка цела, контент не показывается;
--   • ПРАВА НА ПЕРЕПИСКУ ПО КАТЕГОРИЯМ. Отдельно для тех, на кого я подписан,
--     для подписчиков и для всех остальных: писать сразу / в «Запросы» /
--     нельзя.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЗДЕСЬ ПРИНЦИПИАЛЬНО РАЗДЕЛЕНО
--
-- Раньше «взаимная подписка» была и признаком, и правом одновременно, и это
-- уже стоило проекта одной поломки (см. 03-pitfalls §17). Теперь:
--
--   follows           — факт «A читает B». Для закрытого аккаунта строка
--                       появляется ТОЛЬКО после одобрения владельца;
--   follow_requests   — просьба, которая ещё не решена. Права не даёт;
--   взаимная подписка — производная от follows, вычисляется, не хранится;
--   close_friends     — отдельный круг, задаётся владельцем вручную;
--   diary_access      — поимённый доступ к дневнику;
--   message_grants    — решение по переписке (было в 2026-09-07, остаётся);
--   restricted_users  — тихое ограничение;
--   user_mutes        — личное скрытие, ни на чьи права не влияет.
--
-- Ни одно из этих отношений не выводится из другого. Право доступа считает
-- ровно одна функция на ресурс, и она же стоит в политике.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ПЕРЕЧИСЛЕНИЯ СТАНОВЯТСЯ ТЕКСТОМ С CHECK
--
-- post_visibility, diary_audience и notification_type были enum'ами. Каждое
-- новое значение (close_friends, FOLLOW_REQUEST, MESSAGE_REQUEST…) означало бы
-- `alter type … add value`, а он в одной транзакции с использованием нового
-- значения запрещён — то есть setup_all.sql перестал бы прогоняться одним
-- куском. Меняем на text + CHECK: расширять список значений становится
-- обычной правкой ограничения, а не операцией с оговорками.
--
-- Сами типы не удаляем — на них ничто больше не ссылается, и удаление ради
-- чистоты не стоит риска.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ПРОИСХОДИТ С СУЩЕСТВУЮЩИМИ ДАННЫМИ
--
--   • Все аккаунты остаются ОТКРЫТЫМИ (is_private = false). Закрыть аккаунт —
--     осознанное действие владельца, а не следствие обновления;
--   • Существующие подписки сохраняются целиком и считаются одобренными;
--   • diary_visibility у всех остаётся ровно той, что была;
--   • права на переписку по умолчанию воспроизводят прежнее поведение:
--     «на кого я подписан» — сразу, все остальные — в «Запросы»;
--   • ни один человек не получает доступа, которого у него не было вчера.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Настройки аккаунта
-- ─────────────────────────────────────────────────────────────────────────
-- Всё это лежит в profiles, а не в app_state: доступ считает сервер, а
-- app_state он не читает ни в одной политике — там блоб, который принадлежит
-- человеку целиком и меняется без разбора по полям.

alter table public.profiles add column if not exists is_private boolean not null default false;

-- Право писать — три категории, как их видит получатель:
--   msg_from_following — те, на кого подписан Я (получатель);
--   msg_from_followers — мои подписчики, на которых я не подписан;
--   msg_from_others    — все остальные.
-- Значения: 'direct' (сразу в чаты) | 'request' (в «Запросы») | 'none'.
-- Значения по умолчанию воспроизводят поведение до этой миграции.
alter table public.profiles add column if not exists msg_from_following text not null default 'direct';
alter table public.profiles add column if not exists msg_from_followers text not null default 'request';
alter table public.profiles add column if not exists msg_from_others    text not null default 'request';

alter table public.profiles drop constraint if exists profiles_msg_policy_known;
alter table public.profiles add constraint profiles_msg_policy_known check (
  msg_from_following in ('direct', 'request', 'none')
  and msg_from_followers in ('direct', 'request', 'none')
  and msg_from_others in ('direct', 'request', 'none')
);

-- Кто может добавлять меня в групповые чаты.
alter table public.profiles add column if not exists group_invites text not null default 'following';
alter table public.profiles drop constraint if exists profiles_group_invites_known;
alter table public.profiles add constraint profiles_group_invites_known
  check (group_invites in ('everyone', 'following', 'none'));

-- «Показывать, что я в сети» и «показывать прочтение». Обе — взаимные по
-- смыслу: выключив у себя, человек перестаёт видеть и чужие. Взаимность
-- считается на чтении (см. can_see_activity / read_receipts_visible), а не
-- записывается в данные.
alter table public.profiles add column if not exists show_activity boolean not null default true;
alter table public.profiles add column if not exists read_receipts boolean not null default true;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Перечисления → text + CHECK
-- ─────────────────────────────────────────────────────────────────────────

-- 2.1. Видимость поста. Добавляется 'close_friends'. Значение 'friends'
-- сохраняет прежний смысл — «взаимным подпискам»; переименовать его значило бы
-- переписать существующие строки ради косметики.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts'
      and column_name = 'visibility' and data_type <> 'text'
  ) then
    alter table public.posts alter column visibility drop default;
    alter table public.posts alter column visibility type text using visibility::text;
    alter table public.posts alter column visibility set default 'followers';
  end if;
end $$;

alter table public.posts drop constraint if exists posts_visibility_known;
alter table public.posts add constraint posts_visibility_known
  check (visibility in ('public', 'followers', 'friends', 'close_friends', 'private'));

-- 2.2. Круг дневника. Добавляются 'close_friends' и 'selected'.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'diary_visibility' and data_type <> 'text'
  ) then
    alter table public.profiles alter column diary_visibility drop default;
    alter table public.profiles alter column diary_visibility type text using diary_visibility::text;
    alter table public.profiles alter column diary_visibility set default 'followers';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_diary_visibility_known;
alter table public.profiles add constraint profiles_diary_visibility_known
  check (diary_visibility in ('public', 'followers', 'mutuals', 'close_friends', 'selected', 'private'));

-- 2.3. Тип уведомления. Список расширяется сразу под всё, что умеет слать
-- новая система, включая события переписки.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name = 'type' and data_type <> 'text'
  ) then
    alter table public.notifications alter column type type text using type::text;
  end if;
end $$;

alter table public.notifications drop constraint if exists notifications_type_known;
alter table public.notifications add constraint notifications_type_known check (
  type in (
    'FOLLOW', 'FOLLOW_REQUEST', 'FOLLOW_ACCEPTED',
    'FRIEND_REQUEST', 'FRIEND_ACCEPTED',
    'POST_REACTION', 'POST_COMMENT',
    'MESSAGE', 'MESSAGE_REQUEST', 'MESSAGE_REACTION',
    'GROUP_INVITE'
  )
);

-- Тип сущности, на которую ведёт событие. Прежнее ограничение называлось
-- notifications_entity_type; здесь заводится ограничение с ДРУГИМ именем,
-- потому что старое проверяло бы уже лежащие строки по новому условию — а
-- расширение списка значений безопасно только тогда, когда это видно и
-- инструменту проверки, и человеку.
alter table public.notifications drop constraint if exists notifications_entity_type;
alter table public.notifications drop constraint if exists notifications_entity_kind;
alter table public.notifications add constraint notifications_entity_kind check (
  entity_type is null
  or entity_type in ('post', 'comment', 'user', 'friendship', 'message', 'conversation', 'follow_request')
);


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Новые отношения
-- ─────────────────────────────────────────────────────────────────────────

-- 3.1. Запрос на подписку. Живёт только пока не решён: одобрение переносит
-- строку в follows, отказ удаляет её. Хранить решённые запросы незачем —
-- «одобрен» и есть строка в follows, а «отклонён» не должен мешать человеку
-- попросить снова.
create table if not exists public.follow_requests (
  requester_id uuid not null references auth.users(id) on delete cascade,
  target_id    uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (requester_id, target_id),
  constraint follow_requests_no_self check (requester_id <> target_id)
);

create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc);
create index if not exists follow_requests_requester_idx on public.follow_requests (requester_id, created_at desc);

alter table public.follow_requests enable row level security;

-- Видит обе стороны: получателю нужен список, отправителю — состояние кнопки.
drop policy if exists "follow requests select own" on public.follow_requests;
create policy "follow requests select own" on public.follow_requests
  for select using (auth.uid() = requester_id or auth.uid() = target_id);

-- Отменить свою просьбу может отправитель, отклонить — адресат. Создание и
-- одобрение идут только через RPC: одобрение обязано быть атомарным.
drop policy if exists "follow requests delete own" on public.follow_requests;
create policy "follow requests delete own" on public.follow_requests
  for delete using (auth.uid() = requester_id or auth.uid() = target_id);


-- 3.2. Близкие друзья. Список ОДНОСТОРОННИЙ и приватный: наружу не отдаётся
-- даже тому, кто в нём состоит. Instagram здесь прав — знание «меня убрали из
-- близких» не улучшает ничью жизнь.
create table if not exists public.close_friends (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  constraint close_friends_no_self check (owner_id <> user_id)
);

create index if not exists close_friends_user_idx on public.close_friends (user_id);

alter table public.close_friends enable row level security;

-- ТОЛЬКО владелец. Ни одной политики, отдающей строку тому, кого добавили.
drop policy if exists "close friends select own" on public.close_friends;
create policy "close friends select own" on public.close_friends
  for select using (auth.uid() = owner_id);

drop policy if exists "close friends insert own" on public.close_friends;
create policy "close friends insert own" on public.close_friends
  for insert with check (
    auth.uid() = owner_id
    and owner_id <> user_id
    and not public.is_blocked_between(owner_id, user_id)
  );

drop policy if exists "close friends delete own" on public.close_friends;
create policy "close friends delete own" on public.close_friends
  for delete using (auth.uid() = owner_id);


-- 3.3. Ограничение. Тише блокировки и по смыслу, и по последствиям: человек
-- не получает никакого сигнала. Строку видит только тот, кто её поставил.
create table if not exists public.restricted_users (
  owner_id      uuid not null references auth.users(id) on delete cascade,
  restricted_id uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (owner_id, restricted_id),
  constraint restricted_no_self check (owner_id <> restricted_id)
);

create index if not exists restricted_users_target_idx on public.restricted_users (restricted_id);

alter table public.restricted_users enable row level security;

drop policy if exists "restricted select own" on public.restricted_users;
create policy "restricted select own" on public.restricted_users
  for select using (auth.uid() = owner_id);

drop policy if exists "restricted insert own" on public.restricted_users;
create policy "restricted insert own" on public.restricted_users
  for insert with check (auth.uid() = owner_id and owner_id <> restricted_id);

drop policy if exists "restricted delete own" on public.restricted_users;
create policy "restricted delete own" on public.restricted_users
  for delete using (auth.uid() = owner_id);


-- 3.4. Заглушение. На права не влияет ВООБЩЕ: подписка цела, посты доступны,
-- сообщения доходят. Меняется только то, что показывают мне.
create table if not exists public.user_mutes (
  owner_id       uuid not null references auth.users(id) on delete cascade,
  target_id      uuid not null references auth.users(id) on delete cascade,
  mute_posts     boolean not null default true,
  mute_messages  boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (owner_id, target_id),
  constraint user_mutes_no_self check (owner_id <> target_id)
);

alter table public.user_mutes enable row level security;

drop policy if exists "mutes select own" on public.user_mutes;
create policy "mutes select own" on public.user_mutes
  for select using (auth.uid() = owner_id);

drop policy if exists "mutes insert own" on public.user_mutes;
create policy "mutes insert own" on public.user_mutes
  for insert with check (auth.uid() = owner_id and owner_id <> target_id);

drop policy if exists "mutes update own" on public.user_mutes;
create policy "mutes update own" on public.user_mutes
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "mutes delete own" on public.user_mutes;
create policy "mutes delete own" on public.user_mutes
  for delete using (auth.uid() = owner_id);


-- 3.5. Поимённый доступ к дневнику (diary_visibility = 'selected').
-- Отдельная таблица, а не список в блобе: доступ проверяет сервер, а блоб он
-- не читает.
create table if not exists public.diary_access (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  constraint diary_access_no_self check (owner_id <> user_id)
);

create index if not exists diary_access_user_idx on public.diary_access (user_id);

alter table public.diary_access enable row level security;

-- Видит обе стороны: тому, кому открыли, полезно знать, что доступ есть.
drop policy if exists "diary access select" on public.diary_access;
create policy "diary access select" on public.diary_access
  for select using (auth.uid() = owner_id or auth.uid() = user_id);

drop policy if exists "diary access insert own" on public.diary_access;
create policy "diary access insert own" on public.diary_access
  for insert with check (
    auth.uid() = owner_id
    and owner_id <> user_id
    and not public.is_blocked_between(owner_id, user_id)
  );

drop policy if exists "diary access delete own" on public.diary_access;
create policy "diary access delete own" on public.diary_access
  for delete using (auth.uid() = owner_id);


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Предикаты доступа — по одному на вопрос
-- ─────────────────────────────────────────────────────────────────────────
-- Все SECURITY DEFINER и STABLE. DEFINER обязателен: политики отдают
-- вызывающему только его собственные строки, а этим функциям нужно видеть
-- follows, close_friends и profiles целиком.
--
-- Правило порядка одно во всех: БЛОКИРОВКА ПРОВЕРЯЕТСЯ ПЕРВОЙ и перекрывает
-- всё, включая 'public'.

create or replace function public.is_private_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_private from public.profiles where user_id = p_user), false);
$$;

revoke all on function public.is_private_account(uuid) from public, anon;
grant execute on function public.is_private_account(uuid) to authenticated;

-- Состоит ли p_user в близких друзьях p_owner. Наружу этот факт отдаётся
-- только владельцу списка (см. get_relationship: поле is_close_friend
-- заполняется, когда СПРАШИВАЮЩИЙ и есть владелец).
create or replace function public.is_close_friend(p_owner uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.close_friends c
    where c.owner_id = p_owner and c.user_id = p_user
  );
$$;

revoke all on function public.is_close_friend(uuid, uuid) from public, anon;
grant execute on function public.is_close_friend(uuid, uuid) to authenticated;

create or replace function public.is_restricted(p_owner uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restricted_users r
    where r.owner_id = p_owner and r.restricted_id = p_user
  );
$$;

revoke all on function public.is_restricted(uuid, uuid) from public, anon;
grant execute on function public.is_restricted(uuid, uuid) to authenticated;

create or replace function public.follows_user(p_follower uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.follows f
    where f.follower_id = p_follower and f.following_id = p_target
  );
$$;

revoke all on function public.follows_user(uuid, uuid) from public, anon;
grant execute on function public.follows_user(uuid, uuid) to authenticated;


-- ГЛАВНЫЙ предикат закрытого аккаунта: вижу ли я содержимое этого профиля.
-- Открытый аккаунт виден всем незаблокированным; закрытый — себе и одобренным
-- подписчикам. Шапка профиля (имя, аватар, счётчики) под это правило НЕ
-- попадает: её показывают всегда, иначе на закрытый аккаунт невозможно даже
-- попроситься.
create or replace function public.can_view_profile_content(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    when public.is_blocked_between(p_owner, auth.uid()) then false
    when not public.is_private_account(p_owner) then true
    else public.follows_user(auth.uid(), p_owner)
  end;
$$;

revoke all on function public.can_view_profile_content(uuid) from public, anon;
grant execute on function public.can_view_profile_content(uuid) to authenticated;


-- Дневник питания. Круг задаёт владелец; блокировка и закрытый аккаунт
-- перекрывают выбранный круг сверху.
--
-- ⚠ ЗАКРЫТЫЙ АККАУНТ ЖЁСТЧЕ НАСТРОЙКИ. Если аккаунт закрыт, то даже
-- diary_visibility = 'public' не открывает дневник посторонним: закрытость —
-- это утверждение «мой контент только для одобренных», и дневник входит в
-- контент. Иначе человек, закрывший аккаунт, продолжал бы отдавать самое
-- личное всему приложению из-за настройки, выставленной год назад.
create or replace function public.can_view_diary(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    when public.is_blocked_between(p_owner, auth.uid()) then false
    else
      (
        -- Поимённый доступ и доступ тренера НЕ зависят от закрытости
        -- аккаунта: и то и другое владелец выдал руками, конкретному
        -- человеку.
        exists (
          select 1 from public.diary_access d
          where d.owner_id = p_owner and d.user_id = auth.uid()
        )
        or exists (
          select 1 from public.coach_links l
          where l.status = 'accepted' and l.coach = auth.uid() and l.client = p_owner
        )
        or (
          public.can_view_profile_content(p_owner)
          and coalesce((
            select case v.diary_visibility
              when 'public' then true
              when 'followers' then public.follows_user(auth.uid(), p_owner)
              when 'mutuals' then public.follows_user(auth.uid(), p_owner)
                                and public.follows_user(p_owner, auth.uid())
              when 'close_friends' then public.is_close_friend(p_owner, auth.uid())
              else false
            end
            from public.profiles v where v.user_id = p_owner
          ), false)
        )
      )
  end;
$$;

revoke all on function public.can_view_diary(uuid) from public, anon;
grant execute on function public.can_view_diary(uuid) to authenticated;


-- Видимость поста. Зеркало предиката в политике posts — держать их врозь
-- нельзя, но и объединить нельзя: политика на posts, зовущая функцию,
-- читающую posts, зациклится.
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
        or (
          not public.is_blocked_between(p.user_id, auth.uid())
          and public.can_view_profile_content(p.user_id)
          and (
            p.visibility = 'public'
            or (p.visibility = 'followers' and public.follows_user(auth.uid(), p.user_id))
            or (p.visibility = 'friends'
                and public.follows_user(auth.uid(), p.user_id)
                and public.follows_user(p.user_id, auth.uid()))
            or (p.visibility = 'close_friends' and public.is_close_friend(p.user_id, auth.uid()))
          )
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;


-- Видно ли мне, что человек в сети / когда был. Взаимность намеренная: тот,
-- кто скрыл своё присутствие, не видит и чужого. Ограниченному (restrict)
-- присутствие не показывается вовсе — в этом половина смысла ограничения.
create or replace function public.can_see_activity(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    when public.is_blocked_between(p_owner, auth.uid()) then false
    when public.is_restricted(p_owner, auth.uid()) then false
    else coalesce((select show_activity from public.profiles where user_id = p_owner), true)
     and coalesce((select show_activity from public.profiles where user_id = auth.uid()), true)
  end;
$$;

revoke all on function public.can_see_activity(uuid) from public, anon;
grant execute on function public.can_see_activity(uuid) to authenticated;


-- Присутствие переезжает на своё правило.
--
-- До сих пор «был(а) в сети» отдавалось по тому же условию, что и дневник
-- питания (can_view_diary). Это связывало две несвязанные вещи: человек,
-- закрывший дневник, заодно исчезал из сети, а человек, открывший дневник
-- подписчикам, показывал им и своё присутствие, не выбирая этого.
--
-- Теперь у присутствия свой переключатель (show_activity), своя взаимность и
-- своё исключение для ограниченных.
drop policy if exists "presence select self or friends" on public.presence;
drop policy if exists "presence select by diary visibility" on public.presence;
drop policy if exists "presence select by activity setting" on public.presence;
create policy "presence select by activity setting" on public.presence
  for select using (
    auth.uid() = presence.user_id
    or public.can_see_activity(presence.user_id)
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Право написать
-- ─────────────────────────────────────────────────────────────────────────
-- Один ответ на три значения: 'direct' — сразу в чаты, 'request' — в
-- «Запросы», 'denied' — нельзя вовсе. Эту же функцию зовут RLS, RPC отправки
-- и интерфейс: трёх разных трактовок права писать в системе быть не должно.
create or replace function public.get_message_permission(p_sender uuid, p_recipient uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_sender is null or p_recipient is null or p_sender = p_recipient then 'denied'
    when public.is_blocked_between(p_sender, p_recipient) then 'denied'
    -- Явный отказ получателя сильнее любых настроек категорий.
    when exists (
      select 1 from public.message_grants g
      where g.owner_id = p_recipient and g.peer_id = p_sender and g.state = 'declined'
    ) then 'denied'
    -- Ограничение переводит переписку в «Запросы», даже если раньше её
    -- разрешили: именно это ограничение и означает.
    when public.is_restricted(p_recipient, p_sender) then 'request'
    when exists (
      select 1 from public.message_grants g
      where g.owner_id = p_recipient and g.peer_id = p_sender and g.state = 'accepted'
    ) then 'direct'
    else coalesce((
      select case
        when public.follows_user(p_recipient, p_sender) then pr.msg_from_following
        when public.follows_user(p_sender, p_recipient) then pr.msg_from_followers
        else pr.msg_from_others
      end
      from public.profiles pr where pr.user_id = p_recipient
    ), 'request')
  end;
$$;

revoke all on function public.get_message_permission(uuid, uuid) from public, anon;
grant execute on function public.get_message_permission(uuid, uuid) to authenticated;

-- Прежнее имя остаётся тонкой обёрткой: на нём стоит политика messages, и
-- переписывать её отдельно от смысловой части незачем.
create or replace function public.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_message_permission(p_sender, p_recipient) <> 'denied';
$$;

revoke all on function public.can_message(uuid, uuid) from public, anon;
grant execute on function public.can_message(uuid, uuid) to authenticated;

-- Состояние диалога глазами владельца. Опирается на то же право, чтобы
-- «человек может писать сразу» и «диалог лежит в чатах» не разошлись.
create or replace function public.conversation_state(p_owner uuid, p_peer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select g.state from public.message_grants g
                    where g.owner_id = p_owner and g.peer_id = p_peer), '') = 'declined'
      then 'declined'
    when public.get_message_permission(p_peer, p_owner) = 'direct' then 'accepted'
    when public.get_message_permission(p_peer, p_owner) = 'denied' then 'declined'
    else 'pending'
  end;
$$;

revoke all on function public.conversation_state(uuid, uuid) from public, anon;
grant execute on function public.conversation_state(uuid, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Подписка: одно действие, два исхода
-- ─────────────────────────────────────────────────────────────────────────
-- Прямую вставку в follows оставляем разрешённой ТОЛЬКО для открытых
-- аккаунтов: на закрытый подписаться нажатием нельзя по определению, и это
-- обязано держаться политикой, а не тем, что клиент позовёт правильный RPC.
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not public.is_blocked_between(follower_id, following_id)
    and not public.is_private_account(following_id)
  );

-- Частота просьб. Тот же потолок, что у подписок: двести в час — недостижимо
-- для человека и заметно ограничивает перебор.
create or replace function public.limit_follow_requests()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.follow_requests
  where requester_id = new.requester_id and created_at > now() - interval '1 hour';

  if v_recent >= 200 then
    raise exception 'too many follow requests, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists follow_requests_rate_limit on public.follow_requests;
create trigger follow_requests_rate_limit
  before insert on public.follow_requests
  for each row execute function public.limit_follow_requests();

-- Событие «просится в подписчики». Отдельный тип: у него своя карточка с
-- кнопками «Принять» и «Удалить», и путать его с «подписался» нельзя.
create or replace function public.notify_on_follow_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_notification(
    new.target_id, new.requester_id, 'FOLLOW_REQUEST', 'follow_request', new.requester_id
  );
  return new;
end;
$$;

drop trigger if exists follow_requests_notify on public.follow_requests;
create trigger follow_requests_notify
  after insert on public.follow_requests
  for each row execute function public.notify_on_follow_request();

-- Отозванная или отклонённая просьба не должна оставлять после себя событие,
-- ведущее в никуда.
create or replace function public.cleanup_follow_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where recipient_id = old.target_id
     and actor_id = old.requester_id
     and type = 'FOLLOW_REQUEST';
  return old;
end;
$$;

drop trigger if exists follow_requests_notify_cleanup on public.follow_requests;
create trigger follow_requests_notify_cleanup
  after delete on public.follow_requests
  for each row execute function public.cleanup_follow_request_notification();


-- Подписаться. Возвращает то, что случилось на самом деле:
--   'following' — подписка создана (открытый аккаунт);
--   'requested' — создана просьба (закрытый аккаунт);
--   'blocked'   — нельзя.
-- Повторный вызов ничего не ломает и возвращает текущее состояние: защита от
-- двойного нажатия стоит здесь, а не на disabled у кнопки.
create or replace function public.follow_user(p_target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_target is null or p_target = v_uid then
    raise exception 'bad target' using errcode = '22023';
  end if;
  if public.is_blocked_between(v_uid, p_target) then
    return 'blocked';
  end if;

  if public.follows_user(v_uid, p_target) then
    return 'following';
  end if;

  if public.is_private_account(p_target) then
    insert into public.follow_requests (requester_id, target_id)
    values (v_uid, p_target)
    on conflict (requester_id, target_id) do nothing;
    return 'requested';
  end if;

  insert into public.follows (follower_id, following_id)
  values (v_uid, p_target)
  on conflict do nothing;
  -- Просьба, если она почему-то лежала (аккаунт был закрыт и стал открытым),
  -- больше не нужна: подписка уже есть.
  delete from public.follow_requests where requester_id = v_uid and target_id = p_target;
  return 'following';
end;
$$;

revoke all on function public.follow_user(uuid) from public, anon;
grant execute on function public.follow_user(uuid) to authenticated;


-- Отписаться. Снимает и просьбу — «Запрошено → Отменить» и «Вы подписаны →
-- Отписаться» это одна кнопка в интерфейсе, и одно действие здесь.
create or replace function public.unfollow_user(p_target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.follows where follower_id = v_uid and following_id = p_target;
  delete from public.follow_requests where requester_id = v_uid and target_id = p_target;
  return 'none';
end;
$$;

revoke all on function public.unfollow_user(uuid) from public, anon;
grant execute on function public.unfollow_user(uuid) to authenticated;


-- Одобрить просьбу. АТОМАРНО: удаление просьбы и создание подписки в одной
-- транзакции. Два независимых клиентских запроса на их месте оставляли бы
-- человека без подписки при обрыве между ними — и без просьбы, то есть без
-- возможности повторить.
create or replace function public.accept_follow_request(p_requester uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_found boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_requester is null or p_requester = v_uid then
    raise exception 'bad requester' using errcode = '22023';
  end if;

  -- Блокировка строки просьбы: два одобрения подряд (двойное нажатие, две
  -- вкладки) не должны обе дойти до вставки.
  delete from public.follow_requests
   where requester_id = p_requester and target_id = v_uid
  returning true into v_found;

  if not coalesce(v_found, false) then
    -- Просьбы нет. Либо её уже одобрили, либо отозвали. Возвращаем текущее
    -- состояние, а не ошибку: человек добивался именно этого.
    return case when public.follows_user(p_requester, v_uid) then 'following' else 'gone' end;
  end if;

  if public.is_blocked_between(v_uid, p_requester) then
    return 'blocked';
  end if;

  insert into public.follows (follower_id, following_id)
  values (p_requester, v_uid)
  on conflict do nothing;

  -- Отправителю — событие «просьбу одобрили». Уведомление о новом подписчике
  -- владельцу при этом НЕ шлётся: он сам только что нажал «Принять».
  perform public.push_notification(p_requester, v_uid, 'FOLLOW_ACCEPTED', 'user', v_uid);

  return 'following';
end;
$$;

revoke all on function public.accept_follow_request(uuid) from public, anon;
grant execute on function public.accept_follow_request(uuid) to authenticated;


create or replace function public.decline_follow_request(p_requester uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.follow_requests
   where requester_id = p_requester and target_id = v_uid;
  -- Отправителю ничего не сообщаем: отказ в подписке — не событие, о котором
  -- человеку нужно узнать отдельным уведомлением.
  return 'declined';
end;
$$;

revoke all on function public.decline_follow_request(uuid) from public, anon;
grant execute on function public.decline_follow_request(uuid) to authenticated;


-- Убрать подписчика. НЕ блокировка: он не получает уведомления и может
-- подписаться снова — если аккаунт открыт. У закрытого ему придётся заново
-- просить, и это ровно то, зачем кнопка и нужна.
create or replace function public.remove_follower(p_follower uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.follows where follower_id = p_follower and following_id = v_uid;
  return 'removed';
end;
$$;

revoke all on function public.remove_follower(uuid) from public, anon;
grant execute on function public.remove_follower(uuid) to authenticated;


-- Список входящих просьб. Только свой: p_target здесь нет вовсе, и подставить
-- чужой невозможно по построению.
drop function if exists public.list_follow_requests(int, int);

create or replace function public.list_follow_requests(p_limit int default 30, p_offset int default 0)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, r.created_at
  from public.follow_requests r
  join public.profiles p on p.user_id = r.requester_id
  where r.target_id = auth.uid()
    and not public.is_blocked_between(r.requester_id, auth.uid())
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_follow_requests(int, int) from public, anon;
grant execute on function public.list_follow_requests(int, int) to authenticated;

create or replace function public.follow_request_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.follow_requests r
  where r.target_id = auth.uid()
    and not public.is_blocked_between(r.requester_id, auth.uid());
$$;

revoke all on function public.follow_request_count() from public, anon;
grant execute on function public.follow_request_count() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Настройки приватности
-- ─────────────────────────────────────────────────────────────────────────
-- Все — через RPC: прямой записи в profiles у клиента нет с 2026-09-05, и
-- открывать таблицу ради тумблеров значило бы отдать вместе с ними ник,
-- имя и аватар.

-- Переключение открытый ↔ закрытый.
--
-- ЧТО ПРОИСХОДИТ С СУЩЕСТВУЮЩИМИ СВЯЗЯМИ:
--   открытый → закрытый: подписчики СОХРАНЯЮТСЯ все до одного. Новые пойдут
--     через просьбу. Выгонять уже впущенных при смене настройки нельзя —
--     человек менял правило на будущее, а не отзывал прошлое;
--   закрытый → открытый: подписчики сохраняются, а НЕРЕШЁННЫЕ ПРОСЬБЫ
--     остаются просьбами. Автоматически превращать их в подписки нельзя:
--     владелец эти конкретные аккаунты ещё не одобрил, и «я открываю
--     аккаунт» не равно «я согласен на всех, кто уже просился». Они остаются
--     в «Запросах», и он решает по каждому; попроситься заново им не нужно —
--     а нажать «Подписаться» ещё раз можно в любой момент, подписка тогда
--     создастся сразу.
create or replace function public.set_account_privacy(p_private boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.profiles set is_private = coalesce(p_private, false) where user_id = v_uid;
  return coalesce(p_private, false);
end;
$$;

revoke all on function public.set_account_privacy(boolean) from public, anon;
grant execute on function public.set_account_privacy(boolean) to authenticated;


-- Права на переписку по трём категориям — одним вызовом: три отдельных RPC
-- означали бы три состояния «половина сохранилась».
create or replace function public.set_message_policy(
  p_following text, p_followers text, p_others text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_following not in ('direct', 'request', 'none')
     or p_followers not in ('direct', 'request', 'none')
     or p_others not in ('direct', 'request', 'none') then
    raise exception 'unknown message policy' using errcode = '22023';
  end if;

  update public.profiles
     set msg_from_following = p_following,
         msg_from_followers = p_followers,
         msg_from_others    = p_others
   where user_id = v_uid;
end;
$$;

revoke all on function public.set_message_policy(text, text, text) from public, anon;
grant execute on function public.set_message_policy(text, text, text) to authenticated;


create or replace function public.set_group_invites(p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_value not in ('everyone', 'following', 'none') then
    raise exception 'unknown group invite policy' using errcode = '22023';
  end if;
  update public.profiles set group_invites = p_value where user_id = v_uid;
  return p_value;
end;
$$;

revoke all on function public.set_group_invites(text) from public, anon;
grant execute on function public.set_group_invites(text) to authenticated;


create or replace function public.set_activity_visibility(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.profiles set show_activity = coalesce(p_on, true) where user_id = v_uid;
  return coalesce(p_on, true);
end;
$$;

revoke all on function public.set_activity_visibility(boolean) from public, anon;
grant execute on function public.set_activity_visibility(boolean) to authenticated;


create or replace function public.set_read_receipts(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.profiles set read_receipts = coalesce(p_on, true) where user_id = v_uid;
  return coalesce(p_on, true);
end;
$$;

revoke all on function public.set_read_receipts(boolean) from public, anon;
grant execute on function public.set_read_receipts(boolean) to authenticated;


-- Круг дневника. Список значений расширен; проверка — в одном месте, здесь.
create or replace function public.set_diary_visibility(p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_value not in ('public', 'followers', 'mutuals', 'close_friends', 'selected', 'private') then
    raise exception 'unknown diary visibility: %', p_value using errcode = '22023';
  end if;

  update public.profiles set diary_visibility = p_value where user_id = v_uid;
  return p_value;
end;
$$;

revoke all on function public.set_diary_visibility(text) from public, anon;
grant execute on function public.set_diary_visibility(text) to authenticated;


-- Все мои настройки приватности одним запросом: экран настроек иначе делал бы
-- шесть вызовов ради шести переключателей.
drop function if exists public.my_privacy();

create or replace function public.my_privacy()
returns table (
  is_private          boolean,
  diary_visibility    text,
  msg_from_following  text,
  msg_from_followers  text,
  msg_from_others     text,
  group_invites       text,
  show_activity       boolean,
  read_receipts       boolean,
  close_friends_count int,
  blocked_count       int,
  restricted_count    int,
  muted_count         int,
  diary_access_count  int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.is_private, p.diary_visibility,
    p.msg_from_following, p.msg_from_followers, p.msg_from_others,
    p.group_invites, p.show_activity, p.read_receipts,
    (select count(*) from public.close_friends c where c.owner_id = p.user_id)::int,
    (select count(*) from public.blocks b where b.blocker_id = p.user_id)::int,
    (select count(*) from public.restricted_users r where r.owner_id = p.user_id)::int,
    (select count(*) from public.user_mutes m where m.owner_id = p.user_id)::int,
    (select count(*) from public.diary_access d where d.owner_id = p.user_id)::int
  from public.profiles p
  where p.user_id = auth.uid();
$$;

revoke all on function public.my_privacy() from public, anon;
grant execute on function public.my_privacy() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Близкие друзья, ограничение, заглушение, поимённый доступ
-- ─────────────────────────────────────────────────────────────────────────
-- У каждого — установить/снять и список. Списки СВОИ и только свои: чужой
-- список близких друзей не отдаёт ни одна функция и ни одна политика.

create or replace function public.set_close_friend(p_user uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'bad user' using errcode = '22023';
  end if;

  if coalesce(p_on, false) then
    if public.is_blocked_between(v_uid, p_user) then
      return false;
    end if;
    insert into public.close_friends (owner_id, user_id) values (v_uid, p_user)
    on conflict (owner_id, user_id) do nothing;
    return true;
  end if;

  delete from public.close_friends where owner_id = v_uid and user_id = p_user;
  return false;
end;
$$;

revoke all on function public.set_close_friend(uuid, boolean) from public, anon;
grant execute on function public.set_close_friend(uuid, boolean) to authenticated;


create or replace function public.set_restricted(p_user uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'bad user' using errcode = '22023';
  end if;

  if coalesce(p_on, false) then
    insert into public.restricted_users (owner_id, restricted_id) values (v_uid, p_user)
    on conflict (owner_id, restricted_id) do nothing;
    -- Ограниченный человек не должен узнать об этом ни из чего, включая
    -- уведомления. Ничего ему не шлём — в этом весь смысл.
    return true;
  end if;

  delete from public.restricted_users where owner_id = v_uid and restricted_id = p_user;
  return false;
end;
$$;

revoke all on function public.set_restricted(uuid, boolean) from public, anon;
grant execute on function public.set_restricted(uuid, boolean) to authenticated;


create or replace function public.set_user_mute(
  p_user uuid, p_posts boolean default true, p_messages boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'bad user' using errcode = '22023';
  end if;

  -- Обе галочки сняты — строка не нужна вовсе: пустое заглушение и его
  -- отсутствие это одно и то же состояние, и хранить его дважды незачем.
  if not coalesce(p_posts, false) and not coalesce(p_messages, false) then
    delete from public.user_mutes where owner_id = v_uid and target_id = p_user;
    return;
  end if;

  insert into public.user_mutes (owner_id, target_id, mute_posts, mute_messages)
  values (v_uid, p_user, coalesce(p_posts, false), coalesce(p_messages, false))
  on conflict (owner_id, target_id)
  do update set mute_posts = excluded.mute_posts, mute_messages = excluded.mute_messages;
end;
$$;

revoke all on function public.set_user_mute(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_user_mute(uuid, boolean, boolean) to authenticated;


create or replace function public.set_diary_access(p_user uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'bad user' using errcode = '22023';
  end if;

  if coalesce(p_on, false) then
    if public.is_blocked_between(v_uid, p_user) then
      return false;
    end if;
    insert into public.diary_access (owner_id, user_id) values (v_uid, p_user)
    on conflict (owner_id, user_id) do nothing;
    return true;
  end if;

  delete from public.diary_access where owner_id = v_uid and user_id = p_user;
  return false;
end;
$$;

revoke all on function public.set_diary_access(uuid, boolean) from public, anon;
grant execute on function public.set_diary_access(uuid, boolean) to authenticated;


-- Списки «моих» отношений. Одна функция на все четыре: карточки одинаковые,
-- отличается только источник, и четыре почти одинаковых RPC разошлись бы в
-- мелочах — ровно как уже разошлись четыре копии строки человека в интерфейсе.
drop function if exists public.list_relation(text, int, int);

create or replace function public.list_relation(
  p_kind text, p_limit int default 100, p_offset int default 0
)
returns table (
  user_id       uuid,
  username      text,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz,
  mute_posts    boolean,
  mute_messages boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, s.created_at,
         coalesce(s.mute_posts, false), coalesce(s.mute_messages, false)
  from (
    select c.user_id as target, c.created_at, null::boolean as mute_posts, null::boolean as mute_messages
      from public.close_friends c where p_kind = 'close_friends' and c.owner_id = auth.uid()
    union all
    select b.blocked_id, b.created_at, null, null
      from public.blocks b where p_kind = 'blocked' and b.blocker_id = auth.uid()
    union all
    select r.restricted_id, r.created_at, null, null
      from public.restricted_users r where p_kind = 'restricted' and r.owner_id = auth.uid()
    union all
    select m.target_id, m.created_at, m.mute_posts, m.mute_messages
      from public.user_mutes m where p_kind = 'muted' and m.owner_id = auth.uid()
    union all
    select d.user_id, d.created_at, null, null
      from public.diary_access d where p_kind = 'diary_access' and d.owner_id = auth.uid()
  ) s
  join public.profiles p on p.user_id = s.target
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_relation(text, int, int) from public, anon;
grant execute on function public.list_relation(text, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Блокировка сносит всё, что связывало двоих
-- ─────────────────────────────────────────────────────────────────────────
-- Триггер, а не RPC: блокировку можно поставить и прямой вставкой (политика
-- blocks это разрешает), и последствия обязаны наступить в любом случае.
-- Клиенту чистить нечего и незачем — половина удаляемого лежит в строках,
-- которые ему не видны.
create or replace function public.apply_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);

  delete from public.follow_requests
   where (requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id);

  delete from public.friendships
   where (requester = new.blocker_id and addressee = new.blocked_id)
      or (requester = new.blocked_id and addressee = new.blocker_id);

  -- Близкие друзья и поимённый доступ к дневнику снимаются в обе стороны:
  -- блокировка односторонняя по смыслу, но по последствиям симметрична.
  delete from public.close_friends
   where (owner_id = new.blocker_id and user_id = new.blocked_id)
      or (owner_id = new.blocked_id and user_id = new.blocker_id);

  delete from public.diary_access
   where (owner_id = new.blocker_id and user_id = new.blocked_id)
      or (owner_id = new.blocked_id and user_id = new.blocker_id);

  -- Право писать отзывается явно и в обе стороны: без этого разблокировка
  -- вернула бы старое «разрешено», о котором человек давно забыл.
  delete from public.message_grants
   where (owner_id = new.blocker_id and peer_id = new.blocked_id)
      or (owner_id = new.blocked_id and peer_id = new.blocker_id);

  delete from public.notifications
   where (recipient_id = new.blocker_id and actor_id = new.blocked_id)
      or (recipient_id = new.blocked_id and actor_id = new.blocker_id);

  return new;
end;
$$;


-- Блокировка и разблокировка отдельными RPC — чтобы клиент не собирал
-- поведение из прямых запросов и не забыл ни одного шага.
create or replace function public.block_user(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'bad user' using errcode = '22023';
  end if;

  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user)
  on conflict do nothing;
  return 'blocked';
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

drop function if exists public.unblock_user(uuid);

create or replace function public.unblock_user(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.blocks where blocker_id = v_uid and blocked_id = p_user;
  return 'unblocked';
end;
$$;

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Отношение: единственный ответ на «кто мы друг другу»
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок меняется целиком, поэтому DROP обязателен (42P13). Прежние
-- поля про заявки в друзья удалены: их не существует с 2026-08-26, и держать
-- две всегда-false колонки, чтобы «не переучивать клиент», больше не нужно —
-- клиент переучивается этой же выкладкой.
drop function if exists public.get_relationship(uuid);

create or replace function public.get_relationship(p_user_id uuid)
returns table (
  is_self             boolean,
  target_is_private   boolean,
  following           boolean,
  followed_by         boolean,
  mutual_follow       boolean,
  request_sent        boolean,
  request_received    boolean,
  is_close_friend     boolean,
  blocked             boolean,
  blocked_by          boolean,
  restricted          boolean,
  muted_posts         boolean,
  muted_messages      boolean,
  has_diary_access    boolean,
  can_view_content    boolean,
  can_view_diary      boolean,
  can_see_activity    boolean,
  message_permission  text,
  conversation        text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select
    p_user_id = me.uid,
    public.is_private_account(p_user_id),
    public.follows_user(me.uid, p_user_id),
    public.follows_user(p_user_id, me.uid),
    public.follows_user(me.uid, p_user_id) and public.follows_user(p_user_id, me.uid),
    exists (select 1 from public.follow_requests r
             where r.requester_id = me.uid and r.target_id = p_user_id),
    exists (select 1 from public.follow_requests r
             where r.requester_id = p_user_id and r.target_id = me.uid),
    -- ТОЛЬКО «я добавил его». Обратное («он добавил меня») не отдаётся
    -- никому и никогда: список близких друзей односторонний и приватный.
    public.is_close_friend(me.uid, p_user_id),
    exists (select 1 from public.blocks b where b.blocker_id = me.uid and b.blocked_id = p_user_id),
    exists (select 1 from public.blocks b where b.blocker_id = p_user_id and b.blocked_id = me.uid),
    public.is_restricted(me.uid, p_user_id),
    coalesce((select m.mute_posts from public.user_mutes m
               where m.owner_id = me.uid and m.target_id = p_user_id), false),
    coalesce((select m.mute_messages from public.user_mutes m
               where m.owner_id = me.uid and m.target_id = p_user_id), false),
    exists (select 1 from public.diary_access d
             where d.owner_id = me.uid and d.user_id = p_user_id),
    public.can_view_profile_content(p_user_id),
    public.can_view_diary(p_user_id),
    public.can_see_activity(p_user_id),
    public.get_message_permission(me.uid, p_user_id),
    public.conversation_state(me.uid, p_user_id)
  from me;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;


-- Пакетная версия для списков. Тот же набор признаков минус те, что требуют
-- отдельного похода в базу на каждого человека и в списке не нужны
-- (дневник, присутствие).
drop function if exists public.relationships_with(uuid[]);

create or replace function public.relationships_with(p_user_ids uuid[])
returns table (
  user_id             uuid,
  is_self             boolean,
  target_is_private   boolean,
  following           boolean,
  followed_by         boolean,
  mutual_follow       boolean,
  request_sent        boolean,
  request_received    boolean,
  is_close_friend     boolean,
  blocked             boolean,
  blocked_by          boolean,
  restricted          boolean,
  muted_posts         boolean,
  muted_messages      boolean,
  can_view_content    boolean,
  message_permission  text,
  conversation        text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  ids as (select distinct u as id from unnest(p_user_ids[1:200]) u where u is not null)
  select
    ids.id,
    false,
    public.is_private_account(ids.id),
    public.follows_user(me.uid, ids.id),
    public.follows_user(ids.id, me.uid),
    public.follows_user(me.uid, ids.id) and public.follows_user(ids.id, me.uid),
    exists (select 1 from public.follow_requests r where r.requester_id = me.uid and r.target_id = ids.id),
    exists (select 1 from public.follow_requests r where r.requester_id = ids.id and r.target_id = me.uid),
    public.is_close_friend(me.uid, ids.id),
    exists (select 1 from public.blocks b where b.blocker_id = me.uid and b.blocked_id = ids.id),
    exists (select 1 from public.blocks b where b.blocker_id = ids.id and b.blocked_id = me.uid),
    public.is_restricted(me.uid, ids.id),
    coalesce((select m.mute_posts from public.user_mutes m where m.owner_id = me.uid and m.target_id = ids.id), false),
    coalesce((select m.mute_messages from public.user_mutes m where m.owner_id = me.uid and m.target_id = ids.id), false),
    public.can_view_profile_content(ids.id),
    public.get_message_permission(me.uid, ids.id),
    public.conversation_state(me.uid, ids.id)
  from ids, me
  where ids.id <> me.uid;
$$;

revoke all on function public.relationships_with(uuid[]) from public, anon;
grant execute on function public.relationships_with(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Профиль и списки людей знают про закрытый аккаунт
-- ─────────────────────────────────────────────────────────────────────────
-- Шапка и счётчики видны ВСЕГДА (кроме блокировки): иначе на закрытый аккаунт
-- нельзя даже попроситься — человек не найдёт, к кому обращается. Скрыто ровно
-- содержимое: посты, дневник, списки подписчиков.
drop function if exists public.user_profile(uuid);

create or replace function public.user_profile(p_user_id uuid)
returns table (
  user_id          uuid,
  username         text,
  display_name     text,
  avatar_url       text,
  is_private       boolean,
  is_self          boolean,
  can_view_content boolean,
  followers_count  int,
  following_count  int,
  friends_count    int,
  posts_count      int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id, p.username, p.display_name, p.avatar_url,
    p.is_private,
    p.user_id = auth.uid(),
    public.can_view_profile_content(p.user_id),
    (select count(*) from public.follows f where f.following_id = p.user_id)::int,
    (select count(*) from public.follows f where f.follower_id  = p.user_id)::int,
    (select count(*) from public.follows f
      join public.follows r on r.follower_id = f.following_id and r.following_id = f.follower_id
      where f.follower_id = p.user_id)::int,
    -- Счётчик записей — только тех, что видны спрашивающему. Иначе закрытый
    -- профиль обещал бы «12 мыслей» под замком, а открыв доступ, человек
    -- обнаруживал бы другое число.
    (select count(*) from public.posts po
      where po.user_id = p.user_id and public.can_view_post(po.id))::int
  from public.profiles p
  where p.user_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_profile(uuid) from public, anon;
grant execute on function public.user_profile(uuid) to authenticated;


-- Подписчики и подписки закрытого аккаунта видны только ему самому и его
-- одобренным подписчикам. Открытый аккаунт — как раньше, всем.
drop function if exists public.list_followers(uuid, int, int);

create or replace function public.list_followers(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.follower_id
  where f.following_id = p_user_id
    and public.can_view_profile_content(p_user_id)
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

drop function if exists public.list_following(uuid, int, int);

create or replace function public.list_following(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and public.can_view_profile_content(p_user_id)
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_followers(uuid, int, int) from public, anon;
revoke all on function public.list_following(uuid, int, int) from public, anon;
grant execute on function public.list_followers(uuid, int, int) to authenticated;
grant execute on function public.list_following(uuid, int, int) to authenticated;

-- Взаимные подписки («Друзья» в интерфейсе). Тот же круг доступа.
drop function if exists public.list_friends(uuid, int, int);

create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.follows r on r.follower_id = f.following_id and r.following_id = f.follower_id
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and public.can_view_profile_content(p_user_id)
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_friends(uuid, int, int) from public, anon;
grant execute on function public.list_friends(uuid, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Посты: круг «близкие друзья» и закрытый аккаунт
-- ─────────────────────────────────────────────────────────────────────────
-- Предикат политики — зеркало can_view_post и обязан править́ся вместе с ней.
-- Развернут здесь целиком, а не вызовом функции: политика на posts, зовущая
-- функцию, которая читает posts, зациклится.
drop policy if exists "posts select" on public.posts;
create policy "posts select" on public.posts
  for select using (
    auth.uid() = posts.user_id
    or (
      not public.is_blocked_between(posts.user_id, auth.uid())
      -- Закрытый аккаунт: содержимое только одобренным подписчикам, даже
      -- если сам пост помечен 'public'. Без этой строки закрытие аккаунта
      -- ничего бы не закрывало.
      and (
        not public.is_private_account(posts.user_id)
        or public.follows_user(auth.uid(), posts.user_id)
      )
      and (
        posts.visibility = 'public'
        or (posts.visibility = 'followers' and public.follows_user(auth.uid(), posts.user_id))
        or (posts.visibility = 'friends'
            and public.follows_user(auth.uid(), posts.user_id)
            and public.follows_user(posts.user_id, auth.uid()))
        or (posts.visibility = 'close_friends' and public.is_close_friend(posts.user_id, auth.uid()))
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Лента
-- ─────────────────────────────────────────────────────────────────────────
-- Что изменилось: заглушённые авторы исключаются, круг «близкие друзья»
-- добавлен, закрытые аккаунты отдают записи только одобренным подписчикам.
-- Всё это считает сервер — фронтенд ничего не фильтрует и не может.
drop function if exists public.list_feed(int, timestamptz, uuid);

create or replace function public.list_feed(
  p_limit int default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  text text,
  image_url text,
  visibility text,
  created_at timestamptz,
  edited_at timestamptz,
  carrots int,
  broccoli int,
  my_reaction text,
  comments_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  blocked as (
    select b.blocked_id as id from public.blocks b, me where b.blocker_id = me.uid
    union
    select b.blocker_id from public.blocks b, me where b.blocked_id = me.uid
  ),
  followed as (
    select f.following_id as id from public.follows f, me where f.follower_id = me.uid
  ),
  -- Заглушённые авторы выпадают из круга целиком. Подписка при этом цела:
  -- заглушение её не трогает и человек об этом не узнаёт.
  muted as (
    select m.target_id as id from public.user_mutes m, me
    where m.owner_id = me.uid and m.mute_posts
  ),
  circle as (
    select uid as id from me
    union select id from followed
  )
  select
    p.id, p.user_id, pr.username, pr.display_name, pr.avatar_url,
    p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = (select uid from me)),
    (select count(*) from public.post_comments c
      where c.post_id = p.id and c.user_id not in (select id from blocked))::int
  from public.posts p
  join circle             on circle.id = p.user_id
  join public.profiles pr on pr.user_id = p.user_id
  where
    (p_before_at is null
      or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and p.user_id not in (select id from blocked)
    and p.user_id not in (select id from muted)
    -- Закрытый аккаунт отдаёт записи только одобренным подписчикам. В ленте
    -- посторонних его записей быть и не может (круг — только подписки), но
    -- правило записано явно: отписка не должна оставлять хвост доступа.
    and (
      p.user_id = (select uid from me)
      or (
        (not public.is_private_account(p.user_id)
         or p.user_id in (select id from followed))
        and (
          p.visibility = 'public'
          or (p.visibility = 'followers' and p.user_id in (select id from followed))
          or (p.visibility = 'friends'
              and p.user_id in (select id from followed)
              and public.follows_user(p.user_id, (select uid from me)))
          or (p.visibility = 'close_friends'
              and public.is_close_friend(p.user_id, (select uid from me)))
        )
      )
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_feed(int, timestamptz, uuid) from public, anon;
grant execute on function public.list_feed(int, timestamptz, uuid) to authenticated;


-- Записи одного человека. Право на каждую считает can_view_post — одно
-- определение на все экраны.
drop function if exists public.list_posts(uuid, int, timestamptz);

create or replace function public.list_posts(
  p_user_id uuid, p_limit int default 20, p_before timestamptz default null
)
returns table (
  id uuid,
  user_id uuid,
  text text,
  image_url text,
  visibility text,
  created_at timestamptz,
  edited_at timestamptz,
  carrots int,
  broccoli int,
  my_reaction text,
  comments_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select
    p.id, p.user_id, p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r, me where r.post_id = p.id and r.user_id = me.uid),
    (select count(*) from public.post_comments c where c.post_id = p.id)::int
  from public.posts p, me
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and public.can_view_post(p.id)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Поиск людей
-- ─────────────────────────────────────────────────────────────────────────
-- Что изменилось: ищем ещё и по отображаемому имени, а не только по нику.
-- Раньше имя из условия убрали, потому что оно неуникально, — но это довод
-- против имени как АДРЕСА, а не против поиска по нему: человек ищет «Аня», а
-- не «anya_k», и не находил ничего.
--
-- Закрытые аккаунты из выдачи НЕ убираются: закрытость прячет содержимое, а не
-- существование человека, иначе на него нельзя попроситься. Заблокированные —
-- убираются в обе стороны.
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  is_private   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', ''))) as v
  )
  select p.user_id, p.username, p.display_name, p.avatar_url, p.is_private
  from public.profiles p, q
  where char_length(q.v) >= 2
    and p.user_id <> auth.uid()
    and (
      p.username like q.v || '%'
      or lower(coalesce(p.display_name, '')) like q.v || '%'
      or lower(coalesce(p.display_name, '')) like '% ' || q.v || '%'
    )
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    (p.username = q.v) desc,
    (p.username like q.v || '%') desc,
    (exists (select 1 from public.follows f
              where f.follower_id = auth.uid() and f.following_id = p.user_id)) desc,
    (exists (select 1 from public.follows f
              where f.follower_id = p.user_id and f.following_id = auth.uid())) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;

-- Поиск по имени требует индекса по нижнему регистру: без него каждый запрос
-- читал бы profiles целиком.
create index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name) text_pattern_ops);

-- Карточка человека теперь несёт и признак закрытости: списки рисуют по ней
-- замок, не спрашивая отношения отдельным запросом.
drop function if exists public.user_cards(uuid[]);

create or replace function public.user_cards(p_user_ids uuid[])
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  is_private   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, p.is_private
  from public.profiles p
  where p.user_id = any (p_user_ids[1:200])
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_cards(uuid[]) from public, anon;
grant execute on function public.user_cards(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 15. Уведомления
-- ─────────────────────────────────────────────────────────────────────────
-- Тип стал текстом (см. §2.3), поэтому старую сигнатуру push_notification
-- нужно СНЯТЬ, а не переопределить: иначе рядом окажутся две функции с
-- одинаковым именем, и вызов вида push_notification(…, 'FOLLOW', …) станет
-- неоднозначным (42725).
drop function if exists public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb);

create or replace function public.push_notification(
  p_recipient   uuid,
  p_actor       uuid,
  p_type        text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked_between(p_recipient, p_actor) then
    return;
  end if;

  -- Заглушённый собеседник не звонит в колокольчик. Событие всё равно не
  -- пишем: непрочитанный бейдж — это и есть тот сигнал, от которого человек
  -- отказался, заглушив. Сама переписка при этом идёт как обычно.
  if p_actor is not null and p_type in ('MESSAGE', 'MESSAGE_REQUEST', 'MESSAGE_REACTION') then
    if exists (
      select 1 from public.user_mutes m
      where m.owner_id = p_recipient and m.target_id = p_actor and m.mute_messages
    ) then
      return;
    end if;
  end if;

  perform set_config('eataps.trusted_notification_write', 'on', true);

  insert into public.notifications
    (recipient_id, actor_id, type, entity_type, entity_id, metadata)
  values
    (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (recipient_id, actor_id, type, entity_id)
    where entity_id is not null
  do update set created_at = now(), read_at = null, metadata = excluded.metadata;

  perform set_config('eataps.trusted_notification_write', 'off', true);
end;
$$;

revoke all on function public.push_notification(uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;


-- «Подписался» больше не шлётся на закрытый аккаунт: туда подписка приходит
-- только через одобренную просьбу, а о ней уже сказало FOLLOW_REQUEST.
-- Триггер снимается вместе с функцией: иначе DROP упирается в зависимость.
-- Пересоздаём оба тут же, ниже.
drop trigger if exists follows_notify on public.follows;
drop function if exists public.notify_on_follow();

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- На ЗАКРЫТЫЙ аккаунт подписка появляется только через одобренную просьбу,
  -- и о ней владелец уже знает: он сам нажал «Принять» секунду назад.
  -- Событие «подписался» здесь было бы вторым уведомлением о том же.
  if public.is_private_account(new.following_id) then
    return new;
  end if;

  perform public.push_notification(
    new.following_id, new.follower_id, 'FOLLOW', 'user', new.follower_id
  );
  return new;
end;
$$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();


-- Список событий. Тип теперь text; добавлено поле actor_is_private, чтобы
-- карточка «просится в подписчики» могла нарисовать замок, не спрашивая
-- профиль отдельным запросом на каждую строку.
drop function if exists public.list_notifications(int, timestamptz);

create or replace function public.list_notifications(
  p_limit int default 40, p_before timestamptz default null
)
returns table (
  id             uuid,
  type           text,
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb,
  created_at     timestamptz,
  read_at        timestamptz,
  actor_id       uuid,
  actor_name     text,
  actor_avatar   text,
  actor_username text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id, n.type, n.entity_type, n.entity_id, n.metadata, n.created_at, n.read_at,
    n.actor_id, p.display_name, p.avatar_url, p.username
  from public.notifications n
  left join public.profiles p on p.user_id = n.actor_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.created_at < p_before)
    and (n.actor_id is null or not public.is_blocked_between(n.actor_id, auth.uid()))
    -- Просьба о подписке живёт, пока лежит сама просьба. Одобрив её из
    -- профиля, человек не должен потом видеть в событиях кнопку «Принять»
    -- для того, кто уже подписан.
    and (n.type <> 'FOLLOW_REQUEST' or exists (
      select 1 from public.follow_requests r
      where r.target_id = auth.uid() and r.requester_id = n.actor_id
    ))
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_notifications(int, timestamptz) from public, anon;
grant execute on function public.list_notifications(int, timestamptz) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 16. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- Просьба о подписке должна доезжать до владельца сразу — иначе бейдж
-- «Запросы» появляется только при следующем открытии приложения.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follow_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.follow_requests';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follows'
  ) then
    execute 'alter publication supabase_realtime add table public.follows';
  end if;
end $$;

alter table public.follow_requests replica identity full;
alter table public.follows replica identity full;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-09_conversations.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переписка переезжает на диалоги: группы, запросы, отзыв сообщений.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-09-09_social_graph_v2.sql.
-- Идемпотентно. НИ ОДНО СООБЩЕНИЕ НЕ УДАЛЯЕТСЯ И НЕ ПЕРЕПИСЫВАЕТСЯ.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ПОЧЕМУ НЕЛЬЗЯ БЫЛО ОСТАТЬСЯ НА ПАРЕ (sender, recipient)
--
-- Модель «у сообщения ровно один получатель» описывает переписку двоих и
-- ничего кроме. Групповой чат в неё не ложится ни при каких ухищрениях:
-- рассылать по копии сообщения каждому участнику — значит завести N разных
-- сообщений, у которых разъедутся реакции, ответы, отзыв и прочтение.
--
-- Поэтому появляется диалог как самостоятельная сущность, а сообщение
-- принадлежит диалогу. Личная переписка — частный случай: диалог из двух
-- участников.
--
-- ───────────────────────────────────────────────────────────────────────────
-- КАК ПЕРЕЕЗЖАЮТ СУЩЕСТВУЮЩИЕ ДАННЫЕ
--
-- 1. Для каждой пары, между которыми есть хоть одно сообщение, заводится
--    диалог типа 'direct';
-- 2. У всех сообщений этой пары проставляется conversation_id;
-- 3. Оба человека становятся участниками; состояние участника берётся из
--    message_grants — то есть ровно то, что уже решено;
-- 4. Колонка recipient ОСТАЁТСЯ и продолжает заполняться для личных
--    диалогов. Это не дубль ради дубля: на ней держатся счётчик
--    непрочитанного, бейдж в навигации и весь ещё не обновлённый клиент.
--    Для группового сообщения recipient пуст — отсюда снятие NOT NULL.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ПОЯВЛЯЕТСЯ
--
--   • групповые чаты с ролями, названием и составом участников;
--   • запросы на переписку живут на участнике диалога, а не вычисляются
--     каждый раз заново;
--   • отзыв сообщения у всех (unsend) и скрытие у себя (delete for me);
--   • «прочитано» указателем last_read_at, а не UPDATE на каждое сообщение;
--   • реакции произвольным эмодзи из списка, по одной на человека;
--   • архив и очистка переписки — у каждого участника своя;
--   • пересылка;
--   • поиск по сообщениям;
--   • закрытое хранилище для вложений личной переписки.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Диалоги и участники
-- ─────────────────────────────────────────────────────────────────────────
-- pair_low / pair_high — отсортированная пара участников личного диалога.
-- Нужны ровно для одного: уникального индекса, который не даёт двум
-- одновременным «написать этому человеку» создать два диалога. Без него
-- гонка при первом сообщении разводит переписку по двум веткам, и обнаружить
-- это можно только по жалобе «он мне отвечает, а я не вижу».
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'direct',
  title           text,
  avatar_url      text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  pair_low        uuid references auth.users(id) on delete cascade,
  pair_high       uuid references auth.users(id) on delete cascade,
  constraint conversations_kind_known check (kind in ('direct', 'group')),
  constraint conversations_title_len check (title is null or char_length(title) <= 80),
  -- Личный диалог обязан знать свою пару, групповой — не имеет её вовсе.
  constraint conversations_pair_shape check (
    (kind = 'direct' and pair_low is not null and pair_high is not null and pair_low < pair_high)
    or (kind = 'group' and pair_low is null and pair_high is null)
  )
);

create unique index if not exists conversations_direct_pair_uniq
  on public.conversations (pair_low, pair_high) where kind = 'direct';

create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);


-- Участник диалога. Здесь же лежит всё «личное отношение к переписке»:
-- прочитано до, заглушено до, убрано в архив, очищено у себя, состояние
-- запроса. Всё это у каждого своё и в общую строку диалога не помещается.
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member',
  state           text not null default 'accepted',
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  last_read_at    timestamptz,
  muted_until     timestamptz,
  archived        boolean not null default false,
  cleared_at      timestamptz,
  primary key (conversation_id, user_id),
  constraint conversation_members_role_known check (role in ('owner', 'admin', 'member')),
  constraint conversation_members_state_known check (state in ('accepted', 'pending', 'declined'))
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, state)
  where left_at is null;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;


-- Членство — предикат, а не подзапрос в каждой политике. SECURITY DEFINER,
-- потому что политика самой conversation_members иначе сослалась бы на себя
-- и ушла в бесконечную рекурсию (42P17) — классическая ловушка RLS.
create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation
      and m.user_id = p_user
      and m.left_at is null
  );
$$;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

create or replace function public.conversation_role(p_conversation uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.conversation_members m
  where m.conversation_id = p_conversation and m.user_id = p_user and m.left_at is null;
$$;

revoke all on function public.conversation_role(uuid, uuid) from public, anon;
grant execute on function public.conversation_role(uuid, uuid) to authenticated;


-- Диалог виден только его участникам. Ни создания, ни изменения напрямую:
-- и то и другое проверяет права, которых у политики нет.
drop policy if exists "conversations select member" on public.conversations;
create policy "conversations select member" on public.conversations
  for select using (public.is_conversation_member(id, auth.uid()));

-- Состав диалога виден его участникам. Себя добавить нельзя: INSERT-политики
-- нет вовсе, вступление идёт только через RPC.
drop policy if exists "conversation members select" on public.conversation_members;
create policy "conversation members select" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

-- Своя строка участника — единственное, что можно менять напрямую: прочитано,
-- заглушено, архив. Роль и состояние сюда не входят и проверяются триггером.
drop policy if exists "conversation members update own" on public.conversation_members;
create policy "conversation members update own" on public.conversation_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Клиент не должен уметь выдать себе роль администратора или перевести свой
-- запрос в «принято» в обход RPC — тот делает это вместе с message_grants.
create or replace function public.guard_conversation_member_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_member_write', true), 'off') = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.state is distinct from old.state
     or new.user_id is distinct from old.user_id
     or new.conversation_id is distinct from old.conversation_id
     or new.joined_at is distinct from old.joined_at
     or new.left_at is distinct from old.left_at then
    raise exception 'only read/mute/archive state can be updated directly';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_members_update_guard on public.conversation_members;
create trigger conversation_members_update_guard
  before update on public.conversation_members
  for each row execute function public.guard_conversation_member_update();


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Сообщения переезжают в диалоги
-- ─────────────────────────────────────────────────────────────────────────
alter table public.messages add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
-- Отзыв «у всех». Строку не удаляем: у ответов на неё есть reply_to, а
-- каскад on delete set null стёр бы связь и превратил цитату в сироту.
-- Отозванное сообщение остаётся на месте пустой пометкой «сообщение удалено».
alter table public.messages add column if not exists unsent_at timestamptz;
alter table public.messages add column if not exists edited_at timestamptz;
-- Вложение сложнее картинки: видео, звук, «просмотр один раз».
--   { kind: 'image'|'video'|'audio', url, mime, size, duration, width, height,
--     mode: 'keep'|'view_once' }
alter table public.messages add column if not exists media jsonb;
alter table public.messages add column if not exists forwarded_from uuid references auth.users(id) on delete set null;

-- Групповому сообщению получатель не нужен: их там столько, сколько
-- участников. Для личного он по-прежнему заполняется — на нём держатся
-- счётчики непрочитанного и весь ещё не обновлённый клиент.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'recipient' and is_nullable = 'NO'
  ) then
    alter table public.messages alter column recipient drop not null;
  end if;
end $$;

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- Поиск по тексту переписки. Индекс по триграммам не заводим: расширение
-- pg_trgm есть не во всех проектах, а объём переписки здесь такой, что
-- обычный ILIKE по одному диалогу отрабатывает по индексу выше.


-- 2.1. Разовый перенос существующей переписки в диалоги.
--
-- Выполняется только для сообщений без conversation_id, поэтому повторный
-- прогон ничего не делает. Личные диалоги создаются по факту переписки,
-- состояние участника берётся из уже принятых решений.
insert into public.conversations (kind, pair_low, pair_high, created_at, last_message_at)
select 'direct',
       least(m.sender, m.recipient),
       greatest(m.sender, m.recipient),
       min(m.created_at),
       max(m.created_at)
from public.messages m
where m.conversation_id is null
  and m.recipient is not null
  and m.sender <> m.recipient
group by least(m.sender, m.recipient), greatest(m.sender, m.recipient)
on conflict (pair_low, pair_high) where kind = 'direct' do nothing;

update public.messages m
   set conversation_id = c.id
  from public.conversations c
 where m.conversation_id is null
   and m.recipient is not null
   and c.kind = 'direct'
   and c.pair_low  = least(m.sender, m.recipient)
   and c.pair_high = greatest(m.sender, m.recipient);

-- Участники: обе стороны каждого личного диалога.
insert into public.conversation_members (conversation_id, user_id, role, state, last_read_at)
select c.id, c.pair_low, 'member',
       coalesce((select g.state from public.message_grants g
                  where g.owner_id = c.pair_low and g.peer_id = c.pair_high), 'accepted'),
       (select max(x.created_at) from public.messages x
         where x.conversation_id = c.id and x.recipient = c.pair_low and x.read_at is not null)
from public.conversations c
where c.kind = 'direct'
on conflict (conversation_id, user_id) do nothing;

insert into public.conversation_members (conversation_id, user_id, role, state, last_read_at)
select c.id, c.pair_high, 'member',
       coalesce((select g.state from public.message_grants g
                  where g.owner_id = c.pair_high and g.peer_id = c.pair_low), 'accepted'),
       (select max(x.created_at) from public.messages x
         where x.conversation_id = c.id and x.recipient = c.pair_high and x.read_at is not null)
from public.conversations c
where c.kind = 'direct'
on conflict (conversation_id, user_id) do nothing;


-- 2.2. Права на сообщения.
--
-- Прежнее условие (я отправитель или получатель) СОХРАНЕНО: на нём держится
-- ещё не обновлённый клиент, читающий messages напрямую. Добавлено членство в
-- диалоге — единственный способ увидеть групповое сообщение.
--
-- Заблокированные не видят переписку друг друга вовсе: без этой строки
-- блокировка оставляла бы полностью читаемую историю.
drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select using (
    (
      auth.uid() = sender
      or auth.uid() = recipient
      or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid()))
    )
    and (recipient is null or not public.is_blocked_between(sender, auth.uid()))
  );

-- Вставка: либо старым путём (личное сообщение с проверкой права писать),
-- либо в диалог, где я состою. Второе условие ещё раз проверяется в RPC —
-- политика здесь нижняя граница, а не единственная.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and (
      (recipient is not null and public.can_message(sender, recipient))
      or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid()))
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 3. «Удалить у себя»
-- ─────────────────────────────────────────────────────────────────────────
-- Раньше это жило в localStorage и не переживало смену устройства: человек
-- убирал сообщение на телефоне и снова видел его на ноутбуке. Скрытие — это
-- решение человека, а не настройка браузера, поэтому его место на сервере.
create table if not exists public.message_deletions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_deletions_user_idx on public.message_deletions (user_id);

alter table public.message_deletions enable row level security;

drop policy if exists "message deletions own" on public.message_deletions;
create policy "message deletions own" on public.message_deletions
  for select using (auth.uid() = user_id);

drop policy if exists "message deletions insert own" on public.message_deletions;
create policy "message deletions insert own" on public.message_deletions
  for insert with check (auth.uid() = user_id);

drop policy if exists "message deletions delete own" on public.message_deletions;
create policy "message deletions delete own" on public.message_deletions
  for delete using (auth.uid() = user_id);

-- Кто уже посмотрел «одноразовое» вложение. Отдельная таблица, потому что
-- в группе просмотр у каждого свой.
create table if not exists public.message_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_views enable row level security;

-- Отправитель видит, кто посмотрел; каждый видит свои отметки.
drop policy if exists "message views select" on public.message_views;
create policy "message views select" on public.message_views
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.messages m where m.id = message_id and m.sender = auth.uid())
  );

drop policy if exists "message views insert own" on public.message_views;
create policy "message views insert own" on public.message_views
  for insert with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Триггеры сообщений становятся диалоговыми
-- ─────────────────────────────────────────────────────────────────────────

-- Квоты на непринятую переписку. Групповые сообщения под них не попадают:
-- войти в группу без приглашения нельзя, и рассылать через неё некому.
create or replace function public.limit_unaccepted_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_new_peers int;
begin
  if new.recipient is null then
    return new;
  end if;
  if public.get_message_permission(new.sender, new.recipient) = 'direct' then
    return new;
  end if;

  select count(*) into v_pending
  from public.messages m
  where m.sender = new.sender and m.recipient = new.recipient;

  if v_pending >= 5 then
    raise exception 'Пока человек не ответил, можно отправить не больше 5 сообщений'
      using errcode = '54000';
  end if;

  select count(distinct m.recipient) into v_new_peers
  from public.messages m
  where m.sender = new.sender
    and m.created_at > now() - interval '1 hour'
    and not exists (
      select 1 from public.messages e
      where e.sender = m.recipient and e.recipient = m.sender
    );

  if v_new_peers >= 20 then
    raise exception 'Слишком много новых собеседников за час, попробуйте позже'
      using errcode = '54000';
  end if;

  return new;
end;
$$;


-- Событие о сообщении. Теперь оно рассылается ВСЕМ участникам диалога, кроме
-- отправителя, и различает обычное сообщение и запрос: у них разные экраны и
-- разные бейджи.
--
-- entity_id для личного диалога — id собеседника (одна строка на диалог, и
-- вести она должна в диалог). Для группы — id диалога.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member record;
  v_kind text;
begin
  if new.conversation_id is null then
    -- Сообщение, вставленное старым клиентом напрямую: диалога у него нет.
    perform public.push_notification(new.recipient, new.sender, 'MESSAGE', 'message', new.sender);
    return new;
  end if;

  select kind into v_kind from public.conversations where id = new.conversation_id;

  for v_member in
    select m.user_id, m.state, m.muted_until
    from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender
      and m.left_at is null
  loop
    -- Заглушённый диалог не звонит. Сообщение при этом доставлено, счётчик
    -- внутри списка диалогов его посчитает — молчит только колокольчик.
    if v_member.muted_until is not null and v_member.muted_until > now() then
      continue;
    end if;
    if v_member.state = 'declined' then
      continue;
    end if;

    if v_kind = 'group' then
      perform public.push_notification(
        v_member.user_id, new.sender,
        case when v_member.state = 'pending' then 'MESSAGE_REQUEST' else 'MESSAGE' end,
        'conversation', new.conversation_id
      );
    else
      perform public.push_notification(
        v_member.user_id, new.sender,
        case when v_member.state = 'pending' then 'MESSAGE_REQUEST' else 'MESSAGE' end,
        'message', new.sender
      );
    end if;
  end loop;

  return new;
end;
$$;


-- Прямые UPDATE по messages остаются доступны только получателю личного
-- сообщения и только для read_at. Всё остальное (реакции, отзыв, правка) идёт
-- через RPC, которые помечают запись доверенной.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_message_write', true), 'off') = 'on' then
    return new;
  end if;

  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.media        is distinct from old.media
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name
       or new.unsent_at    is distinct from old.unsent_at
       or new.reactions    is distinct from old.reactions
       or new.conversation_id is distinct from old.conversation_id then
      raise exception 'Only read_at can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "messages mark read" on public.messages;
create policy "messages mark read" on public.messages
  for update using (auth.uid() = recipient) with check (auth.uid() = recipient);


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Создание диалогов
-- ─────────────────────────────────────────────────────────────────────────

-- Личный диалог: найти или создать. Идемпотентна по построению — повторный
-- вызов возвращает тот же id, а уникальный индекс по паре не даёт двум
-- одновременным вызовам развести переписку по двум веткам.
--
-- Состояние участника выставляется по праву писать: 'accepted', если человек
-- принимает сообщения от собеседника сразу, иначе 'pending' — и диалог
-- ложится к нему в «Запросы», а не в чаты.
create or replace function public.direct_conversation(p_peer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_low  uuid;
  v_high uuid;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;
  if public.is_blocked_between(v_uid, p_peer) then
    raise exception 'Этот диалог недоступен' using errcode = '42501';
  end if;

  v_low  := least(v_uid, p_peer);
  v_high := greatest(v_uid, p_peer);

  select id into v_id from public.conversations
   where kind = 'direct' and pair_low = v_low and pair_high = v_high;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (kind, created_by, pair_low, pair_high)
  values ('direct', v_uid, v_low, v_high)
  on conflict (pair_low, pair_high) where kind = 'direct' do nothing
  returning id into v_id;

  if v_id is null then
    -- Гонку выиграл кто-то другой: диалог уже есть, и это нормальный исход.
    select id into v_id from public.conversations
     where kind = 'direct' and pair_low = v_low and pair_high = v_high;
    return v_id;
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  insert into public.conversation_members (conversation_id, user_id, state)
  values
    (v_id, v_uid,  case when public.get_message_permission(p_peer, v_uid) = 'direct' then 'accepted' else 'pending' end),
    (v_id, p_peer, case when public.get_message_permission(v_uid, p_peer) = 'direct' then 'accepted' else 'pending' end)
  on conflict (conversation_id, user_id) do nothing;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_id;
end;
$$;

revoke all on function public.direct_conversation(uuid) from public, anon;
grant execute on function public.direct_conversation(uuid) to authenticated;


-- Кто может добавить меня в группу. Блокировка перекрывает всё; дальше —
-- настройка приглашаемого.
create or replace function public.can_invite_to_group(p_inviter uuid, p_invitee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_inviter is null or p_invitee is null or p_inviter = p_invitee then false
    when public.is_blocked_between(p_inviter, p_invitee) then false
    else coalesce((
      select case pr.group_invites
        when 'everyone' then true
        when 'following' then public.follows_user(p_invitee, p_inviter)
        else false
      end
      from public.profiles pr where pr.user_id = p_invitee
    ), false)
  end;
$$;

revoke all on function public.can_invite_to_group(uuid, uuid) from public, anon;
grant execute on function public.can_invite_to_group(uuid, uuid) to authenticated;


-- Групповой диалог. Приглашать можно только тех, кто это разрешил: настройка
-- group_invites у каждого своя ('everyone' | 'following' | 'none').
create or replace function public.create_group_conversation(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_ids   uuid[];
  v_one   uuid;
  v_added int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct u) into v_ids
  from unnest(coalesce(p_members, '{}'::uuid[])) u
  where u is not null and u <> v_uid;

  if v_ids is null or array_length(v_ids, 1) < 1 then
    raise exception 'Выберите хотя бы одного участника' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 49 then
    raise exception 'В группе не больше 50 участников' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22001';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', v_title, v_uid)
  returning id into v_id;

  perform set_config('eataps.trusted_member_write', 'on', true);
  insert into public.conversation_members (conversation_id, user_id, role, state)
  values (v_id, v_uid, 'owner', 'accepted');

  foreach v_one in array v_ids loop
    if public.is_blocked_between(v_uid, v_one) then
      continue;
    end if;
    if public.can_invite_to_group(v_uid, v_one) then
      insert into public.conversation_members (conversation_id, user_id, role, state)
      values (v_id, v_one, 'member',
              case when public.get_message_permission(v_uid, v_one) = 'direct' then 'accepted' else 'pending' end)
      on conflict (conversation_id, user_id) do nothing;
      -- Человек должен узнать, что его куда-то добавили, а не обнаружить это
      -- по всплывшему в списке незнакомому диалогу.
      perform public.push_notification(v_one, v_uid, 'GROUP_INVITE', 'conversation', v_id);
      v_added := v_added + 1;
    end if;
  end loop;
  perform set_config('eataps.trusted_member_write', 'off', true);

  if v_added = 0 then
    raise exception 'Никого из выбранных нельзя добавить в группу' using errcode = '42501';
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public, anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;




-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отправка
-- ─────────────────────────────────────────────────────────────────────────
-- Одна точка входа на личное и групповое сообщение. SECURITY DEFINER, потому
-- что нужно писать в conversations.last_message_at — таблицу, у которой нет
-- клиентской UPDATE-политики и не должно быть.
--
-- Идемпотентность: client_id придумывает клиент ОДИН раз на сообщение и
-- повторяет при каждой попытке. Сервер, увидев знакомый ключ, возвращает уже
-- существующую строку. Без этого «отправил → сеть отвалилась → повторил»
-- давало два одинаковых сообщения ровно там, где повтор и нужен.
create or replace function public.send_conversation_message(
  p_conversation   uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_media          jsonb default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_text      text := nullif(btrim(coalesce(p_text, '')), '');
  v_kind      text;
  v_peer      uuid;
  v_row       public.messages;
  v_my_state  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select c.kind,
         case when c.kind = 'direct'
              then case when c.pair_low = v_uid then c.pair_high else c.pair_low end
         end
    into v_kind, v_peer
  from public.conversations c where c.id = p_conversation;

  if v_kind is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  select state into v_my_state from public.conversation_members
   where conversation_id = p_conversation and user_id = v_uid;
  if v_my_state = 'declined' then
    raise exception 'Вы отказались от этого диалога' using errcode = '42501';
  end if;

  if v_kind = 'direct' then
    if public.get_message_permission(v_uid, v_peer) = 'denied' then
      raise exception 'Этот человек не принимает от вас сообщения' using errcode = '42501';
    end if;
  end if;

  if v_text is null and p_image_url is null and p_media is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;
  if p_media is not null and char_length(p_media::text) > 4000 then
    raise exception 'media reference is too large' using errcode = '22001';
  end if;

  if p_client_id is not null then
    select * into v_row from public.messages m
     where m.sender = v_uid and m.client_id = p_client_id
     limit 1;
    if found then
      return v_row;
    end if;
  end if;

  -- Ответ обязан лежать в ЭТОМ диалоге: иначе цитатой можно было бы вытащить
  -- в чужую переписку кусок своей.
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to and m.conversation_id = p_conversation
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '42501';
  end if;

  insert into public.messages
    (conversation_id, sender, recipient, text, image_url, media, meal_ref,
     reply_to, reply_snapshot, forwarded_name, client_id)
  values
    (p_conversation, v_uid, v_peer, v_text, p_image_url, p_media, p_meal_ref,
     p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id)
  returning * into v_row;

  update public.conversations set last_message_at = v_row.created_at where id = p_conversation;

  -- Отправитель прочитал собственное сообщение по определению, и его же
  -- отправка снимает его отказ, если он раньше сам был в «Запросах».
  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set last_read_at = v_row.created_at,
         archived = false,
         state = case when state = 'pending' then 'accepted' else state end
   where conversation_id = p_conversation and user_id = v_uid;

  -- Новое сообщение возвращает диалог из архива у всех: архив прячет
  -- переписку, а не отключает её.
  update public.conversation_members
     set archived = false
   where conversation_id = p_conversation and archived;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_row;

exception when unique_violation then
  select * into v_row from public.messages m
   where m.sender = v_uid and m.client_id = p_client_id
   limit 1;
  if found then
    return v_row;
  end if;
  raise;
end;
$$;

revoke all on function public.send_conversation_message(uuid, text, text, jsonb, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_conversation_message(uuid, text, text, jsonb, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- Прежний send_message остаётся: на нём стоит ещё не обновлённый клиент.
-- Теперь он находит или создаёт диалог и передаёт работу общей функции —
-- второй реализации отправки в системе быть не должно.
create or replace function public.send_message(
  p_recipient      uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
begin
  v_conv := public.direct_conversation(p_recipient);
  return public.send_conversation_message(
    v_conv, p_text, p_image_url, null, p_meal_ref,
    p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id
  );
end;
$$;

revoke all on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Список диалогов
-- ─────────────────────────────────────────────────────────────────────────
-- Одна строка на диалог со всем, что нужно нарисовать: карточка собеседника
-- или название группы, последнее сообщение, непрочитанные, заглушение,
-- архив, состояние запроса. Без этого список из двадцати диалогов означал бы
-- двадцать походов за именами и двадцать — за счётчиками.
--
-- Непрочитанные считаются по указателю last_read_at, а не по read_at на
-- каждом сообщении: в группе у пятерых участников это пять разных чисел, и
-- хранить их на строке сообщения нечем.
drop function if exists public.list_conversations_v2(text, boolean, int, timestamptz);

create or replace function public.list_conversations_v2(
  p_state    text default null,       -- null = все, 'accepted' | 'pending'
  p_archived boolean default false,
  p_limit    int default 40,
  p_before   timestamptz default null
)
returns table (
  id             uuid,
  kind           text,
  title          text,
  avatar_url     text,
  peer_id        uuid,
  peer_username  text,
  peer_name      text,
  peer_avatar    text,
  peer_private   boolean,
  members_count  int,
  state          text,
  archived       boolean,
  muted_until    timestamptz,
  last_id        uuid,
  last_sender    uuid,
  last_sender_name text,
  last_text      text,
  last_image     text,
  last_media     jsonb,
  last_meal      boolean,
  last_unsent    boolean,
  last_at        timestamptz,
  unread_count   int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select c.*, m.state as my_state, m.archived as my_archived,
           m.muted_until as my_muted, m.last_read_at, m.cleared_at
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    cross join me
    where m.user_id = me.uid and m.left_at is null
  ),
  peer as (
    select mine.id as cid,
           case when mine.kind = 'direct'
                then case when mine.pair_low = (select uid from me) then mine.pair_high else mine.pair_low end
           end as pid
    from mine
  ),
  last_msg as (
    select distinct on (x.conversation_id)
           x.conversation_id, x.id, x.sender, x.text, x.image_url, x.media,
           (x.meal_ref is not null) as has_meal, x.unsent_at, x.created_at
    from public.messages x
    join mine on mine.id = x.conversation_id
    where (mine.cleared_at is null or x.created_at > mine.cleared_at)
      and not exists (
        select 1 from public.message_deletions d
        where d.message_id = x.id and d.user_id = (select uid from me)
      )
    order by x.conversation_id, x.created_at desc, x.id desc
  )
  select
    mine.id, mine.kind, mine.title, mine.avatar_url,
    peer.pid, pp.username, pp.display_name, pp.avatar_url, pp.is_private,
    (select count(*)::int from public.conversation_members cm
      where cm.conversation_id = mine.id and cm.left_at is null),
    mine.my_state, mine.my_archived, mine.my_muted,
    last_msg.id, last_msg.sender, sp.display_name,
    case when last_msg.unsent_at is null then last_msg.text end,
    case when last_msg.unsent_at is null then last_msg.image_url end,
    case when last_msg.unsent_at is null then last_msg.media end,
    coalesce(last_msg.has_meal, false) and last_msg.unsent_at is null,
    last_msg.unsent_at is not null,
    coalesce(last_msg.created_at, mine.last_message_at),
    (select count(*)::int from public.messages u
      where u.conversation_id = mine.id
        and u.sender <> (select uid from me)
        and u.unsent_at is null
        and (mine.last_read_at is null or u.created_at > mine.last_read_at)
        and (mine.cleared_at is null or u.created_at > mine.cleared_at))
  from mine
  join peer on peer.cid = mine.id
  left join last_msg on last_msg.conversation_id = mine.id
  left join public.profiles pp on pp.user_id = peer.pid
  left join public.profiles sp on sp.user_id = last_msg.sender
  where mine.my_state <> 'declined'
    and coalesce(mine.my_archived, false) = coalesce(p_archived, false)
    and (p_state is null or mine.my_state = p_state)
    and (peer.pid is null or not public.is_blocked_between(peer.pid, (select uid from me)))
    -- Диалог без единого сообщения показывать незачем: он появляется в тот
    -- момент, когда человек открыл переписку, но ещё ничего не написал.
    and (last_msg.id is not null or mine.kind = 'group')
    and (p_before is null or coalesce(last_msg.created_at, mine.last_message_at) < p_before)
  order by coalesce(last_msg.created_at, mine.last_message_at) desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_conversations_v2(text, boolean, int, timestamptz) from public, anon;
grant execute on function public.list_conversations_v2(text, boolean, int, timestamptz) to authenticated;


-- Прежний list_conversations остаётся для ещё не обновлённого клиента и
-- пересобран поверх новой модели: две независимые выборки одного и того же
-- списка разошлись бы на первой же правке.
drop function if exists public.list_conversations(int, text);

create or replace function public.list_conversations(
  p_limit int default 100,
  p_state text default null
)
returns table (
  peer_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  state        text,
  last_id      uuid,
  last_sender  uuid,
  last_text    text,
  last_image   text,
  last_meal    boolean,
  last_at      timestamptz,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select c.peer_id, c.peer_username, c.peer_name, c.peer_avatar, c.state,
         c.last_id, c.last_sender, c.last_text, c.last_image, c.last_meal,
         c.last_at, c.unread_count
  from public.list_conversations_v2(p_state, false, least(greatest(coalesce(p_limit, 100), 1), 100), null) c
  where c.kind = 'direct' and c.peer_id is not null;
$$;

revoke all on function public.list_conversations(int, text) from public, anon;
grant execute on function public.list_conversations(int, text) to authenticated;


-- Счётчики для бейджей: сообщения, запросы на переписку, запросы на подписку.
-- Одним запросом — их спрашивают на каждом открытии приложения и по каждому
-- realtime-событию.
drop function if exists public.unread_totals();

create or replace function public.unread_totals()
returns table (
  messages         int,
  message_requests int,
  follow_requests  int,
  notifications    int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select m.conversation_id, m.state, m.last_read_at, m.cleared_at, m.muted_until
    from public.conversation_members m, me
    where m.user_id = me.uid and m.left_at is null and m.state <> 'declined'
  ),
  counts as (
    select mine.state,
           (select count(*) from public.messages u, me
             where u.conversation_id = mine.conversation_id
               and u.sender <> me.uid
               and u.unsent_at is null
               and (mine.last_read_at is null or u.created_at > mine.last_read_at)
               and (mine.cleared_at is null or u.created_at > mine.cleared_at)) as n
    from mine
    -- Заглушённый диалог не участвует в бейдже: заглушение ровно об этом.
    where mine.muted_until is null or mine.muted_until <= now()
  )
  select
    coalesce((select sum(n)::int from counts where state = 'accepted'), 0),
    coalesce((select count(*)::int from mine where state = 'pending'), 0),
    public.follow_request_count(),
    public.unread_notification_count();
$$;

revoke all on function public.unread_totals() from public, anon;
grant execute on function public.unread_totals() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Чтение переписки
-- ─────────────────────────────────────────────────────────────────────────
-- Страницами, начиная с конца. Скрытые «у себя» и обрезанные очисткой не
-- отдаются вовсе — фильтровать это на клиенте значило бы возить по сети то,
-- что человек велел убрать.
drop function if exists public.list_conversation_messages(uuid, int, timestamptz, uuid);

create or replace function public.list_conversation_messages(
  p_conversation uuid,
  p_limit int default 40,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id             uuid,
  conversation_id uuid,
  sender         uuid,
  recipient      uuid,
  text           text,
  image_url      text,
  media          jsonb,
  meal_ref       jsonb,
  reply_to       uuid,
  reply_snapshot jsonb,
  forwarded_name text,
  reactions      jsonb,
  unsent_at      timestamptz,
  edited_at      timestamptz,
  created_at     timestamptz,
  read_at        timestamptz,
  client_id      uuid,
  media_viewed   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mem as (
    select m.cleared_at from public.conversation_members m, me
    where m.conversation_id = p_conversation and m.user_id = me.uid and m.left_at is null
      -- Блокировка проверяется ЗДЕСЬ, а не только политикой messages.
      --
      -- Функция SECURITY DEFINER, то есть RLS её не касается: без этой строки
      -- заблокированный человек, у которого сохранился id диалога, читал бы всю
      -- историю через RPC, хотя прямой select из messages ему уже ничего не
      -- отдаёт. Два разных ответа на один вопрос — это и есть дыра.
      and not exists (
        select 1 from public.conversations c
        where c.id = p_conversation and c.kind = 'direct'
          and public.is_blocked_between(
                case when c.pair_low = me.uid then c.pair_high else c.pair_low end,
                me.uid)
      )
  )
  select
    x.id, x.conversation_id, x.sender, x.recipient,
    case when x.unsent_at is null then x.text end,
    case when x.unsent_at is null then x.image_url end,
    case when x.unsent_at is null then x.media end,
    case when x.unsent_at is null then x.meal_ref end,
    x.reply_to,
    case when x.unsent_at is null then x.reply_snapshot end,
    x.forwarded_name,
    coalesce(x.reactions, '{}'::jsonb),
    x.unsent_at, x.edited_at, x.created_at, x.read_at, x.client_id,
    exists (select 1 from public.message_views v, me
             where v.message_id = x.id and v.user_id = me.uid)
  from public.messages x, me, mem
  where x.conversation_id = p_conversation
    and (mem.cleared_at is null or x.created_at > mem.cleared_at)
    and (p_before_at is null
         or (x.created_at, x.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and not exists (
      select 1 from public.message_deletions d
      where d.message_id = x.id and d.user_id = me.uid
    )
  order by x.created_at desc, x.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_conversation_messages(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_conversation_messages(uuid, int, timestamptz, uuid) to authenticated;


-- Отметить диалог прочитанным. Один UPDATE по указателю вместо UPDATE на
-- каждое сообщение: в переписке на две тысячи реплик разница между этими
-- двумя способами — три порядка.
--
-- read_at на самих сообщениях продолжаем ставить ТОЛЬКО в личном диалоге и
-- только если получатель разрешил показывать прочтение: на этой колонке
-- держится «Прочитано» у собеседника и счётчик у необновлённого клиента.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_receipts boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    return;
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select kind into v_kind from public.conversations where id = p_conversation;
  select read_receipts into v_receipts from public.profiles where user_id = v_uid;

  if v_kind = 'direct' and coalesce(v_receipts, true) then
    update public.messages
       set read_at = now()
     where conversation_id = p_conversation
       and recipient = v_uid
       and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Прежнее имя, прежняя сигнатура: старый клиент зовёт его по собеседнику.
create or replace function public.mark_messages_read(p_sender uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    return;
  end if;
  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_sender) and pair_high = greatest(v_uid, p_sender);
  if v_conv is not null then
    perform public.mark_conversation_read(v_conv);
  else
    update public.messages set read_at = now()
     where recipient = v_uid and sender = p_sender and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;


-- Видно ли мне, что собеседник прочитал. Взаимно, как и присутствие: кто
-- скрыл своё прочтение, не видит и чужого.
create or replace function public.read_receipts_visible(p_peer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select read_receipts from public.profiles where user_id = p_peer), true)
     and coalesce((select read_receipts from public.profiles where user_id = auth.uid()), true)
     and not public.is_blocked_between(p_peer, auth.uid());
$$;

revoke all on function public.read_receipts_visible(uuid) from public, anon;
grant execute on function public.read_receipts_visible(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Запросы на переписку
-- ─────────────────────────────────────────────────────────────────────────
-- Открытие запроса НЕ означает согласия: человек читает сообщение и решает
-- отдельно. Решение хранится в двух местах намеренно — в состоянии участника
-- (оно про этот диалог) и в message_grants (оно про человека и переживает
-- удаление диалога). Обе записи ставит одна функция, поэтому разойтись им
-- негде.
create or replace function public.accept_conversation_request(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_peer uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set state = 'accepted'
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select c.kind,
         case when c.kind = 'direct'
              then case when c.pair_low = v_uid then c.pair_high else c.pair_low end
         end
    into v_kind, v_peer
  from public.conversations c where c.id = p_conversation;

  if v_peer is not null then
    insert into public.message_grants (owner_id, peer_id, state)
    values (v_uid, v_peer, 'accepted')
    on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();
  end if;

  -- Событие о запросе больше не актуально: человек его разобрал.
  delete from public.notifications
   where recipient_id = v_uid and type = 'MESSAGE_REQUEST'
     and (entity_id = v_peer or entity_id = p_conversation);

  return 'accepted';
end;
$$;

revoke all on function public.accept_conversation_request(uuid) from public, anon;
grant execute on function public.accept_conversation_request(uuid) to authenticated;


-- Отказ. НЕ блокировка: человек остаётся подписчиком, видит посты и профиль —
-- он теряет ровно право писать. Отказ от навязчивого сообщения не должен
-- стоить так же дорого, как блокировка.
create or replace function public.decline_conversation_request(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_peer uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set state = 'declined'
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select case when c.pair_low = v_uid then c.pair_high else c.pair_low end
    into v_peer
  from public.conversations c where c.id = p_conversation and c.kind = 'direct';

  if v_peer is not null then
    insert into public.message_grants (owner_id, peer_id, state)
    values (v_uid, v_peer, 'declined')
    on conflict (owner_id, peer_id) do update set state = 'declined', created_at = now();
  end if;

  delete from public.notifications
   where recipient_id = v_uid
     and type in ('MESSAGE', 'MESSAGE_REQUEST')
     and (entity_id = v_peer or entity_id = p_conversation);

  return 'declined';
end;
$$;

revoke all on function public.decline_conversation_request(uuid) from public, anon;
grant execute on function public.decline_conversation_request(uuid) to authenticated;


-- Прежние имена по собеседнику — для ещё не обновлённого клиента.
create or replace function public.accept_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'accepted')
  on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();

  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_peer) and pair_high = greatest(v_uid, p_peer);
  if v_conv is not null then
    perform set_config('eataps.trusted_member_write', 'on', true);
    update public.conversation_members set state = 'accepted'
     where conversation_id = v_conv and user_id = v_uid;
    perform set_config('eataps.trusted_member_write', 'off', true);
  end if;

  return 'accepted';
end;
$$;

create or replace function public.decline_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'declined')
  on conflict (owner_id, peer_id) do update set state = 'declined', created_at = now();

  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_peer) and pair_high = greatest(v_uid, p_peer);
  if v_conv is not null then
    perform set_config('eataps.trusted_member_write', 'on', true);
    update public.conversation_members set state = 'declined'
     where conversation_id = v_conv and user_id = v_uid;
    perform set_config('eataps.trusted_member_write', 'off', true);
  end if;

  delete from public.notifications
   where recipient_id = v_uid and actor_id = p_peer and type in ('MESSAGE', 'MESSAGE_REQUEST');

  return 'declined';
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
revoke all on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;
grant execute on function public.decline_message_request(uuid) to authenticated;

-- Счётчик запросов на переписку — теперь по состоянию участника.
create or replace function public.pending_request_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.conversation_members m
  where m.user_id = auth.uid() and m.left_at is null and m.state = 'pending'
    and exists (select 1 from public.messages x where x.conversation_id = m.conversation_id);
$$;

revoke all on function public.pending_request_count() from public, anon;
grant execute on function public.pending_request_count() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Действия над сообщением
-- ─────────────────────────────────────────────────────────────────────────

-- Отзыв «у всех». Строку не удаляем: на неё ссылаются ответы, и удаление
-- превратило бы цитату в сироту. Содержимое стирается, остаётся пометка.
create or replace function public.unsend_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.messages where id = p_message;
  if not found then
    return;
  end if;
  if v_row.sender <> v_uid then
    raise exception 'Отозвать можно только своё сообщение' using errcode = '42501';
  end if;
  if v_row.unsent_at is not null then
    return;
  end if;

  perform set_config('eataps.trusted_message_write', 'on', true);
  update public.messages
     set unsent_at = now(),
         text = null, image_url = null, media = null, meal_ref = null,
         reply_snapshot = null, reactions = '{}'::jsonb
   where id = p_message;
  perform set_config('eataps.trusted_message_write', 'off', true);

  -- Событие о сообщении, которого больше нет, вести некуда.
  delete from public.notifications
   where actor_id = v_uid
     and type in ('MESSAGE', 'MESSAGE_REQUEST', 'MESSAGE_REACTION')
     and entity_id = p_message;
end;
$$;

revoke all on function public.unsend_message(uuid) from public, anon;
grant execute on function public.unsend_message(uuid) to authenticated;


-- Скрыть у себя. У собеседника сообщение остаётся — в этом вся разница с
-- отзывом, и путать их нельзя.
create or replace function public.delete_message_for_me(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select conversation_id into v_conv from public.messages where id = p_message;
  if v_conv is not null and not public.is_conversation_member(v_conv, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  insert into public.message_deletions (message_id, user_id)
  values (p_message, v_uid)
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.delete_message_for_me(uuid) from public, anon;
grant execute on function public.delete_message_for_me(uuid) to authenticated;


-- Реакция. Одна на человека: повторное нажатие тем же эмодзи снимает её,
-- другим — заменяет. Форма хранения прежняя ({ user_id: emoji }), поэтому
-- ещё не обновлённый клиент продолжает читать реакции как читал.
create or replace function public.set_message_reaction(p_message uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.messages;
  v_key  text;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_emoji is not null and p_emoji not in ('🥕', '❤️', '😂', '😮', '😢', '😡', '👍') then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;

  select * into v_row from public.messages where id = p_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_row.unsent_at is not null then
    return '{}'::jsonb;
  end if;

  if v_row.conversation_id is not null then
    if not public.is_conversation_member(v_row.conversation_id, v_uid) then
      raise exception 'Вы не участник этого диалога' using errcode = '42501';
    end if;
  elsif v_uid <> v_row.sender and v_uid <> v_row.recipient then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  v_key := v_uid::text;
  if p_emoji is null or coalesce(v_row.reactions, '{}'::jsonb)->>v_key = p_emoji then
    v_next := coalesce(v_row.reactions, '{}'::jsonb) - v_key;
  else
    v_next := jsonb_set(coalesce(v_row.reactions, '{}'::jsonb), array[v_key], to_jsonb(p_emoji), true);
  end if;

  perform set_config('eataps.trusted_message_write', 'on', true);
  update public.messages set reactions = v_next where id = p_message;
  perform set_config('eataps.trusted_message_write', 'off', true);

  -- Автору — событие о реакции. Своей же реакции на своё сообщение не бывает:
  -- push_notification отбрасывает такое сам.
  if v_next ? v_key then
    perform public.push_notification(
      v_row.sender, v_uid, 'MESSAGE_REACTION', 'message', p_message,
      jsonb_build_object('reaction', p_emoji)
    );
  end if;

  return v_next;
end;
$$;

revoke all on function public.set_message_reaction(uuid, text) from public, anon;
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

-- Прежнее имя — тонкая обёртка, чтобы не держать вторую реализацию.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.set_message_reaction(p_message_id, p_emoji);
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;


-- Отметить одноразовое вложение просмотренным. Сервер после этого перестаёт
-- отдавать ссылку — но честно предупреждаем в интерфейсе: помешать снять
-- скриншот веб-клиент не может, и обещать этого нельзя.
create or replace function public.mark_media_viewed(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select conversation_id into v_conv from public.messages where id = p_message;
  if v_conv is null or not public.is_conversation_member(v_conv, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  insert into public.message_views (message_id, user_id)
  values (p_message, v_uid)
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.mark_media_viewed(uuid) from public, anon;
grant execute on function public.mark_media_viewed(uuid) to authenticated;


-- Пересылка. Создаёт НОВОЕ сообщение в каждом выбранном диалоге — отдать
-- чужой conversation_id значило бы впустить человека в чужую переписку.
-- Права на каждый диалог проверяются по отдельности.
create or replace function public.forward_message(p_message uuid, p_conversations uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.messages;
  v_conv uuid;
  v_from text;
  v_sent int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.messages where id = p_message;
  if not found or v_row.unsent_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_row.conversation_id is not null
     and not public.is_conversation_member(v_row.conversation_id, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  select coalesce(display_name, username) into v_from from public.profiles where user_id = v_row.sender;

  foreach v_conv in array coalesce(p_conversations[1:20], '{}'::uuid[]) loop
    if public.is_conversation_member(v_conv, v_uid) then
      perform public.send_conversation_message(
        v_conv, v_row.text, v_row.image_url, v_row.media, v_row.meal_ref,
        null, null, v_from, null
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.forward_message(uuid, uuid[]) from public, anon;
grant execute on function public.forward_message(uuid, uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Управление диалогом
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.conversation_info(uuid);

create or replace function public.conversation_info(p_conversation uuid)
returns table (
  id            uuid,
  kind          text,
  title         text,
  avatar_url    text,
  created_by    uuid,
  created_at    timestamptz,
  my_role       text,
  my_state      text,
  archived      boolean,
  muted_until   timestamptz,
  peer_id       uuid,
  -- Карточка собеседника приезжает здесь же. Диалог можно открыть, зная
  -- только его id — из уведомления о группе или из поиска по сообщениям, — и
  -- тогда имени взять больше неоткуда: заголовок «Диалог» вместо имени
  -- человека выглядит как поломка.
  peer_username text,
  peer_name     text,
  peer_avatar   text,
  members_count int,
  media_count   int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.kind, c.title, c.avatar_url, c.created_by, c.created_at,
    m.role, m.state, m.archived, m.muted_until,
    pp.user_id, pp.username, pp.display_name, pp.avatar_url,
    (select count(*)::int from public.conversation_members x
      where x.conversation_id = c.id and x.left_at is null),
    (select count(*)::int from public.messages x
      where x.conversation_id = c.id and x.unsent_at is null
        and (x.image_url is not null or x.media is not null))
  from public.conversations c
  join public.conversation_members m
    on m.conversation_id = c.id and m.user_id = auth.uid() and m.left_at is null
  left join public.profiles pp
    on c.kind = 'direct'
   and pp.user_id = case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end
  where c.id = p_conversation;
$$;

revoke all on function public.conversation_info(uuid) from public, anon;
grant execute on function public.conversation_info(uuid) to authenticated;


drop function if exists public.conversation_member_list(uuid);

create or replace function public.conversation_member_list(p_conversation uuid)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  role         text,
  joined_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, m.role, m.joined_at
  from public.conversation_members m
  join public.profiles p on p.user_id = m.user_id
  where m.conversation_id = p_conversation
    and m.left_at is null
    and public.is_conversation_member(p_conversation, auth.uid())
  order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.joined_at;
$$;

revoke all on function public.conversation_member_list(uuid) from public, anon;
grant execute on function public.conversation_member_list(uuid) to authenticated;


create or replace function public.rename_conversation(p_conversation uuid, p_title text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Переименовать группу может администратор' using errcode = '42501';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22001';
  end if;

  update public.conversations set title = v_title
   where id = p_conversation and kind = 'group';
  return v_title;
end;
$$;

revoke all on function public.rename_conversation(uuid, text) from public, anon;
grant execute on function public.rename_conversation(uuid, text) to authenticated;


create or replace function public.add_conversation_members(p_conversation uuid, p_members uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_one   uuid;
  v_added int := 0;
  v_kind  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select kind into v_kind from public.conversations where id = p_conversation;
  if v_kind <> 'group' then
    raise exception 'Добавлять людей можно только в группу' using errcode = '22023';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Добавлять участников может администратор' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members
       where conversation_id = p_conversation and left_at is null) >= 50 then
    raise exception 'В группе не больше 50 участников' using errcode = '22023';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  foreach v_one in array coalesce(p_members[1:50], '{}'::uuid[]) loop
    if v_one is not null and v_one <> v_uid and public.can_invite_to_group(v_uid, v_one) then
      insert into public.conversation_members (conversation_id, user_id, role, state)
      values (p_conversation, v_one, 'member',
              case when public.get_message_permission(v_uid, v_one) = 'direct' then 'accepted' else 'pending' end)
      on conflict (conversation_id, user_id)
      do update set left_at = null
      where conversation_members.left_at is not null;
      perform public.push_notification(v_one, v_uid, 'GROUP_INVITE', 'conversation', p_conversation);
      v_added := v_added + 1;
    end if;
  end loop;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_added;
end;
$$;

revoke all on function public.add_conversation_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_conversation_members(uuid, uuid[]) to authenticated;


create or replace function public.remove_conversation_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Убирать участников может администратор' using errcode = '42501';
  end if;
  if public.conversation_role(p_conversation, p_user) = 'owner' then
    raise exception 'Создателя группы убрать нельзя' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set left_at = now()
   where conversation_id = p_conversation and user_id = p_user and left_at is null;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.remove_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.remove_conversation_member(uuid, uuid) to authenticated;


create or replace function public.set_conversation_role(p_conversation uuid, p_user uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  -- Роль «создатель» не передаётся и не назначается: она одна на группу и
  -- определяется тем, кто её завёл.
  if public.conversation_role(p_conversation, v_uid) <> 'owner' then
    raise exception 'Назначать администраторов может только создатель' using errcode = '42501';
  end if;
  if public.conversation_role(p_conversation, p_user) = 'owner' then
    raise exception 'Роль создателя не меняется' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set role = p_role
   where conversation_id = p_conversation and user_id = p_user and left_at is null;
  perform set_config('eataps.trusted_member_write', 'off', true);
  return p_role;
end;
$$;

revoke all on function public.set_conversation_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_conversation_role(uuid, uuid, text) to authenticated;


create or replace function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select kind into v_kind from public.conversations where id = p_conversation;
  if v_kind <> 'group' then
    raise exception 'Выйти можно только из группы' using errcode = '22023';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set left_at = now()
   where conversation_id = p_conversation and user_id = v_uid and left_at is null;

  -- Группа без создателя не должна остаться без администратора: передаём
  -- роль самому давнему участнику. Иначе состав становится неуправляемым.
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and role = 'owner' and left_at is null
  ) then
    update public.conversation_members set role = 'owner'
     where conversation_id = p_conversation and left_at is null
       and user_id = (
         select user_id from public.conversation_members
         where conversation_id = p_conversation and left_at is null
         order by joined_at limit 1
       );
  end if;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;


-- Заглушить, убрать в архив, очистить у себя. Все три — про МОЮ строку
-- участника и ни на кого больше не влияют.
create or replace function public.set_conversation_muted(p_conversation uuid, p_until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.conversation_members set muted_until = p_until
   where conversation_id = p_conversation and user_id = v_uid;
  return p_until;
end;
$$;

create or replace function public.set_conversation_archived(p_conversation uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.conversation_members set archived = coalesce(p_on, false)
   where conversation_id = p_conversation and user_id = v_uid;
  return coalesce(p_on, false);
end;
$$;

-- «Удалить переписку» — у СЕБЯ. Чужую историю не трогаем: она принадлежит не
-- нам. Ставим отсечку по времени, и всё, что до неё, перестаёт отдаваться.
create or replace function public.clear_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set cleared_at = now(), last_read_at = now(), archived = false
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.set_conversation_muted(uuid, timestamptz) from public, anon;
revoke all on function public.set_conversation_archived(uuid, boolean) from public, anon;
revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.set_conversation_muted(uuid, timestamptz) to authenticated;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;
grant execute on function public.clear_conversation(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Общие вложения и поиск по переписке
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.conversation_media(uuid, int, int);

create or replace function public.conversation_media(
  p_conversation uuid, p_limit int default 60, p_offset int default 0
)
returns table (
  id         uuid,
  sender     uuid,
  image_url  text,
  media      jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.sender, x.image_url, x.media, x.created_at
  from public.messages x
  join public.conversation_members m
    on m.conversation_id = x.conversation_id and m.user_id = auth.uid() and m.left_at is null
  where x.conversation_id = p_conversation
    and x.unsent_at is null
    and (x.image_url is not null or x.media is not null)
    and (m.cleared_at is null or x.created_at > m.cleared_at)
    -- Та же проверка блокировки, что и в list_conversation_messages: обе
    -- функции SECURITY DEFINER, и RLS их не прикрывает.
    and not exists (
      select 1 from public.conversations c
      where c.id = p_conversation and c.kind = 'direct'
        and public.is_blocked_between(
              case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end,
              auth.uid())
    )
    and not exists (
      select 1 from public.message_deletions d
      where d.message_id = x.id and d.user_id = auth.uid()
    )
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.conversation_media(uuid, int, int) from public, anon;
grant execute on function public.conversation_media(uuid, int, int) to authenticated;


-- Поиск по сообщениям. Только там, где я участник: p_conversation = null
-- ищет по всем моим диалогам сразу, и это по-прежнему не выходит за пределы
-- моего членства.
drop function if exists public.search_messages(text, uuid, int);

create or replace function public.search_messages(
  p_query text, p_conversation uuid default null, p_limit int default 40
)
returns table (
  id              uuid,
  conversation_id uuid,
  sender          uuid,
  text            text,
  created_at      timestamptz,
  peer_id         uuid,
  title           text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select btrim(coalesce(p_query, '')) as v)
  select x.id, x.conversation_id, x.sender, x.text, x.created_at,
         case when c.kind = 'direct'
              then case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end end,
         c.title
  from public.messages x
  join public.conversation_members m
    on m.conversation_id = x.conversation_id and m.user_id = auth.uid() and m.left_at is null
  join public.conversations c on c.id = x.conversation_id
  cross join q
  where char_length(q.v) >= 2
    and x.unsent_at is null
    and x.text is not null
    and x.text ilike '%' || q.v || '%'
    and (p_conversation is null or x.conversation_id = p_conversation)
    and (m.cleared_at is null or x.created_at > m.cleared_at)
    -- Поиск не должен становиться обходным путём к переписке, закрытой
    -- блокировкой: без этой строки он находил бы её текст.
    and not (c.kind = 'direct' and public.is_blocked_between(
      case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end, auth.uid()))
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 60);
$$;

revoke all on function public.search_messages(text, uuid, int) from public, anon;
grant execute on function public.search_messages(text, uuid, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Хранилище вложений личной переписки
-- ─────────────────────────────────────────────────────────────────────────
-- ЗАКРЫТЫЙ бакет, в отличие от chat-images и post-images. Разница
-- принципиальная: те публичны на чтение, и границей доступа служит не бакет,
-- а RLS на posts/messages — «у кого есть точный URL, тот увидит». Для
-- вложений групповых и личных диалогов этого мало, поэтому здесь граница
-- стоит на самом файле: путь начинается с id диалога, и политика пускает
-- только его участников.
--
-- Клиент получает подписанную ссылку (createSignedUrl) — она живёт час и
-- выдаётся только тому, кого пустила политика.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-media', 'dm-media', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

-- Первый сегмент пути — id диалога. Приведение к uuid делаем через
-- безопасный разбор: невалидный путь должен ОТКЛОНЯТЬСЯ политикой, а не
-- ронять весь запрос ошибкой приведения типа (22P02), которая унесла бы с
-- собой и чтение соседних файлов.
create or replace function public.safe_uuid(p_text text)
returns uuid
language sql
immutable
as $$
  select case when p_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then p_text::uuid end;
$$;

drop policy if exists "dm-media read members" on storage.objects;
create policy "dm-media read members" on storage.objects
  for select using (
    bucket_id = 'dm-media'
    and public.is_conversation_member(
      public.safe_uuid((storage.foldername(name))[1]), auth.uid()
    )
  );

drop policy if exists "dm-media write members" on storage.objects;
create policy "dm-media write members" on storage.objects
  for insert with check (
    bucket_id = 'dm-media'
    and auth.role() = 'authenticated'
    and public.is_conversation_member(
      public.safe_uuid((storage.foldername(name))[1]), auth.uid()
    )
    -- Второй сегмент пути — id автора: свои файлы человек может удалить, а
    -- чужие в его папку не попадут.
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "dm-media delete own" on storage.objects;
create policy "dm-media delete own" on storage.objects
  for delete using (
    bucket_id = 'dm-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Realtime
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_members';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;
end $$;

alter table public.conversations replica identity full;
alter table public.conversation_members replica identity full;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-11_fav_restaurant.sql
-- ###########################################################################

-- Любимый ресторан — новое поле профиля с необязательной геолокацией.
-- Добавляем его в visible_diary (и, через неё, в friend_state).

create or replace function public.visible_diary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.can_view_diary(p_user_id)
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',           a.state->'profile'->'name',
        'avatar',         a.state->'profile'->'avatar',
        'bio',            a.state->'profile'->'bio',
        'guiltyPleasure', a.state->'profile'->'guiltyPleasure',
        'favRestaurant',  a.state->'profile'->'favRestaurant',
        'targets',        jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
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

revoke all on function public.visible_diary(uuid) from public, anon;
grant execute on function public.visible_diary(uuid) to authenticated;


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_private_media.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — вложения перестают быть публичными.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- Бакеты chat-images и post-images создавались с public = true, а политика
-- чтения выглядела так:
--
--     create policy "chat-images read" on storage.objects
--       for select using (bucket_id = 'chat-images');
--
-- То есть предиката не было вовсе: файл отдавался кому угодно, включая
-- неаутентифицированного, по прямой ссылке. Защитой служила только
-- неугадываемость адреса (uuid v4 в пути). Это «ссылка-пропуск»: она не
-- отзывается никогда. Один раз показанное подписчику фото оставалось
-- доступным ему и после отписки, и после блокировки, и после удаления
-- записи, и после удаления всего аккаунта.
--
-- Политика записи при этом проверяла ЗАГРУЖАЮЩЕГО (первый сегмент пути равен
-- auth.uid()), но чтение не проверяло ЧИТАЮЩЕГО вообще. Это две разные
-- проверки, и наличие первой не заменяет вторую.
--
-- ИНВАРИАНТ, КОТОРЫЙ ВВОДИТ ЭТА МИГРАЦИЯ
--
--   Вложение личной переписки может прочитать только участник того
--   сообщения, к которому вложение прикреплено.
--
--   Изображение записи может прочитать только тот, кому видна сама запись.
--
-- Обе проверки выполняет база, а не интерфейс, и обе опираются на ту же
-- функцию видимости, что и остальное приложение (can_view_post), либо на
-- прямое участие в сообщении.
--
-- КАК СВЯЗАТЬ ФАЙЛ С СООБЩЕНИЕМ
--
-- В сообщении хранится готовый публичный URL, а политике хранилища нужен путь
-- внутри бакета (storage.objects.name). Вытаскивать путь подстрокой прямо в
-- политике нельзя: это означало бы LIKE с ведущим шаблоном и полный проход по
-- messages на КАЖДОЕ чтение файла.
--
-- Поэтому заводится ВЫЧИСЛЯЕМАЯ колонка image_path. Она:
--   • заполняется сама и для старых строк, и для будущих — бэкфилл не нужен;
--   • не может разъехаться с image_url, потому что вычисляется из него;
--   • индексируется, и политика превращается в точечный поиск по индексу.
--
-- Клиент по-прежнему хранит в сообщении полный URL — менять состав колонок,
-- которые отдают list_messages и send_message, эта миграция не требует.
--
-- ДАННЫЕ НЕ УДАЛЯЮТСЯ. Ни один объект хранилища эта миграция не трогает,
-- меняются только флаг публичности бакета и политики чтения.
--
-- ПОРЯДОК ВЫКАТКИ. Клиент, который запрашивает подписанную ссылку, работает и
-- с публичным бакетом (подписанная ссылка на публичный объект тоже валидна).
-- Поэтому безопасный порядок: сначала выкатить фронтенд, затем эту миграцию.
-- Обратный порядок оставит старые фото недоступными до выкатки фронтенда.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Путь файла, выведенный из сохранённого URL
-- ---------------------------------------------------------------------------
-- substring(text from pattern) неизменяема, поэтому колонку можно объявить
-- stored — она посчитается один раз при записи строки, а не на каждое чтение.
alter table public.messages
  add column if not exists image_path text
  generated always as (substring(image_url from '/chat-images/(.*)$')) stored;

create index if not exists messages_image_path_idx
  on public.messages (image_path) where image_path is not null;

alter table public.posts
  add column if not exists image_path text
  generated always as (substring(image_url from '/post-images/(.*)$')) stored;

create index if not exists posts_image_path_idx
  on public.posts (image_path) where image_path is not null;

-- ---------------------------------------------------------------------------
-- 2. Кто вправе прочитать вложение переписки
-- ---------------------------------------------------------------------------
-- security definer здесь нужен по существу, а не для удобства: политика
-- хранилища обязана дать однозначный ответ независимо от того, как в будущем
-- изменится RLS на messages. Проверка участия и блокировки выписана явно.
create or replace function public.can_read_chat_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    where m.image_path = p_name
      and auth.uid() is not null
      and (
        m.sender = auth.uid()
        or m.recipient = auth.uid()
        or (m.conversation_id is not null
            and public.is_conversation_member(m.conversation_id, auth.uid()))
      )
      -- Блокировка перекрывает участие — ровно как в политике чтения самих
      -- сообщений: заблокировавший не должен видеть и вложения.
      and not public.is_blocked_between(m.sender, auth.uid())
  );
$$;

revoke all on function public.can_read_chat_image(text) from public, anon;
grant execute on function public.can_read_chat_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Кто вправе прочитать изображение записи
-- ---------------------------------------------------------------------------
-- Здесь переиспользуется can_view_post — та же функция, которой пользуются
-- политики самих записей, ответов и реакций. Расходиться им нельзя: иначе
-- «запись не видна, а картинка видна» вернётся другим путём.
create or replace function public.can_read_post_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.image_path = p_name
      and auth.uid() is not null
      and public.can_view_post(p.id)
  );
$$;

revoke all on function public.can_read_post_image(text) from public, anon;
grant execute on function public.can_read_post_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Бакеты становятся закрытыми
-- ---------------------------------------------------------------------------
-- Ограничения на размер и типы уже стояли — сохраняем их и здесь, чтобы
-- повторный прогон на чистой базе давал тот же результат.
update storage.buckets
set public = false,
    file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('chat-images', 'post-images');

-- ---------------------------------------------------------------------------
-- 5. Политики чтения
-- ---------------------------------------------------------------------------
drop policy if exists "chat-images read" on storage.objects;
drop policy if exists "chat-images read participants" on storage.objects;
create policy "chat-images read participants" on storage.objects
  for select using (
    bucket_id = 'chat-images'
    and public.can_read_chat_image(name)
  );

drop policy if exists "post-images read" on storage.objects;
drop policy if exists "post-images read visible" on storage.objects;
create policy "post-images read visible" on storage.objects
  for select using (
    bucket_id = 'post-images'
    and public.can_read_post_image(name)
  );

-- ---------------------------------------------------------------------------
-- 6. Политики записи: подтверждаем прежние правила явно
-- ---------------------------------------------------------------------------
-- Менять их не нужно, но пересоздаём вместе с чтением, чтобы весь набор правил
-- по этим бакетам читался в одном месте, а не был разбросан по трём миграциям.
-- Путь обязан начинаться с папки автора: имя файла приходит от клиента, и
-- доверять ему нельзя.
drop policy if exists "chat-images write own" on storage.objects;
create policy "chat-images write own" on storage.objects
  for insert with check (
    bucket_id = 'chat-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-images write own" on storage.objects;
create policy "post-images write own" on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 7. Уборка за удалёнными данными
-- ---------------------------------------------------------------------------
-- Прежде объект хранилища не удалялся НИКОГДА: ни при удалении записи, ни при
-- отмене сообщения, ни при удалении аккаунта. Фотографии оставались на сервере
-- и — при публичном бакете — оставались доступны. Теперь бакеты закрыты, и
-- висящий объект уже не утекает, но хранить его вечно всё равно неправильно:
-- право на удаление означает фактическое удаление, а не потерю ссылки.
--
-- Удалять файл прямо из триггера нельзя: расширение storage не даёт SQL-доступа
-- к содержимому бакета, а http-вызов из триггера — плохая идея (он выполнялся
-- бы внутри транзакции пользователя и мог её подвесить). Поэтому триггер лишь
-- отмечает объект к удалению, а выносит его отдельный проход.
create table if not exists public.storage_cleanup_queue (
  id         bigserial primary key,
  bucket     text not null check (bucket in ('chat-images', 'post-images', 'dm-media')),
  path       text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

alter table public.storage_cleanup_queue enable row level security;
-- Политик нет намеренно: очередь читает и чистит только сервер под
-- service_role, которому RLS не писан. Клиенту она не нужна ни в каком виде.

create or replace function public.enqueue_storage_cleanup(p_bucket text, p_path text, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.storage_cleanup_queue (bucket, path, reason)
  select p_bucket, p_path, p_reason
  where p_path is not null and p_path <> ''
  on conflict (bucket, path) do nothing;
$$;

revoke all on function public.enqueue_storage_cleanup(text, text, text) from public, anon, authenticated;

create or replace function public.queue_post_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Удаление записи и замена картинки при правке — оба случая оставляют
  -- осиротевший файл.
  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('post-images', old.image_path, 'post deleted');
  elsif old.image_path is distinct from new.image_path then
    perform public.enqueue_storage_cleanup('post-images', old.image_path, 'post image replaced');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists posts_image_cleanup on public.posts;
create trigger posts_image_cleanup
  after update or delete on public.posts
  for each row execute function public.queue_post_image_cleanup();

create or replace function public.queue_message_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('chat-images', old.image_path, 'message deleted');
    if old.media ? 'path' then
      perform public.enqueue_storage_cleanup('dm-media', old.media->>'path', 'message deleted');
    end if;
  elsif old.unsent_at is null and new.unsent_at is not null then
    -- Отмена сообщения обнуляет image_url и media, поэтому путь берём из OLD.
    perform public.enqueue_storage_cleanup('chat-images', old.image_path, 'message unsent');
    if old.media ? 'path' then
      perform public.enqueue_storage_cleanup('dm-media', old.media->>'path', 'message unsent');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists messages_image_cleanup on public.messages;
create trigger messages_image_cleanup
  after update or delete on public.messages
  for each row execute function public.queue_message_image_cleanup();

comment on table public.storage_cleanup_queue is
  'Пути в хранилище, оставшиеся без владеющей строки. Разбирает серверный проход под service_role; RLS-политик нет намеренно.';


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_stripe_events.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — вебхук Stripe становится устойчивым к повторам и переупорядочиванию.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- Обработчик делал безусловный upsert строки подписки на каждое событие:
--
--     await admin().from('subscriptions').upsert({ user_id, tier, status, ... })
--
-- Ни идентификатор события, ни время его создания нигде не хранились. Отсюда
-- два разных отказа:
--
--   1. ПОВТОРНАЯ ДОСТАВКА. Stripe повторяет событие, пока не получит 200.
--      Повтор проходил весь путь заново. Для upsert это, как правило,
--      безобидно, но любой побочный эффект (а они появляются) выполнился бы
--      дважды.
--
--   2. ПЕРЕУПОРЯДОЧИВАНИЕ. Stripe прямо предупреждает, что порядок доставки
--      не гарантирован. Последовательность «updated (active) → deleted
--      (canceled)», пришедшая наоборот, оставляла в базе ЖИВОЙ тариф у
--      отменённой подписки. Платный доступ после отмены — это уже деньги.
--
-- ЧТО ВВОДИТСЯ
--
--   • Журнал обработанных событий: одно событие обрабатывается один раз.
--     Заявка и завершение разнесены, поэтому падение на середине НЕ помечает
--     событие обработанным — следующая доставка подхватит его заново.
--
--   • Время последнего применённого события прямо в строке подписки. Запись
--     более старого события отбрасывается — это и есть защита от
--     переупорядочивания, и работает она независимо от того, сколько
--     экземпляров функции выполняются одновременно.
--
-- Проверка подписи запроса в обработчике остаётся как была — она отсекает
-- подделку, а этот журнал отвечает только за доставку.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Журнал событий
-- ---------------------------------------------------------------------------
-- Полезную нагрузку события НЕ храним: в ней платёжные и персональные данные,
-- а для идемпотентности достаточно идентификатора. Храним ровно столько,
-- сколько нужно, чтобы разобраться, почему событие не применилось.
create table if not exists public.stripe_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  event_created timestamptz,
  status        text not null default 'processing'
                check (status in ('processing', 'processed', 'failed')),
  attempts      integer not null default 1,
  last_error    text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

alter table public.stripe_webhook_events enable row level security;
-- Политик нет намеренно: журнал принадлежит серверу (service_role, которому
-- RLS не писан). Клиенту он не нужен ни на чтение, ни на запись.

create index if not exists stripe_webhook_events_unfinished_idx
  on public.stripe_webhook_events (received_at)
  where status <> 'processed';

-- ---------------------------------------------------------------------------
-- 2. Заявка на обработку
-- ---------------------------------------------------------------------------
-- Возвращает, что делать вызывающему:
--   'claimed'   — событие новое, обрабатываем;
--   'duplicate' — уже обработано, второй раз не надо (отвечаем Stripe 200);
--   'retry'     — заявка была, но обработка не завершилась; пробуем снова.
--
-- Ключевое свойство — атомарность: insert ... on conflict выполняется одним
-- оператором, поэтому два параллельных экземпляра функции не могут оба
-- получить 'claimed' на одно событие.
create or replace function public.stripe_event_claim(
  p_event_id   text,
  p_event_type text,
  p_created    timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type, event_created)
  values (p_event_id, coalesce(p_event_type, 'unknown'), p_created)
  on conflict (event_id) do nothing;

  if found then
    return 'claimed';
  end if;

  -- Строка уже была. Смотрим, чем кончилась прошлая попытка.
  update public.stripe_webhook_events
     set attempts = attempts + 1,
         status = case when status = 'processed' then 'processed' else 'processing' end
   where event_id = p_event_id
  returning status into v_status;

  return case when v_status = 'processed' then 'duplicate' else 'retry' end;
end;
$$;

create or replace function public.stripe_event_finish(
  p_event_id text,
  p_ok       boolean,
  p_error    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_webhook_events
     set status = case when p_ok then 'processed' else 'failed' end,
         processed_at = case when p_ok then now() else processed_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where event_id = p_event_id;
$$;

revoke all on function public.stripe_event_claim(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.stripe_event_finish(text, boolean, text) from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, text, timestamptz) to service_role;
grant execute on function public.stripe_event_finish(text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Время последнего применённого события — прямо в подписке
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists last_event_created timestamptz;
alter table public.subscriptions
  add column if not exists last_event_id text;

-- ---------------------------------------------------------------------------
-- 4. Запись подписки с защитой от устаревшего события
-- ---------------------------------------------------------------------------
-- Вся проверка и запись — один оператор. Именно поэтому здесь функция, а не
-- «прочитать, сравнить в JavaScript, записать»: между чтением и записью
-- успевает вклиниться параллельный экземпляр, и более старое событие затирает
-- более новое. Ровно та же ошибка, что уже была разобрана в save_app_state.
--
-- Возвращает true, если состояние применено, и false, если отброшено как
-- устаревшее. Отброшенное событие — это НЕ ошибка: обработчик отвечает Stripe
-- успехом, иначе тот будет повторять его до бесконечности.
create or replace function public.stripe_subscription_sync(
  p_user_id              uuid,
  p_tier                 text,
  p_status               text,
  p_customer_id          text,
  p_subscription_id      text,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created        timestamptz,
  p_event_id             text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied boolean := false;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  insert into public.subscriptions as s (
    user_id, tier, status, stripe_customer_id, stripe_subscription_id,
    current_period_end, cancel_at_period_end, updated_at,
    last_event_created, last_event_id
  )
  values (
    p_user_id, coalesce(p_tier, 'FREE'), coalesce(p_status, 'inactive'),
    p_customer_id, p_subscription_id,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), now(),
    p_event_created, p_event_id
  )
  on conflict (user_id) do update
    set tier                 = excluded.tier,
        status               = excluded.status,
        -- Идентификатор клиента Stripe не затираем пустым значением: часть
        -- событий приходит без него, а потерять связь с клиентом значит
        -- потерять возможность открыть человеку портал управления подпиской.
        stripe_customer_id   = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
        stripe_subscription_id = excluded.stripe_subscription_id,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at           = now(),
        last_event_created   = excluded.last_event_created,
        last_event_id        = excluded.last_event_id
    where s.last_event_created is null
       or excluded.last_event_created is null
       or excluded.last_event_created >= s.last_event_created
  returning true into v_applied;

  return coalesce(v_applied, false);
end;
$$;

revoke all on function public.stripe_subscription_sync(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.stripe_subscription_sync(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Один клиент Stripe на пользователя
-- ---------------------------------------------------------------------------
-- Прежний порядок в checkout был: прочитать stripe_customer_id → если пусто,
-- создать клиента в Stripe → записать. Два одновременных нажатия «оплатить»
-- читали пустоту оба и создавали ДВУХ клиентов; второй затирал первого, и у
-- человека оставалась подписка, привязанная к потерянному клиенту.
--
-- Эта функция делает шаг «записать, если ещё не записано» атомарным и всегда
-- возвращает ПОБЕДИВШЕЕ значение. Проигравшая гонку сторона получает чужой
-- (первый) идентификатор и обязана свой лишний объект в Stripe не
-- использовать. Вторая половина защиты — ключ идемпотентности при создании
-- клиента на стороне Stripe, см. api/stripe/checkout.js.
create or replace function public.stripe_customer_claim(p_user_id uuid, p_customer_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_user_id is null or p_customer_id is null or p_customer_id = '' then
    raise exception 'user id and customer id are required' using errcode = '22023';
  end if;

  insert into public.subscriptions (user_id, tier, status, stripe_customer_id, updated_at)
  values (p_user_id, 'FREE', 'inactive', p_customer_id, now())
  on conflict (user_id) do update
    set stripe_customer_id = coalesce(public.subscriptions.stripe_customer_id, excluded.stripe_customer_id),
        updated_at = now()
  returning stripe_customer_id into v_existing;

  return v_existing;
end;
$$;

revoke all on function public.stripe_customer_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.stripe_customer_claim(uuid, text) to service_role;

comment on table public.stripe_webhook_events is
  'Идемпотентность вебхука Stripe: одно событие обрабатывается один раз. Полезная нагрузка не хранится.';


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_ai_ledger.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — учёт расхода AI становится атомарным и переживает обрывы.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ОШИБКА ПЕРВАЯ: РЕШЕНИЕ ПРИНИМАЛОСЬ ПО УСТАРЕВШЕМУ ЧИСЛУ
--
-- Порядок в api/ai/* был такой:
--
--     spent = await spentThisPeriod(user)     -- 1. прочитали расход
--     check = checkBudget({ spent, ... })     -- 2. решили по прочитанному
--     await reserve(user, check.needed)       -- 3. списали
--
-- Шаги 1 и 3 разнесены во времени, а между ними нет ничего, что мешало бы
-- другому запросу прочитать ТО ЖЕ САМОЕ число. Сто запросов, отправленных
-- одновременно, читали spent = 0, все сто проходили проверку и все сто уходили
-- в модель. Дневной лимит FREE — три запроса; платил за остальные владелец
-- ключа.
--
-- Самое обидное: атомарный примитив уже существовал. ai_usage_add выполняет
-- insert ... on conflict do update и ВОЗВРАЩАЕТ новый итог. Но вызывающий код
-- разбирал ответ как `const { error } = ...` и выбрасывал data. То есть
-- результат атомарной операции просто терялся по дороге.
--
-- ЗДЕСЬ ЭТО ЧИНИТСЯ ТАК: решение принимается ВНУТРИ той же операции, что и
-- списание. Функция сначала списывает, затем смотрит на получившийся итог и,
-- если он вышел за потолок, возвращает резерв и отказывает. Гонка невозможна
-- не потому, что «мы успеваем», а потому, что проверять нечего: число, по
-- которому принимается решение, получено из самой записи.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ОШИБКА ВТОРАЯ: ОБРЫВ МЕЖДУ РЕЗЕРВОМ И РАСЧЁТОМ
--
--     1. резерв списан          — успех
--     2. запрос к модели        — успех
--     3. возврат неизрасходованного — НЕ ДОШЁЛ (упала функция, отвалилась база)
--
-- Человек терял разницу между верхней оценкой и фактической ценой. Она
-- намеренно пессимистична, поэтому потеря заметная: списывается максимально
-- возможный ответ, а тратится обычно втрое меньше.
--
-- Отсюда журнал запросов: у каждого резерва есть строка со своим
-- идентификатором. Не рассчитанные вовремя строки видны, и их возвращает
-- отдельный проход (ai_reconcile). Расчёт при этом идемпотентен: повторный
-- вызов по тому же идентификатору ничего не делает, поэтому повтор запроса
-- не может списать дважды.
--
-- Содержимое переписки с моделью здесь НЕ хранится: журнал существует ради
-- правильного счёта, а не ради логов. Личные данные в него не попадают.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_requests (
  request_id     uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  period         text not null,
  kind           text not null default 'chat' check (kind in ('chat', 'vision', 'digest')),
  reserved_micro bigint not null check (reserved_micro >= 0),
  actual_micro   bigint,
  status         text not null default 'reserved'
                 check (status in ('reserved', 'settled', 'denied', 'reconciled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.ai_requests enable row level security;

-- Свои запросы человек видеть вправе: на этом можно построить честный экран
-- «на что ушёл лимит». Писать в таблицу нельзя никому — только функциям ниже.
drop policy if exists "ai requests select own" on public.ai_requests;
create policy "ai requests select own" on public.ai_requests
  for select using (auth.uid() = user_id);

create index if not exists ai_requests_stale_idx
  on public.ai_requests (created_at) where status = 'reserved';
create index if not exists ai_requests_user_period_idx
  on public.ai_requests (user_id, period);

-- ---------------------------------------------------------------------------
-- Резерв: списать и тут же решить по получившемуся итогу
-- ---------------------------------------------------------------------------
-- p_budget — дневной потолок в микродолларах; null означает «без потолка».
--
-- Возвращает jsonb:
--   { ok: true,  spent, remaining }              — можно звать модель
--   { ok: false, reason: 'exhausted', spent }    — лимит исчерпан
--   { ok: true,  duplicate: true, spent }        — повтор того же запроса
--
-- Отказ возвращается ЗНАЧЕНИЕМ, а не исключением: «лимит кончился» — обычный
-- ответ, который нужно показать человеку, а не сбой.
create or replace function public.ai_reserve(
  p_request_id uuid,
  p_user_id    uuid,
  p_period     text,
  p_micro      bigint,
  p_budget     bigint default null,
  p_kind       text default 'chat'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent bigint;
begin
  if p_request_id is null or p_user_id is null or p_period is null then
    raise exception 'request id, user id and period are required' using errcode = '22023';
  end if;
  if p_micro is null or p_micro < 0 then
    raise exception 'reserve must be non-negative' using errcode = '22023';
  end if;

  -- Повторная заявка с тем же идентификатором не списывает второй раз.
  -- Это делает безопасным повтор запроса после сетевого обрыва.
  insert into public.ai_requests (request_id, user_id, period, reserved_micro, kind)
  values (p_request_id, p_user_id, p_period, p_micro, coalesce(p_kind, 'chat'))
  on conflict (request_id) do nothing;

  if not found then
    select coalesce(spent_micro, 0) into v_spent
      from public.ai_usage where user_id = p_user_id and period = p_period;
    return jsonb_build_object('ok', true, 'duplicate', true, 'spent', coalesce(v_spent, 0));
  end if;

  -- Списание и получение НОВОГО итога — одним оператором. Строка ai_usage
  -- блокируется на время обновления, поэтому параллельные вызовы выстраиваются
  -- в очередь и каждый видит результат предыдущего, а не общее старое число.
  insert into public.ai_usage (user_id, period, spent_micro, requests, updated_at)
  values (p_user_id, p_period, greatest(0, p_micro), 1, now())
  on conflict (user_id, period) do update
    set spent_micro = greatest(0, public.ai_usage.spent_micro + p_micro),
        requests    = public.ai_usage.requests + 1,
        updated_at  = now()
  returning spent_micro into v_spent;

  -- Решение по ФАКТИЧЕСКОМУ итогу, а не по прочитанному заранее.
  if p_budget is not null and v_spent > p_budget then
    update public.ai_usage
       set spent_micro = greatest(0, spent_micro - p_micro),
           requests    = greatest(0, requests - 1),
           updated_at  = now()
     where user_id = p_user_id and period = p_period
    returning spent_micro into v_spent;

    update public.ai_requests
       set status = 'denied', actual_micro = 0, updated_at = now()
     where request_id = p_request_id;

    return jsonb_build_object('ok', false, 'reason', 'exhausted', 'spent', coalesce(v_spent, 0));
  end if;

  return jsonb_build_object(
    'ok', true,
    'spent', v_spent,
    'remaining', case when p_budget is null then null else greatest(0, p_budget - v_spent) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Расчёт по факту
-- ---------------------------------------------------------------------------
-- Идемпотентен по построению: строка берётся for update, и рассчитать её
-- можно ровно один раз. Двойной вызов (повтор, гонка, ретрай) второй раз
-- ничего не спишет и не вернёт.
create or replace function public.ai_settle(p_request_id uuid, p_actual_micro bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.ai_requests;
  v_actual bigint := greatest(0, coalesce(p_actual_micro, 0));
  v_spent  bigint;
begin
  select * into v_row from public.ai_requests
   where request_id = p_request_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_request');
  end if;
  if v_row.status <> 'reserved' then
    -- Уже рассчитан (или отказан). Повтор — не ошибка, просто ничего не делаем.
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.ai_usage
     set spent_micro = greatest(0, spent_micro + (v_actual - v_row.reserved_micro)),
         updated_at  = now()
   where user_id = v_row.user_id and period = v_row.period
  returning spent_micro into v_spent;

  update public.ai_requests
     set status = 'settled', actual_micro = v_actual, updated_at = now()
   where request_id = p_request_id;

  return jsonb_build_object('ok', true, 'spent', coalesce(v_spent, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Возврат зависших резервов
-- ---------------------------------------------------------------------------
-- Строка остаётся в состоянии 'reserved', если функция не дожила до расчёта:
-- платформа убила её по таймауту, упала сеть до базы, отключили питание.
-- Резерв в этом случае списан, а фактическая цена неизвестна — но она заведомо
-- не больше зарезервированной, и держать разницу на человеке нельзя.
--
-- Возвращаем резерв ЦЕЛИКОМ. Это сознательно в пользу пользователя: запрос мог
-- и не дойти до модели вовсе, а выяснить это задним числом нечем.
--
-- Порог по умолчанию — 15 минут: собственный таймаут обращения к модели 60
-- секунд, так что живых запросов старше этого не бывает.
create or replace function public.ai_reconcile(p_older_than interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.ai_requests;
  v_count integer := 0;
begin
  for v_row in
    select * from public.ai_requests
     where status = 'reserved' and created_at < now() - p_older_than
     order by created_at
     limit 500
     for update skip locked
  loop
    update public.ai_usage
       set spent_micro = greatest(0, spent_micro - v_row.reserved_micro),
           updated_at  = now()
     where user_id = v_row.user_id and period = v_row.period;

    update public.ai_requests
       set status = 'reconciled', actual_micro = 0, updated_at = now()
     where request_id = v_row.request_id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Вызывать всё это может только сервер: клиент не должен уметь ни
-- резервировать, ни рассчитывать, ни возвращать себе лимит.
revoke all on function public.ai_reserve(uuid, uuid, text, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.ai_settle(uuid, bigint) from public, anon, authenticated;
revoke all on function public.ai_reconcile(interval) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, bigint, bigint, text) to service_role;
grant execute on function public.ai_settle(uuid, bigint) to service_role;
grant execute on function public.ai_reconcile(interval) to service_role;

comment on table public.ai_requests is
  'Журнал резервов AI: обеспечивает атомарную проверку лимита и возврат зависших резервов. Содержимое запросов не хранится.';


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_rate_limits.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ограничение частоты, которое переживает бессерверную платформу.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- В api/feedback.js лимит жил в памяти процесса:
--
--     const hits = new Map()
--
-- На Vercel экземпляров функции много, они создаются под нагрузкой и умирают.
-- Общей памяти между ними нет, поэтому счётчик обнулялся сам собой, а
-- параллельные запросы попадали в РАЗНЫЕ экземпляры и не видели друг друга.
-- Автор честно описал это в комментарии, но заслон от этого работать не начал.
--
-- Вторая половина беды: ключом был первый элемент X-Forwarded-For, то есть
-- значение из заголовка запроса. Подставив свой, можно было получить сколько
-- угодно свежих корзин.
--
-- ЧТО ВВОДИТСЯ
--
-- Одна общая таблица счётчиков и одна функция. Намеренно НЕ Redis и не внешний
-- сервис: для нескольких обращений в минуту отдельный поставщик — лишняя
-- зависимость, лишние деньги и лишняя точка отказа, а Postgres уже есть.
--
-- Окно фиксированное (не скользящее). Для защиты от потока это достаточно:
-- на границе окон в худшем случае проходит удвоенный лимит, что на порядки
-- лучше отсутствия лимита. Скользящее окно потребовало бы хранить каждую
-- попытку отдельно — дороже без практической разницы.
--
-- КЛЮЧ ХРАНИТСЯ ХЭШЕМ. По ключу может прийти IP-адрес, а это персональные
-- данные: складывать их в открытую ради счётчика не нужно. Хэш решает ту же
-- задачу (различить обратившихся), но не даёт обратного прочтения.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  bucket       text        not null,
  key_hash     text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, key_hash, window_start)
);

alter table public.rate_limits enable row level security;
-- Политик нет намеренно: таблицу трогает только сервер под service_role.
-- Клиенту нельзя ни читать (это разведка чужой активности), ни писать.

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Одно обращение к лимиту
-- ---------------------------------------------------------------------------
-- Возвращает jsonb: { allowed, hits, limit, reset_at, retry_after }.
--
-- Проверка и увеличение — один оператор: иначе два одновременных запроса
-- прочитали бы одно и то же значение и оба прошли бы (ровно та ошибка, что
-- была в учёте AI).
--
-- Сам лимитер не должен становиться способом положить базу, поэтому:
--   • строк ровно по числу активных корзин, а не по числу попыток;
--   • старые окна убираются здесь же, изредка и небольшими порциями.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_key    text,
  p_limit  integer,
  p_window interval default interval '1 minute'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds numeric := greatest(1, extract(epoch from p_window));
  v_start   timestamptz;
  v_hits    integer;
begin
  if p_bucket is null or p_key is null or p_key = '' then
    raise exception 'bucket and key are required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'limit must be positive' using errcode = '22023';
  end if;

  -- Начало текущего окна: время, округлённое вниз до размера окна.
  v_start := to_timestamp(floor(extract(epoch from now()) / v_seconds) * v_seconds);

  insert into public.rate_limits (bucket, key_hash, window_start, hits)
  values (p_bucket, md5(p_bucket || ':' || p_key), v_start, 1)
  on conflict (bucket, key_hash, window_start) do update
    set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  -- Уборка прошлых окон. Раз примерно на сотню обращений и не больше тысячи
  -- строк за раз: полная чистка под нагрузкой сама стала бы помехой.
  if random() < 0.01 then
    delete from public.rate_limits
     where ctid in (
       select ctid from public.rate_limits
        where window_start < now() - interval '1 day'
        limit 1000
     );
  end if;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'hits', v_hits,
    'limit', p_limit,
    'reset_at', v_start + p_window,
    'retry_after', greatest(1, ceil(extract(epoch from (v_start + p_window) - now())))
  );
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, interval) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, interval) to service_role;

comment on table public.rate_limits is
  'Счётчики частоты обращений. Ключ хранится хэшем: по нему может приходить IP-адрес.';


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_restore_post_visibility.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — возврат старым записям того круга, на который рассчитывал автор.
--
-- ЧТО ПРОИЗОШЛО
--
-- До перехода на социальный граф (2026-08-25_social_graph) «мысли» были видны
-- ДРУЗЬЯМ, то есть людям со взаимной подпиской. Миграция ввела настройку
-- видимости и перевела все существующие записи одной строкой:
--
--     update public.posts set visibility = 'followers', visibility_migrated = true;
--
-- Намерение было аккуратным — автор миграции специально сделал это отдельным
-- осознанным шагом, а не побочным эффектом значения по умолчанию, и даже
-- пометил переведённые строки. Но направление выбрано в СТОРОНУ РАСШИРЕНИЯ:
-- «подписчики» — надмножество «друзей». Односторонний подписчик, которого
-- автор к себе не добавлял, получил доступ к записям, написанным тогда, когда
-- такого доступа у него быть не могло.
--
-- Это ровно тот случай, когда менять приватность задним числом нельзя. Человек
-- писал в расчёте на один круг — приложение не вправе молча расширить его.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ
--
--   1. Возвращает всё ещё помеченным записям видимость 'friends'.
--   2. Заводит триггер, снимающий пометку при ЛЮБОМ явном изменении видимости
--      автором. С этого момента «выбрал человек» и «перевела миграция»
--      различимы, и подобный откат больше никогда не заденет осознанный выбор.
--
-- ⚠ ЧЕСТНАЯ ОГОВОРКА. Пометка снимается только с этого момента, поэтому если
-- между августовской миграцией и сегодняшним днём человек СОЗНАТЕЛЬНО поставил
-- записи «для подписчиков», она тоже сузится до «друзей». Это выбрано
-- намеренно: сужение человек увидит и вернёт одним касанием, а расширение
-- он не увидит вовсе. Из двух ошибок выбираем ту, которая не раскрывает
-- лишнего.
--
-- ДАННЫЕ НЕ УДАЛЯЮТСЯ. Меняется одно поле видимости; тексты и изображения
-- записей не трогаются.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Явный выбор автора снимает пометку миграции
-- ---------------------------------------------------------------------------
-- Триггер создаётся ДО отката: иначе сам откат (update ниже) снял бы пометки,
-- которые ему же и нужны, чтобы понять, что откатывать.
create or replace function public.clear_visibility_migrated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Снимаем пометку только при смене САМОЙ видимости. Правка текста или
  -- картинки к выбору круга отношения не имеет.
  if new.visibility is distinct from old.visibility then
    new.visibility_migrated := false;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_visibility_choice on public.posts;
create trigger posts_visibility_choice
  before update on public.posts
  for each row execute function public.clear_visibility_migrated();

-- ---------------------------------------------------------------------------
-- 2. Откат автоматического расширения
-- ---------------------------------------------------------------------------
-- Условие включает visibility = 'followers': если запись уже стоит в другом
-- круге, её трогать не за что. Повторный прогон миграции безопасен — после
-- первого не останется ни одной подходящей строки, а те, что автор поправил
-- руками, уже лишились пометки триггером выше.
do $$
declare
  v_count integer;
begin
  -- Колонки может не быть на базе, поднятой до 2026-08-25. Тогда и откатывать
  -- нечего: автоматического перевода там не было.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'visibility_migrated'
  ) then
    update public.posts
       set visibility = 'friends'
     where visibility_migrated = true
       and visibility = 'followers';
    get diagnostics v_count = row_count;
    raise notice 'Возвращено к кругу «друзья»: % записей', v_count;
  end if;
end $$;

comment on function public.clear_visibility_migrated() is
  'Снимает posts.visibility_migrated при явной смене круга автором: отличает выбор человека от автоматического перевода миграцией.';


-- ###########################################################################
-- ИСТОЧНИК: supabase/migrations/2026-09-12_media_path_ownership.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — путь вложения обязан принадлежать тому, кто его приложил.
--
-- ⚠ ЭТА МИГРАЦИЯ ЗАКРЫВАЕТ ДЫРУ, ОТКРЫТУЮ МИГРАЦИЕЙ 2026-09-12_private_media.
-- Она обязана применяться вместе с ней. Ниже подробно, в чём было дело, —
-- ошибка неочевидная, и повторить её легко.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ЧТО БЫЛО НЕ ТАК
--
-- Предикат чтения выглядел так:
--
--     select exists (
--       select 1 from public.messages m
--       where m.image_path = p_name
--         and (m.sender = auth.uid() or m.recipient = auth.uid() or …)
--     )
--
-- Читается он как «файл виден участнику сообщения, к которому приложен». Но
-- КТО задаёт `image_url`, из которого выводится `image_path`? Клиент:
-- send_conversation_message принимает p_image_url параметром и кладёт как есть.
--
-- Значит нападающий может отправить сообщение САМОМУ СЕБЕ, подставив в
-- image_url чужой путь:
--
--     .../object/public/chat-images/<чужой-uuid>/<файл>.jpg
--
-- Он — отправитель этого сообщения, условие выполняется, и политика выдаёт
-- подписанную ссылку на ЧУЖОЕ фото. Проверка «ты участник сообщения» ничего
-- не значит, если сообщение сочинил сам нападающий.
--
-- Вторая половина беды — уборка. Триггеры складывали `image_path` удалённого
-- сообщения в очередь, а разбирает её сервер под service_role, которому RLS не
-- писан. То есть та же подделка позволяла УДАЛИТЬ чужой файл: приложить чужой
-- путь к своему сообщению и удалить сообщение.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ПОЧЕМУ ЧИНИТСЯ ИМЕННО ТАК
--
-- Путь файла не произволен — его задаёт загрузка, и в нём уже записан владелец:
--
--     chat-images / post-images : <id владельца>/<uuid>.<ext>
--     dm-media                  : <id диалога>/<id автора>/<uuid>.<ext>
--
-- Политика записи в хранилище это и проверяет: положить файл можно только в
-- свою папку. Значит первый (для dm-media — второй) сегмент пути — достоверное
-- утверждение о том, кто файл загрузил.
--
-- Отсюда правило: путь засчитывается, только если его сегмент владельца
-- совпадает с автором строки, которая на него ссылается. Подделка перестаёт
-- работать сама собой — чужой путь несёт чужой идентификатор.
--
-- Никаких новых таблиц и колонок: проверка опирается на то, что уже записано
-- в самом пути.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Владелец пути
-- ---------------------------------------------------------------------------
-- Вынесено отдельной функцией, чтобы одно и то же правило не было переписано
-- в четырёх местах и не разъехалось между ними.
create or replace function public.media_path_owner(p_path text, p_segment int default 1)
returns text
language sql
immutable
as $$
  select case
    when p_path is null or p_path = '' then null
    -- split_part вернёт пустую строку, если сегмента нет вовсе; такой путь
    -- не принадлежит никому и не должен совпасть ни с одним идентификатором.
    when nullif(split_part(p_path, '/', p_segment), '') is null then null
    else split_part(p_path, '/', p_segment)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Чтение вложений переписки
-- ---------------------------------------------------------------------------
create or replace function public.can_read_chat_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    where m.image_path = p_name
      and auth.uid() is not null
      -- ⚠ КЛЮЧЕВАЯ СТРОКА. Без неё достаточно приложить чужой путь к своему
      -- сообщению, чтобы получить подпись на чужой файл.
      and public.media_path_owner(m.image_path) = m.sender::text
      and (
        m.sender = auth.uid()
        or m.recipient = auth.uid()
        or (m.conversation_id is not null
            and public.is_conversation_member(m.conversation_id, auth.uid()))
      )
      -- Блокировка перекрывает участие — как и в политике чтения сообщений.
      and not public.is_blocked_between(m.sender, auth.uid())
  );
$$;

revoke all on function public.can_read_chat_image(text) from public, anon;
grant execute on function public.can_read_chat_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Чтение изображений записей
-- ---------------------------------------------------------------------------
create or replace function public.can_read_post_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.image_path = p_name
      and auth.uid() is not null
      -- То же самое: своя запись с чужим путём не даёт доступа к чужому файлу.
      and public.media_path_owner(p.image_path) = p.user_id::text
      and public.can_view_post(p.id)
  );
$$;

revoke all on function public.can_read_post_image(text) from public, anon;
grant execute on function public.can_read_post_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Уборка удаляет только свои файлы
-- ---------------------------------------------------------------------------
-- Здесь проверка нужна не меньше, чем на чтении: очередь разбирает сервер под
-- service_role, для которого политик хранилища не существует. Без неё подделка
-- пути превращалась в удаление чужого файла.
create or replace function public.queue_post_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  v_path := old.image_path;
  -- Путь, не принадлежащий автору записи, в очередь не попадает вовсе.
  if v_path is null or public.media_path_owner(v_path) is distinct from old.user_id::text then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('post-images', v_path, 'post deleted');
  elsif old.image_path is distinct from new.image_path then
    perform public.enqueue_storage_cleanup('post-images', v_path, 'post image replaced');
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.queue_message_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_img   text;
  v_media text;
  v_drop  boolean;
begin
  v_drop := tg_op = 'DELETE'
    or (old.unsent_at is null and new.unsent_at is not null);
  if not v_drop then
    return coalesce(new, old);
  end if;

  -- chat-images: путь начинается с папки загрузившего.
  v_img := old.image_path;
  if v_img is not null and public.media_path_owner(v_img) = old.sender::text then
    perform public.enqueue_storage_cleanup('chat-images', v_img, 'message removed');
  end if;

  -- dm-media: <id диалога>/<id автора>/<файл>. Проверяем ОБА сегмента —
  -- иначе можно было бы удалить файл соседнего диалога.
  if old.media ? 'path' then
    v_media := old.media->>'path';
    if v_media is not null
       and public.media_path_owner(v_media, 2) = old.sender::text
       and (old.conversation_id is null
            or public.media_path_owner(v_media, 1) = old.conversation_id::text)
    then
      perform public.enqueue_storage_cleanup('dm-media', v_media, 'message removed');
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- Триггеры пересоздаём: тела функций заменены через create or replace, но
-- пересоздание делает связь явной и переживает переименование в будущем.
drop trigger if exists posts_image_cleanup on public.posts;
create trigger posts_image_cleanup
  after update or delete on public.posts
  for each row execute function public.queue_post_image_cleanup();

drop trigger if exists messages_image_cleanup on public.messages;
create trigger messages_image_cleanup
  after update or delete on public.messages
  for each row execute function public.queue_message_image_cleanup();

-- ---------------------------------------------------------------------------
-- 5. Разовая чистка очереди от уже подделанного
-- ---------------------------------------------------------------------------
-- Если между применением 2026-09-12_private_media и этой миграцией кто-то
-- успел подложить чужой путь, он уже лежит в очереди и будет удалён первым же
-- проходом уборки. Выметаем всё, чей владелец не подтверждается строкой-
-- источником. Записи, подтверждённые источником, остаются.
delete from public.storage_cleanup_queue q
where q.bucket in ('chat-images', 'post-images')
  and not exists (
    select 1 from public.posts p
    where q.bucket = 'post-images'
      and p.image_path = q.path
      and public.media_path_owner(p.image_path) = p.user_id::text
  )
  and not exists (
    select 1 from public.messages m
    where q.bucket = 'chat-images'
      and m.image_path = q.path
      and public.media_path_owner(m.image_path) = m.sender::text
  );

comment on function public.media_path_owner(text, int) is
  'Идентификатор владельца, записанный в пути файла. Политика записи в хранилище гарантирует, что положить файл можно только в свою папку, — поэтому этому сегменту можно верить.';
