-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после миграции 2026-08-26_nickname_identity.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только читает.
-- Каждая строка — одна проверка со статусом ✔ или ✖.
--
-- Проверяет три класса вещей:
--   • что публичного ID больше нет — ни колонки, ни функций вокруг него;
--   • что ник стал обязательным и уникальным адресом;
--   • инварианты новой дружбы: строка friendships существует ровно там, где
--     подписка взаимна, и создавать её клиент не может.
--
-- Последнее — главное. Дружба теперь производная, а производная величина может
-- разойтись с источником: именно поэтому здесь стоят двусторонние проверки
-- 20 и 21, а не одна.
--
-- Проверку «пользователь A не может написать B, не будучи другом» этот файл не
-- делает и сделать не может: он выполняется от service_role, для которого RLS
-- не применяется. См. раздел «Ручные проверки» в конце файла.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Публичного ID больше нет ─────────────────────────────────────────
  select 1, 'колонка profiles.public_id удалена',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_id'
    ),
    'единственный адрес человека — ник'

  union all select 2, 'функции публичного ID удалены',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('find_user_by_public_id', 'ensure_public_id',
                          'generate_public_id', 'normalize_public_id')
    ),
    'осталось: ' || coalesce((
      select string_agg(p.proname, ', ')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('find_user_by_public_id', 'ensure_public_id',
                          'generate_public_id', 'normalize_public_id')), '—')

  union all select 3, 'ограничение формата public_id снято',
    not exists (
      select 1 from pg_constraint
      where conname = 'profiles_public_id_format' and conrelid = 'public.profiles'::regclass
    ),
    'ограничение без колонки — мусор в схеме'

  -- ── 2. Ник ──────────────────────────────────────────────────────────────
  union all select 4, 'ник обязателен (NOT NULL)',
    coalesce((
      select attnotnull from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'username' and attnum > 0
    ), false),
    'профиль без ника невидим для поиска и для списков'

  union all select 5, 'ник уникален',
    exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'profiles' and indexname = 'profiles_username_key'
    ),
    'всего профилей: ' || (select count(*)::text from public.profiles)

  union all select 6, 'двух одинаковых ников нет',
    (select count(*) from public.profiles) = (select count(distinct username) from public.profiles),
    'дублей: ' || (
      select coalesce(count(*)::text, '0') from (
        select username from public.profiles group by username having count(*) > 1
      ) d)

  union all select 7, 'у всех пользователей есть ник',
    not exists (
      select 1 from auth.users u
      left join public.profiles p on p.user_id = u.id
      where p.user_id is null or p.username is null
    ),
    'без ника: ' || (
      select count(*)::text from auth.users u
      left join public.profiles p on p.user_id = u.id
      where p.user_id is null or p.username is null)

  union all select 8, 'все ники соответствуют формату',
    not exists (select 1 from public.profiles where username !~ '^[a-z0-9_]{3,20}$'),
    'нарушений: ' || (select count(*)::text from public.profiles where username !~ '^[a-z0-9_]{3,20}$')

  union all select 9, 'формат ника закреплён ограничением, а не только кодом',
    exists (
      select 1 from pg_constraint
      where conname = 'profiles_username_format' and conrelid = 'public.profiles'::regclass
    ),
    'иначе прямая запись в обход RPC внесла бы верхний регистр'

  union all select 10, 'ник выдаётся прямо при регистрации',
    coalesce((
      select pg_get_functiondef(p.oid) like '%claim_username%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user' limit 1
    ), false),
    'иначе новый профиль не находился бы поиском до первой правки'

  union all select 11, 'claim_username больше не опирается на public_id',
    coalesce((
      select pg_get_functiondef(p.oid) not like '%public_id%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_username' limit 1
    ), false),
    'запасной ник строится из UUID, который уникален по построению'

  union all select 12, 'set_username снимает ведущую «@» на сервере',
    coalesce((
      select pg_get_functiondef(p.oid) like '%^@+%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_username' limit 1
    ), false),
    'вставленный по привычке «@nickname» не должен отвергаться'

  union all select 13, 'find_user_by_username создан',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'find_user_by_username'
    ),
    'приглашение тренера ищет человека по нику'

  -- ── 3. Поиск ────────────────────────────────────────────────────────────
  union all select 14, 'поиск идёт только по нику',
    coalesce((
      select pg_get_functiondef(p.oid) not like '%display_name) like%'
         and pg_get_functiondef(p.oid) like '%p.username like%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'search_users' limit 1
    ), false),
    'имя неуникально — по нему нельзя выбрать нужного человека'

  union all select 15, 'индекс по имени убран',
    not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'profiles_display_name_prefix_idx'
    ),
    'индекс, который не обслуживает ни одного запроса, — плата без выгоды'

  -- ── 4. Дружба производна от подписок ────────────────────────────────────
  union all select 16, 'is_friend_with считает дружбу по подпискам',
    coalesce((
      select pg_get_functiondef(p.oid) like '%public.follows%'
         and pg_get_functiondef(p.oid) not like '%public.friendships%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_friend_with' limit 1
    ), false),
    'права считаются по графу, а не по материализованной строке'

  union all select 17, 'триггеры материализации дружбы стоят',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'follows'
        and t.tgname in ('follows_sync_friendship_ins', 'follows_sync_friendship_del')) = 2,
    'без них дружба не появлялась бы и не исчезала'

  union all select 18, 'клиент не может писать в friendships',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'friendships' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'иначе можно было бы выписать себе право переписки'

  union all select 19, 'свои связи читать по-прежнему можно',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'friendships' and cmd = 'SELECT'
    ),
    'политика friendship select'

  union all select 20, 'механика заявок демонтирована',
    not exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'friendships'
        and t.tgname in ('friendships_rate_limit', 'friendships_set_requester_name')
    )
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('limit_friend_requests', 'set_requester_name')
    ),
    'лимит «30 заявок в час» ронял бы обычную подписку в ответ'

  union all select 21, 'незакрытых заявок не осталось',
    not exists (select 1 from public.friendships where status <> 'accepted'),
    'строк не в статусе accepted: '
      || (select count(*)::text from public.friendships where status <> 'accepted')

  union all select 22, 'каждая дружба подтверждена взаимной подпиской',
    not exists (
      select 1 from public.friendships f
      where not (
        exists (select 1 from public.follows x
                 where x.follower_id = f.requester and x.following_id = f.addressee)
        and exists (select 1 from public.follows y
                 where y.follower_id = f.addressee and y.following_id = f.requester)
      )
    ),
    'дружб без взаимной подписки: ' || (
      select count(*)::text from public.friendships f
      where not (
        exists (select 1 from public.follows x
                 where x.follower_id = f.requester and x.following_id = f.addressee)
        and exists (select 1 from public.follows y
                 where y.follower_id = f.addressee and y.following_id = f.requester)
      ))

  union all select 23, 'каждая взаимная подписка стала дружбой',
    not exists (
      select 1 from public.follows a
      join public.follows b on b.follower_id = a.following_id and b.following_id = a.follower_id
      where not exists (
        select 1 from public.friendships f
        where (f.requester = a.follower_id  and f.addressee = a.following_id)
           or (f.requester = a.following_id and f.addressee = a.follower_id)
      )
    ),
    'взаимных подписок без дружбы: ' || (
      select count(*)::text from (
        select distinct least(a.follower_id, a.following_id) l, greatest(a.follower_id, a.following_id) g
        from public.follows a
        join public.follows b on b.follower_id = a.following_id and b.following_id = a.follower_id
        where not exists (
          select 1 from public.friendships f
          where (f.requester = a.follower_id  and f.addressee = a.following_id)
             or (f.requester = a.following_id and f.addressee = a.follower_id)
        )
      ) d)

  union all select 24, 'переписка осталась привилегией дружбы',
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT'
        and with_check like '%is_friend_with%'
    ),
    'смысл поменялся, правило — нет: писать можно только друзьям'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНЫЕ ПРОВЕРКИ
