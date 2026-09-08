-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка приватности.
--
-- Отдельный файл от verify_social_v2, потому что отвечает на другой вопрос.
-- Тот проверяет, что СТРУКТУРА социального графа на месте; этот — что ни один
-- путь к чувствительным данным не открыт мимо правил.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет.
--
-- ⚠ От service_role RLS не применяется. Здесь проверяется НАЛИЧИЕ и ФОРМА
-- правил, а не их работа. Доказательство изоляции — только из реальных сессий.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Ни одной таблицы с чужими данными без RLS ────────────────────────
  select 1, 'RLS включён на КАЖДОЙ таблице public',
    not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    ),
    coalesce((
      select string_agg(c.relname, ', ')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    ), 'все таблицы защищены')

  -- ── 2. Нет политик «всем авторизованным» на приватных данных ────────────
  union all select 2, 'нет политики «читать всё» на приватных таблицах',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and cmd='SELECT'
        and tablename in (
          'app_state','messages','conversations','conversation_members',
          'close_friends','restricted_users','user_mutes','diary_access',
          'follow_requests','notifications','message_grants','presence',
          'message_deletions','message_views'
        )
        and (qual = 'true' or qual like '%auth.role() = ''authenticated''%')
    ),
    'приватные таблицы не отдаются по факту входа'

  -- ── 3. Дневник питания ──────────────────────────────────────────────────
  union all select 10, 'чтение app_state решает can_view_diary',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'
        and qual like '%can_view_diary%'
    ),
    'одна функция на всё правило доступа к дневнику'

  union all select 11, 'у app_state нет второй SELECT-политики',
    -- Две политики складываются по ИЛИ: вторая, более мягкая, молча отменила
    -- бы первую. Для дневника это самая дорогая ошибка в приложении.
    (select count(*) from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT') = 1,
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'), '—')

  union all select 12, 'закрытый аккаунт перекрывает настройку дневника',
    (select pg_get_functiondef(p.oid) like '%can_view_profile_content%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='can_view_diary'),
    'иначе закрывший аккаунт продолжал бы отдавать дневник всем'

  union all select 13, 'выборка дневника отдаёт ограниченный набор полей',
    (select pg_get_functiondef(p.oid) not like '%select a.state%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='visible_diary'),
    'вес, цели, настроение и заметки дня не отдаются никому'

  union all select 14, 'присутствие видно по своему правилу',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='can_see_activity'),
    'can_see_activity: взаимность + ограничение + блокировка'

  -- ── 4. Записи ───────────────────────────────────────────────────────────
  union all select 20, 'у posts ровно одна SELECT-политика',
    (select count(*) from pg_policies
      where schemaname='public' and tablename='posts' and cmd='SELECT') = 1,
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname='public' and tablename='posts' and cmd='SELECT'), '—')

  union all select 21, 'приватная запись не видна никому, кроме автора',
    (select qual not like '%''private''%'
       from pg_policies
      where schemaname='public' and tablename='posts' and cmd='SELECT' limit 1),
    'уровень private отсутствует среди разрешающих веток'

  union all select 22, 'ответы и реакции наследуют права на запись',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='post_comments' and cmd='SELECT'
        and qual like '%can_view_post%'
    ),
    'нельзя прочитать ответы к записи, которую не видишь'

  -- ── 5. Профиль ──────────────────────────────────────────────────────────
  union all select 30, 'прямое чтение profiles закрыто чужим',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles' and cmd='SELECT'
        and qual like '%auth.uid()%'
    ),
    'публичная карточка отдаётся только через user_cards / user_profile'

  union all select 31, 'клиент не пишет в profiles напрямую',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles' and cmd in ('INSERT','UPDATE','DELETE')
    ),
    'настройки приватности меняются только через RPC'

  union all select 32, 'настройки приватности меняются только своим RPC',
    not exists (
      select 1 from information_schema.role_routine_grants
      where routine_schema='public' and grantee='anon'
        and routine_name in ('set_account_privacy','set_message_policy',
                             'set_diary_visibility','set_activity_visibility',
                             'set_read_receipts','set_group_invites')
    ),
    'анониму настройки недоступны'

  -- ── 6. Уведомления нельзя подделать ─────────────────────────────────────
  union all select 40, 'у notifications нет INSERT-политики',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='notifications' and cmd='INSERT'
    ),
    'событие от чужого имени создать нельзя'

  union all select 41, 'подмена содержимого события защищена триггером',
    exists (select 1 from pg_trigger where tgname='notifications_update_guard'),
    'получателю разрешено менять только read_at'

  -- ── 7. Хранилище ────────────────────────────────────────────────────────
  union all select 50, 'вложения личной переписки в ЗАКРЫТОМ бакете',
    exists (select 1 from storage.buckets where id='dm-media' and public = false),
    'публичный бакет границей доступа не является'

  union all select 51, 'публичные бакеты ограничены по типу и размеру',
    not exists (
      select 1 from storage.buckets
      where id in ('chat-images','post-images')
        and (file_size_limit is null or allowed_mime_types is null)
    ),
    coalesce((select string_agg(id || ': ' || file_size_limit::text, ', ')
              from storage.buckets where id in ('chat-images','post-images')), '—')

  union all select 52, 'заливать можно только в свою папку',
    (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects' and cmd='INSERT'
        and with_check like '%auth.uid()%') >= 3,
    'chat-images, post-images, dm-media'

  -- ── 8. Согласованность данных с правилами ───────────────────────────────
  union all select 60, 'нет доступа к дневнику у заблокированных',
    not exists (
      select 1 from public.diary_access d
      join public.blocks b
        on (b.blocker_id=d.owner_id and b.blocked_id=d.user_id)
        or (b.blocker_id=d.user_id and b.blocked_id=d.owner_id)
    ),
    'apply_block чистит diary_access в обе стороны'

  union all select 61, 'нет заглушений и ограничений самого себя',
    not exists (select 1 from public.user_mutes where owner_id = target_id)
    and not exists (select 1 from public.restricted_users where owner_id = restricted_id),
    'CHECK-ограничения на месте'

  union all select 62, 'у каждого профиля заполнены настройки приватности',
    not exists (
      select 1 from public.profiles
      where is_private is null or diary_visibility is null
         or msg_from_following is null or msg_from_others is null
    ),
    'NOT NULL + значения по умолчанию'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- ЧТО ПРОВЕРИТЬ РУКАМИ (две реальные сессии, НЕ service_role)
--
-- Самое ценное здесь — попытки ОБОЙТИ интерфейс. Все они должны отказывать:
--
--   select * from app_state where user_id = '<чужой>';        → 0 строк
--   select * from messages where conversation_id = '<чужой>'; → 0 строк
--   select * from close_friends;                              → только свои
--   select * from restricted_users;                           → только свои
--   select * from posts where visibility = 'private'
--     and user_id <> auth.uid();                              → 0 строк
--   select * from profiles where user_id <> auth.uid();       → 0 строк
--   insert into notifications (...);                          → ошибка RLS
--   insert into conversation_members (...);                   → ошибка RLS
--   update profiles set is_private = false
--     where user_id = '<чужой>';                              → 0 строк
--   update conversation_members set role='owner'
--     where user_id = auth.uid();                             → ошибка триггера
--   select accept_follow_request('<чужая просьба>');          → 'gone'
--
-- И один положительный контроль — чтобы убедиться, что проверяем живую
-- сессию, а не пустую базу:
--
--   select * from app_state where user_id = auth.uid();       → 1 строка
-- ═══════════════════════════════════════════════════════════════════════════
