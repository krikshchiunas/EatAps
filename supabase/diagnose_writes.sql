-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — почему не проходят запись подписки и отправка сообщения.
--
-- Вставить целиком в Supabase SQL Editor → Run.
--
-- ЧТО ЭТО ДЕЛАЕТ. Две части.
--   ЧАСТЬ 1 — только читает: на месте ли всё, от чего зависят эти две записи.
--   ЧАСТЬ 2 — ПОВТОРЯЕТ обе записи по-настоящему и печатает точный SQLSTATE
--             и текст ошибки, после чего ОТКАТЫВАЕТ их.
--
-- Почему часть 2 безопасна: вставки идут внутри блока с обработчиком
-- исключений, то есть внутри точки сохранения, и каждая снимается принудительно
-- ещё до конца блока. Ни подписки, ни сообщения, ни уведомления не остаются.
-- Проверить можно счётчиками в самом конце файла.
--
-- ЧЕГО ЭТО НЕ ПРОВЕРЯЕТ. Файл выполняется от service_role, для которого RLS не
-- применяется. Значит, отказ ПОЛИТИКИ здесь не воспроизведётся — но отказ
-- ТРИГГЕРА, отсутствующего индекса, ограничения или функции воспроизведётся
-- полностью. Если часть 2 говорит «прошло», а в приложении по-прежнему отказ,
-- причина в RLS, и искать её надо по сообщению из консоли браузера
-- (оно теперь печатается: [eataps:follow] отказ сервера {code, message, …}).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ЧАСТЬ 1. Всё ли на месте ───────────────────────────────────────────────
with checks(порядок, проверка, ok, деталь) as (

  select 1, 'функция push_notification существует',
    to_regprocedure('public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb)') is not null,
    'через неё идут ОБЕ операции: и подписка, и сообщение'

  -- push_notification делает ON CONFLICT по этому набору колонок. Если
  -- частичного уникального индекса нет, Postgres отвечает 42P10 «there is no
  -- unique or exclusion constraint matching the ON CONFLICT specification»,
  -- и падает КАЖДАЯ подписка и КАЖДОЕ сообщение — именно так, как на скриншотах.
  union all select 2, 'индекс дедупликации уведомлений существует',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_dedup_idx'),
    'без него ON CONFLICT в push_notification падает с 42P10'

  union all select 3, 'индекс дедупликации — частичный и по нужным колонкам',
    coalesce((
      select indexdef like '%recipient_id%' and indexdef like '%actor_id%'
         and indexdef like '%type%' and indexdef like '%entity_id%'
         and indexdef like '%WHERE%'
      from pg_indexes where schemaname = 'public' and indexname = 'notifications_dedup_idx'
    ), false),
    coalesce((select indexdef from pg_indexes where indexname = 'notifications_dedup_idx'), '—')

  union all select 4, 'тип notification_type содержит FOLLOW и MESSAGE',
    (select count(*) from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_type' and e.enumlabel in ('FOLLOW', 'MESSAGE')) = 2,
    coalesce((select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
              from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'notification_type'), '— типа нет')

  union all select 5, 'функция is_blocked_between существует',
    to_regprocedure('public.is_blocked_between(uuid, uuid)') is not null,
    'её зовёт push_notification и половина политик'

  union all select 6, 'функция is_friend_with существует',
    to_regprocedure('public.is_friend_with(uuid, uuid)') is not null,
    'от неё зависит право отправить сообщение'

  -- Все триггеры обеих таблиц и их функции. Триггер, ссылающийся на
  -- несуществующую функцию, роняет вставку целиком.
  union all select 7, 'у всех триггеров follows есть их функции',
    not exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.follows'::regclass and not t.tgisinternal
        and t.tgfoid = 0
    ),
    coalesce((select string_agg(t.tgname, ', ' order by t.tgname)
              from pg_trigger t
              where t.tgrelid = 'public.follows'::regclass and not t.tgisinternal), '— триггеров нет')

  union all select 8, 'у всех триггеров messages есть их функции',
    not exists (
      select 1 from pg_trigger t
      where t.tgrelid = 'public.messages'::regclass and not t.tgisinternal
        and t.tgfoid = 0
    ),
    coalesce((select string_agg(t.tgname, ', ' order by t.tgname)
              from pg_trigger t
              where t.tgrelid = 'public.messages'::regclass and not t.tgisinternal), '— триггеров нет')

  -- Ловушка, из-за которой падает КАЖДЫЙ update по profiles (42703).
  -- К подписке отношения не имеет, но если она горит — база точно разошлась
  -- с миграциями, и это объясняет остальное.
  union all select 9, 'guard_profile_update не читает удалённый public_id',
    coalesce((select prosrc from pg_proc where proname = 'guard_profile_update' limit 1) not like '%public_id%', true),
    'если ✖ — база до миграции 2026-09-05, падает смена ника и сохранение состояния'

  union all select 10, 'форма list_feed совпадает с ожидаемой',
    coalesce((
      select pg_get_function_result(p.oid) like '%comments_count%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_feed' limit 1
    ), false),
    coalesce((select left(pg_get_function_result(p.oid), 120)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'list_feed' limit 1), '— функции нет')
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;


-- ── ЧАСТЬ 2. Повторяем обе записи и печатаем точную ошибку ─────────────────
-- Результат смотреть во вкладке с сообщениями (NOTICE), а не в таблице.
do $$
declare
  a uuid;
  b uuid;
  v_state text;
  v_msg   text;
  v_hint  text;
begin
  -- Берём пару, между которой подписки ЕЩЁ НЕТ: иначе получим 23505 и примем
  -- обычный дубликат за поломку.
  select f.user_id, s.user_id into a, b
  from public.profiles f
  cross join public.profiles s
  where f.user_id <> s.user_id
    and not exists (
      select 1 from public.follows x
      where x.follower_id = f.user_id and x.following_id = s.user_id
    )
  limit 1;

  if a is null then
    raise notice '⚠ нужно минимум два аккаунта без подписки между ними — пропускаем';
    return;
  end if;

  raise notice '── пробная пара: % → %', left(a::text, 8), left(b::text, 8);

  -- 1. Подписка.
  begin
    insert into public.follows (follower_id, following_id) values (a, b);
    -- Дошли сюда — вставка и все её триггеры отработали. Откатываем.
    raise exception using errcode = 'P0001', message = '__ok__';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    if v_msg = '__ok__' then
      raise notice '✔ ПОДПИСКА: вставка проходит, дело не в триггерах и не в ограничениях (откачено)';
    else
      raise notice '✖ ПОДПИСКА: % — %  %', v_state, v_msg, coalesce('| ' || v_hint, '');
    end if;
  end;

  -- 2. Сообщение. Триггеры те же по сути (уведомление), плюс свои.
  begin
    insert into public.messages (sender, recipient, text) values (a, b, 'проверка записи');
    raise exception using errcode = 'P0001', message = '__ok__';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    if v_msg = '__ok__' then
      raise notice '✔ СООБЩЕНИЕ: вставка проходит, дело не в триггерах и не в ограничениях (откачено)';
    else
      raise notice '✖ СООБЩЕНИЕ: % — %  %', v_state, v_msg, coalesce('| ' || v_hint, '');
    end if;
  end;
end $$;


-- ── Убеждаемся, что часть 2 ничего не оставила ─────────────────────────────
select 'проверочных сообщений в базе' as что, count(*) as сколько
from public.messages where text = 'проверка записи';
-- Должно быть 0. Если не 0 — что-то пошло совсем не так, удалите вручную:
--   delete from public.messages where text = 'проверка записи';
