-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после 2026-09-09_social_graph_v2.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только читает.
-- Каждая строка — одна проверка со статусом ✔ или ✖.
--
-- ⚠ ЧТО ЭТОТ ФАЙЛ ДОКАЗАТЬ НЕ МОЖЕТ. Он выполняется от service_role, для
-- которого RLS не применяется. Значит, он проверяет, что правила СУЩЕСТВУЮТ и
-- что данные им не противоречат, — но не то, что они РАБОТАЮТ. Настоящая
-- проверка изоляции делается двумя реальными сессиями; матрица в конце файла.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Новые отношения ──────────────────────────────────────────────────
  select 1, 'таблица follow_requests существует',
    to_regclass('public.follow_requests') is not null,
    coalesce((select count(*)::text || ' просьб' from public.follow_requests), '—')

  union all select 2, 'таблица close_friends существует',
    to_regclass('public.close_friends') is not null,
    coalesce((select count(*)::text || ' записей' from public.close_friends), '—')

  union all select 3, 'таблица restricted_users существует',
    to_regclass('public.restricted_users') is not null,
    coalesce((select count(*)::text || ' ограничений' from public.restricted_users), '—')

  union all select 4, 'таблица user_mutes существует',
    to_regclass('public.user_mutes') is not null,
    coalesce((select count(*)::text || ' заглушений' from public.user_mutes), '—')

  union all select 5, 'таблица diary_access существует',
    to_regclass('public.diary_access') is not null,
    coalesce((select count(*)::text || ' доступов' from public.diary_access), '—')

  union all select 6, 'у всех новых таблиц включён RLS',
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not c.relrowsecurity
        and c.relname in ('follow_requests','close_friends','restricted_users','user_mutes','diary_access')
    ),
    'RLS обязателен на каждой таблице с чужими данными'

  -- ── 2. Приватность аккаунта ─────────────────────────────────────────────
  union all select 10, 'profiles.is_private существует и NOT NULL',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles'
        and column_name='is_private' and is_nullable='NO'
    ),
    coalesce((select count(*) filter (where is_private)::text || ' закрытых из '
              || count(*)::text from public.profiles), '—')

  union all select 11, 'миграция НЕ закрыла ничей аккаунт задним числом',
    -- Закрытие — осознанное действие владельца. Если сразу после прогона
    -- закрытых окажется много, значит колонка добавлена с неверным default.
    (select coalesce(bool_or(is_private), false) = false
       from public.profiles where created_at < now() - interval '1 day'
       limit 1) is not false,
    coalesce((select count(*)::text || ' закрытых' from public.profiles where is_private), '0')

  union all select 12, 'права на переписку по трём категориям заведены',
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='profiles'
        and column_name in ('msg_from_following','msg_from_followers','msg_from_others')) = 3,
    coalesce((select msg_from_following || ' / ' || msg_from_followers || ' / ' || msg_from_others
              from public.profiles limit 1), '—')

  union all select 13, 'значения прав на переписку ограничены CHECK',
    exists (select 1 from pg_constraint where conname = 'profiles_msg_policy_known'),
    'constraint profiles_msg_policy_known'

  union all select 14, 'круг дневника знает close_friends и selected',
    exists (
      select 1 from pg_constraint
      where conname = 'profiles_diary_visibility_known'
        and pg_get_constraintdef(oid) like '%close_friends%'
        and pg_get_constraintdef(oid) like '%selected%'
    ),
    coalesce((select string_agg(distinct diary_visibility, ', ') from public.profiles), '—')

  -- ── 3. Просьба о подписке не даёт прав ──────────────────────────────────
  union all select 20, 'на закрытый аккаунт нельзя подписаться прямой вставкой',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='follows' and cmd='INSERT'
        and with_check like '%is_private_account%'
    ),
    'политика follows insert проверяет закрытость'

  union all select 21, 'нет просьбы там, где уже есть подписка',
    not exists (
      select 1 from public.follow_requests r
      join public.follows f
        on f.follower_id = r.requester_id and f.following_id = r.target_id
    ),
    'просьба и подписка одновременно — признак неатомарного одобрения'

  union all select 22, 'нет просьб к самому себе',
    not exists (select 1 from public.follow_requests where requester_id = target_id),
    'constraint follow_requests_no_self'

  union all select 23, 'одобрение просьбы — одна серверная транзакция',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='accept_follow_request' and p.prosecdef),
    'accept_follow_request, SECURITY DEFINER'

  union all select 24, 'блокировка сносит просьбы в обе стороны',
    (select pg_get_functiondef(p.oid) like '%follow_requests%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='apply_block'),
    'apply_block чистит follow_requests'

  union all select 25, 'блокировка отзывает право писать',
    (select pg_get_functiondef(p.oid) like '%message_grants%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='apply_block'),
    'apply_block чистит message_grants'

  union all select 26, 'после блокировки не осталось связей',
    not exists (
      select 1 from public.blocks b
      where exists (select 1 from public.follows f
                     where (f.follower_id=b.blocker_id and f.following_id=b.blocked_id)
                        or (f.follower_id=b.blocked_id and f.following_id=b.blocker_id))
         or exists (select 1 from public.close_friends c
                     where (c.owner_id=b.blocker_id and c.user_id=b.blocked_id)
                        or (c.owner_id=b.blocked_id and c.user_id=b.blocker_id))
         or exists (select 1 from public.follow_requests r
                     where (r.requester_id=b.blocker_id and r.target_id=b.blocked_id)
                        or (r.requester_id=b.blocked_id and r.target_id=b.blocker_id))
    ),
    'граф согласован с блокировками'

  -- ── 4. Близкие друзья — односторонний ПРИВАТНЫЙ список ──────────────────
  union all select 30, 'чужой список близких друзей не читается',
    -- Ни одной SELECT-политики, отдающей строку тому, КОГО добавили. Иначе
    -- человек узнавал бы, что его убрали из близких, — знание, которое никому
    -- не улучшает жизнь.
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='close_friends' and cmd='SELECT'
        and qual like '%user_id%'
    ),
    'политика close_friends select — только owner_id'

  union all select 31, 'нет близких друзей самому себе',
    not exists (select 1 from public.close_friends where owner_id = user_id),
    'constraint close_friends_no_self'

  -- ── 5. Ограничение — тихое ──────────────────────────────────────────────
  union all select 40, 'ограниченный не читает строку о своём ограничении',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='restricted_users' and cmd='SELECT'
        and qual like '%restricted_id%'
    ),
    'политика restricted select — только owner_id'

  union all select 41, 'ограничение переводит переписку в «Запросы»',
    (select pg_get_functiondef(p.oid) like '%is_restricted%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='get_message_permission'),
    'get_message_permission учитывает ограничение'

  -- ── 6. Единственность правил доступа ────────────────────────────────────
  union all select 50, 'закрытость аккаунта решает одна функция',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='can_view_profile_content' and p.prosecdef),
    'can_view_profile_content, SECURITY DEFINER'

  union all select 51, 'политика записей знает про закрытый аккаунт',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='posts' and cmd='SELECT'
        and qual like '%is_private_account%'
    ),
    'иначе закрытие аккаунта ничего бы не закрывало'

  union all select 52, 'политика записей знает про близких друзей',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='posts' and cmd='SELECT'
        and qual like '%is_close_friend%'
    ),
    'круг close_friends виден политике'

  union all select 53, 'лента исключает заглушённых',
    (select pg_get_functiondef(p.oid) like '%user_mutes%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='list_feed'),
    'list_feed отбрасывает mute_posts'

  -- ── 7. Уведомления ──────────────────────────────────────────────────────
  union all select 60, 'тип уведомления — text с CHECK, а не enum',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='notifications'
        and column_name='type' and data_type='text'
    ),
    'расширять список значений можно обычной правкой ограничения'

  union all select 61, 'CHECK знает новые типы событий',
    exists (
      select 1 from pg_constraint
      where conname='notifications_type_known'
        and pg_get_constraintdef(oid) like '%FOLLOW_REQUEST%'
        and pg_get_constraintdef(oid) like '%MESSAGE_REQUEST%'
    ),
    'constraint notifications_type_known'

  union all select 62, 'push_notification недоступна клиенту',
    not exists (
      select 1 from information_schema.role_routine_grants
      where routine_schema='public' and routine_name='push_notification'
        and grantee in ('anon','authenticated')
    ),
    'уведомление нельзя подделать от чужого имени'

  union all select 63, 'все новые RPC закрыты для anon',
    not exists (
      select 1 from information_schema.role_routine_grants
      where routine_schema='public' and grantee='anon'
        and routine_name in (
          'follow_user','unfollow_user','accept_follow_request','decline_follow_request',
          'remove_follower','set_account_privacy','set_message_policy','set_close_friend',
          'set_restricted','set_user_mute','set_diary_access','block_user','unblock_user',
          'my_privacy','list_relation','list_follow_requests','get_message_permission'
        )
    ),
    'анонимный доступ к социальным действиям закрыт'

  -- ── 8. Индексы под новые запросы ────────────────────────────────────────
  union all select 70, 'индексы просьб на месте',
    (select count(*) from pg_indexes
      where schemaname='public' and tablename='follow_requests') >= 2,
    'follow_requests: по адресату и по просителю'

  union all select 71, 'индекс поиска по имени на месте',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='profiles_display_name_lower_idx'),
    'без него поиск по имени читал бы profiles целиком'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНАЯ МАТРИЦА: ТРИ АККАУНТА, НАСТОЯЩИЕ СЕССИИ
