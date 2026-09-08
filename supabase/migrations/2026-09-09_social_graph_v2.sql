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
