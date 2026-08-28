-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка исправлений по аудиту 2026-08-28.
--
-- Только чтение. Выполнять в Supabase SQL Editor ПОСЛЕ миграции
-- 2026-08-28_audit_fixes.sql. Все строки должны быть ✔.
--
-- Зачем ещё один файл проверок. Главную находку аудита — две select-политики на
-- app_state — ловит проверка №29 в verify.sql, написанная за три недели до
-- того, как дыра появилась. Она всё это время отдавала ✖, и никто не смотрел.
-- Поэтому здесь проверки собраны отдельно и коротко: этот файл прогоняется
-- целиком за секунду, и его не жалко выполнять после каждой миграции.
--
-- ⚠️ Как и остальные verify-файлы, это выполняется от service_role, для
-- которого RLS не действует. Проверки доказывают, что политики и ограничения
-- СУЩЕСТВУЮТ и выглядят как задумано, но не что изоляция работает. Настоящая
-- проверка — двумя реальными сессиями, список в конце файла.
-- ═══════════════════════════════════════════════════════════════════════════

with checks as (

  -- ── 1. app_state: одна политика чтения ───────────────────────────────────
  select 1 as порядок, 'на app_state ровно ОДНА политика SELECT' as проверка,
    (select count(*) from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT') = 1 as ok,
    coalesce((select string_agg(policyname, ' + ') from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'), 'политик нет') as деталь

  union all
  select 2, 'политика app_state не пускает друзей к строке состояния',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'
        and (qual like '%friendships%' or qual like '%is_friend_with%')
    ),
    'друг получает профиль и дневник через friend_state(), а не прямым select'

  union all
  select 3, 'доступ тренера к дневнику сохранён и учитывает блокировку',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='app_state' and cmd='SELECT'
        and qual like '%coach_links%' and qual like '%is_blocked_between%'
    ),
    'блокировка обязана перекрывать связь тренера'

  -- ── 2. Блокировка рвёт связь тренера ─────────────────────────────────────
  union all
  select 4, 'apply_block удаляет coach_links',
    (select prosrc like '%coach_links%' from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='apply_block' limit 1),
    'иначе заблокированный тренер продолжает читать дневник'

  -- ── 3. Поиск людей ───────────────────────────────────────────────────────
  union all
  select 5, 'search_users экранирует спецсимволы LIKE',
    (select prosrc like '%escape%' and prosrc like '%\_%' from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='search_users' limit 1),
    'без экранирования search_users(''___'') совпадает со всеми никами'

  union all
  select 6, 'search_users больше не отдаёт аватар',
    not exists (
      select 1 from information_schema.routines r
      join information_schema.parameters pr on pr.specific_name = r.specific_name
      where r.routine_schema='public' and r.routine_name='search_users'
        and pr.parameter_name = 'avatar_url'
    ),
    'аватар — base64 на десятки килобайт, в поиске его быть не должно'

  -- ── 4. Соцграф не выгружается целиком ────────────────────────────────────
  union all
  select 7, 'follows читается только своими строками',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='follows' and cmd='SELECT'
        and qual like '%auth.uid()%'
    ) and not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='follows' and cmd='SELECT'
        and qual like '%auth.role()%'
    ),
    coalesce((select qual from pg_policies
      where schemaname='public' and tablename='follows' and cmd='SELECT' limit 1), '—')

  union all
  select 8, 'coaches не отдаётся списком любому вошедшему',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='coaches' and cmd='SELECT'
        and qual like '%auth.role()%'
    ),
    'полный список тренеров — тоже выгрузка пользователей'

  -- ── 5. Бан ───────────────────────────────────────────────────────────────
  union all
  select 9, 'бан проверяется при публикации, комментировании, переписке и подписке',
    (select count(*) from pg_policies
      where schemaname='public' and cmd='INSERT'
        and tablename in ('posts','post_comments','messages','follows')
        and with_check like '%is_banned%') = 4,
    (select coalesce(string_agg(tablename, ', '), 'нет ни одной') from pg_policies
      where schemaname='public' and cmd='INSERT'
        and tablename in ('posts','post_comments','messages','follows')
        and with_check like '%is_banned%')

  -- ── 6. Гонка дружбы ──────────────────────────────────────────────────────
  union all
  select 10, 'материализация дружбы идёт под блокировкой пары',
    (select prosrc like '%pg_advisory_xact_lock%' from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='sync_friendship_from_follows' limit 1),
    'без неё одновременная взаимная подписка не создаёт дружбу вовсе'

  union all
  select 11, 'дубль дружбы невозможен на уровне индекса',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='friendships_pair_key'),
    'уникальность на НЕУПОРЯДОЧЕННОЙ паре'

  union all
  select 12, 'таблица дружбы согласована с графом подписок',
    not exists (
      select 1 from public.friendships f
      where not exists (select 1 from public.follows a
                         where a.follower_id=f.requester and a.following_id=f.addressee)
         or not exists (select 1 from public.follows b
                         where b.follower_id=f.addressee and b.following_id=f.requester)
    ),
    'строк дружбы: ' || (select count(*)::text from public.friendships)

  union all
  select 13, 'нет взаимных подписок без строки дружбы',
    not exists (
      select 1 from public.follows f
      join public.follows r on r.follower_id=f.following_id and r.following_id=f.follower_id
      where not exists (
        select 1 from public.friendships x
        where (x.requester=f.follower_id and x.addressee=f.following_id)
           or (x.requester=f.following_id and x.addressee=f.follower_id)
      )
    ),
    'ровно тот перекос, который оставляла гонка'

  -- ── 7. Счётчики постов ───────────────────────────────────────────────────
  union all
  select 14, 'у постов есть денормализованные счётчики',
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='posts'
        and column_name in ('carrots_count','broccoli_count','comments_count')) = 3,
    'вместо трёх подзапросов на каждый пост в ленте'

  union all
  select 15, 'счётчики совпадают с фактическими реакциями и ответами',
    not exists (
      select 1 from public.posts p
      where p.carrots_count  <> (select count(*) from public.post_reactions r where r.post_id=p.id and r.reaction='🥕')
         or p.broccoli_count <> (select count(*) from public.post_reactions r where r.post_id=p.id and r.reaction='🥦')
         or p.comments_count <> (select count(*) from public.post_comments c where c.post_id=p.id)
    ),
    'постов: ' || (select count(*)::text from public.posts)

  union all
  select 16, 'триггеры счётчиков установлены',
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where not t.tgisinternal
        and t.tgname in ('post_reactions_counts','post_comments_counts')) = 2,
    'без них счётчики разойдутся с первой же реакцией'

  -- ── 8. Лимиты AI ─────────────────────────────────────────────────────────
  union all
  select 17, 'таблица ограничения частоты создана и закрыта от клиента',
    exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='rate_limits')
    and not exists (select 1 from pg_policies
      where schemaname='public' and tablename='rate_limits'),
    'политик нет вовсе — пишет и читает только сервер'

  union all
  select 18, 'rate_limit_take доступен ТОЛЬКО серверу',
    has_function_privilege('service_role', 'public.rate_limit_take(text, text, integer, interval)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.rate_limit_take(text, text, integer, interval)', 'EXECUTE'),
    'иначе счётчик обнуляется из браузера'

  union all
  select 19, 'ai_usage принимает суточный период',
    (select count(*) from pg_constraint
      where conrelid='public.ai_usage'::regclass and conname='ai_usage_period_format') = 1,
    'YYYY-MM и YYYY-MM-DD в одной таблице — суточный подпотолок'

  -- ── 9. Ник ───────────────────────────────────────────────────────────────
  union all
  select 20, 'ник нельзя сменить в обход set_username',
    (select prosrc like '%eataps.username_change%' from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='guard_profile_update' limit 1),
    'прямой UPDATE колонки обходил нормализацию ввода'

  -- ── 10. Stripe ───────────────────────────────────────────────────────────
  union all
  select 21, 'журнал событий Stripe создан',
    exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='stripe_events'),
    'повторная доставка события больше не обрабатывается дважды'

  union all
  select 22, 'у подписки есть отметка времени события',
    exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='subscriptions' and column_name='event_at'),
    'по ней отсекаются устаревшие апдейты, пришедшие после отмены'

  -- ── 11. Прочее ───────────────────────────────────────────────────────────
  union all
  select 23, 'аватар в профиле ограничен разумным потолком',
    (select pg_get_constraintdef(oid) like '%60000%' from pg_constraint
      where conrelid='public.profiles'::regclass and conname='profiles_avatar_len'),
    '256×256 JPEG — это около 40 000 символов base64; 300 000 было запасом в 10 раз'

  union all
  select 24, 'пакетное чтение отношений доступно',
    has_function_privilege('authenticated', 'public.get_relationships(uuid[])', 'EXECUTE'),
    'один запрос на список вместо одного на человека'

  union all
  select 25, 'список диалогов считается на сервере',
    has_function_privilege('authenticated', 'public.list_conversations(integer)', 'EXECUTE'),
    'клиентское схлопывание 200 сообщений теряло диалоги'

  union all
  select 26, 'списки людей перешли на курсор',
    not exists (
      select 1 from information_schema.parameters
      where specific_schema='public' and parameter_name='p_offset'
        and specific_name in (
          select specific_name from information_schema.routines
          where routine_schema='public'
            and routine_name in ('list_followers','list_following','list_friends')
        )
    ),
    'offset на дописываемом сверху списке показывает дубли'

  union all
  select 27, 'у всех SECURITY DEFINER функций закреплён search_path',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
    ),
    coalesce((select string_agg(p.proname, ', ') from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
    ), 'все закреплены')
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНЫЕ ПРОВЕРКИ (двумя реальными сессиями A и B)
--
-- Всё выше выполнено от service_role, для которого RLS не действует.
--
--   1. A и B — друзья (подписаны друг на друга).
--      От B: select * from app_state where user_id = '<A>';
--        → ПУСТО. Раньше здесь приезжала строка целиком: вес, рост, возраст,
--          пол, настроение, самочувствие, заметки дня.
--      От B: select * from friend_state('<A>');
--        → профиль и дневник приходят, телесных показателей в них нет.
--
--   2. От B: select * from search_users('___');
--        → ПУСТО (или только ники, буквально начинающиеся с трёх подчёркиваний).
--          Раньше возвращались первые тридцать пользователей базы.
--      От B: select * from search_users('%');       → пусто (меньше трёх символов)
--      От B: select * from search_users('a_c');     → только ник ровно с таким началом
--
--   3. От B: select * from follows limit 1000;
--        → только строки, где участвует сам B.
--
--   4. Забаньте B (bans), затем от B:
--        insert into posts (user_id, text) values ('<B>', 'тест');   → ошибка RLS
--        insert into post_comments (...)                             → ошибка RLS
--        insert into messages (...)                                  → ошибка RLS
--        insert into follows (...)                                   → ошибка RLS
--      Не забудьте снять бан после проверки.
--
--   5. От B: update profiles set username = 'ЛюбойДругой' where user_id = '<B>';
--        → ник НЕ изменился (guard вернул прежний). Смена только через
--          select set_username('newnick');
--
--   6. Тренер: A приглашает тренера C, C принимает, C читает app_state A —
--      строка приходит. Затем A блокирует C:
--        → строка coach_links исчезла, select app_state от C даёт пусто.
-- ═══════════════════════════════════════════════════════════════════════════
