-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переписка переезжает на диалоги: группы, запросы, отзыв сообщений.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-09-09_social_graph_v2.sql.
-- Идемпотентно. НИ ОДНО СООБЩЕНИЕ НЕ УДАЛЯЕТСЯ И НЕ ПЕРЕПИСЫВАЕТСЯ.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ПОЧЕМУ НЕЛЬЗЯ БЫЛО ОСТАТЬСЯ НА ПАРЕ (sender, recipient)
--
-- Модель «у сообщения ровно один получатель» описывает переписку двоих и
-- ничего кроме. Групповой чат в неё не ложится ни при каких ухищрениях:
-- рассылать по копии сообщения каждому участнику — значит завести N разных
-- сообщений, у которых разъедутся реакции, ответы, отзыв и прочтение.
--
-- Поэтому появляется диалог как самостоятельная сущность, а сообщение
-- принадлежит диалогу. Личная переписка — частный случай: диалог из двух
-- участников.
--
-- ───────────────────────────────────────────────────────────────────────────
-- КАК ПЕРЕЕЗЖАЮТ СУЩЕСТВУЮЩИЕ ДАННЫЕ
--
-- 1. Для каждой пары, между которыми есть хоть одно сообщение, заводится
--    диалог типа 'direct';
-- 2. У всех сообщений этой пары проставляется conversation_id;
-- 3. Оба человека становятся участниками; состояние участника берётся из
--    message_grants — то есть ровно то, что уже решено;
-- 4. Колонка recipient ОСТАЁТСЯ и продолжает заполняться для личных
--    диалогов. Это не дубль ради дубля: на ней держатся счётчик
--    непрочитанного, бейдж в навигации и весь ещё не обновлённый клиент.
--    Для группового сообщения recipient пуст — отсюда снятие NOT NULL.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ПОЯВЛЯЕТСЯ
--
--   • групповые чаты с ролями, названием и составом участников;
--   • запросы на переписку живут на участнике диалога, а не вычисляются
--     каждый раз заново;
--   • отзыв сообщения у всех (unsend) и скрытие у себя (delete for me);
--   • «прочитано» указателем last_read_at, а не UPDATE на каждое сообщение;
--   • реакции произвольным эмодзи из списка, по одной на человека;
--   • архив и очистка переписки — у каждого участника своя;
--   • пересылка;
--   • поиск по сообщениям;
--   • закрытое хранилище для вложений личной переписки.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Диалоги и участники
-- ─────────────────────────────────────────────────────────────────────────
-- pair_low / pair_high — отсортированная пара участников личного диалога.
-- Нужны ровно для одного: уникального индекса, который не даёт двум
-- одновременным «написать этому человеку» создать два диалога. Без него
-- гонка при первом сообщении разводит переписку по двум веткам, и обнаружить
-- это можно только по жалобе «он мне отвечает, а я не вижу».
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'direct',
  title           text,
  avatar_url      text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  pair_low        uuid references auth.users(id) on delete cascade,
  pair_high       uuid references auth.users(id) on delete cascade,
  constraint conversations_kind_known check (kind in ('direct', 'group')),
  constraint conversations_title_len check (title is null or char_length(title) <= 80),
  -- Личный диалог обязан знать свою пару, групповой — не имеет её вовсе.
  constraint conversations_pair_shape check (
    (kind = 'direct' and pair_low is not null and pair_high is not null and pair_low < pair_high)
    or (kind = 'group' and pair_low is null and pair_high is null)
  )
);

create unique index if not exists conversations_direct_pair_uniq
  on public.conversations (pair_low, pair_high) where kind = 'direct';

create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);


-- Участник диалога. Здесь же лежит всё «личное отношение к переписке»:
-- прочитано до, заглушено до, убрано в архив, очищено у себя, состояние
-- запроса. Всё это у каждого своё и в общую строку диалога не помещается.
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member',
  state           text not null default 'accepted',
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  last_read_at    timestamptz,
  muted_until     timestamptz,
  archived        boolean not null default false,
  cleared_at      timestamptz,
  primary key (conversation_id, user_id),
  constraint conversation_members_role_known check (role in ('owner', 'admin', 'member')),
  constraint conversation_members_state_known check (state in ('accepted', 'pending', 'declined'))
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, state)
  where left_at is null;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;


-- Членство — предикат, а не подзапрос в каждой политике. SECURITY DEFINER,
-- потому что политика самой conversation_members иначе сослалась бы на себя
-- и ушла в бесконечную рекурсию (42P17) — классическая ловушка RLS.
create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation
      and m.user_id = p_user
      and m.left_at is null
  );
$$;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

create or replace function public.conversation_role(p_conversation uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.conversation_members m
  where m.conversation_id = p_conversation and m.user_id = p_user and m.left_at is null;
$$;

revoke all on function public.conversation_role(uuid, uuid) from public, anon;
grant execute on function public.conversation_role(uuid, uuid) to authenticated;


-- Диалог виден только его участникам. Ни создания, ни изменения напрямую:
-- и то и другое проверяет права, которых у политики нет.
drop policy if exists "conversations select member" on public.conversations;
create policy "conversations select member" on public.conversations
  for select using (public.is_conversation_member(id, auth.uid()));

-- Состав диалога виден его участникам. Себя добавить нельзя: INSERT-политики
-- нет вовсе, вступление идёт только через RPC.
drop policy if exists "conversation members select" on public.conversation_members;
create policy "conversation members select" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

-- Своя строка участника — единственное, что можно менять напрямую: прочитано,
-- заглушено, архив. Роль и состояние сюда не входят и проверяются триггером.
drop policy if exists "conversation members update own" on public.conversation_members;
create policy "conversation members update own" on public.conversation_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Клиент не должен уметь выдать себе роль администратора или перевести свой
-- запрос в «принято» в обход RPC — тот делает это вместе с message_grants.
create or replace function public.guard_conversation_member_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_member_write', true), 'off') = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.state is distinct from old.state
     or new.user_id is distinct from old.user_id
     or new.conversation_id is distinct from old.conversation_id
     or new.joined_at is distinct from old.joined_at
     or new.left_at is distinct from old.left_at then
    raise exception 'only read/mute/archive state can be updated directly';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_members_update_guard on public.conversation_members;
create trigger conversation_members_update_guard
  before update on public.conversation_members
  for each row execute function public.guard_conversation_member_update();


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Сообщения переезжают в диалоги
-- ─────────────────────────────────────────────────────────────────────────
alter table public.messages add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
-- Отзыв «у всех». Строку не удаляем: у ответов на неё есть reply_to, а
-- каскад on delete set null стёр бы связь и превратил цитату в сироту.
-- Отозванное сообщение остаётся на месте пустой пометкой «сообщение удалено».
alter table public.messages add column if not exists unsent_at timestamptz;
alter table public.messages add column if not exists edited_at timestamptz;
-- Вложение сложнее картинки: видео, звук, «просмотр один раз».
--   { kind: 'image'|'video'|'audio', url, mime, size, duration, width, height,
--     mode: 'keep'|'view_once' }
alter table public.messages add column if not exists media jsonb;
alter table public.messages add column if not exists forwarded_from uuid references auth.users(id) on delete set null;

-- Групповому сообщению получатель не нужен: их там столько, сколько
-- участников. Для личного он по-прежнему заполняется — на нём держатся
-- счётчики непрочитанного и весь ещё не обновлённый клиент.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'recipient' and is_nullable = 'NO'
  ) then
    alter table public.messages alter column recipient drop not null;
  end if;