--
-- Всё выше выполняется от service_role, для которого RLS не применяется. Эти
-- запросы доказывают, что политики существуют и что данные согласованы, но НЕ
-- что изоляция работает. Настоящая проверка — двумя реальными сессиями.
--
-- Два аккаунта A и B, изначально без связи:
--
--   1. От B: select * from search_users('<ник A>');        → A найден
--      От B: select * from search_users('<имя A>');        → пусто,
--            если имя не совпадает с началом ника (поиск по имени убран)
--
--   2. От B: insert into messages (sender, recipient, text)
--            values ('<B>', '<A>', 'привет');              → ошибка RLS
--            (подписки ещё нет — значит и дружбы нет)
--
--   3. B подписывается на A. Повторить п.2                 → снова ошибка RLS
--      (подписка односторонняя, дружбы всё ещё нет)
--      От A: select * from friend_state('<B>');            → null
--
--   4. A подписывается на B в ответ.
--      select * from get_relationship('<A>') от B          → friend = true
--      Повторить п.2                                       → сообщение уходит
--      От B: select * from friend_state('<A>');            → дневник виден
--      A должен получить уведомление FRIEND_ACCEPTED (он подписался первым)
--
--   5. B отписывается от A.
--      От B: select * from friend_state('<A>');            → null
--      Повторить п.2                                       → снова ошибка RLS
--      select count(*) from friendships (service_role)     → строка исчезла
--
--   6. От B: insert into friendships (requester, addressee, status)
--            values ('<B>', '<A>', 'accepted');            → ошибка RLS
--            (единственный путь к дружбе — подписка)
--
--   7. От B: select set_username('<ник A>');               → ошибка «is taken»
--      От B: select set_username('AB');                    → ошибка формата
--      От B: select set_username('@Denis_1');              → станет 'denis_1'
-- ═══════════════════════════════════════════════════════════════════════════