--
-- Всё выше выполнено от service_role, для которого RLS не применяется. Это
-- значит, что ни одна строка выше НЕ ДОКАЗЫВАЕТ изоляцию. Доказывают только
-- запросы из реальных пользовательских сессий (вход в приложении или
-- supabase-js с ключом anon и токеном человека).
--
-- Участники: A, B, C. Ни один не должен быть service_role.
--
-- 1. ОТКРЫТЫЙ АККАУНТ
--    B открыт. A: select follow_user('<B>')            → 'following'
--    A: select * from list_posts('<B>')                → записи B видны
--
-- 2. ЗАКРЫТЫЙ АККАУНТ
--    B: select set_account_privacy(true);
--    C: select follow_user('<B>')                      → 'requested'
--    C: select * from get_relationship('<B>')          → request_sent = true,
--                                                        following = false,
--                                                        can_view_content = false
--    C: select * from list_posts('<B>')                → 0 строк
--    C: select * from posts where user_id='<B>'        → 0 строк (прямой обход)
--    C: select * from list_followers('<B>')            → 0 строк
--
-- 3. ОДОБРЕНИЕ
--    B: select accept_follow_request('<C>');
--    C: select * from list_posts('<B>')                → записи появились
--    C: select * from follow_requests                  → просьбы больше нет
--
-- 4. ОТКАЗ
--    A просится к B (закрытому). B: select decline_follow_request('<A>');
--    A: get_relationship('<B>') → request_sent = false, following = false
--
-- 5. УДАЛЕНИЕ ПОДПИСЧИКА
--    B: select remove_follower('<C>');
--    C: list_posts('<B>')                              → снова 0 строк
--    C может попроситься заново.
--
-- 6. ЧУЖОЙ ЗАПРОС НЕЛЬЗЯ ОДОБРИТЬ ЗА ДРУГОГО
--    A: select accept_follow_request('<C>')            → 'gone'
--       (функция работает ТОЛЬКО со своими просьбами: адресат — auth.uid())
--
-- 7. БЛОКИРОВКА
--    B: select block_user('<A>');
--    A: select * from search_users('<ник B>')          → 0 строк
--    A: select follow_user('<B>')                      → 'blocked'
--    A: select * from user_profile('<B>')              → 0 строк
--    A: select * from posts where user_id='<B>'        → 0 строк
--    A: select * from messages where sender='<B>'      → 0 строк
--
-- 8. ОГРАНИЧЕНИЕ
--    B: select set_restricted('<C>', true);
--    C: select * from get_relationship('<B>')          → restricted НЕ виден
--                                                        (это поле про МОИ
--                                                         ограничения, не про
--                                                         чужие)
--    C: select get_message_permission('<C>','<B>')     → 'request'
--    C: select can_see_activity('<B>')                 → false
--
-- 9. БЛИЗКИЕ ДРУЗЬЯ
--    B: select set_close_friend('<A>', true);
--    B создаёт запись с visibility='close_friends'.
--    A: list_posts('<B>')                              → запись видна
--    C: list_posts('<B>')                              → записи нет
--    C: select * from close_friends                    → 0 строк (чужой список
--                                                        не читается вовсе)
--    A: select * from close_friends                    → 0 строк (даже тот, кого
--                                                        добавили, списка не видит)
--
-- 10. ДНЕВНИК НЕ ОТКРЫВАЕТСЯ ВЗАИМНОЙ ПОДПИСКОЙ
--     A и B подписаны друг на друга. B: select set_diary_visibility('private');
--     A: select * from app_state where user_id='<B>'   → 0 строк
--     A: select visible_diary('<B>')                   → null
--     B: select set_diary_access('<A>', true);
--     A: select visible_diary('<B>')                   → дневник виден
--        (поимённый доступ работает поверх настройки — и только он)
--
-- 11. ЗАГЛУШЕНИЕ НЕ ТРОГАЕТ ПРАВА
--     A: select set_user_mute('<B>', true, false);
--     A: select * from list_feed()                     → записей B нет
--     A: select * from list_posts('<B>')               → записи B ЕСТЬ
--        (заглушение прячет ленту, а не отбирает доступ)
--     B: get_relationship('<A>')                       → ничего не изменилось
--
-- 12. ПОДДЕЛКА ОТ ЧУЖОГО ИМЕНИ
--     A: insert into follows (follower_id, following_id)
--        values ('<B>','<C>');                         → ошибка RLS
--     A: insert into close_friends (owner_id, user_id)
--        values ('<B>','<A>');                         → ошибка RLS
--     A: insert into notifications (...);              → ошибка RLS
--     A: update profiles set is_private=false where user_id='<B>';  → 0 строк
-- ═══════════════════════════════════════════════════════════════════════════
