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
create policy "profiles select own" on public.profiles
  for select using (auth.uid() = user_id);

-- Менять username и bio может владелец. display_name и avatar_url сюда не
-- входят: их зеркалит триггер из app_state, и ручная правка разошлась бы с
-- источником истины.
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

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
create or replace function public.user_brief(p_user uuid)
returns table (public_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.user_brief(uuid) from public, anon;
grant execute on function public.user_brief(uuid) to authenticated;
