-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — почему не проходят подписка и отправка сообщения.
--
-- Вставить целиком в Supabase SQL Editor → Run. Смотреть ОДНУ таблицу внизу.
--
-- ПОЧЕМУ ФАЙЛ ПЕРЕПИСАН. Прошлая версия печатала результат через
-- `raise notice` и отдавала две отдельные таблицы. И то и другое в Supabase
-- SQL Editor не видно: уведомления он не показывает вовсе, а из нескольких
-- запросов выводит результат ТОЛЬКО ПОСЛЕДНЕГО. Поэтому от всей диагностики
-- на экран попадала одна финальная строка с нулём. Теперь всё складывается во
-- временную таблицу, и последний запрос отдаёт её целиком.
--
-- ЧТО ДЕЛАЕТ. Две части, обе в одном ответе:
--   • проверяет, на месте ли всё, от чего зависят эти две записи;
--   • ПО-НАСТОЯЩЕМУ повторяет обе вставки и записывает точный SQLSTATE,
--     после чего откатывает их.
--
-- БЕЗОПАСНО. Вставки идут внутри блока с обработчиком исключений, то есть
-- внутри точки сохранения, и снимаются принудительно ещё до выхода из блока.
-- Ни подписки, ни сообщения, ни уведомления не остаются — последняя строка
-- таблицы это подтверждает. Временная таблица живёт до конца сессии и
-- исчезает сама.
--
-- ЧЕГО НЕ ПРОВЕРЯЕТ. Файл выполняется от service_role, для которого RLS не
-- применяется. Значит, отказ ПОЛИТИКИ здесь не воспроизведётся — а отказ
-- триггера, функции, индекса или ограничения воспроизведётся полностью.
-- Если обе строки «ПОВТОР ЗАПИСИ» окажутся ✔, а приложение по-прежнему
-- отказывает — причина в RLS, и её назовёт код ошибки в самом приложении.
-- ═══════════════════════════════════════════════════════════════════════════

create temp table if not exists _diag (
  порядок int,
  статус  text,
  проверка text,
  деталь  text
);
truncate _diag;

do $$
declare
  a       uuid;
  b       uuid;
  v_state text;
  v_msg   text;
  v_ok    boolean;
  v_err   text;
begin
  -- ── Часть 1. На месте ли всё, от чего зависят обе записи ────────────────

  insert into _diag values (1,
    case when to_regprocedure('public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb)') is not null
         then '✔' else '✖' end,
    'функция push_notification',
    'через неё идут ОБЕ операции — и подписка, и сообщение');

  -- push_notification делает ON CONFLICT по этому набору колонок. Нет
  -- частичного уникального индекса — Postgres отвечает 42P10, и падает КАЖДАЯ
  -- подписка и КАЖДОЕ сообщение. Главный подозреваемый.
  insert into _diag values (2,
    case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_dedup_idx')
         then '✔' else '✖' end,
    'индекс notifications_dedup_idx',
    coalesce((select indexdef from pg_indexes where indexname = 'notifications_dedup_idx'),
             'НЕТ — тогда ON CONFLICT в push_notification падает с 42P10'));

  insert into _diag values (3,
    case when (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'notification_type' and e.enumlabel in ('FOLLOW', 'MESSAGE')) = 2
         then '✔' else '✖' end,
    'тип notification_type: FOLLOW и MESSAGE',
    coalesce((select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
              from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'notification_type'), '— типа нет'));

  insert into _diag values (4,
    case when to_regprocedure('public.is_blocked_between(uuid, uuid)') is not null then '✔' else '✖' end,
    'функция is_blocked_between', 'её зовёт push_notification и половина политик');

  insert into _diag values (5,
    case when to_regprocedure('public.is_friend_with(uuid, uuid)') is not null then '✔' else '✖' end,
    'функция is_friend_with', 'от неё зависит право отправить сообщение');

  insert into _diag values (6, 'ℹ', 'триггеры на follows',
    coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
              where tgrelid = 'public.follows'::regclass and not tgisinternal), '— нет ни одного'));

  insert into _diag values (7, 'ℹ', 'триггеры на messages',
    coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
              where tgrelid = 'public.messages'::regclass and not tgisinternal), '— нет ни одного'));

  -- Прогнана ли миграция 2026-09-05. От этого зависит, какой путь отправки
  -- использует приложение и починена ли ловушка с public_id.
  insert into _diag values (8,
    case when to_regprocedure('public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid)') is not null
         then '✔' else '✖' end,
    'миграция 2026-09-05 прогнана',
    'признак — наличие функции send_message');

  insert into _diag values (9,
    case when coalesce((select prosrc from pg_proc where proname = 'guard_profile_update' limit 1), '') not like '%public_id%'
         then '✔' else '✖' end,
    'guard_profile_update не читает удалённый public_id',
    'если ✖ — падает КАЖДЫЙ update по profiles: смена ника и сохранение состояния');

  -- ── Часть 2. Повторяем обе записи по-настоящему ─────────────────────────
  -- Пара, между которой подписки ещё нет: иначе получим 23505 и примем
  -- обычный дубликат за поломку.
  select f.user_id, s.user_id into a, b
  from public.profiles f
  cross join public.profiles s
  where f.user_id <> s.user_id
    and not exists (select 1 from public.follows x
                    where x.follower_id = f.user_id and x.following_id = s.user_id)
  limit 1;

  if a is null then
    insert into _diag values (100, '⚠', 'ПОВТОР ЗАПИСИ пропущен',
      'нужно минимум два аккаунта, между которыми ещё нет подписки');
  else
    -- 1. Подписка.
    -- Значения переменных переживают откат точки сохранения, а строки — нет.
    -- Поэтому итог записываем ПОСЛЕ блока, а не внутри него.
    v_ok := false; v_err := null;
    begin
      insert into public.follows (follower_id, following_id) values (a, b);
      raise exception using errcode = 'P0001', message = '__rollback__';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_msg = '__rollback__' then v_ok := true;
      else v_err := v_state || ' — ' || v_msg; end if;
    end;
    insert into _diag values (100, case when v_ok then '✔' else '✖' end,
      'ПОВТОР ЗАПИСИ: подписка',
      coalesce(v_err, 'вставка и все её триггеры проходят (откачено)'));

    -- 2. Сообщение.
    v_ok := false; v_err := null;
    begin
      insert into public.messages (sender, recipient, text) values (a, b, 'проверка записи');
      raise exception using errcode = 'P0001', message = '__rollback__';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_msg = '__rollback__' then v_ok := true;
      else v_err := v_state || ' — ' || v_msg; end if;
    end;
    insert into _diag values (101, case when v_ok then '✔' else '✖' end,
      'ПОВТОР ЗАПИСИ: сообщение',
      coalesce(v_err, 'вставка и все её триггеры проходят (откачено)'));
  end if;

  -- ── Ничего ли не осталось ───────────────────────────────────────────────
  insert into _diag values (200,
    case when (select count(*) from public.messages where text = 'проверка записи') = 0
          and (select count(*) from public.follows f where f.follower_id = a and f.following_id = b) = 0
         then '✔' else '✖' end,
    'проверочные записи откачены',
    'если ✖ — удалите вручную: delete from public.messages where text = ''проверка записи''');
end $$;

select порядок as "№", статус, проверка, деталь from _diag order by порядок;
