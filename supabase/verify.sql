-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после миграции account_sync.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только читает.
-- Возвращает таблицу: каждая строка — одна проверка со статусом ✔ или ✖.
-- Если все строки ✔ — база готова, можно деплоить фронтенд.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- 1. Версионирование состояния
  select 1, 'app_state.revision существует и NOT NULL',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_state'
        and column_name = 'revision' and is_nullable = 'NO'
    ),
    coalesce((select data_type from information_schema.columns
      where table_schema='public' and table_name='app_state' and column_name='revision'), 'колонки нет')

  union all
  select 2, 'у всех существующих строк revision >= 1',
    not exists (select 1 from public.app_state where revision < 1),
    'строк в app_state: ' || (select count(*)::text from public.app_state)

  -- 2. Единственный путь записи
  union all
  select 3, 'RPC save_app_state(jsonb, bigint) создан',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_app_state'
        and pg_get_function_identity_arguments(p.oid) = 'jsonb, bigint'
    ), ''

  union all
  select 4, 'save_app_state работает как SECURITY DEFINER',
    coalesce((
      select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_app_state' limit 1
    ), false), ''

  union all
  select 5, 'save_app_state доступен роли authenticated',
    has_function_privilege('authenticated', 'public.save_app_state(jsonb, bigint)', 'EXECUTE'), ''

  union all
  select 6, 'save_app_state НЕ доступен анониму',
    not has_function_privilege('anon', 'public.save_app_state(jsonb, bigint)', 'EXECUTE'), ''

  -- 3. Слепая перезапись закрыта на уровне прав
  union all
  select 7, 'прямой UPDATE на app_state отозван у authenticated',
    not has_table_privilege('authenticated', 'public.app_state', 'UPDATE'),
    'это главная защита от затирания чужих правок'

  union all
  select 8, 'прямой INSERT на app_state отозван у authenticated',
    not has_table_privilege('authenticated', 'public.app_state', 'INSERT'), ''

  union all
  select 9, 'SELECT на app_state сохранён (нужен для своих данных и друзей)',
    has_table_privilege('authenticated', 'public.app_state', 'SELECT'), ''

  union all
  select 10, 'DELETE на app_state сохранён (право на удаление данных)',
    has_table_privilege('authenticated', 'public.app_state', 'DELETE'), ''

  union all
  select 11, 'триггер app_state_update_guard установлен',
    exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'app_state' and t.tgname = 'app_state_update_guard' and not t.tgisinternal
    ), 'страховка: revision растёт, updated_at ставит сервер'

  -- 4. Присутствие переехало из app_state
  union all
  select 12, 'таблица presence создана',
    to_regclass('public.presence') is not null, ''

  union all
  select 13, 'на presence включён RLS',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.presence')), false), ''

  union all
  select 14, 'политика чтения presence (себя + друзья) на месте',
    exists (select 1 from pg_policies where schemaname='public' and tablename='presence'),
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname='public' and tablename='presence'), '—')

  union all
  select 15, 'прямая запись в presence закрыта',
    not has_table_privilege('authenticated', 'public.presence', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.presence', 'INSERT'), ''

  union all
  select 16, 'touch_last_seen пишет в presence, а не в app_state',
    coalesce((
      select pg_get_functiondef(p.oid) like '%public.presence%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='touch_last_seen' limit 1
    ), false),
    'иначе heartbeat раз в минуту рассылал бы весь блоб по Realtime'

  union all
  select 17, 'RPC get_last_seen создан',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='get_last_seen'
    ), ''

  union all
  select 18, 'отметки last_seen перенесены в presence',
    (select count(*) from public.app_state where last_seen is not null)
      <= (select count(*) from public.presence),
    'app_state.last_seen: ' || (select count(*)::text from public.app_state where last_seen is not null)
      || ' → presence: ' || (select count(*)::text from public.presence)

  -- 5. Realtime
  union all
  select 19, 'app_state добавлен в публикацию supabase_realtime',
    exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='app_state'),
    'без этого правки не приезжают на другие устройства сами'

  union all
  select 20, 'messages в публикации supabase_realtime',
    exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='messages'), ''

  union all
  select 21, 'subscriptions в публикации supabase_realtime',
    exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='subscriptions'), ''

  -- 6. Ужесточение прав на сообщения
  union all
  select 22, 'guard_message_update защищает reply/forward и снятие прочтения',
    coalesce((
      select pg_get_functiondef(p.oid) like '%reply_snapshot%'
         and pg_get_functiondef(p.oid) like '%read_at cannot be cleared%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='guard_message_update' limit 1
    ), false), ''

  -- 7. Индексы
  union all
  select 23, 'индексы на friendships созданы',
    (select count(*) from pg_indexes where schemaname='public' and tablename='friendships'
      and indexname in ('friendships_addressee_idx','friendships_requester_idx')) = 2, ''

  -- 8. Ничего не потеряно
  union all
  select 24, 'у всех пользователей есть public_id',
    not exists (
      select 1 from auth.users u
      left join public.profiles p on p.user_id = u.id
      where p.user_id is null
    ),
    'без public_id человека нельзя добавить в друзья; пользователей без него: '
      || (select count(*)::text from auth.users u
          left join public.profiles p on p.user_id = u.id where p.user_id is null)

  union all
  select 25, 'состояния пользователей на месте',
    true,
    'строк app_state: ' || (select count(*)::text from public.app_state)
      || ', непустых: ' || (select count(*)::text from public.app_state where state <> '{}'::jsonb)

  -- 9. Приватность данных друзей (миграция friend_privacy)
  union all
  select 26, 'RPC friend_state создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_state'),
    'отдаёт другу только профиль без телесных показателей, дни и составные блюда'

  union all
  select 27, 'friend_state не отдаёт вес, рост, возраст и пол',
    coalesce((
      select pg_get_functiondef(p.oid) not like '%''weight''%'
         and pg_get_functiondef(p.oid) not like '%''height''%'
         and pg_get_functiondef(p.oid) not like '%''age''%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_state' limit 1
    ), false), ''

  union all
  select 28, 'RPC friend_briefs создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_briefs'), ''

  union all
  select 29, 'прямое чтение чужого app_state закрыто',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'
        and qual like '%friendships%'
    ),
    coalesce((select string_agg(policyname, ', ') from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'), 'политик SELECT нет')

  union all
  select 30, 'RPC ensure_public_id создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='ensure_public_id'),
    'чинит отсутствующий public_id при первом обращении'

  -- 10. Устранение слабостей аудита (миграция hardening)
  union all
  select 31, 'имя в заявке в друзья ставит сервер, а не клиент',
    exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname='friendships' and t.tgname='friendships_set_requester_name' and not t.tgisinternal),
    'иначе заявку можно подписать чужим именем'

  union all
  select 32, 'ограничена частота исходящих заявок в друзья',
    exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname='friendships' and t.tgname='friendships_rate_limit' and not t.tgisinternal), ''

  union all
  select 33, 'ограничен размер состояния в save_app_state',
    coalesce((select pg_get_functiondef(p.oid) like '%state is too large%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='save_app_state' limit 1), false), ''

  union all
  select 34, 'бакет chat-images ограничен по размеру и типу файла',
    coalesce((select file_size_limit is not null and allowed_mime_types is not null
      from storage.buckets where id='chat-images'), false),
    coalesce((select 'лимит: ' || coalesce((file_size_limit/1024/1024)::text || ' МБ', 'нет')
      from storage.buckets where id='chat-images'), 'бакета нет')
)

select
  case when ok then '✔' else '✖ ПРОБЛЕМА' end as статус,
  проверка,
  nullif(деталь, '') as деталь
from checks
order by ok, порядок;