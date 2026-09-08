-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переписка открывается всем, дневник получает собственную настройку.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО МЕНЯЕТСЯ ПРИНЦИПИАЛЬНО
--
-- 1. ДРУЖБА ПЕРЕСТАЁТ БЫТЬ ПРАВОМ. Понятие «друзья» уходит из продукта: есть
--    только подписки. Взаимная подписка больше ничего не открывает сама по
--    себе — ни переписку, ни дневник. Она остаётся ровно тем, чем и является:
--    фактом, что два человека подписаны друг на друга.
--
--    Таблица friendships и функция is_friend_with НЕ удаляются: на них
--    завязаны видимость постов 'friends' (теперь читается как «взаимным
--    подпискам») и уведомление о взаимной подписке. Удалять их значило бы
--    трогать половину цепочки ради переименования.
--
-- 2. НАПИСАТЬ МОЖНО КОМУ УГОДНО. Сообщение доходит всегда. Но если получатель
--    не подписан на отправителя, диалог попадает к нему во вкладку «Запросы»,
--    а не в основной список: он видит сообщение и решает — разрешить или
--    запретить писать.
--
--    «Запретить» здесь НЕ блокировка. Человек остаётся подписчиком, видит
--    посты и профиль — он просто больше не может отправлять сообщения.
--    Полная блокировка остаётся отдельной кнопкой в профиле: отказ от
--    навязчивого сообщения не должен стоить человеку так дорого.
--
--    ⚠ ЭТО СНИМАЕТ ЕДИНСТВЕННЫЙ БАРЬЕР ОТ СПАМА В ЛИЧКЕ. Раньше им была
--    дружба. Поэтому здесь же вводятся квоты: до принятия запроса можно
--    отправить не больше 5 сообщений, и не больше 20 новых собеседников в час
--    (см. раздел 5). Без них открытая личка — это готовый инструмент рассылки.
--
-- 3. ДНЕВНИК ПОЛУЧАЕТ СОБСТВЕННУЮ НАСТРОЙКУ. Раньше его круг был жёстко зашит
--    («друзьям») и совпадал с кругом переписки. Теперь это выбор человека:
--
--      public    — любой авторизованный
--      followers — подписчики (ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ)
--      mutuals   — только взаимные подписки
--      private   — никто, кроме меня
--
--    ⚠ ПОСЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ. По умолчанию дневник видят ВСЕ
--    ПОДПИСЧИКИ. Подписка односторонняя и согласия владельца не требует —
--    значит, любой человек открывает себе доступ к тому, что ты ешь, одним
--    нажатием. Прежний круг (взаимная подписка) требовал согласия обеих
--    сторон. Это решение владельца продукта, принятое явно; кто хочет
--    прежнего поведения — ставит 'mutuals' в настройках.
--
--    Существующим аккаунтам ставится 'mutuals', а не 'followers': менять
--    круг доступа к чужим личным данным задним числом нельзя. Значение по
--    умолчанию действует только для тех, кто заведётся после миграции.
--
-- 4. Тем же переключателем управляется «был(а) в сети»: это часть того же
--    вопроса «кто меня наблюдает», и две отдельные настройки для него только
--    множили бы состояния.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Настройка видимости дневника
-- ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'diary_audience') then
    create type public.diary_audience as enum ('public', 'followers', 'mutuals', 'private');
  end if;
end $$;

-- Колонку добавляем со значением 'mutuals', чтобы существующие строки не
-- переехали в момент ALTER: сегодняшний круг доступа к дневнику — это ровно
-- взаимная подписка, и он обязан сохраниться. Значение по умолчанию для НОВЫХ
-- аккаунтов ставится отдельным шагом ниже, и это видно в диффе.
alter table public.profiles
  add column if not exists diary_visibility public.diary_audience not null default 'mutuals';

alter table public.profiles alter column diary_visibility set default 'followers';

-- Смена настройки. Отдельный RPC, а не UPDATE из клиента: прямой записи в
-- profiles у клиента нет вовсе с 2026-09-05, и заводить её заново ради одной
-- колонки значило бы открыть таблицу целиком.
create or replace function public.set_diary_visibility(p_value text)
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
  if p_value not in ('public', 'followers', 'mutuals', 'private') then
    raise exception 'unknown diary visibility: %', p_value using errcode = '22023';
  end if;

  update public.profiles
     set diary_visibility = p_value::public.diary_audience
   where user_id = v_uid;

  return p_value;
end;
$$;