end $$;

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- Поиск по тексту переписки. Индекс по триграммам не заводим: расширение
-- pg_trgm есть не во всех проектах, а объём переписки здесь такой, что
-- обычный ILIKE по одному диалогу отрабатывает по индексу выше.


-- 2.1. Разовый перенос существующей переписки в диалоги.
--
-- Выполняется только для сообщений без conversation_id, поэтому повторный
-- прогон ничего не делает. Личные диалоги создаются по факту переписки,
-- состояние участника берётся из уже принятых решений.
insert into public.conversations (kind, pair_low, pair_high, created_at, last_message_at)
select 'direct',
       least(m.sender, m.recipient),
       greatest(m.sender, m.recipient),
       min(m.created_at),
       max(m.created_at)
from public.messages m
where m.conversation_id is null
  and m.recipient is not null
  and m.sender <> m.recipient
group by least(m.sender, m.recipient), greatest(m.sender, m.recipient)
on conflict (pair_low, pair_high) where kind = 'direct' do nothing;

update public.messages m
   set conversation_id = c.id
  from public.conversations c
 where m.conversation_id is null
   and m.recipient is not null
   and c.kind = 'direct'
   and c.pair_low  = least(m.sender, m.recipient)
   and c.pair_high = greatest(m.sender, m.recipient);

-- Участники: обе стороны каждого личного диалога.
insert into public.conversation_members (conversation_id, user_id, role, state, last_read_at)
select c.id, c.pair_low, 'member',
       coalesce((select g.state from public.message_grants g
                  where g.owner_id = c.pair_low and g.peer_id = c.pair_high), 'accepted'),
       (select max(x.created_at) from public.messages x
         where x.conversation_id = c.id and x.recipient = c.pair_low and x.read_at is not null)
from public.conversations c
where c.kind = 'direct'
on conflict (conversation_id, user_id) do nothing;

insert into public.conversation_members (conversation_id, user_id, role, state, last_read_at)
select c.id, c.pair_high, 'member',
       coalesce((select g.state from public.message_grants g
                  where g.owner_id = c.pair_high and g.peer_id = c.pair_low), 'accepted'),
       (select max(x.created_at) from public.messages x
         where x.conversation_id = c.id and x.recipient = c.pair_high and x.read_at is not null)
from public.conversations c
where c.kind = 'direct'
on conflict (conversation_id, user_id) do nothing;


-- 2.2. Права на сообщения.
--
-- Прежнее условие (я отправитель или получатель) СОХРАНЕНО: на нём держится
-- ещё не обновлённый клиент, читающий messages напрямую. Добавлено членство в
-- диалоге — единственный способ увидеть групповое сообщение.
--
-- Заблокированные не видят переписку друг друга вовсе: без этой строки
-- блокировка оставляла бы полностью читаемую историю.
drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select using (
    (
      auth.uid() = sender
      or auth.uid() = recipient
      or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid()))
    )
    and (recipient is null or not public.is_blocked_between(sender, auth.uid()))
  );

-- Вставка: либо старым путём (личное сообщение с проверкой права писать),
-- либо в диалог, где я состою. Второе условие ещё раз проверяется в RPC —
-- политика здесь нижняя граница, а не единственная.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and (
      (recipient is not null and public.can_message(sender, recipient))
      or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid()))
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 3. «Удалить у себя»
-- ─────────────────────────────────────────────────────────────────────────
-- Раньше это жило в localStorage и не переживало смену устройства: человек
-- убирал сообщение на телефоне и снова видел его на ноутбуке. Скрытие — это
-- решение человека, а не настройка браузера, поэтому его место на сервере.
create table if not exists public.message_deletions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_deletions_user_idx on public.message_deletions (user_id);

alter table public.message_deletions enable row level security;

drop policy if exists "message deletions own" on public.message_deletions;
create policy "message deletions own" on public.message_deletions
  for select using (auth.uid() = user_id);

drop policy if exists "message deletions insert own" on public.message_deletions;
create policy "message deletions insert own" on public.message_deletions
  for insert with check (auth.uid() = user_id);

drop policy if exists "message deletions delete own" on public.message_deletions;
create policy "message deletions delete own" on public.message_deletions
  for delete using (auth.uid() = user_id);

-- Кто уже посмотрел «одноразовое» вложение. Отдельная таблица, потому что
-- в группе просмотр у каждого свой.
create table if not exists public.message_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_views enable row level security;

-- Отправитель видит, кто посмотрел; каждый видит свои отметки.
drop policy if exists "message views select" on public.message_views;
create policy "message views select" on public.message_views
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.messages m where m.id = message_id and m.sender = auth.uid())
  );

drop policy if exists "message views insert own" on public.message_views;
create policy "message views insert own" on public.message_views
  for insert with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Триггеры сообщений становятся диалоговыми
-- ─────────────────────────────────────────────────────────────────────────

-- Квоты на непринятую переписку. Групповые сообщения под них не попадают:
-- войти в группу без приглашения нельзя, и рассылать через неё некому.
create or replace function public.limit_unaccepted_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_new_peers int;
begin
  if new.recipient is null then
    return new;
  end if;
  if public.get_message_permission(new.sender, new.recipient) = 'direct' then
    return new;
  end if;

  select count(*) into v_pending
  from public.messages m
  where m.sender = new.sender and m.recipient = new.recipient;

  if v_pending >= 5 then
    raise exception 'Пока человек не ответил, можно отправить не больше 5 сообщений'
      using errcode = '54000';
  end if;

  select count(distinct m.recipient) into v_new_peers
  from public.messages m
  where m.sender = new.sender
    and m.created_at > now() - interval '1 hour'
    and not exists (
      select 1 from public.messages e
      where e.sender = m.recipient and e.recipient = m.sender
    );

  if v_new_peers >= 20 then
    raise exception 'Слишком много новых собеседников за час, попробуйте позже'
      using errcode = '54000';
  end if;

  return new;
end;
$$;


-- Событие о сообщении. Теперь оно рассылается ВСЕМ участникам диалога, кроме
-- отправителя, и различает обычное сообщение и запрос: у них разные экраны и
-- разные бейджи.
--
-- entity_id для личного диалога — id собеседника (одна строка на диалог, и
-- вести она должна в диалог). Для группы — id диалога.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member record;
  v_kind text;
begin
  if new.conversation_id is null then
    -- Сообщение, вставленное старым клиентом напрямую: диалога у него нет.
    perform public.push_notification(new.recipient, new.sender, 'MESSAGE', 'message', new.sender);
    return new;
  end if;

  select kind into v_kind from public.conversations where id = new.conversation_id;

  for v_member in
    select m.user_id, m.state, m.muted_until
    from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender
      and m.left_at is null
  loop
    -- Заглушённый диалог не звонит. Сообщение при этом доставлено, счётчик
    -- внутри списка диалогов его посчитает — молчит только колокольчик.
    if v_member.muted_until is not null and v_member.muted_until > now() then
      continue;
    end if;
    if v_member.state = 'declined' then
      continue;
    end if;

    if v_kind = 'group' then
      perform public.push_notification(
        v_member.user_id, new.sender,
        case when v_member.state = 'pending' then 'MESSAGE_REQUEST' else 'MESSAGE' end,
        'conversation', new.conversation_id
      );
    else
      perform public.push_notification(
        v_member.user_id, new.sender,
        case when v_member.state = 'pending' then 'MESSAGE_REQUEST' else 'MESSAGE' end,
        'message', new.sender
      );
    end if;
  end loop;

  return new;
