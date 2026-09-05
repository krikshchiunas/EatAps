-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после миграции 2026-09-05_social_hardening.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только
-- читает. Каждая строка — одна проверка со статусом ✔ или ✖.
--
-- Проверяет три класса вещей:
--   • структуру — колонки, индексы, триггеры и функции на месте;
--   • инварианты данных — то, чего структура не гарантирует: строка дружбы
--     существует ровно там, где есть взаимная подписка, и нигде больше;
--   • отсутствие ловушек, которые уже срабатывали, — ссылку на удалённую
--     колонку в guard_profile_update и незаполненную публичную витрину.
--
-- Проверку «пользователь A не видит приватный пост B» этот файл не делает и
-- сделать не может: он выполняется от service_role, для которого RLS не
-- применяется. Такая проверка — только двумя реальными сессиями, см. раздел
-- «Ручные проверки» в конце.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Дружба как производная ───────────────────────────────────────────
  select 1, 'friendships: пара уникальна независимо от порядка',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'friendships_pair_uniq'),
    'индекс friendships_pair_uniq'

  union all select 2, 'follows: пара сериализуется advisory-локом',
    exists (select 1 from pg_trigger where tgname = 'follows_aa_pair_lock' and not tgisinternal),
    'триггер follows_aa_pair_lock (before insert or delete)'

  union all select 3, 'лок берётся ДО вставки (BEFORE, а не AFTER)',
    exists (
      select 1 from pg_trigger t
      where t.tgname = 'follows_aa_pair_lock'
        and (t.tgtype & 2) = 2  -- бит BEFORE
    ),
    'иначе вторая транзакция всё равно не увидит первую'

  union all select 4, 'reconcile_friendship существует',
    to_regprocedure('public.reconcile_friendship(uuid, uuid)') is not null,
    'единая точка приведения строки дружбы к графу'

  -- ИНВАРИАНТ. Обе стороны обязаны сойтись: нет дружбы без взаимной подписки
  -- и нет взаимной подписки без дружбы. Именно это расходилось при гонке.
  union all select 5, 'нет строк дружбы без взаимной подписки',
    not exists (
      select 1 from public.friendships f
      where not (
        exists (select 1 from public.follows a where a.follower_id = f.requester and a.following_id = f.addressee)
        and exists (select 1 from public.follows b where b.follower_id = f.addressee and b.following_id = f.requester)
      )
    ),
    coalesce((
      select count(*)::text || ' лишних строк' from public.friendships f
      where not (
        exists (select 1 from public.follows a where a.follower_id = f.requester and a.following_id = f.addressee)
        and exists (select 1 from public.follows b where b.follower_id = f.addressee and b.following_id = f.requester)
      )
    ), '0')

  union all select 6, 'нет взаимных подписок без строки дружбы',
    not exists (
      select 1
      from public.follows f
      join public.follows r on r.follower_id = f.following_id and r.following_id = f.follower_id
      where not exists (
        select 1 from public.friendships x
        where least(x.requester, x.addressee) = least(f.follower_id, f.following_id)
          and greatest(x.requester, x.addressee) = greatest(f.follower_id, f.following_id)
      )
    ),
    'потерянные дружбы (именно их создавала гонка)'

  union all select 7, 'нет дублей пары в friendships',
    not exists (
      select 1 from public.friendships
      group by least(requester, addressee), greatest(requester, addressee)
      having count(*) > 1
    ),
    'пара (A,B) и (B,A) одновременно'

  -- ── 2. Права считаются по графу, а не по материализованной строке ───────
  union all select 8, 'политика дневника спрашивает is_friend_with',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'app_state'
        and policyname = 'state select self, friends or coach'
        and qual like '%is_friend_with%'
    ),
    'иначе доступ к дневнику разойдётся с правом переписки'

  union all select 9, 'политика дневника больше не читает friendships напрямую',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'app_state'
        and policyname = 'state select self, friends or coach'
        and qual not like '%friendships%'
    ),
    'два определения «друга» — это два расходящихся определения'

  -- ── 3. Профиль: две ловушки, которые уже срабатывали ────────────────────
  union all select 10, 'guard_profile_update не читает удалённый public_id',
    (select prosrc from pg_proc where proname = 'guard_profile_update' limit 1) not like '%public_id%',
    'иначе КАЖДЫЙ update по profiles падает с 42703'

  union all select 11, 'у profiles нет клиентской политики UPDATE',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'
    ),
    'ник меняет только set_username, витрину — только триггер'

  union all select 12, 'витрина заполнена: у всех, кто сохранял состояние, есть имя',
    coalesce((
      select count(*) = 0
      from public.profiles p
      join public.app_state a on a.user_id = p.user_id
      where p.display_name is null
        and nullif(btrim(coalesce(a.state->'profile'->>'name', '')), '') is not null
    ), true),
    coalesce((
      select count(*)::text || ' профилей без имени при заполненном состоянии'
      from public.profiles p
      join public.app_state a on a.user_id = p.user_id
      where p.display_name is null
        and nullif(btrim(coalesce(a.state->'profile'->>'name', '')), '') is not null
    ), '0')

  union all select 13, 'ник ограничен по частоте смены',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'username_changed_at'
    ),
    'колонка username_changed_at'

  -- ── 4. Сообщения ────────────────────────────────────────────────────────
  union all select 14, 'у сообщений есть ключ идемпотентности',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'client_id'
    ),
    'колонка client_id'

  union all select 15, 'повтор с тем же ключом невозможен',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'messages_sender_client_idx'),
    'частичный уникальный индекс (sender, client_id)'

  union all select 16, 'отправка идёт через send_message',
    to_regprocedure('public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid)') is not null,
    'сервер определяет отправителя по auth.uid()'

  union all select 17, 'история читается страницами',
    to_regprocedure('public.list_messages(uuid, int, timestamptz, uuid)') is not null,
    'раньше клиент брал САМЫЕ СТАРЫЕ 300 сообщений'

  union all select 18, 'список диалогов не выгружает переписку целиком',
    to_regprocedure('public.list_conversations(int)') is not null,
    'по одному последнему сообщению на диалог'

  union all select 19, 'у длины сообщения есть потолок',
    exists (select 1 from pg_constraint where conname = 'messages_text_len'),
    'если ✖ — в базе есть сообщения длиннее 4000 символов, см. NOTICE миграции'

  -- ── 5. Списки и блокировки ──────────────────────────────────────────────
  union all select 20, 'списки людей закрыты от заблокировавшего',
    (select prosrc from pg_proc where proname = 'list_followers' limit 1) like '%is_blocked_between(p_user_id%',
    'иначе заблокировавший остаётся перечислимым через RPC'

  union all select 21, 'подписка проверяет блокировку функцией, а не подзапросом',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'follows' and cmd = 'INSERT'
        and with_check like '%is_blocked_between%'
    ),
    'подзапрос к blocks внутри политики не видит чужую блокировку — она невидима заблокированному'

  union all select 22, 'таблица подписок закрыта от посторонних',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'follows' and cmd = 'SELECT'
        and qual like '%authenticated%' and qual not like '%auth.uid()%'
    ),
    'иначе проверки блокировки в RPC обходятся прямым GET /follows'

  union all select 23, 'список друзей строится по подпискам',
    (select prosrc from pg_proc where proname = 'list_friends' limit 1) like '%public.follows%',
    'а не по материализованной строке'

  union all select 24, 'политика ответов знает про блокировки',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'post_comments' and cmd = 'SELECT'
        and qual like '%is_blocked_between%'
    ),
    'иначе фильтр в RPC обходится прямым GET /post_comments'

  union all select 25, 'ответы скрывают заблокированных',
    (select prosrc from pg_proc where proname = 'list_post_comments' limit 1) like '%blocked%',
    'блокировка работает и под чужим постом'

  union all select 26, 'имя автора ответа берётся из profiles',
    (select prosrc from pg_proc where proname = 'list_post_comments' limit 1) not like '%app_state%',
    'а не из чужого блоба состояния'

  -- ── 6. Пакетные и частотные ─────────────────────────────────────────────
  union all select 27, 'отношения читаются пакетом',
    to_regprocedure('public.relationships_with(uuid[])') is not null,
    'список из 50 человек — один запрос, а не 50'

  union all select 28, 'у реакций есть ограничение частоты',
    exists (select 1 from pg_trigger where tgname = 'post_reactions_rate_limit' and not tgisinternal),
    'иначе переключением 🥕/🥦 можно дёргать чужой бейдж'

  union all select 29, 'лимиты частоты обеспечены индексами',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'post_reactions_user_time_idx')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'post_comments_user_time_idx'),
    'иначе каждая вставка — seq scan по всей таблице'

  union all select 30, 'бесполезный индекс по visibility снят',
    not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'posts_visibility_created_idx'),
    'колонка из четырёх значений не годится в начало индекса'

  -- ── 7. Уведомления не переживают свою сущность ──────────────────────────
  union all select 31, 'удаление поста уносит уведомления о нём',
    exists (select 1 from pg_trigger where tgname = 'posts_notify_cleanup' and not tgisinternal),
    'иначе событие ведёт в никуда'

  union all select 32, 'удаление ответа уносит уведомление о нём',
    exists (select 1 from pg_trigger where tgname = 'post_comments_notify_cleanup' and not tgisinternal),
    'триггер post_comments_notify_cleanup'

  union all select 33, 'блокировка чистит события в ОБЕ стороны',
    (select prosrc from pg_proc where proname = 'apply_block' limit 1) like '%recipient_id = new.blocked_id%',
    'у заблокированного тоже не должно остаться событий от блокирующего'

  union all select 34, 'нет уведомлений о несуществующих постах',
    not exists (
      select 1 from public.notifications n
      where n.entity_type = 'post' and n.entity_id is not null
        and not exists (select 1 from public.posts p where p.id = n.entity_id)
    ),
    'висячие события'

  union all select 35, 'нет уведомлений самому себе',
    not exists (select 1 from public.notifications where actor_id = recipient_id),
    'push_notification обязана их отбрасывать'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;