revoke all on function public.set_diary_visibility(text) from public, anon;
grant execute on function public.set_diary_visibility(text) to authenticated;

create or replace function public.my_diary_visibility()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select diary_visibility::text from public.profiles where user_id = auth.uid();
$$;

revoke all on function public.my_diary_visibility() from public, anon;
grant execute on function public.my_diary_visibility() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Единственный ответ на вопрос «вижу ли я дневник этого человека»
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER обязателен по той же причине, что и у is_blocked_between:
-- функции нужно видеть follows и profiles целиком, а политики этих таблиц
-- отдают вызывающему только его собственные строки.
--
-- Блокировка проверяется ПЕРВОЙ и перекрывает всё, включая 'public'.
-- Доступ тренера сохранён здесь же: держать два разных правила доступа к
-- одной таблице — верный способ разойтись между ними при следующей правке.
create or replace function public.can_view_diary(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    when public.is_blocked_between(p_owner, auth.uid()) then false
    else
      coalesce((
        select case v.diary_visibility
          when 'public' then true
          when 'followers' then exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = p_owner
          )
          when 'mutuals' then public.is_friend_with(auth.uid(), p_owner)
          else false
        end
        from public.profiles v where v.user_id = p_owner
      ), false)
      -- Тренер с принятой связью видит дневник независимо от настройки:
      -- клиент сам отдал ему доступ, и настройка публичности к этому
      -- отношения не имеет.
      or exists (
        select 1 from public.coach_links l
        where l.status = 'accepted' and l.coach = auth.uid() and l.client = p_owner
      )
  end;
$$;

revoke all on function public.can_view_diary(uuid) from public, anon;
grant execute on function public.can_view_diary(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Дневник и присутствие переходят на настройку
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;
drop policy if exists "state select by diary visibility" on public.app_state;
create policy "state select by diary visibility" on public.app_state
  for select using (
    auth.uid() = app_state.user_id
    or public.can_view_diary(app_state.user_id)
  );

drop policy if exists "presence select self or friends" on public.presence;
drop policy if exists "presence select by diary visibility" on public.presence;
create policy "presence select by diary visibility" on public.presence
  for select using (
    auth.uid() = presence.user_id
    or public.can_view_diary(presence.user_id)
  );

-- Выборка дневника для чужого экрана. Имя friend_state осталось от модели, где
-- круг доступа назывался дружбой; смысла «только друзьям» в нём больше нет.
-- Заводим внятное имя, а старое оставляем тонкой обёрткой: фронтенд может
-- выкатываться и до, и после этой миграции.
create or replace function public.visible_diary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.can_view_diary(p_user_id)
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',           a.state->'profile'->'name',
        'avatar',         a.state->'profile'->'avatar',
        'bio',            a.state->'profile'->'bio',
        'guiltyPleasure', a.state->'profile'->'guiltyPleasure',
        'targets',        jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
      ),
      'days', coalesce((
        select jsonb_object_agg(d.key, jsonb_build_object('meals', coalesce(d.value->'meals', '[]'::jsonb)))
        from jsonb_each(coalesce(a.state->'days', '{}'::jsonb)) d
      ), '{}'::jsonb),
      'customFoods', coalesce((
        select jsonb_agg(f)
        from jsonb_array_elements(coalesce(a.state->'customFoods', '[]'::jsonb)) f
        where f->>'kind' = 'composite' and f ? 'recipe'
      ), '[]'::jsonb)
    ))
    else null
  end
  from public.app_state a
  where a.user_id = p_user_id;
$$;

revoke all on function public.visible_diary(uuid) from public, anon;
grant execute on function public.visible_diary(uuid) to authenticated;

