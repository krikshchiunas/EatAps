-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — надёжная синхронизация аккаунта между устройствами.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ supabase/schema.sql.
-- Идемпотентно: можно прогонять повторно, данные не удаляются.
--
-- Что решает:
--   1. Раньше клиент делал upsert всего блоба app_state.state. Два устройства,
--      открытые одновременно, затирали правки друг друга без следа (lost
--      update). Теперь запись возможна ТОЛЬКО через save_app_state() с
--      compare-and-swap по revision: обновление применяется, если с момента
--      чтения никто другой не писал. Иначе клиент получает актуальную версию,
--      сливает её со своей и повторяет.
--   2. Прямые INSERT/UPDATE на app_state отозваны у клиентских ролей — слепая
--      перезапись становится физически невозможной, а не «не должна случаться».
--   3. updated_at проставляет сервер (now()), а не клиент: часы устройств
--      расходятся, и клиентское время нельзя использовать как порядок записей.
--   4. «Был(а) в сети» переехал из app_state в отдельную таблицу presence.
--      Иначе heartbeat раз в минуту трогал бы строку app_state и рассылал по
--      Realtime весь блоб состояния каждому устройству.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Версия строки состояния
-- ─────────────────────────────────────────────────────────────────────────
-- default 1: существующие строки получают revision = 1, а «0/NULL» на клиенте
-- однозначно означает «я ещё не видел строку», а не «видел версию ноль».
alter table public.app_state
  add column if not exists revision bigint not null default 1;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Присутствие (последняя активность) — отдельно от состояния
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.presence (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now()
);

alter table public.presence enable row level security;

-- Видеть можно себя и принятых друзей — тот же круг, что и для app_state.
drop policy if exists "presence select self or friends" on public.presence;
create policy "presence select self or friends" on public.presence
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = presence.user_id)
          or (f.addressee = auth.uid() and f.requester = presence.user_id)
        )
    )
  );

-- Писать напрямую нельзя — только через touch_last_seen().
revoke insert, update, delete on public.presence from authenticated, anon;

-- Переносим уже накопленные отметки из app_state (одноразово, без потерь).
insert into public.presence (user_id, last_seen)
select user_id, last_seen from public.app_state where last_seen is not null
on conflict (user_id) do update set last_seen = greatest(public.presence.last_seen, excluded.last_seen);

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.presence (user_id, last_seen)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen = now();
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

create or replace function public.get_last_seen(p_user_id uuid)
returns timestamptz
language sql
stable
security invoker          -- RLS presence решает, кому можно; чужое вернёт NULL
set search_path = public
as $$
  select last_seen from public.presence where user_id = p_user_id;
$$;

revoke all on function public.get_last_seen(uuid) from public, anon;
grant execute on function public.get_last_seen(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Единственный путь записи состояния: compare-and-swap
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER, потому что прямая запись в app_state ролям отозвана (см.
-- п.4). Функция трогает ИСКЛЮЧИТЕЛЬНО строку auth.uid() — user_id никогда не
-- берётся из аргументов, поэтому подставить чужой ID невозможно.
--
-- Контракт: p_base_revision — версия, на которой основана правка.
--   • NULL / <= 0  → «строки не было»: вставляем. Если строка всё-таки есть —
--                    это конфликт, отдаём актуальную.
--   • N            → обновляем, только если revision всё ещё N.
-- При успехе out_state = NULL: клиенту и так известно, что он записал, а гонять
-- весь блоб обратно на каждое сохранение — лишний трафик на мобильной сети.
-- Состояние возвращается только при конфликте, когда его действительно нужно
-- слить.
-- Всегда возвращает актуальную версию и флаг conflict.
create or replace function public.save_app_state(
  p_state jsonb,
  p_base_revision bigint default null
)
returns table (
  out_revision   bigint,
  out_updated_at timestamptz,
  out_state      jsonb,
  out_conflict   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_at  timestamptz;
  v_st  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'state must be a json object' using errcode = '22023';
  end if;

  if p_base_revision is null or p_base_revision <= 0 then
    insert into public.app_state (user_id, state, revision, updated_at)
    values (v_uid, p_state, 1, now())
    on conflict (user_id) do nothing
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  else
    update public.app_state
       set state      = p_state,
           revision   = revision + 1,
           updated_at = now()
     where user_id = v_uid
       and revision = p_base_revision
    returning revision, updated_at into v_rev, v_at;

    if found then
      return query select v_rev, v_at, null::jsonb, false;
      return;
    end if;
  end if;

  -- Не применилось → кто-то опередил (или строку удалили). Отдаём то, что есть,
  -- чтобы клиент слил и повторил. Молча ничего не перезаписываем.
  select a.revision, a.updated_at, a.state into v_rev, v_at, v_st
    from public.app_state a where a.user_id = v_uid;

  return query select coalesce(v_rev, 0::bigint), v_at, v_st, true;
end;
$$;

revoke all on function public.save_app_state(jsonb, bigint) from public, anon;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Закрываем прямую запись в app_state
-- ─────────────────────────────────────────────────────────────────────────
-- После этого ни один клиент (даже с валидным токеном) не может перезаписать
-- своё состояние в обход проверки версии. SELECT (своё + друзья) и DELETE
-- (право на удаление данных) остаются.
revoke insert, update on public.app_state from authenticated, anon;

-- Политики insert/update больше не нужны: грант отозван, а RPC работает как
-- definer. Оставляем их на месте — они безвредны и пригодятся, если грант
-- когда-нибудь вернут (тогда ограничение auth.uid() = user_id снова в силе).

-- Страховка на уровне БД: revision монотонно растёт, updated_at ставит сервер.
create or replace function public.guard_app_state_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  if new.state is distinct from old.state and new.revision <= old.revision then
    raise exception 'revision must increase when state changes';
  end if;
  if new.state is distinct from old.state then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists app_state_update_guard on public.app_state;
create trigger app_state_update_guard
  before update on public.app_state
  for each row execute function public.guard_app_state_update();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Realtime для app_state — чтобы правки приезжали на другие устройства
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state'
  ) then
    execute 'alter publication supabase_realtime add table public.app_state';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Чистка legacy-колонки last_seen
-- ─────────────────────────────────────────────────────────────────────────
-- Колонку НЕ удаляем: старые вкладки, открытые в момент деплоя, ещё могут её
-- читать (fetchLastSeen). Данные уже скопированы в presence, писать в неё
-- больше некому. Удалить можно вручную позже:
--   alter table public.app_state drop column if exists last_seen;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Ужесточение прав на messages
-- ─────────────────────────────────────────────────────────────────────────
-- Получателю разрешено ставить read_at и только его. Прежний триггер не
-- проверял reply_to/reply_snapshot/forwarded_name и позволял снять отметку
-- прочтения обратно в NULL.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name then
      raise exception 'Only read_at can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Индексы
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists friendships_requester_idx on public.friendships (requester, status);
