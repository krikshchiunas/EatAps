-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после миграции 2026-08-25_social_graph.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только читает.
-- Каждая строка — одна проверка со статусом ✔ или ✖.
--
-- Проверяет ДВА разных класса вещей:
--   • структуру — таблицы, колонки, индексы, политики, функции на месте;
--   • инварианты модели — то, что структура сама по себе не гарантирует:
--     отсутствие INSERT-политики на уведомлениях, приватность public_id,
--     отсутствие дублей в графе, согласованность username.
--
-- Проверку «пользователь A не видит приватный пост пользователя B» этот файл
-- не делает и сделать не может: он выполняется от service_role, для которого
-- RLS не применяется. Такую проверку нужно делать двумя реальными сессиями —
-- см. раздел «Ручные проверки» в конце файла.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Структура графа ──────────────────────────────────────────────────
  select 1, 'таблица follows существует',
    to_regclass('public.follows') is not null,
    coalesce((select count(*)::text || ' подписок' from public.follows), '—')

  union all select 2, 'таблица blocks существует',
    to_regclass('public.blocks') is not null,
    coalesce((select count(*)::text || ' блокировок' from public.blocks), '—')

  union all select 3, 'таблица notifications существует',
    to_regclass('public.notifications') is not null,
    coalesce((select count(*)::text || ' уведомлений' from public.notifications), '—')

  union all select 4, 'follows: нельзя подписаться на себя (CHECK)',
    exists (select 1 from pg_constraint where conname = 'follows_no_self'),
    'constraint follows_no_self'

  union all select 5, 'follows: пара уникальна (PK)',
    exists (
      select 1 from pg_index i
      join pg_class c on c.oid = i.indrelid
      where c.relname = 'follows' and i.indisprimary
    ),
    'первичный ключ (follower_id, following_id)'

  union all select 6, 'blocks: нельзя заблокировать себя (CHECK)',
    exists (select 1 from pg_constraint where conname = 'blocks_no_self'),
    'constraint blocks_no_self'

  -- ── 2. Разделение FOLLOW / FRIENDSHIP / PERMISSION ──────────────────────
  union all select 7, 'posts.visibility существует и NOT NULL',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='posts'
        and column_name='visibility' and is_nullable='NO'
    ),
    coalesce((select string_agg(distinct visibility::text, ', ') from public.posts), 'постов нет')

  union all select 8, 'тип post_visibility содержит все четыре уровня',
    (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'post_visibility') = 4,
    coalesce((select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
      from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname='post_visibility'), 'типа нет')

  union all select 9, 'старые посты переведены в followers',
    not exists (
      select 1 from public.posts
      where visibility_migrated = true and visibility <> 'followers'
    ),
    coalesce((select count(*)::text || ' постов мигрировано'
      from public.posts where visibility_migrated), '0')

  union all select 10, 'дневник питания НЕ открыт подписчикам (friend_state требует дружбы)',
    (select pg_get_functiondef(p.oid) like '%is_friend_with%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_state'),
    'friend_state опирается на дружбу, а не на follows'

  -- ── 3. Уведомления: клиент не может их создавать ────────────────────────
  union all select 11, 'notifications: INSERT-политики НЕТ (клиент не пишет)',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='notifications' and cmd='INSERT'
    ),
    'политик INSERT: ' || (select count(*)::text from pg_policies
      where schemaname='public' and tablename='notifications' and cmd='INSERT')

  union all select 12, 'notifications: RLS включён',
    (select relrowsecurity from pg_class where relname='notifications' and relnamespace='public'::regnamespace),
    'relrowsecurity'

  union all select 13, 'notifications: SELECT только своих',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='notifications' and cmd='SELECT'
        and qual like '%recipient_id%'
    ),
    'политика notifications select own'

  union all select 14, 'push_notification недоступна клиенту',
    not has_function_privilege('authenticated',
      'public.push_notification(uuid,uuid,public.notification_type,text,uuid,jsonb)', 'EXECUTE'),
    'EXECUTE отозван у authenticated'

  union all select 15, 'нет уведомлений самому себе',
    not exists (select 1 from public.notifications where actor_id = recipient_id),
    'actor_id <> recipient_id'

  union all select 16, 'дедуп-индекс уведомлений на месте',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='notifications_dedup_idx'),
    'notifications_dedup_idx'

  -- ── 4. Публичные профили ────────────────────────────────────────────────
  union all select 17, 'у всех профилей есть username',
    not exists (select 1 from public.profiles where username is null),
    (select count(*)::text || ' без username' from public.profiles where username is null)

  union all select 18, 'username уникальны',
    (select count(*) from public.profiles where username is not null)
      = (select count(distinct username) from public.profiles where username is not null),
    'дублей: ' || (select coalesce(sum(c) - count(*), 0)::text from (
      select count(*) c from public.profiles where username is not null group by username) x)

  union all select 19, 'username соответствуют формату',
    not exists (select 1 from public.profiles
      where username is not null and username !~ '^[a-z0-9_]{3,20}$'),
    'нарушений: ' || (select count(*)::text from public.profiles
      where username is not null and username !~ '^[a-z0-9_]{3,20}$')

  union all select 20, 'public_id НЕ раздаётся публично',
    -- Прямое чтение profiles закрыто на владельца, а публичные RPC (user_cards,
    -- search_users, user_profile) не содержат public_id в списке возврата.
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public'
        and p.proname in ('user_cards','search_users','user_profile','list_followers','list_following')
        and pg_get_functiondef(p.oid) ~* '\mpublic_id\M'
    ),
    'ни одна публичная RPC не отдаёт public_id'

  union all select 21, 'прямое чтение profiles ограничено владельцем',
    exists (select 1 from pg_policies
      where schemaname='public' and tablename='profiles' and cmd='SELECT'
        and qual like '%uid()%'),
    'политика profiles select own'

  -- ── 5. Функции слоя отношений ───────────────────────────────────────────
  union all select 22, 'get_relationship создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='get_relationship'), 'RPC'

  union all select 23, 'list_feed создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='list_feed'), 'RPC'

  union all select 24, 'search_users создан и требует 3+ символа',
    (select pg_get_functiondef(p.oid) like '%char_length%>= 3%'
       or pg_get_functiondef(p.oid) like '%char_length(q.v) >= 3%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='search_users'),
    'минимальная длина запроса защищает от выгрузки базы'

  union all select 25, 'все социальные RPC закрыты для anon',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public'
        and p.proname in ('get_relationship','list_feed','search_users','user_profile',
                          'user_cards','list_followers','list_following',
                          'list_notifications','mark_all_notifications_read','set_username')
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    'anon не может вызвать ни одну'

  -- ── 6. Целостность графа ────────────────────────────────────────────────
  union all select 26, 'нет подписок на самого себя',
    not exists (select 1 from public.follows where follower_id = following_id), 'follows'

  union all select 27, 'нет дружбы с самим собой',
    not exists (select 1 from public.friendships where requester = addressee), 'friendships'

  union all select 28, 'блокировка не сосуществует с подпиской',
    not exists (
      select 1 from public.blocks b join public.follows f
        on (f.follower_id = b.blocker_id and f.following_id = b.blocked_id)
        or (f.follower_id = b.blocked_id and f.following_id = b.blocker_id)
    ),
    'триггер apply_block снимает подписки'

  union all select 29, 'блокировка не сосуществует с дружбой',
    not exists (
      select 1 from public.blocks b join public.friendships fr
        on (fr.requester = b.blocker_id and fr.addressee = b.blocked_id)
        or (fr.requester = b.blocked_id and fr.addressee = b.blocker_id)
    ),
    'триггер apply_block снимает дружбу'

  union all select 30, 'user_brief не раздаёт public_id посторонним',
    (select pg_get_functiondef(p.oid) like '%coach_links%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='user_brief'),
    'код добавления в друзья виден только владельцу и связанному тренеру'

  union all select 31, 'сообщения по-прежнему только между друзьями',
    exists (select 1 from pg_policies
      where schemaname='public' and tablename='messages' and cmd='INSERT'
        and with_check like '%is_friend_with%'),
    'право переписки не перешло к подписчикам'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНЫЕ ПРОВЕРКИ ДОСТУПА
--
-- Всё выше выполняется от service_role, а для него RLS не применяется. Значит
-- эти запросы НЕ доказывают, что политики работают, — они доказывают, что
-- политики существуют и что данные согласованы. Настоящая проверка изоляции
-- делается только двумя реальными пользовательскими сессиями.
--
-- Как проверить руками (два аккаунта A и B, НЕ друзья и НЕ подписаны):
--
--   1. От A: создать пост с visibility='private'.
--      От B: select * from posts where id = '<id>';        → 0 строк
--            select * from list_posts('<A>');              → поста нет
--
--   2. От A: пост с visibility='followers'.
--      От B: 0 строк. Затем B подписывается на A → пост появляется.
--      B отписывается → пост снова пропадает.
--
--   3. От B: insert into notifications (...) values (...);  → ошибка RLS
--      (INSERT-политики нет вовсе — писать не может никто, кроме триггеров).
--
--   4. От B: update posts set text='взломано' where user_id='<A>';
--                                                          → 0 строк
--      delete from post_comments where user_id='<A>';       → 0 строк
--
--   5. От B: insert into follows (follower_id, following_id)
--            values ('<A>', '<кто угодно>');                → ошибка RLS
--            (подписаться можно только от своего имени)
--
--   6. A блокирует B. Проверить: B не видит постов A ни на каком уровне
--      visibility, включая 'public'; строки follows между ними исчезли.
--
--   7. От B: select public_id from profiles where user_id = '<A>';
--                                                          → 0 строк
-- ═══════════════════════════════════════════════════════════════════════════