create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.visible_diary(p_user_id);
$$;

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Разрешения на переписку
-- ─────────────────────────────────────────────────────────────────────────
-- Строка появляется только когда получатель ПРИНЯЛ решение. Состояние
-- «запрос висит» не хранится вовсе: оно вычисляется как «решения нет и
-- получатель не подписан на отправителя». Так нельзя рассинхронизировать
-- таблицу с графом подписок, и не нужен триггер, создающий строку на каждое
-- первое сообщение.
create table if not exists public.message_grants (
  owner_id   uuid not null references auth.users(id) on delete cascade,  -- получатель, он решает
  peer_id    uuid not null references auth.users(id) on delete cascade,  -- отправитель
  state      text not null check (state in ('accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (owner_id, peer_id),
  constraint message_grants_no_self check (owner_id <> peer_id)
);

create index if not exists message_grants_peer_idx on public.message_grants (peer_id, state);

alter table public.message_grants enable row level security;

-- Читать можно обе свои стороны: получателю нужно видеть свои решения,
-- отправителю — понимать, почему он больше не может писать.
drop policy if exists "message grants select own" on public.message_grants;
create policy "message grants select own" on public.message_grants
  for select using (auth.uid() = owner_id or auth.uid() = peer_id);

-- INSERT/UPDATE/DELETE-политик нет: решение принимается только через RPC ниже.
-- Иначе отправитель вписал бы себе 'accepted' прямым запросом.

-- Существующие переписки не должны задним числом уехать в «Запросы»: люди уже
-- общаются, и предъявлять им запрос на разговор, который идёт полгода, — это
-- поломка, а не приватность. Проставляем согласие по факту существующей
-- переписки, в обе стороны.
insert into public.message_grants (owner_id, peer_id, state)
select distinct m.recipient, m.sender, 'accepted'
from public.messages m
where m.recipient <> m.sender
on conflict (owner_id, peer_id) do nothing;

insert into public.message_grants (owner_id, peer_id, state)
select distinct m.sender, m.recipient, 'accepted'
from public.messages m
where m.recipient <> m.sender
on conflict (owner_id, peer_id) do nothing;


-- Состояние диалога глазами его владельца.
--   accepted — общаемся: владелец подписан на собеседника или принял его;
--   declined — владелец запретил писать;
--   pending  — сообщение пришло, решения ещё нет. Это и есть «Запрос».
create or replace function public.conversation_state(p_owner uuid, p_peer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select g.state from public.message_grants g
                    where g.owner_id = p_owner and g.peer_id = p_peer), '') = 'declined'
      then 'declined'
    when exists (select 1 from public.message_grants g
                  where g.owner_id = p_owner and g.peer_id = p_peer and g.state = 'accepted')
      then 'accepted'
    -- Подписка владельца на собеседника — это уже согласие его слушать.
    -- Отдельного нажатия «разрешить» она не требует.
    when exists (select 1 from public.follows f
                  where f.follower_id = p_owner and f.following_id = p_peer)
      then 'accepted'
    else 'pending'
  end;
$$;

revoke all on function public.conversation_state(uuid, uuid) from public, anon;
grant execute on function public.conversation_state(uuid, uuid) to authenticated;


-- Право отправить сообщение. Открыто всем, КРОМЕ двух случаев: полная
-- блокировка и явный отказ получателя.
create or replace function public.can_message(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_sender is not null
     and p_recipient is not null
     and p_sender <> p_recipient
     and not public.is_blocked_between(p_sender, p_recipient)
     and not exists (
       select 1 from public.message_grants g
       where g.owner_id = p_recipient and g.peer_id = p_sender and g.state = 'declined'
     );
$$;

revoke all on function public.can_message(uuid, uuid) from public, anon;
grant execute on function public.can_message(uuid, uuid) to authenticated;

-- Переписка больше не привилегия взаимной подписки.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and public.can_message(sender, recipient)
  );


-- Разрешить и запретить. Обе — от имени получателя и только про себя:
-- p_peer участвует лишь как вторая половина ключа, подставить чужой owner_id
-- невозможно по построению.
create or replace function public.accept_message_request(p_peer uuid)
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
  if p_peer is null or p_peer = v_uid then
    raise exception 'bad peer' using errcode = '22023';
  end if;

  insert into public.message_grants (owner_id, peer_id, state)
  values (v_uid, p_peer, 'accepted')
  on conflict (owner_id, peer_id) do update set state = 'accepted', created_at = now();

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

  -- Уведомления от него убираем: человек только что сказал, что не хочет
  -- этого разговора, и бейдж о нём — продолжение того же разговора.
  delete from public.notifications
   where recipient_id = v_uid and actor_id = p_peer and type = 'MESSAGE';

  return 'declined';
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
revoke all on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;
grant execute on function public.decline_message_request(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Квоты: то, что раньше делала дружба
-- ─────────────────────────────────────────────────────────────────────────
-- Пока личка была открыта только друзьям, спам в ней был невозможен по
-- построению — написать мог лишь тот, кого впустили. Теперь написать может
-- каждый, и без ограничений это готовый инструмент рассылки: перебрать ники
-- поиском и разослать всем по сообщению.
--
-- Два потолка, оба высокие для живого человека и низкие для рассылки:
--   • до принятия запроса — не больше 5 сообщений одному человеку. Донести
--     мысль хватает; завалить непрочитанным — нет;
--   • не больше 20 НОВЫХ собеседников в час. Переписка с теми, кто уже
--     ответил или подписан, не ограничена ничем.
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
  -- Диалог уже принят — никаких ограничений.
  if public.conversation_state(new.recipient, new.sender) = 'accepted' then
    return new;
  end if;

  select count(*) into v_pending
  from public.messages m
  where m.sender = new.sender and m.recipient = new.recipient;

  if v_pending >= 5 then
    raise exception 'Пока человек не ответил, можно отправить не больше 5 сообщений'
      using errcode = '54000';
  end if;

  -- Скольким новым людям я написал за час. Считаем по первому сообщению
  -- каждому: продолжение начатого разговора новым собеседником не является.
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

drop trigger if exists messages_request_quota on public.messages;
create trigger messages_request_quota
  before insert on public.messages
  for each row execute function public.limit_unaccepted_messages();

-- Под оба счёта нужен индекс по паре в прямом направлении: messages_pair_idx
-- построен по неупорядоченной паре и для «сколько я написал ЕМУ» не годится.
create index if not exists messages_sender_recipient_idx
  on public.messages (sender, recipient, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Список диалогов знает про состояние
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок меняется (добавились state и карточка собеседника), поэтому
-- нужен DROP: create or replace на смену OUT-параметров отвечает 42P13.
-- Карточка здесь не роскошь — без неё клиент шёл бы за именами вторым
-- запросом на каждого собеседника, а в «Запросах» это заведомо незнакомые
-- люди, которых в кэше нет.
drop function if exists public.list_conversations(int);
drop function if exists public.list_conversations(int, text);

create or replace function public.list_conversations(
  p_limit int default 100,
  p_state text default null          -- null = все, 'accepted' | 'pending' | 'declined'
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
  with mine as (
    select m.recipient as peer_id, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null) as has_meal, m.created_at
    from public.messages m
    where m.sender = auth.uid()
    union all
    select m.sender, m.id, m.sender, m.text, m.image_url,
           (m.meal_ref is not null), m.created_at
    from public.messages m
    where m.recipient = auth.uid()
  ),
  conv as (
    select distinct on (peer_id) peer_id, id, sender, text, image_url, has_meal, created_at
    from mine
    order by peer_id, created_at desc, id desc
  )
  select c.peer_id, p.username, p.display_name, p.avatar_url,
         public.conversation_state(auth.uid(), c.peer_id),
         c.id, c.sender, c.text, c.image_url, c.has_meal, c.created_at,
         (select count(*)::int from public.messages u
           where u.recipient = auth.uid() and u.sender = c.peer_id and u.read_at is null)
  from conv c
  left join public.profiles p on p.user_id = c.peer_id
  where not public.is_blocked_between(c.peer_id, auth.uid())
    and (p_state is null or public.conversation_state(auth.uid(), c.peer_id) = p_state)
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_conversations(int, text) from public, anon;
grant execute on function public.list_conversations(int, text) to authenticated;

-- Счётчик для бейджа на вкладке «Запросы». Отдельная функция, а не длина
-- списка: бейдж спрашивают часто, а тащить ради числа все карточки с
-- аватарами по десятку килобайт каждая — расточительно.
create or replace function public.pending_request_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.sender)::int
  from public.messages m
  where m.recipient = auth.uid()
    and public.conversation_state(auth.uid(), m.sender) = 'pending'
    and not public.is_blocked_between(m.sender, auth.uid());
$$;

revoke all on function public.pending_request_count() from public, anon;
grant execute on function public.pending_request_count() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Отправка: понятный отказ вместо «нарушение политики»
-- ─────────────────────────────────────────────────────────────────────────
-- send_message остаётся SECURITY INVOKER: вставку по-прежнему проверяет
-- политика messages, и дублировать её условия внутри значило бы завести второе
-- место, где они могут разойтись. Добавлена только ранняя проверка с внятным
-- текстом — иначе человек видит «new row violates row-level security policy»
-- и не понимает, что произошло.
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
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_recipient is null or p_recipient = v_uid then
    raise exception 'bad recipient' using errcode = '22023';
  end if;
  if not public.can_message(v_uid, p_recipient) then
    raise exception 'Этот человек не принимает от вас сообщения' using errcode = '42501';
  end if;
  if v_text is null and p_image_url is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;

  if p_client_id is not null then
    select * into v_row from public.messages m
     where m.sender = v_uid and m.client_id = p_client_id
     limit 1;
    if found then
      return v_row;
    end if;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages m
     where m.id = p_reply_to
       and least(m.sender, m.recipient)    = least(v_uid, p_recipient)
       and greatest(m.sender, m.recipient) = greatest(v_uid, p_recipient)
  ) then
    raise exception 'reply target is not in this conversation' using errcode = '42501';
  end if;

  insert into public.messages
    (sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, client_id)
  values
    (v_uid, p_recipient, v_text, p_image_url, p_meal_ref, p_reply_to, p_reply_snapshot, p_forwarded_name, p_client_id)
  returning * into v_row;

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

revoke all on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Отношение: право писать больше не следует из взаимной подписки
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок сохранён, чтобы не переучивать вызывающий код; поля про
-- заявки в друзья как были всегда false, так и остались. Добавлено ровно то,
-- что теперь решает: можно ли писать и в каком состоянии диалог.
drop function if exists public.get_relationship(uuid);

create or replace function public.get_relationship(p_user_id uuid)
returns table (
  following                boolean,
  followed_by              boolean,
  mutual_follow            boolean,
  friend                   boolean,
  incoming_friend_request  boolean,
  outgoing_friend_request  boolean,
  blocked                  boolean,
  blocked_by               boolean,
  friendship_id            uuid,
  can_message              boolean,
  conversation             text,
  can_view_diary           boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  fo as (
    select
      exists (select 1 from public.follows f, me where f.follower_id = me.uid and f.following_id = p_user_id) as fwing,
      exists (select 1 from public.follows f, me where f.follower_id = p_user_id and f.following_id = me.uid) as fwed
  ),
  bl as (
    select
      exists (select 1 from public.blocks b, me where b.blocker_id = me.uid and b.blocked_id = p_user_id) as i_blocked,
      exists (select 1 from public.blocks b, me where b.blocker_id = p_user_id and b.blocked_id = me.uid) as they_blocked
  )
  select
    fo.fwing,
    fo.fwed,
    fo.fwing and fo.fwed,
    fo.fwing and fo.fwed,
    false,
    false,
    bl.i_blocked,
    bl.they_blocked,
    (select f.id from public.friendships f, me
      where (f.requester = me.uid and f.addressee = p_user_id)
         or (f.requester = p_user_id and f.addressee = me.uid)
      limit 1),
    public.can_message((select uid from me), p_user_id),
    public.conversation_state((select uid from me), p_user_id),
    public.can_view_diary(p_user_id)
  from fo, bl;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;

-- Пакетная версия — тем же набором признаков.
drop function if exists public.relationships_with(uuid[]);

create or replace function public.relationships_with(p_user_ids uuid[])
returns table (
  user_id       uuid,
  following     boolean,
  followed_by   boolean,
  mutual_follow boolean,
  friend        boolean,
  blocked       boolean,
  blocked_by    boolean,
  can_message   boolean,
  conversation  text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  ids as (
    select distinct u as id from unnest(p_user_ids[1:200]) u where u is not null
  ),
  fo as (
    select f.following_id as id from public.follows f, me
    where f.follower_id = me.uid and f.following_id in (select id from ids)
  ),
  fb as (
    select f.follower_id as id from public.follows f, me
    where f.following_id = me.uid and f.follower_id in (select id from ids)
  ),
  bl as (
    select b.blocked_id as id from public.blocks b, me
    where b.blocker_id = me.uid and b.blocked_id in (select id from ids)
  ),
  bb as (
    select b.blocker_id as id from public.blocks b, me
    where b.blocked_id = me.uid and b.blocker_id in (select id from ids)
  )
  select
    ids.id,
    ids.id in (select id from fo),
    ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from fo) and ids.id in (select id from fb),
    ids.id in (select id from bl),
    ids.id in (select id from bb),
    public.can_message(me.uid, ids.id),
    public.conversation_state(me.uid, ids.id)
  from ids, me
  where ids.id <> me.uid;
$$;

revoke all on function public.relationships_with(uuid[]) from public, anon;
grant execute on function public.relationships_with(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- Решение по запросу должно доезжать до отправителя сразу: пока он видит
-- «сообщение не отправляется», причину знает только получатель.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_grants'
  ) then
    execute 'alter publication supabase_realtime add table public.message_grants';
  end if;
end $$;

alter table public.message_grants replica identity full;
