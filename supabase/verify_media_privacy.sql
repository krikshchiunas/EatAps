-- ═══════════════════════════════════════════════════════════════════════════
-- Проверка после миграций 2026-09-12.
--
-- Выполнить в Supabase → SQL Editor ПОСЛЕ применения setup_all.sql либо
-- отдельных миграций. Все строки должны быть ✔.
--
-- Проверяется не «функция существует», а СВОЙСТВО: закрыт ли бакет, стоит ли
-- предикат на чтении, отозваны ли права у роли, которой их иметь не должно.
-- Проверка «объект есть» бесполезна: дыра как раз и выглядит как объект,
-- который есть, но ничего не проверяет.
-- ═══════════════════════════════════════════════════════════════════════════

with checks as (

  -- ── 1. Бакеты вложений закрыты ────────────────────────────────────────────
  select 1 as n, 'бакеты chat-images и post-images закрыты' as what,
    not exists (
      select 1 from storage.buckets
      where id in ('chat-images', 'post-images') and public = true
    ) as ok,
    coalesce((select string_agg(id || '=' || public::text, ', ')
      from storage.buckets where id in ('chat-images', 'post-images', 'dm-media')), 'бакетов нет') as detail

  -- ── 2. У чтения вложений есть предикат ────────────────────────────────────
  -- Прежняя политика выглядела так: using (bucket_id = 'chat-images') — то есть
  -- отдавала файл кому угодно. Требуем, чтобы в условии была наша функция.
  union all select 2, 'чтение chat-images проверяет участника переписки',
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd = 'SELECT'
        and qual like '%can_read_chat_image%'
    ),
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd = 'SELECT' and qual like '%chat-images%'), 'политики нет')

  union all select 3, 'чтение post-images проверяет видимость записи',
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd = 'SELECT'
        and qual like '%can_read_post_image%'
    ),
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd = 'SELECT' and qual like '%post-images%'), 'политики нет')

  -- ── 3. Путь файла выводится из сохранённого адреса ────────────────────────
  union all select 4, 'messages.image_path и posts.image_path вычисляемые',
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'messages' and column_name = 'image_path')
          or (table_name = 'posts' and column_name = 'image_path'))
        and is_generated = 'ALWAYS') = 2,
    coalesce((select string_agg(table_name || '.' || column_name || ' ' || is_generated, ', ')
      from information_schema.columns
      where table_schema = 'public' and column_name = 'image_path'), 'колонок нет')

  -- Вычисляемая колонка обязана СОВПАДАТЬ с сохранённым адресом: если хоть
  -- одна строка с картинкой осталась без пути, её файл не откроется никому.
  union all select 5, 'у всех записей с картинкой выведен путь',
    not exists (
      select 1 from public.posts
      where image_url is not null and image_url like '%/post-images/%' and image_path is null
    ),
    coalesce((select count(*)::text || ' записей с картинкой'
      from public.posts where image_url is not null), '0')

  union all select 6, 'у всех сообщений с фото выведен путь',
    not exists (
      select 1 from public.messages
      where image_url is not null and image_url like '%/chat-images/%' and image_path is null
    ),
    coalesce((select count(*)::text || ' сообщений с фото'
      from public.messages where image_url is not null), '0')

  -- ── 3a. Путь вложения принадлежит автору строки ───────────────────────────
  -- Без этой проверки достаточно приложить ЧУЖОЙ путь к своему сообщению
  -- (image_url задаёт клиент!), чтобы получить подпись на чужой файл.
  union all select 14, 'чтение вложений сверяет владельца пути',
    (select count(*) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('can_read_chat_image', 'can_read_post_image')
        and pg_get_functiondef(p.oid) like '%media_path_owner%') = 2,
    coalesce((select string_agg(p.proname, ', ') from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('can_read_chat_image', 'can_read_post_image')
        and pg_get_functiondef(p.oid) not like '%media_path_owner%'), 'обе проверяют — верно')

  union all select 15, 'уборка сверяет владельца пути',
    (select count(*) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('queue_post_image_cleanup', 'queue_message_image_cleanup')
        and pg_get_functiondef(p.oid) like '%media_path_owner%') = 2,
    'иначе подделанный путь приводит к удалению чужого файла'

  -- Ни одной строки, чей путь не подтверждается её же автором. Появление
  -- таких строк означает попытку подделки.
  union all select 16, 'нет записей с чужим путём вложения',
    not exists (
      select 1 from public.posts
      where image_path is not null
        and public.media_path_owner(image_path) is distinct from user_id::text
    )
    and not exists (
      select 1 from public.messages
      where image_path is not null
        and public.media_path_owner(image_path) is distinct from sender::text
    ),
    coalesce((select count(*)::text || ' подозрительных строк' from (
      select 1 from public.posts
        where image_path is not null
          and public.media_path_owner(image_path) is distinct from user_id::text
      union all
      select 1 from public.messages
        where image_path is not null
          and public.media_path_owner(image_path) is distinct from sender::text
    ) x), '0')

  -- ── 4. Служебные функции недоступны клиенту ───────────────────────────────
  -- Клиент не должен уметь ни резервировать лимит AI, ни считать чужие
  -- обращения, ни разбирать очередь удаления.
  union all select 7, 'серверные функции отозваны у роли authenticated',
    not exists (
      select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in (
          'ai_reserve', 'ai_settle', 'ai_reconcile', 'ai_usage_add',
          'stripe_event_claim', 'stripe_event_finish',
          'stripe_subscription_sync', 'stripe_customer_claim',
          'rate_limit_hit', 'enqueue_storage_cleanup', 'push_notification'
        )
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    coalesce((
      select string_agg(p.proname, ', ')
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('ai_reserve', 'ai_settle', 'ai_reconcile', 'ai_usage_add',
          'stripe_event_claim', 'stripe_event_finish', 'stripe_subscription_sync',
          'stripe_customer_claim', 'rate_limit_hit', 'enqueue_storage_cleanup', 'push_notification')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), 'ни одной — верно')

  -- ── 5. Служебные таблицы закрыты ──────────────────────────────────────────
  -- RLS включён и политик нет — значит, для клиента таблица недоступна вовсе.
  union all select 8, 'служебные таблицы закрыты от клиента',
    not exists (
      select 1 from pg_tables t
      where t.schemaname = 'public'
        and t.tablename in ('stripe_webhook_events', 'rate_limits', 'storage_cleanup_queue')
        and (
          t.rowsecurity = false
          or exists (
            select 1 from pg_policies pol
            where pol.schemaname = 'public' and pol.tablename = t.tablename
          )
        )
    ),
    coalesce((select string_agg(tablename || ' rls=' || rowsecurity::text, ', ')
      from pg_tables where schemaname = 'public'
        and tablename in ('stripe_webhook_events', 'rate_limits', 'storage_cleanup_queue')), 'таблиц нет')

  -- ── 6. Журнал AI виден только владельцу ───────────────────────────────────
  union all select 9, 'свои запросы к AI видит только их автор',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'ai_requests'
        and cmd = 'SELECT' and qual like '%auth.uid()%'
    )
    and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'ai_requests' and cmd <> 'SELECT'
    ),
    coalesce((select string_agg(cmd || ':' || policyname, ', ') from pg_policies
      where schemaname = 'public' and tablename = 'ai_requests'), 'политик нет')

  -- ── 7. Защита подписки от переупорядоченной доставки ──────────────────────
  union all select 10, 'в подписке есть время последнего применённого события',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'subscriptions'
        and column_name in ('last_event_created', 'last_event_id')) = 2,
    coalesce((select string_agg(column_name, ', ') from information_schema.columns
      where table_schema = 'public' and table_name = 'subscriptions'
        and column_name like 'last_event%'), 'колонок нет')

  -- ── 8. Старые записи не остались в расширенном круге ──────────────────────
  union all select 11, 'автоматически расширенных записей не осталось',
    not exists (
      select 1 from public.posts
      where visibility_migrated = true and visibility = 'followers'
    ),
    coalesce((select count(*)::text || ' записей ещё с пометкой миграции'
      from public.posts where visibility_migrated), '0')

  -- ── 9. Явный выбор круга отличим от автоматического ───────────────────────
  union all select 12, 'смена круга автором снимает пометку миграции',
    exists (select 1 from pg_trigger where tgname = 'posts_visibility_choice'),
    coalesce((select string_agg(tgname, ', ') from pg_trigger
      where tgrelid = 'public.posts'::regclass and not tgisinternal), 'триггеров нет')

  -- ── 10. Все SECURITY DEFINER с закреплённым search_path ───────────────────
  union all select 13, 'у всех security definer закреплён search_path',
    not exists (
      select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
        )
    ),
    coalesce((
      select string_agg(p.proname, ', ')
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    ), 'ни одной — верно')
)
select
  n as "№",
  case when ok then '✔' else '✖' end as "итог",
  what as "что проверяем",
  detail as "подробности"
from checks
order by n;
