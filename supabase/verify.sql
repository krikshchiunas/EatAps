-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка базы после установки и миграций.
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
  select 24, 'у всех пользователей есть профиль с ником',
    not exists (
      select 1 from auth.users u
      left join public.profiles p on p.user_id = u.id
      where p.user_id is null or p.username is null
    ),
    'без ника человека нельзя ни найти, ни показать; пользователей без него: '
      || (select count(*)::text from auth.users u
          left join public.profiles p on p.user_id = u.id
          where p.user_id is null or p.username is null)

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
  select 30, 'колонка public_id удалена вместе со всей идеей кодов',
    not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='public_id'
    ),
    'единственный адрес человека — ник'

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

  -- 11. Реакции на сообщения (двойной тап → 🥕)
  union all
  select 35, 'колонка messages.reactions существует',
    exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='messages' and column_name='reactions'), ''

  union all
  select 36, 'RPC toggle_message_reaction создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='toggle_message_reaction'), ''

  union all
  select 37, 'toggle_message_reaction доступен authenticated, не anon',
    has_function_privilege('authenticated', 'public.toggle_message_reaction(uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.toggle_message_reaction(uuid, text)', 'EXECUTE'), ''

  union all
  select 38, 'guard_message_update ограничивает получателя собственным ключом реакции',
    coalesce((select pg_get_functiondef(p.oid) like '%Only your own reaction key can change%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='guard_message_update' limit 1), false),
    'иначе прямой запрос в обход RPC мог бы дописать реакцию под чужим ключом'

  -- 12. Непредсказуемые публичные ID
  union all
  select 39, 'ник выдаётся при регистрации, а не после первого входа',
    coalesce((
      select pg_get_functiondef(p.oid) like '%claim_username%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='handle_new_user' limit 1
    ), false),
    'иначе новый профиль был бы невидим в поиске до первой правки'

  union all
  select 40, 'последовательность public_id_seq удалена',
    to_regclass('public.public_id_seq') is null,
    'оставленная последовательность — готовый механизм выдачи предсказуемых ID'

  union all
  select 41, 'формат ника закреплён ограничением',
    exists (select 1 from pg_constraint
      where conname = 'profiles_username_format'
        and conrelid = 'public.profiles'::regclass),
    'без него в базу попал бы ник в верхнем регистре, и «Denis» с «denis» стали бы разными'

  union all
  select 42, 'ники уникальны',
    exists (select 1 from pg_indexes
      where schemaname='public' and tablename='profiles' and indexname='profiles_username_key'),
    'всего ников: ' || (select count(distinct username)::text from public.profiles)

  union all
  select 43, 'find_user_by_username нормализует ввод на сервере',
    coalesce((
      select pg_get_functiondef(p.oid) like '%lower(%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='find_user_by_username' limit 1
    ), false),
    'регистр и ведущую «@» снимает база, а не клиент'

  -- 13. Публичный профиль и «Мои мысли»
  union all
  select 44, 'friend_state отдаёт списки «не ем» и «люблю»',
    coalesce((
      select pg_get_functiondef(p.oid) like '%noGos%'
         and pg_get_functiondef(p.oid) like '%toGos%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_state' limit 1
    ), false),
    'без этого друг видит профиль без того, что человек ест и не ест'

  union all
  select 45, 'friend_state по-прежнему НЕ отдаёт вес, рост и возраст',
    coalesce((
      select pg_get_functiondef(p.oid) not like '%''weight''%'
         and pg_get_functiondef(p.oid) not like '%''height''%'
         and pg_get_functiondef(p.oid) not like '%''age''%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='friend_state' limit 1
    ), false),
    'список полей белый: новый экран не должен был расширить его молча'

  union all
  select 46, 'таблицы posts / post_reactions / post_comments созданы',
    to_regclass('public.posts') is not null
      and to_regclass('public.post_reactions') is not null
      and to_regclass('public.post_comments') is not null,
    'мысли живут вне app_state — у них своё версионирование и свои права'

  union all
  select 47, 'RLS включена на всех трёх таблицах мыслей',
    coalesce((
      select bool_and(c.relrowsecurity)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('posts', 'post_reactions', 'post_comments')
    ), false),
    'без RLS любая строка читается любым авторизованным'

  union all
  select 48, 'пост виден только автору и принятому другу',
    coalesce((
      select pg_get_expr(pol.polqual, pol.polrelid) like '%friendships%'
      from pg_policy pol
      where pol.polrelid = 'public.posts'::regclass and pol.polname = 'posts select'
    ), false),
    'тот же круг, что у app_state: публичных постов в приложении нет'

  union all
  select 49, 'реакцию видно ТОЛЬКО свою',
    coalesce((
      select pg_get_expr(pol.polqual, pol.polrelid) like '%auth.uid()%'
         and pg_get_expr(pol.polqual, pol.polrelid) not like '%friendships%'
      from pg_policy pol
      where pol.polrelid = 'public.post_reactions'::regclass
        and pol.polname = 'post reactions select own'
    ), false),
    'иначе по чужому посту читается поимённый список отреагировавших'

  union all
  select 50, 'toggle_post_reaction работает от auth.uid(), а не от присланного id',
    coalesce((
      select p.prosecdef
         and pg_get_function_identity_arguments(p.oid) = 'uuid, text'
         and pg_get_functiondef(p.oid) like '%auth.uid()%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='toggle_post_reaction' limit 1
    ), false),
    'реакцию нельзя поставить под чужим именем'

  union all
  select 51, 'реакции ограничены списком 🥕/🥦',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.post_reactions'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%reaction%'
    ),
    'поле реакции — не свободный ввод в чужую строку'

  union all
  select 52, 'комментарий нельзя отредактировать (нет UPDATE-политики)',
    not exists (
      select 1 from pg_policy
      where polrelid = 'public.post_comments'::regclass and polcmd = 'w'
    ),
    'отсутствие политики надёжнее списка разрешённых полей'

  union all
  select 53, 'list_posts доступен authenticated и закрыт для анонима',
    has_function_privilege('authenticated', 'public.list_posts(uuid, int, timestamptz)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.list_posts(uuid, int, timestamptz)', 'EXECUTE'),
    ''

  union all
  select 54, 'бакет post-images ограничен по размеру и типу файла',
    coalesce((
      select file_size_limit is not null and allowed_mime_types is not null
      from storage.buckets where id = 'post-images'
    ), false),
    'иначе хранилище проекта превращается в бесплатный файлообменник'

  -- 12. Модерация: баны и обращения в поддержку
  union all
  select 55, 'таблица bans создана и защищена RLS',
    coalesce((select relrowsecurity from pg_class where oid = 'public.bans'::regclass), false),
    'банов в базе: ' || coalesce((select count(*)::text from public.bans), '—')

  union all
  select 56, 'клиент не может выдать или снять бан сам себе',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'bans' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'политик записи быть не должно вовсе — пишет только service_role'

  union all
  select 57, 'is_banned доступен authenticated и закрыт для анонима',
    has_function_privilege('authenticated', 'public.is_banned(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.is_banned(uuid)', 'EXECUTE'),
    ''

  union all
  select 58, 'support_messages: клиент не может писать в обход лимита',
    coalesce((select relrowsecurity from pg_class where oid = 'public.support_messages'::regclass), false)
      and not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'support_messages' and cmd = 'INSERT'
      ),
    'вставка только через api/support.js, где проверяется «раз в час»'

  union all
  select 59, 'индекс под проверку частоты обращений на месте',
    exists (select 1 from pg_indexes where schemaname='public' and indexname='support_user_time_idx'),
    'без него лимит превращается в скан всей таблицы'

  -- 13. Роль тренера
  union all
  select 60, 'таблицы coaches и coach_links созданы',
    to_regclass('public.coaches') is not null and to_regclass('public.coach_links') is not null,
    'тренеров одобрено: ' || coalesce((select count(*)::text from public.coaches), '—')

  union all
  select 61, 'пригласить тренера может только сам клиент',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='coach_links' and cmd='INSERT'
        and with_check like '%auth.uid() = client%'
    ),
    'иначе чужой человек подписался бы на ваш дневник сам'

  union all
  select 62, 'приглашать можно только одобренного тренера',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='coach_links' and cmd='INSERT'
        and with_check like '%coaches%'
    ),
    'проверка членства в coaches должна быть в политике, а не в интерфейсе'

  union all
  select 63, 'политика чтения app_state покрывает себя, друзей и тренера',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'
        and qual like '%friendships%' and qual like '%coach_links%'
    ),
    'права друзей не должны потеряться при добавлении тренера'

  union all
  select 64, 'day_comments: писать может только автор от своего имени',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='day_comments' and cmd='INSERT'
        and with_check like '%auth.uid() = author%'
    ),
    ''

  -- 14. Челленджи
  union all
  select 65, 'таблицы челленджей созданы',
    to_regclass('public.challenges') is not null
      and to_regclass('public.challenge_members') is not null
      and to_regclass('public.challenge_days') is not null,
    'челленджей: ' || coalesce((select count(*)::text from public.challenges), '—')

  union all
  select 66, 'in_challenge существует — без неё политики зациклятся',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='in_challenge'
    ),
    'политика на challenge_members читала бы саму себя'

  union all
  select 67, 'отметку о зачёте можно поставить только себе',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='challenge_days' and cmd='INSERT'
        and with_check like '%auth.uid() = user_id%'
    ),
    'иначе очки проставлялись бы за соседа'

  union all
  select 68, 'триггер не даёт засчитывать дни вне срока челленджа',
    exists (select 1 from pg_trigger where tgname = 'challenge_day_guard' and not tgisinternal),
    'без него очки добирались бы задним числом за пределами окна'

  union all
  select 69, 'challenge_board закрыт для анонима',
    has_function_privilege('authenticated', 'public.challenge_board(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.challenge_board(uuid)', 'EXECUTE'),
    ''

  -- 12. Расход токенов AI
  union all
  select 70, 'таблица ai_usage существует',
    exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='ai_usage'),
    'без неё ассистент не запустится: лимит некуда писать'

  union all
  select 71, 'на ai_usage включён RLS',
    coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='ai_usage'), false),
    ''

  union all
  select 72, 'клиент может читать только свою строку расхода',
    exists (select 1 from pg_policies
      where schemaname='public' and tablename='ai_usage' and cmd='SELECT'
        and qual like '%auth.uid() = user_id%'),
    ''

  union all
  select 73, 'клиенту нельзя писать в ai_usage',
    not exists (select 1 from pg_policies
      where schemaname='public' and tablename='ai_usage' and cmd in ('INSERT','UPDATE','ALL')),
    'иначе месячный лимит обнулялся бы одним запросом из консоли браузера'

  union all
  select 74, 'RPC ai_usage_add создан',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='ai_usage_add'),
    'атомарный инкремент: без него параллельные запросы затирают расход'

  union all
  -- Права спрашиваем через oid из pg_proc, а не по строке сигнатуры:
  -- has_function_privilege('...текст...') БРОСАЕТ ошибку, если функции нет, и
  -- тогда вся самопроверка падает вместо того, чтобы показать ✖ в одной строке.
  select 75, 'ai_usage_add закрыт для клиента — вызывает только сервер',
    coalesce((
      select not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ai_usage_add'
      limit 1
    ), false),
    ''

  union all
  -- Ловушка обновления: create or replace НЕ заменяет функцию с другим числом
  -- аргументов, а создаёт вторую перегрузку рядом. Тогда вызов с тремя
  -- параметрами становится неоднозначным, и учёт расхода падает целиком.
  select 76, 'ai_usage_add существует ровно в одном экземпляре',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ai_usage_add') = 1,
    'найдено версий: ' || (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'ai_usage_add')

  -- 13. Промокоды
  union all
  select 77, 'таблицы promo_codes и promo_grants существуют',
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name in ('promo_codes','promo_grants')) = 2,
    ''

  union all
  select 78, 'на обеих таблицах промокодов включён RLS',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('promo_codes','promo_grants')
        and c.relrowsecurity) = 2,
    ''

  union all
  select 79, 'список кодов закрыт от клиента наглухо',
    not exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'promo_codes'),
    'при любой политике SELECT все действующие коды выгружались бы одним запросом'

  union all
  select 80, 'свои выдачи человек видит, чужие — нет',
    exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'promo_grants' and cmd = 'SELECT'
        and qual like '%auth.uid() = user_id%')
    and not exists (select 1 from pg_policies
      where schemaname = 'public' and tablename = 'promo_grants'
        and cmd in ('INSERT','UPDATE','ALL')),
    'выдачу создаёт только redeem_promo'

  union all
  select 81, 'число гашений не может превысить лимит кода',
    exists (select 1 from pg_constraint
      where conname = 'promo_codes_uses_within_limit'),
    'ограничение БД страхует на случай ошибки в функции гашения'

  union all
  select 82, 'redeem_promo доступен вошедшему и закрыт для анонима',
    coalesce((
      select has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_promo'
      limit 1
    ), false),
    ''

  -- 14. Панель управления доступом
  union all
  select 83, 'представления admin_subscriptions и admin_promo_codes созданы',
    (select count(*) from information_schema.views
      where table_schema = 'public'
        and table_name in ('admin_subscriptions','admin_promo_codes')) = 2,
    ''

  union all
  -- Самая опасная строка во всей самопроверке: представление читает auth.users,
  -- и одна лишняя выдача прав превращает его в выгрузку почт всех пользователей.
  select 84, 'панель закрыта от клиента — почты пользователей не утекают',
    not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('admin_subscriptions','admin_promo_codes')
        and grantee in ('anon','authenticated')
    ),
    'иначе любой вошедший выгрузит список всех пользователей с почтами'

  union all
  select 85, 'issue_promo закрыт для клиента — коды выпускает только владелец',
    coalesce((
      select not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'issue_promo'
      limit 1
    ), false),
    'иначе пользователь выпишет себе AI+ на десять лет'
)

select
  case when ok then '✔' else '✖ ПРОБЛЕМА' end as статус,
  проверка,
  nullif(деталь, '') as деталь
from checks
order by ok, порядок;