end;
$$;


-- Прямые UPDATE по messages остаются доступны только получателю личного
-- сообщения и только для read_at. Всё остальное (реакции, отзыв, правка) идёт
-- через RPC, которые помечают запись доверенной.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_message_write', true), 'off') = 'on' then
    return new;
  end if;

  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.media        is distinct from old.media
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name
       or new.unsent_at    is distinct from old.unsent_at
       or new.reactions    is distinct from old.reactions
       or new.conversation_id is distinct from old.conversation_id then
      raise exception 'Only read_at can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "messages mark read" on public.messages;
create policy "messages mark read" on public.messages
  for update using (auth.uid() = recipient) with check (auth.uid() = recipient);


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Создание диалогов
-- ─────────────────────────────────────────────────────────────────────────

-- Личный диалог: найти или создать. Идемпотентна по построению — повторный
-- вызов возвращает тот же id, а уникальный индекс по паре не даёт двум
-- одновременным вызовам развести переписку по двум веткам.
--
-- Состояние участника выставляется по праву писать: 'accepted', если человек
-- принимает сообщения от собеседника сразу, иначе 'pending' — и диалог
-- ложится к нему в «Запросы», а не в чаты.
create or replace function public.direct_conversation(p_peer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_low  uuid;
  v_high uuid;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;
  if public.is_blocked_between(v_uid, p_peer) then
    raise exception 'Этот диалог недоступен' using errcode = '42501';
  end if;

  v_low  := least(v_uid, p_peer);
  v_high := greatest(v_uid, p_peer);

  select id into v_id from public.conversations
   where kind = 'direct' and pair_low = v_low and pair_high = v_high;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (kind, created_by, pair_low, pair_high)
  values ('direct', v_uid, v_low, v_high)
  on conflict (pair_low, pair_high) where kind = 'direct' do nothing
  returning id into v_id;

  if v_id is null then
    -- Гонку выиграл кто-то другой: диалог уже есть, и это нормальный исход.
    select id into v_id from public.conversations
     where kind = 'direct' and pair_low = v_low and pair_high = v_high;
    return v_id;
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  insert into public.conversation_members (conversation_id, user_id, state)
  values
    (v_id, v_uid,  case when public.get_message_permission(p_peer, v_uid) = 'direct' then 'accepted' else 'pending' end),
    (v_id, p_peer, case when public.get_message_permission(v_uid, p_peer) = 'direct' then 'accepted' else 'pending' end)
  on conflict (conversation_id, user_id) do nothing;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_id;
end;
$$;

revoke all on function public.direct_conversation(uuid) from public, anon;
grant execute on function public.direct_conversation(uuid) to authenticated;


-- Кто может добавить меня в группу. Блокировка перекрывает всё; дальше —
-- настройка приглашаемого.
create or replace function public.can_invite_to_group(p_inviter uuid, p_invitee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_inviter is null or p_invitee is null or p_inviter = p_invitee then false
    when public.is_blocked_between(p_inviter, p_invitee) then false
    else coalesce((
      select case pr.group_invites
        when 'everyone' then true
        when 'following' then public.follows_user(p_invitee, p_inviter)
        else false
      end
      from public.profiles pr where pr.user_id = p_invitee
    ), false)
  end;
$$;

revoke all on function public.can_invite_to_group(uuid, uuid) from public, anon;
grant execute on function public.can_invite_to_group(uuid, uuid) to authenticated;


-- Групповой диалог. Приглашать можно только тех, кто это разрешил: настройка
-- group_invites у каждого своя ('everyone' | 'following' | 'none').
create or replace function public.create_group_conversation(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_ids   uuid[];
  v_one   uuid;
  v_added int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct u) into v_ids
  from unnest(coalesce(p_members, '{}'::uuid[])) u
  where u is not null and u <> v_uid;

  if v_ids is null or array_length(v_ids, 1) < 1 then
    raise exception 'Выберите хотя бы одного участника' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 49 then
    raise exception 'В группе не больше 50 участников' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22001';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', v_title, v_uid)
  returning id into v_id;

  perform set_config('eataps.trusted_member_write', 'on', true);
  insert into public.conversation_members (conversation_id, user_id, role, state)
  values (v_id, v_uid, 'owner', 'accepted');

  foreach v_one in array v_ids loop
    if public.is_blocked_between(v_uid, v_one) then
      continue;
    end if;
    if public.can_invite_to_group(v_uid, v_one) then
      insert into public.conversation_members (conversation_id, user_id, role, state)
      values (v_id, v_one, 'member',
              case when public.get_message_permission(v_uid, v_one) = 'direct' then 'accepted' else 'pending' end)
      on conflict (conversation_id, user_id) do nothing;
      -- Человек должен узнать, что его куда-то добавили, а не обнаружить это
      -- по всплывшему в списке незнакомому диалогу.
      perform public.push_notification(v_one, v_uid, 'GROUP_INVITE', 'conversation', v_id);
      v_added := v_added + 1;
    end if;
  end loop;
  perform set_config('eataps.trusted_member_write', 'off', true);

  if v_added = 0 then
    raise exception 'Никого из выбранных нельзя добавить в группу' using errcode = '42501';
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public, anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;




-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отправка
-- ─────────────────────────────────────────────────────────────────────────
-- Одна точка входа на личное и групповое сообщение. SECURITY DEFINER, потому
-- что нужно писать в conversations.last_message_at — таблицу, у которой нет
-- клиентской UPDATE-политики и не должно быть.
--
-- Идемпотентность: client_id придумывает клиент ОДИН раз на сообщение и
-- повторяет при каждой попытке. Сервер, увидев знакомый ключ, возвращает уже
-- существующую строку. Без этого «отправил → сеть отвалилась → повторил»
-- давало два одинаковых сообщения ровно там, где повтор и нужен.
create or replace function public.send_conversation_message(
  p_conversation   uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_media          jsonb default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_text      text := nullif(btrim(coalesce(p_text, '')), '');
  v_kind      text;
  v_peer      uuid;
  v_row       public.messages;
  v_my_state  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select c.kind,
         case when c.kind = 'direct'
              then case when c.pair_low = v_uid then c.pair_high else c.pair_low end
         end
    into v_kind, v_peer
  from public.conversations c where c.id = p_conversation;

  if v_kind is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  select state into v_my_state from public.conversation_members
   where conversation_id = p_conversation and user_id = v_uid;
  if v_my_state = 'declined' then
    raise exception 'Вы отказались от этого диалога' using errcode = '42501';
  end if;

  if v_kind = 'direct' then
    if public.get_message_permission(v_uid, v_peer) = 'denied' then
      raise exception 'Этот человек не принимает от вас сообщения' using errcode = '42501';
    end if;
  end if;

  if v_text is null and p_image_url is null and p_media is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;
  if p_media is not null and char_length(p_media::text) > 4000 then
    raise exception 'media reference is too large' using errcode = '22001';
  end if;

  if p_client_id is not null then
    select * into v_row from public.messages m
     where m.sender = v_uid and m.client_id = p_client_id
     limit 1;
    if found then
      return v_row;
    end if;
  end if;

  -- Ответ обязан лежать в ЭТОМ диалоге: иначе цитатой можно было бы вытащить
  -- в чужую переписку кусок своей.
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to and m.conversation_id = p_conversation
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '42501';
  end if;

  insert into public.messages
    (conversation_id, sender, recipient, text, image_url, media, meal_ref,
     reply_to, reply_snapshot, forwarded_name, client_id)
  values
    (p_conversation, v_uid, v_peer, v_text, p_image_url, p_media, p_meal_ref,
     p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id)
  returning * into v_row;

  update public.conversations set last_message_at = v_row.created_at where id = p_conversation;

  -- Отправитель прочитал собственное сообщение по определению, и его же
  -- отправка снимает его отказ, если он раньше сам был в «Запросах».
  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set last_read_at = v_row.created_at,
         archived = false,
         state = case when state = 'pending' then 'accepted' else state end
   where conversation_id = p_conversation and user_id = v_uid;

  -- Новое сообщение возвращает диалог из архива у всех: архив прячет
  -- переписку, а не отключает её.
  update public.conversation_members
     set archived = false
   where conversation_id = p_conversation and archived;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_row;

exception when unique_violation then
  select * into v_row from public.messages m
   where m.sender = v_uid and m.client_id = p_client_id
   limit 1;
  if found then
    return v_row;
  end if;
  raise;
end;
$$;

revoke all on function public.send_conversation_message(uuid, text, text, jsonb, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_conversation_message(uuid, text, text, jsonb, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- Прежний send_message остаётся: на нём стоит ещё не обновлённый клиент.
-- Теперь он находит или создаёт диалог и передаёт работу общей функции —
-- второй реализации отправки в системе быть не должно.
create or replace function public.send_message(
  p_recipient      uuid,
  p_text           text default null,
  p_image_url      text default null,
  p_meal_ref       jsonb default null,
  p_reply_to       uuid default null,
  p_reply_snapshot jsonb default null,
  p_forwarded_name text default null,
  p_client_id      uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
begin
  v_conv := public.direct_conversation(p_recipient);
  return public.send_conversation_message(
    v_conv, p_text, p_image_url, null, p_meal_ref,
    p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id
  );
end;
$$;

revoke all on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Список диалогов
-- ─────────────────────────────────────────────────────────────────────────
-- Одна строка на диалог со всем, что нужно нарисовать: карточка собеседника
-- или название группы, последнее сообщение, непрочитанные, заглушение,
-- архив, состояние запроса. Без этого список из двадцати диалогов означал бы
-- двадцать походов за именами и двадцать — за счётчиками.
--
-- Непрочитанные считаются по указателю last_read_at, а не по read_at на
-- каждом сообщении: в группе у пятерых участников это пять разных чисел, и
-- хранить их на строке сообщения нечем.
drop function if exists public.list_conversations_v2(text, boolean, int, timestamptz);

create or replace function public.list_conversations_v2(
  p_state    text default null,       -- null = все, 'accepted' | 'pending'
  p_archived boolean default false,
  p_limit    int default 40,
  p_before   timestamptz default null
)
returns table (
  id             uuid,
  kind           text,
  title          text,
  avatar_url     text,
  peer_id        uuid,
  peer_username  text,
  peer_name      text,
  peer_avatar    text,
  peer_private   boolean,
  members_count  int,
  state          text,
  archived       boolean,
  muted_until    timestamptz,
  last_id        uuid,
  last_sender    uuid,
  last_sender_name text,
  last_text      text,
  last_image     text,
  last_media     jsonb,
  last_meal      boolean,
  last_unsent    boolean,
  last_at        timestamptz,
  unread_count   int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select c.*, m.state as my_state, m.archived as my_archived,
           m.muted_until as my_muted, m.last_read_at, m.cleared_at
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    cross join me
    where m.user_id = me.uid and m.left_at is null
  ),
  peer as (
    select mine.id as cid,
           case when mine.kind = 'direct'
                then case when mine.pair_low = (select uid from me) then mine.pair_high else mine.pair_low end
           end as pid
    from mine
  ),
  last_msg as (
    select distinct on (x.conversation_id)
           x.conversation_id, x.id, x.sender, x.text, x.image_url, x.media,
           (x.meal_ref is not null) as has_meal, x.unsent_at, x.created_at
    from public.messages x
    join mine on mine.id = x.conversation_id
    where (mine.cleared_at is null or x.created_at > mine.cleared_at)
      and not exists (
        select 1 from public.message_deletions d
        where d.message_id = x.id and d.user_id = (select uid from me)
      )
    order by x.conversation_id, x.created_at desc, x.id desc
  )
  select
    mine.id, mine.kind, mine.title, mine.avatar_url,
    peer.pid, pp.username, pp.display_name, pp.avatar_url, pp.is_private,
    (select count(*)::int from public.conversation_members cm
      where cm.conversation_id = mine.id and cm.left_at is null),
    mine.my_state, mine.my_archived, mine.my_muted,
    last_msg.id, last_msg.sender, sp.display_name,
    case when last_msg.unsent_at is null then last_msg.text end,
    case when last_msg.unsent_at is null then last_msg.image_url end,
    case when last_msg.unsent_at is null then last_msg.media end,
    coalesce(last_msg.has_meal, false) and last_msg.unsent_at is null,
    last_msg.unsent_at is not null,
    coalesce(last_msg.created_at, mine.last_message_at),
    (select count(*)::int from public.messages u
      where u.conversation_id = mine.id
        and u.sender <> (select uid from me)
        and u.unsent_at is null
        and (mine.last_read_at is null or u.created_at > mine.last_read_at)
        and (mine.cleared_at is null or u.created_at > mine.cleared_at))
  from mine
  join peer on peer.cid = mine.id
  left join last_msg on last_msg.conversation_id = mine.id
  left join public.profiles pp on pp.user_id = peer.pid
  left join public.profiles sp on sp.user_id = last_msg.sender
  where mine.my_state <> 'declined'
    and coalesce(mine.my_archived, false) = coalesce(p_archived, false)
    and (p_state is null or mine.my_state = p_state)
    and (peer.pid is null or not public.is_blocked_between(peer.pid, (select uid from me)))
    -- Диалог без единого сообщения показывать незачем: он появляется в тот
    -- момент, когда человек открыл переписку, но ещё ничего не написал.
    and (last_msg.id is not null or mine.kind = 'group')
    and (p_before is null or coalesce(last_msg.created_at, mine.last_message_at) < p_before)
  order by coalesce(last_msg.created_at, mine.last_message_at) desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_conversations_v2(text, boolean, int, timestamptz) from public, anon;
grant execute on function public.list_conversations_v2(text, boolean, int, timestamptz) to authenticated;


-- Прежний list_conversations остаётся для ещё не обновлённого клиента и
-- пересобран поверх новой модели: две независимые выборки одного и того же
-- списка разошлись бы на первой же правке.
drop function if exists public.list_conversations(int, text);

create or replace function public.list_conversations(
  p_limit int default 100,
  p_state text default null
)
returns table (
  peer_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  state        text,
  last_id      uuid,
  last_sender  uuid,
  last_text    text,
  last_image   text,
  last_meal    boolean,
  last_at      timestamptz,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select c.peer_id, c.peer_username, c.peer_name, c.peer_avatar, c.state,
         c.last_id, c.last_sender, c.last_text, c.last_image, c.last_meal,
         c.last_at, c.unread_count
  from public.list_conversations_v2(p_state, false, least(greatest(coalesce(p_limit, 100), 1), 100), null) c
  where c.kind = 'direct' and c.peer_id is not null;
$$;

revoke all on function public.list_conversations(int, text) from public, anon;
grant execute on function public.list_conversations(int, text) to authenticated;


-- Счётчики для бейджей: сообщения, запросы на переписку, запросы на подписку.
-- Одним запросом — их спрашивают на каждом открытии приложения и по каждому
-- realtime-событию.
drop function if exists public.unread_totals();

create or replace function public.unread_totals()
returns table (
  messages         int,
  message_requests int,
  follow_requests  int,
  notifications    int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mine as (
    select m.conversation_id, m.state, m.last_read_at, m.cleared_at, m.muted_until
    from public.conversation_members m, me
    where m.user_id = me.uid and m.left_at is null and m.state <> 'declined'
  ),
  counts as (
    select mine.state,
           (select count(*) from public.messages u, me
             where u.conversation_id = mine.conversation_id
               and u.sender <> me.uid
               and u.unsent_at is null
               and (mine.last_read_at is null or u.created_at > mine.last_read_at)
               and (mine.cleared_at is null or u.created_at > mine.cleared_at)) as n
    from mine
    -- Заглушённый диалог не участвует в бейдже: заглушение ровно об этом.
    where mine.muted_until is null or mine.muted_until <= now()
  )
  select
    coalesce((select sum(n)::int from counts where state = 'accepted'), 0),
    coalesce((select count(*)::int from mine where state = 'pending'), 0),
    public.follow_request_count(),
    public.unread_notification_count();
$$;

revoke all on function public.unread_totals() from public, anon;
grant execute on function public.unread_totals() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Чтение переписки
-- ─────────────────────────────────────────────────────────────────────────
-- Страницами, начиная с конца. Скрытые «у себя» и обрезанные очисткой не
-- отдаются вовсе — фильтровать это на клиенте значило бы возить по сети то,
-- что человек велел убрать.
drop function if exists public.list_conversation_messages(uuid, int, timestamptz, uuid);

create or replace function public.list_conversation_messages(
  p_conversation uuid,
  p_limit int default 40,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id             uuid,
  conversation_id uuid,
  sender         uuid,
  recipient      uuid,
  text           text,
  image_url      text,
  media          jsonb,
  meal_ref       jsonb,
  reply_to       uuid,
  reply_snapshot jsonb,
  forwarded_name text,
  reactions      jsonb,
  unsent_at      timestamptz,
  edited_at      timestamptz,
  created_at     timestamptz,
  read_at        timestamptz,
  client_id      uuid,
  media_viewed   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  mem as (
    select m.cleared_at from public.conversation_members m, me
    where m.conversation_id = p_conversation and m.user_id = me.uid and m.left_at is null
      -- Блокировка проверяется ЗДЕСЬ, а не только политикой messages.
      --
      -- Функция SECURITY DEFINER, то есть RLS её не касается: без этой строки
      -- заблокированный человек, у которого сохранился id диалога, читал бы всю
      -- историю через RPC, хотя прямой select из messages ему уже ничего не
      -- отдаёт. Два разных ответа на один вопрос — это и есть дыра.
      and not exists (
        select 1 from public.conversations c
        where c.id = p_conversation and c.kind = 'direct'
          and public.is_blocked_between(
                case when c.pair_low = me.uid then c.pair_high else c.pair_low end,
                me.uid)
      )
  )
  select
    x.id, x.conversation_id, x.sender, x.recipient,
    case when x.unsent_at is null then x.text end,
    case when x.unsent_at is null then x.image_url end,
    case when x.unsent_at is null then x.media end,
    case when x.unsent_at is null then x.meal_ref end,
    x.reply_to,
    case when x.unsent_at is null then x.reply_snapshot end,
    x.forwarded_name,
    coalesce(x.reactions, '{}'::jsonb),
    x.unsent_at, x.edited_at, x.created_at, x.read_at, x.client_id,
    exists (select 1 from public.message_views v, me
             where v.message_id = x.id and v.user_id = me.uid)
  from public.messages x, me, mem
  where x.conversation_id = p_conversation
    and (mem.cleared_at is null or x.created_at > mem.cleared_at)
    and (p_before_at is null
         or (x.created_at, x.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and not exists (
      select 1 from public.message_deletions d
      where d.message_id = x.id and d.user_id = me.uid
    )
  order by x.created_at desc, x.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_conversation_messages(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_conversation_messages(uuid, int, timestamptz, uuid) to authenticated;


-- Отметить диалог прочитанным. Один UPDATE по указателю вместо UPDATE на
-- каждое сообщение: в переписке на две тысячи реплик разница между этими
-- двумя способами — три порядка.
--
-- read_at на самих сообщениях продолжаем ставить ТОЛЬКО в личном диалоге и
-- только если получатель разрешил показывать прочтение: на этой колонке
-- держится «Прочитано» у собеседника и счётчик у необновлённого клиента.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_receipts boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    return;
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select kind into v_kind from public.conversations where id = p_conversation;
  select read_receipts into v_receipts from public.profiles where user_id = v_uid;

  if v_kind = 'direct' and coalesce(v_receipts, true) then
    update public.messages
       set read_at = now()
     where conversation_id = p_conversation
       and recipient = v_uid
       and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Прежнее имя, прежняя сигнатура: старый клиент зовёт его по собеседнику.
create or replace function public.mark_messages_read(p_sender uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    return;
  end if;
  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_sender) and pair_high = greatest(v_uid, p_sender);
  if v_conv is not null then
    perform public.mark_conversation_read(v_conv);
  else
    update public.messages set read_at = now()
     where recipient = v_uid and sender = p_sender and read_at is null;
  end if;
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;


-- Видно ли мне, что собеседник прочитал. Взаимно, как и присутствие: кто
-- скрыл своё прочтение, не видит и чужого.
create or replace function public.read_receipts_visible(p_peer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select read_receipts from public.profiles where user_id = p_peer), true)
     and coalesce((select read_receipts from public.profiles where user_id = auth.uid()), true)
     and not public.is_blocked_between(p_peer, auth.uid());
$$;

revoke all on function public.read_receipts_visible(uuid) from public, anon;
grant execute on function public.read_receipts_visible(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Запросы на переписку
-- ─────────────────────────────────────────────────────────────────────────
-- Открытие запроса НЕ означает согласия: человек читает сообщение и решает
-- отдельно. Решение хранится в двух местах намеренно — в состоянии участника
-- (оно про этот диалог) и в message_grants (оно про человека и переживает
-- удаление диалога). Обе записи ставит одна функция, поэтому разойтись им
-- негде.
create or replace function public.accept_conversation_request(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_peer uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set state = 'accepted'
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select c.kind,
         case when c.kind = 'direct'
              then case when c.pair_low = v_uid then c.pair_high else c.pair_low end
         end
    into v_kind, v_peer
  from public.conversations c where c.id = p_conversation;

  if v_peer is not null then
    insert into public.message_grants (owner_id, peer_id, state)
    values (v_uid, v_peer, 'accepted')
    on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();
  end if;

  -- Событие о запросе больше не актуально: человек его разобрал.
  delete from public.notifications
   where recipient_id = v_uid and type = 'MESSAGE_REQUEST'
     and (entity_id = v_peer or entity_id = p_conversation);

  return 'accepted';
end;
$$;

revoke all on function public.accept_conversation_request(uuid) from public, anon;
grant execute on function public.accept_conversation_request(uuid) to authenticated;


-- Отказ. НЕ блокировка: человек остаётся подписчиком, видит посты и профиль —
-- он теряет ровно право писать. Отказ от навязчивого сообщения не должен
-- стоить так же дорого, как блокировка.
create or replace function public.decline_conversation_request(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_peer uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_conversation_member(p_conversation, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set state = 'declined'
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);

  select case when c.pair_low = v_uid then c.pair_high else c.pair_low end
    into v_peer
  from public.conversations c where c.id = p_conversation and c.kind = 'direct';

  if v_peer is not null then
    insert into public.message_grants (owner_id, peer_id, state)
    values (v_uid, v_peer, 'declined')
    on conflict (owner_id, peer_id) do update set state = 'declined', created_at = now();
  end if;

  delete from public.notifications
   where recipient_id = v_uid
     and type in ('MESSAGE', 'MESSAGE_REQUEST')
     and (entity_id = v_peer or entity_id = p_conversation);

  return 'declined';
end;
$$;

revoke all on function public.decline_conversation_request(uuid) from public, anon;
grant execute on function public.decline_conversation_request(uuid) to authenticated;


-- Прежние имена по собеседнику — для ещё не обновлённого клиента.
create or replace function public.accept_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'accepted')
  on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();

  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_peer) and pair_high = greatest(v_uid, p_peer);
  if v_conv is not null then
    perform set_config('eataps.trusted_member_write', 'on', true);
    update public.conversation_members set state = 'accepted'
     where conversation_id = v_conv and user_id = v_uid;
    perform set_config('eataps.trusted_member_write', 'off', true);
  end if;

  return 'accepted';
end;
$$;

create or replace function public.decline_message_request(p_peer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'declined')
  on conflict (owner_id, peer_id) do update set state = 'declined', created_at = now();

  select id into v_conv from public.conversations
   where kind = 'direct'
     and pair_low = least(v_uid, p_peer) and pair_high = greatest(v_uid, p_peer);
  if v_conv is not null then
    perform set_config('eataps.trusted_member_write', 'on', true);
    update public.conversation_members set state = 'declined'
     where conversation_id = v_conv and user_id = v_uid;
    perform set_config('eataps.trusted_member_write', 'off', true);
  end if;

  delete from public.notifications
   where recipient_id = v_uid and actor_id = p_peer and type in ('MESSAGE', 'MESSAGE_REQUEST');

  return 'declined';
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
revoke all on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;
grant execute on function public.decline_message_request(uuid) to authenticated;

-- Счётчик запросов на переписку — теперь по состоянию участника.
create or replace function public.pending_request_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.conversation_members m
  where m.user_id = auth.uid() and m.left_at is null and m.state = 'pending'
    and exists (select 1 from public.messages x where x.conversation_id = m.conversation_id);
$$;

revoke all on function public.pending_request_count() from public, anon;
grant execute on function public.pending_request_count() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Действия над сообщением
-- ─────────────────────────────────────────────────────────────────────────

-- Отзыв «у всех». Строку не удаляем: на неё ссылаются ответы, и удаление
-- превратило бы цитату в сироту. Содержимое стирается, остаётся пометка.
create or replace function public.unsend_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.messages where id = p_message;
  if not found then
    return;
  end if;
  if v_row.sender <> v_uid then
    raise exception 'Отозвать можно только своё сообщение' using errcode = '42501';
  end if;
  if v_row.unsent_at is not null then
    return;
  end if;

  perform set_config('eataps.trusted_message_write', 'on', true);
  update public.messages
     set unsent_at = now(),
         text = null, image_url = null, media = null, meal_ref = null,
         reply_snapshot = null, reactions = '{}'::jsonb
   where id = p_message;
  perform set_config('eataps.trusted_message_write', 'off', true);

  -- Событие о сообщении, которого больше нет, вести некуда.
  delete from public.notifications
   where actor_id = v_uid
     and type in ('MESSAGE', 'MESSAGE_REQUEST', 'MESSAGE_REACTION')
     and entity_id = p_message;
end;
$$;

revoke all on function public.unsend_message(uuid) from public, anon;
grant execute on function public.unsend_message(uuid) to authenticated;


-- Скрыть у себя. У собеседника сообщение остаётся — в этом вся разница с
-- отзывом, и путать их нельзя.
create or replace function public.delete_message_for_me(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select conversation_id into v_conv from public.messages where id = p_message;
  if v_conv is not null and not public.is_conversation_member(v_conv, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  insert into public.message_deletions (message_id, user_id)
  values (p_message, v_uid)
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.delete_message_for_me(uuid) from public, anon;
grant execute on function public.delete_message_for_me(uuid) to authenticated;


-- Реакция. Одна на человека: повторное нажатие тем же эмодзи снимает её,
-- другим — заменяет. Форма хранения прежняя ({ user_id: emoji }), поэтому
-- ещё не обновлённый клиент продолжает читать реакции как читал.
create or replace function public.set_message_reaction(p_message uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.messages;
  v_key  text;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_emoji is not null and p_emoji not in ('🥕', '❤️', '😂', '😮', '😢', '😡', '👍') then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;

  select * into v_row from public.messages where id = p_message for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_row.unsent_at is not null then
    return '{}'::jsonb;
  end if;

  if v_row.conversation_id is not null then
    if not public.is_conversation_member(v_row.conversation_id, v_uid) then
      raise exception 'Вы не участник этого диалога' using errcode = '42501';
    end if;
  elsif v_uid <> v_row.sender and v_uid <> v_row.recipient then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  v_key := v_uid::text;
  if p_emoji is null or coalesce(v_row.reactions, '{}'::jsonb)->>v_key = p_emoji then
    v_next := coalesce(v_row.reactions, '{}'::jsonb) - v_key;
  else
    v_next := jsonb_set(coalesce(v_row.reactions, '{}'::jsonb), array[v_key], to_jsonb(p_emoji), true);
  end if;

  perform set_config('eataps.trusted_message_write', 'on', true);
  update public.messages set reactions = v_next where id = p_message;
  perform set_config('eataps.trusted_message_write', 'off', true);

  -- Автору — событие о реакции. Своей же реакции на своё сообщение не бывает:
  -- push_notification отбрасывает такое сам.
  if v_next ? v_key then
    perform public.push_notification(
      v_row.sender, v_uid, 'MESSAGE_REACTION', 'message', p_message,
      jsonb_build_object('reaction', p_emoji)
    );
  end if;

  return v_next;
end;
$$;

revoke all on function public.set_message_reaction(uuid, text) from public, anon;
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

-- Прежнее имя — тонкая обёртка, чтобы не держать вторую реализацию.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.set_message_reaction(p_message_id, p_emoji);
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;


-- Отметить одноразовое вложение просмотренным. Сервер после этого перестаёт
-- отдавать ссылку — но честно предупреждаем в интерфейсе: помешать снять
-- скриншот веб-клиент не может, и обещать этого нельзя.
create or replace function public.mark_media_viewed(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select conversation_id into v_conv from public.messages where id = p_message;
  if v_conv is null or not public.is_conversation_member(v_conv, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  insert into public.message_views (message_id, user_id)
  values (p_message, v_uid)
  on conflict (message_id, user_id) do nothing;
end;
$$;

revoke all on function public.mark_media_viewed(uuid) from public, anon;
grant execute on function public.mark_media_viewed(uuid) to authenticated;


-- Пересылка. Создаёт НОВОЕ сообщение в каждом выбранном диалоге — отдать
-- чужой conversation_id значило бы впустить человека в чужую переписку.
-- Права на каждый диалог проверяются по отдельности.
create or replace function public.forward_message(p_message uuid, p_conversations uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.messages;
  v_conv uuid;
  v_from text;
  v_sent int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.messages where id = p_message;
  if not found or v_row.unsent_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_row.conversation_id is not null
     and not public.is_conversation_member(v_row.conversation_id, v_uid) then
    raise exception 'Вы не участник этого диалога' using errcode = '42501';
  end if;

  select coalesce(display_name, username) into v_from from public.profiles where user_id = v_row.sender;

  foreach v_conv in array coalesce(p_conversations[1:20], '{}'::uuid[]) loop
    if public.is_conversation_member(v_conv, v_uid) then
      perform public.send_conversation_message(
        v_conv, v_row.text, v_row.image_url, v_row.media, v_row.meal_ref,
        null, null, v_from, null
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.forward_message(uuid, uuid[]) from public, anon;
grant execute on function public.forward_message(uuid, uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Управление диалогом
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.conversation_info(uuid);

create or replace function public.conversation_info(p_conversation uuid)
returns table (
  id            uuid,
  kind          text,
  title         text,
  avatar_url    text,
  created_by    uuid,
  created_at    timestamptz,
  my_role       text,
  my_state      text,
  archived      boolean,
  muted_until   timestamptz,
  peer_id       uuid,
  -- Карточка собеседника приезжает здесь же. Диалог можно открыть, зная
  -- только его id — из уведомления о группе или из поиска по сообщениям, — и
  -- тогда имени взять больше неоткуда: заголовок «Диалог» вместо имени
  -- человека выглядит как поломка.
  peer_username text,
  peer_name     text,
  peer_avatar   text,
  members_count int,
  media_count   int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.kind, c.title, c.avatar_url, c.created_by, c.created_at,
    m.role, m.state, m.archived, m.muted_until,
    pp.user_id, pp.username, pp.display_name, pp.avatar_url,
    (select count(*)::int from public.conversation_members x
      where x.conversation_id = c.id and x.left_at is null),
    (select count(*)::int from public.messages x
      where x.conversation_id = c.id and x.unsent_at is null
        and (x.image_url is not null or x.media is not null))
  from public.conversations c
  join public.conversation_members m
    on m.conversation_id = c.id and m.user_id = auth.uid() and m.left_at is null
  left join public.profiles pp
    on c.kind = 'direct'
   and pp.user_id = case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end
  where c.id = p_conversation;
$$;

revoke all on function public.conversation_info(uuid) from public, anon;
grant execute on function public.conversation_info(uuid) to authenticated;


drop function if exists public.conversation_member_list(uuid);

create or replace function public.conversation_member_list(p_conversation uuid)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text,
  role         text,
  joined_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, m.role, m.joined_at
  from public.conversation_members m
  join public.profiles p on p.user_id = m.user_id
  where m.conversation_id = p_conversation
    and m.left_at is null
    and public.is_conversation_member(p_conversation, auth.uid())
  order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.joined_at;
$$;

revoke all on function public.conversation_member_list(uuid) from public, anon;
grant execute on function public.conversation_member_list(uuid) to authenticated;


create or replace function public.rename_conversation(p_conversation uuid, p_title text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Переименовать группу может администратор' using errcode = '42501';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'Слишком длинное название' using errcode = '22001';
  end if;

  update public.conversations set title = v_title
   where id = p_conversation and kind = 'group';
  return v_title;
end;
$$;

revoke all on function public.rename_conversation(uuid, text) from public, anon;
grant execute on function public.rename_conversation(uuid, text) to authenticated;


create or replace function public.add_conversation_members(p_conversation uuid, p_members uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_one   uuid;
  v_added int := 0;
  v_kind  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select kind into v_kind from public.conversations where id = p_conversation;
  if v_kind <> 'group' then
    raise exception 'Добавлять людей можно только в группу' using errcode = '22023';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Добавлять участников может администратор' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members
       where conversation_id = p_conversation and left_at is null) >= 50 then
    raise exception 'В группе не больше 50 участников' using errcode = '22023';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  foreach v_one in array coalesce(p_members[1:50], '{}'::uuid[]) loop
    if v_one is not null and v_one <> v_uid and public.can_invite_to_group(v_uid, v_one) then
      insert into public.conversation_members (conversation_id, user_id, role, state)
      values (p_conversation, v_one, 'member',
              case when public.get_message_permission(v_uid, v_one) = 'direct' then 'accepted' else 'pending' end)
      on conflict (conversation_id, user_id)
      do update set left_at = null
      where conversation_members.left_at is not null;
      perform public.push_notification(v_one, v_uid, 'GROUP_INVITE', 'conversation', p_conversation);
      v_added := v_added + 1;
    end if;
  end loop;
  perform set_config('eataps.trusted_member_write', 'off', true);

  return v_added;
end;
$$;

revoke all on function public.add_conversation_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_conversation_members(uuid, uuid[]) to authenticated;


create or replace function public.remove_conversation_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.conversation_role(p_conversation, v_uid) not in ('owner', 'admin') then
    raise exception 'Убирать участников может администратор' using errcode = '42501';
  end if;
  if public.conversation_role(p_conversation, p_user) = 'owner' then
    raise exception 'Создателя группы убрать нельзя' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set left_at = now()
   where conversation_id = p_conversation and user_id = p_user and left_at is null;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.remove_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.remove_conversation_member(uuid, uuid) to authenticated;


create or replace function public.set_conversation_role(p_conversation uuid, p_user uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  -- Роль «создатель» не передаётся и не назначается: она одна на группу и
  -- определяется тем, кто её завёл.
  if public.conversation_role(p_conversation, v_uid) <> 'owner' then
    raise exception 'Назначать администраторов может только создатель' using errcode = '42501';
  end if;
  if public.conversation_role(p_conversation, p_user) = 'owner' then
    raise exception 'Роль создателя не меняется' using errcode = '42501';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set role = p_role
   where conversation_id = p_conversation and user_id = p_user and left_at is null;
  perform set_config('eataps.trusted_member_write', 'off', true);
  return p_role;
end;
$$;

revoke all on function public.set_conversation_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_conversation_role(uuid, uuid, text) to authenticated;


create or replace function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select kind into v_kind from public.conversations where id = p_conversation;
  if v_kind <> 'group' then
    raise exception 'Выйти можно только из группы' using errcode = '22023';
  end if;

  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members set left_at = now()
   where conversation_id = p_conversation and user_id = v_uid and left_at is null;

  -- Группа без создателя не должна остаться без администратора: передаём
  -- роль самому давнему участнику. Иначе состав становится неуправляемым.
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and role = 'owner' and left_at is null
  ) then
    update public.conversation_members set role = 'owner'
     where conversation_id = p_conversation and left_at is null
       and user_id = (
         select user_id from public.conversation_members
         where conversation_id = p_conversation and left_at is null
         order by joined_at limit 1
       );
  end if;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;


-- Заглушить, убрать в архив, очистить у себя. Все три — про МОЮ строку
-- участника и ни на кого больше не влияют.
create or replace function public.set_conversation_muted(p_conversation uuid, p_until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.conversation_members set muted_until = p_until
   where conversation_id = p_conversation and user_id = v_uid;
  return p_until;
end;
$$;

create or replace function public.set_conversation_archived(p_conversation uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.conversation_members set archived = coalesce(p_on, false)
   where conversation_id = p_conversation and user_id = v_uid;
  return coalesce(p_on, false);
end;
$$;

-- «Удалить переписку» — у СЕБЯ. Чужую историю не трогаем: она принадлежит не
-- нам. Ставим отсечку по времени, и всё, что до неё, перестаёт отдаваться.
create or replace function public.clear_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform set_config('eataps.trusted_member_write', 'on', true);
  update public.conversation_members
     set cleared_at = now(), last_read_at = now(), archived = false
   where conversation_id = p_conversation and user_id = v_uid;
  perform set_config('eataps.trusted_member_write', 'off', true);
end;
$$;

revoke all on function public.set_conversation_muted(uuid, timestamptz) from public, anon;
revoke all on function public.set_conversation_archived(uuid, boolean) from public, anon;
revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.set_conversation_muted(uuid, timestamptz) to authenticated;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;
grant execute on function public.clear_conversation(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Общие вложения и поиск по переписке
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.conversation_media(uuid, int, int);

create or replace function public.conversation_media(
  p_conversation uuid, p_limit int default 60, p_offset int default 0
)
returns table (
  id         uuid,
  sender     uuid,
  image_url  text,
  media      jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.sender, x.image_url, x.media, x.created_at
  from public.messages x
  join public.conversation_members m
    on m.conversation_id = x.conversation_id and m.user_id = auth.uid() and m.left_at is null
  where x.conversation_id = p_conversation
    and x.unsent_at is null
    and (x.image_url is not null or x.media is not null)
    and (m.cleared_at is null or x.created_at > m.cleared_at)
    -- Та же проверка блокировки, что и в list_conversation_messages: обе
    -- функции SECURITY DEFINER, и RLS их не прикрывает.
    and not exists (
      select 1 from public.conversations c
      where c.id = p_conversation and c.kind = 'direct'
        and public.is_blocked_between(
              case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end,
              auth.uid())
    )
    and not exists (
      select 1 from public.message_deletions d
      where d.message_id = x.id and d.user_id = auth.uid()
    )
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.conversation_media(uuid, int, int) from public, anon;
grant execute on function public.conversation_media(uuid, int, int) to authenticated;


-- Поиск по сообщениям. Только там, где я участник: p_conversation = null
-- ищет по всем моим диалогам сразу, и это по-прежнему не выходит за пределы
-- моего членства.
drop function if exists public.search_messages(text, uuid, int);

create or replace function public.search_messages(
  p_query text, p_conversation uuid default null, p_limit int default 40
)
returns table (
  id              uuid,
  conversation_id uuid,
  sender          uuid,
  text            text,
  created_at      timestamptz,
  peer_id         uuid,
  title           text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select btrim(coalesce(p_query, '')) as v)
  select x.id, x.conversation_id, x.sender, x.text, x.created_at,
         case when c.kind = 'direct'
              then case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end end,
         c.title
  from public.messages x
  join public.conversation_members m
    on m.conversation_id = x.conversation_id and m.user_id = auth.uid() and m.left_at is null
  join public.conversations c on c.id = x.conversation_id
  cross join q
  where char_length(q.v) >= 2
    and x.unsent_at is null
    and x.text is not null
    and x.text ilike '%' || q.v || '%'
    and (p_conversation is null or x.conversation_id = p_conversation)
    and (m.cleared_at is null or x.created_at > m.cleared_at)
    -- Поиск не должен становиться обходным путём к переписке, закрытой
    -- блокировкой: без этой строки он находил бы её текст.
    and not (c.kind = 'direct' and public.is_blocked_between(
      case when c.pair_low = auth.uid() then c.pair_high else c.pair_low end, auth.uid()))
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 60);
$$;

revoke all on function public.search_messages(text, uuid, int) from public, anon;
grant execute on function public.search_messages(text, uuid, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Хранилище вложений личной переписки
-- ─────────────────────────────────────────────────────────────────────────
-- ЗАКРЫТЫЙ бакет, в отличие от chat-images и post-images. Разница
-- принципиальная: те публичны на чтение, и границей доступа служит не бакет,
-- а RLS на posts/messages — «у кого есть точный URL, тот увидит». Для
-- вложений групповых и личных диалогов этого мало, поэтому здесь граница
-- стоит на самом файле: путь начинается с id диалога, и политика пускает
-- только его участников.
--
-- Клиент получает подписанную ссылку (createSignedUrl) — она живёт час и
-- выдаётся только тому, кого пустила политика.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-media', 'dm-media', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

-- Первый сегмент пути — id диалога. Приведение к uuid делаем через
-- безопасный разбор: невалидный путь должен ОТКЛОНЯТЬСЯ политикой, а не
-- ронять весь запрос ошибкой приведения типа (22P02), которая унесла бы с
-- собой и чтение соседних файлов.
create or replace function public.safe_uuid(p_text text)
returns uuid
language sql
immutable
as $$
  select case when p_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then p_text::uuid end;
$$;

drop policy if exists "dm-media read members" on storage.objects;
create policy "dm-media read members" on storage.objects
  for select using (
    bucket_id = 'dm-media'
    and public.is_conversation_member(
      public.safe_uuid((storage.foldername(name))[1]), auth.uid()
    )
  );

drop policy if exists "dm-media write members" on storage.objects;
create policy "dm-media write members" on storage.objects
  for insert with check (
    bucket_id = 'dm-media'
    and auth.role() = 'authenticated'
    and public.is_conversation_member(
      public.safe_uuid((storage.foldername(name))[1]), auth.uid()
    )
    -- Второй сегмент пути — id автора: свои файлы человек может удалить, а
    -- чужие в его папку не попадут.
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "dm-media delete own" on storage.objects;
create policy "dm-media delete own" on storage.objects
  for delete using (
    bucket_id = 'dm-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Realtime
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_members';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;
end $$;

alter table public.conversations replica identity full;
alter table public.conversation_members replica identity full;