-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНЫЕ ПРОВЕРКИ (двумя реальными сессиями, из приложения)
--
-- Ни одну из них нельзя сделать этим файлом: он выполняется от service_role,
-- для которого RLS не применяется, и потому «видно» будет всё и всегда.
--
--  1. ГОНКА ВЗАИМНОЙ ПОДПИСКИ. С двух устройств одновременно нажать
--     «Подписаться» друг на друга. Ожидаемо: оба видят «Вы друзья», оба видят
--     друг друга в списке друзей, у обоих открывается чат и дневник.
--     Проверка 6 выше после этого обязана оставаться ✔.
--
--  2. ПРИВАТНОСТЬ ПОСТА. A публикует пост «только друзьям». B — подписчик, но
--     не друг. Ожидаемо: B не видит пост ни в ленте, ни в профиле A, ни по
--     прямому вызову list_posts, а счётчик мыслей в профиле A его не считает.
--
--  3. БЛОКИРОВКА. A блокирует B. Из-под B проверить ВСЕ пути: профиль A,
--     посты A, лента, поиск по нику A, список подписчиков A, ответы A под
--     общим постом, чат. Везде ожидаемо пусто или «Профиль недоступен».
--
--  4. ИДЕМПОТЕНТНОСТЬ ОТПРАВКИ. Включить в чате «медленную сеть» в DevTools,
--     отправить сообщение, дождаться пометки «не отправлено», нажать
--     «Повторить». Ожидаемо: в переписке ОДНО сообщение, не два.
--
--  5. ИСТОРИЯ ДЛИННОГО ЧАТА. В переписке длиннее 60 сообщений открыть чат.
--     Ожидаемо: видны ПОСЛЕДНИЕ сообщения, прокрутка вверх догружает более
--     ранние. Раньше открывались самые старые.
--
--  6. СМЕНА ИМЕНИ. Изменить имя и фото в профиле, затем открыть свой профиль
--     из другого аккаунта. Ожидаемо: новое имя и фото видны. До миграции
--     витрина не обновлялась вовсе, а сохранение состояния падало.
-- ═══════════════════════════════════════════════════════════════════════════
