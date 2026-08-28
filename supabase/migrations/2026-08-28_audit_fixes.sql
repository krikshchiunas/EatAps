-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — исправления по итогам технического аудита от 2026-08-28.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет, кроме дублей дружбы (см. раздел 6).
--
-- ───────────────────────────────────────────────────────────────────────────
-- ПОРЯДОК ДЕПЛОЯ: сначала ЭТА миграция, потом фронтенд.
--
-- Меняется состав колонок у list_feed, search_users, list_followers,
-- list_following и list_friends — старый фронтенд получит от них ошибку
-- «функция не найдена» (PGRST202) и покажет раздел пустым, а не сломается:
-- isMissingRelation в social.js/supabase.js это уже умеет. Обратный порядок
-- (фронтенд раньше миграции) тоже не ломается по той же причине.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ИСПРАВЛЯЕТСЯ
--
--   1. КРИТИЧНО. Две SELECT-политики на app_state складывались через OR, и
--      друг снова читал строку состояния целиком — вес, рост, возраст, пол,
--      настроение, самочувствие, личную заметку дня. Ровно та утечка, которую
--      закрывала миграция 2026-08-07 и ради которой существует friend_state().
--   2. Блокировка не разрывала связь тренера.
--   3. search_users не экранировала спецсимволы LIKE: запрос '___' совпадал с
--      любым ником и превращал поиск в выгрузку базы.
--   4. follows и coaches читались целиком любым авторизованным.
--   5. Бан не проверялся нигде, кроме обращений в поддержку.
--   6. Гонка при одновременной взаимной подписке: строка friendships не
--      создавалась вовсе либо создавалась дважды.
--   7. Пакетное чтение отношений (было N запросов на список из N человек).
--   8. Счётчики реакций и ответов вместо трёх подзапросов на каждый пост.
--   9. Аватары (base64, десятки килобайт) больше не уезжают в каждой строке
--      ленты и поиска.
--  10. Курсорная пагинация вместо offset в списках людей.
--  11. Прочее: ник нельзя сменить в обход set_username, дневной лимит расхода
--      AI, ограничение частоты обращений к ассистенту, журнал событий Stripe,
--      чистка старых уведомлений.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. app_state: ОДНА политика чтения вместо двух
-- ─────────────────────────────────────────────────────────────────────────
-- Что произошло. Миграция 2026-08-07 сузила чтение до собственной строки:
-- удалила "state select self or friends" и создала "own state select". Через
-- две недели миграция тренеров создала "state select self, friends or coach",
-- удалив по пути только те два имени, которых уже не существовало, — а
-- "own state select" осталась жить рядом.
--
-- В PostgreSQL несколько permissive-политик на одну команду объединяются через
-- OR, поэтому действующим правилом стало «self ИЛИ друг ИЛИ тренер». Отсюда
-- вывод, который стоит записать: политику нельзя заменять переименованием.
-- Либо то же имя, либо явный drop старого — иначе получается тихое ослабление.
--
-- Ниже — одна политика с одним именем. Ветки друзей в ней нет: друг получает
-- профиль и дневник через friend_state(), где отобраны конкретные поля.
-- Ветка тренера остаётся (ему дневник нужен целиком), но теперь с проверкой
-- блокировки, которой не было.
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;

create policy "own state select" on public.app_state
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.coach_links l
      where l.status = 'accepted'
        and l.coach = auth.uid()
        and l.client = app_state.user_id
        and not public.is_blocked_between(l.coach, l.client)
    )
  );

-- presence живёт по тому же принципу «свой круг», но отдаёт ровно одну
-- отметку времени, а не строку состояния. Здесь ветка друзей осмысленна и
-- остаётся — только переводим её на is_friend_with (дружба с 2026-08-26 это
-- взаимная подписка) и добавляем проверку блокировки.
drop policy if exists "presence select self or friends" on public.presence;
create policy "presence select self or friends" on public.presence
  for select using (
    auth.uid() = user_id
    or (public.is_friend_with(auth.uid(), presence.user_id)
        and not public.is_blocked_between(auth.uid(), presence.user_id))
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Блокировка разрывает и связь тренера
-- ─────────────────────────────────────────────────────────────────────────
-- apply_block сносил подписки, дружбу и уведомления, но не coach_links. В паре
-- с политикой из раздела 1 (где проверки блокировки не было) это означало, что
-- заблокированный тренер продолжает читать дневник клиента.
create or replace function public.apply_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);

  delete from public.friendships
   where (requester = new.blocker_id and addressee = new.blocked_id)
      or (requester = new.blocked_id and addressee = new.blocker_id);

  -- Связь тренер↔клиент рвём в обе стороны: неважно, кто кого заблокировал —
  -- доступ к дневнику держаться на такой связи больше не должен.
  delete from public.coach_links
   where (coach = new.blocker_id and client = new.blocked_id)
      or (coach = new.blocked_id and client = new.blocker_id);

  delete from public.notifications
   where recipient_id = new.blocker_id and actor_id = new.blocked_id;

  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. search_users: экранирование спецсимволов LIKE
-- ─────────────────────────────────────────────────────────────────────────
-- Защита поиска строилась на двух правилах: минимум три символа и совпадение
-- только с начала строки. Оба обходил один символ: в LIKE «_» означает «любой
-- один символ», ввод не экранировался, а «_» разрешён в самих никах — то есть
-- отфильтровать его как недопустимый тоже нельзя.
--
--   search_users('___')  →  username LIKE '___%'  →  совпадает со ВСЕМИ никами
--   (ограничение формата гарантирует минимум три символа)
--
-- Дальше пространство обходится систематически: 'a__%', 'ab_%', … — по тридцать
-- карточек за запрос. Экранируем «\», «%» и «_» и объявляем escape-символ явно.
--
-- Заодно из результата уходит avatar_url (см. раздел 9), поэтому меняется состав
-- колонок — нужен DROP, а не CREATE OR REPLACE: иначе Postgres ответит 42P13
-- «cannot change return type of existing function».
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', ''))) as v
  ),
  q as (
    -- Порядок замен важен: обратный слеш экранируется ПЕРВЫМ, иначе он
    -- удвоит уже проставленные экранирующие слеши.
    select v,
           replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') as pat
    from raw
  )
  select p.user_id, p.username, p.display_name
  from public.profiles p, q
  where char_length(q.v) >= 3
    and p.user_id <> auth.uid()
    and p.username like q.pat || '%' escape '\'
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    (p.username = q.v) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. follows и coaches: не отдавать таблицу целиком
-- ─────────────────────────────────────────────────────────────────────────
-- Политика follows разрешала SELECT любому авторизованному без ограничений:
-- один запрос через PostgREST выгружал весь социальный граф постранично, без
-- учёта блокировок. При этом взаимная подписка = дружба = доступ к дневнику и
-- личке, то есть выгружался ещё и список того, у кого что открыто.
--
-- Чужие списки подписчиков и подписок отдают list_followers/list_following:
-- там есть и лимит, и проверка блокировки. Прямое чтение оставляем только для
-- своих строк — фронтенду больше и не нужно (он ходит исключительно через RPC).
drop policy if exists "follows select" on public.follows;
create policy "follows select" on public.follows
  for select using (
    auth.uid() = follower_id or auth.uid() = following_id
  );

-- Список тренеров тоже не должен выгружаться целиком. В приложении эта таблица
-- читается ровно одним способом — amICoach() про себя.
drop policy if exists "coach select all" on public.coaches;
drop policy if exists "coach select own" on public.coaches;
create policy "coach select own" on public.coaches
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.coach_links l
      where l.coach = coaches.user_id and l.client = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Бан начинает что-то значить
-- ─────────────────────────────────────────────────────────────────────────
-- is_banned() была написана и выдана роли authenticated ещё в августе, но не
-- вызывалась ни в одной политике. Забаненный публиковал мысли, комментировал,
-- писал в личку и подписывался — запрещено ему было ровно одно: писать в
-- поддержку. Проверка ставится в базе, а не в интерфейсе: иначе она снимается
-- вкладкой DevTools.
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert with check (
    auth.uid() = user_id and not public.is_banned(auth.uid())
  );

drop policy if exists "post comments insert own" on public.post_comments;
create policy "post comments insert own" on public.post_comments
  for insert with check (
    auth.uid() = user_id
    and public.can_view_post(post_id)
    and not public.is_banned(auth.uid())
  );

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and sender <> recipient
    and public.is_friend_with(sender, recipient)
    and not public.is_blocked_between(sender, recipient)
    and not public.is_banned(auth.uid())
  );

drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not public.is_banned(auth.uid())
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = following_id and b.blocked_id = follower_id)
         or (b.blocker_id = follower_id  and b.blocked_id = following_id)
    )
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Гонка при одновременной взаимной подписке
-- ─────────────────────────────────────────────────────────────────────────
-- Триггер материализации дружбы спрашивал «есть ли встречная подписка?»
-- обычным EXISTS. На READ COMMITTED (умолчание Supabase) снимок не видит
-- незакоммиченных строк чужих транзакций, поэтому при одновременной подписке
-- A→B и B→A ни один из двух триггеров встречной строки не находил, и строка
-- friendships не появлялась вовсе. Права при этом работали (is_friend_with
-- считает по follows), а списки друзей, счётчик friends_count и уведомление
-- FRIEND_ACCEPTED — нет. Само по себе это не чинилось: повторная подписка
-- невозможна из-за первичного ключа.
--
-- Лечится блокировкой на детерминированный ключ ПАРЫ, взятой до проверки:
-- вторая транзакция ждёт первую и видит её результат. Ключ строится из двух
-- UUID в фиксированном порядке, поэтому обе стороны берут одну и ту же
-- блокировку. Блокировка транзакционная — снимается сама на commit/rollback.

-- Сначала чистим дубли, которые могла оставить прежняя версия (обе транзакции
-- увидели друг друга и обе вставили строку — на упорядоченной паре
-- (requester, addressee) уникальность этого не ловила). Оставляем самую раннюю.
delete from public.friendships f
where exists (
  select 1 from public.friendships g
  where least(g.requester, g.addressee)    = least(f.requester, f.addressee)
    and greatest(g.requester, g.addressee) = greatest(f.requester, f.addressee)
    and (g.created_at, g.id) < (f.created_at, f.id)
);

-- Теперь уникальность на НЕУПОРЯДОЧЕННОЙ паре: дубль становится невозможен
-- физически, а не «не должен случаться».
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

create or replace function public.sync_friendship_from_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid := least(coalesce(new.follower_id, old.follower_id),
                    coalesce(new.following_id, old.following_id));
  v_b uuid := greatest(coalesce(new.follower_id, old.follower_id),
                       coalesce(new.following_id, old.following_id));
begin
  -- Блокировка на пару. hashtextextended даёт стабильное 64-битное число из
  -- двух UUID, взятых в порядке возрастания, — обе стороны получают один ключ.
  perform pg_advisory_xact_lock(hashtextextended(v_a::text || v_b::text, 0));

  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.follows f
      where f.follower_id = new.following_id and f.following_id = new.follower_id
    ) then
      -- requester — тот, кто подписался ПЕРВЫМ (объект нынешней подписки):
      -- именно он должен получить уведомление «теперь вы друзья», потому что
      -- второй только что нажал кнопку сам и всё знает.
      insert into public.friendships (requester, addressee, status)
      select new.following_id, new.follower_id, 'accepted'
      where not exists (
        select 1 from public.friendships f
        where (f.requester = new.follower_id  and f.addressee = new.following_id)
           or (f.requester = new.following_id and f.addressee = new.follower_id)
      );
    end if;
    return new;
  end if;

  delete from public.friendships f
   where (f.requester = old.follower_id  and f.addressee = old.following_id)
      or (f.requester = old.following_id and f.addressee = old.follower_id);
  return old;
end;
$$;

-- Разовая сверка: докладываем недостающие дружбы, накопившиеся из-за гонки до
-- этой миграции. Уведомления при этом не рассылаем — событию год, и присылать
-- «теперь вы друзья» задним числом было бы странно.
drop trigger if exists friendships_notify on public.friendships;

insert into public.friendships (requester, addressee, status)
select distinct least(f.follower_id, f.following_id), greatest(f.follower_id, f.following_id), 'accepted'
from public.follows f
join public.follows r
  on r.follower_id = f.following_id and r.following_id = f.follower_id
where not exists (
  select 1 from public.friendships x
  where (x.requester = f.follower_id  and x.addressee = f.following_id)
     or (x.requester = f.following_id and x.addressee = f.follower_id)
)
on conflict do nothing;

-- И наоборот: строка дружбы без взаимной подписки — не дружба.
delete from public.friendships f
 where not public.is_friend_with(f.requester, f.addressee);

create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friendship();

-- Сверку полезно повторять по расписанию: гонка закрыта, но восстановление
-- из бэкапа или ручная правка могут снова развести таблицу с графом.
create or replace function public.reconcile_friendships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixed int := 0;
  v_n int;
begin
  insert into public.friendships (requester, addressee, status)
  select distinct least(f.follower_id, f.following_id), greatest(f.follower_id, f.following_id), 'accepted'
  from public.follows f
  join public.follows r
    on r.follower_id = f.following_id and r.following_id = f.follower_id
  where not exists (
    select 1 from public.friendships x
    where (x.requester = f.follower_id  and x.addressee = f.following_id)
       or (x.requester = f.following_id and x.addressee = f.follower_id)
  )
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_fixed := v_fixed + v_n;

  delete from public.friendships f
   where not public.is_friend_with(f.requester, f.addressee);
  get diagnostics v_n = row_count;
  return v_fixed + v_n;
end;
$$;

revoke all on function public.reconcile_friendships() from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Отношения пачкой: один запрос вместо N
-- ─────────────────────────────────────────────────────────────────────────
-- Списки людей отдают карточки одним запросом (для того RPC и написаны), а
-- отношение к каждому человеку клиент спрашивал по одному: список из пятидесяти
-- подписчиков — пятьдесят параллельных HTTP-запросов и около двухсот индексных
-- сканов. Параллельность не отменяет N+1, она лишь прячет его до момента, когда
-- упирается в лимит соединений.
--
-- Возвращаем только четыре факта: friend и mutual_follow клиент выводит сам из
-- following && followedBy (см. toRelationship) — дублировать их незачем.
create or replace function public.get_relationships(p_user_ids uuid[])
returns table (
  user_id     uuid,
  following   boolean,
  followed_by boolean,
  blocked     boolean,
  blocked_by  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  ids as (select distinct u as id from unnest(coalesce(p_user_ids, '{}')::uuid[]) u limit 200)
  select
    ids.id,
    exists (select 1 from public.follows f, me
             where f.follower_id = me.uid and f.following_id = ids.id),
    exists (select 1 from public.follows f, me
             where f.follower_id = ids.id and f.following_id = me.uid),
    exists (select 1 from public.blocks b, me
             where b.blocker_id = me.uid and b.blocked_id = ids.id),
    exists (select 1 from public.blocks b, me
             where b.blocker_id = ids.id and b.blocked_id = me.uid)
  from ids;
$$;

revoke all on function public.get_relationships(uuid[]) from public, anon;
grant execute on function public.get_relationships(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Счётчики реакций и ответов — колонками, а не подзапросами
-- ─────────────────────────────────────────────────────────────────────────
-- list_feed и list_posts считали 🥕, 🥦 и число ответов тремя коррелированными
-- подзапросами НА КАЖДЫЙ пост: страница из двадцати постов — шестьдесят
-- отдельных обходов индексов. Денормализуем: счётчики ведут триггеры, а чтение
-- становится обычной колонкой.
alter table public.posts add column if not exists carrots_count  int not null default 0;
alter table public.posts add column if not exists broccoli_count int not null default 0;
alter table public.posts add column if not exists comments_count int not null default 0;

create or replace function public.sync_post_reaction_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d_carrot int := 0;
  d_broc   int := 0;
begin
  -- UPDATE (смена 🥕 на 🥦) — это одновременно минус старой и плюс новой.
  if tg_op in ('DELETE', 'UPDATE') then
    if old.reaction = '🥕' then d_carrot := d_carrot - 1; else d_broc := d_broc - 1; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.reaction = '🥕' then d_carrot := d_carrot + 1; else d_broc := d_broc + 1; end if;
  end if;

  if d_carrot <> 0 or d_broc <> 0 then
    -- greatest(0, …) — страховка от ухода в минус, если счётчик когда-нибудь
    -- разойдётся с таблицей: отрицательное число реакций хуже, чем заниженное.
    update public.posts
       set carrots_count  = greatest(0, carrots_count  + d_carrot),
           broccoli_count = greatest(0, broccoli_count + d_broc)
     where id = coalesce(new.post_id, old.post_id);
  end if;
  return null;
end;
$$;

drop trigger if exists post_reactions_counts on public.post_reactions;
create trigger post_reactions_counts
  after insert or update or delete on public.post_reactions
  for each row execute function public.sync_post_reaction_counts();

create or replace function public.sync_post_comment_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.posts
     set comments_count = greatest(0, comments_count + case when tg_op = 'INSERT' then 1 else -1 end)
   where id = coalesce(new.post_id, old.post_id);
  return null;
end;
$$;

drop trigger if exists post_comments_counts on public.post_comments;
create trigger post_comments_counts
  after insert or delete on public.post_comments
  for each row execute function public.sync_post_comment_counts();

-- Бэкфилл. Идемпотентен: пересчитывает из первоисточника, а не прибавляет.
update public.posts p
set carrots_count  = coalesce(r.carrots, 0),
    broccoli_count = coalesce(r.broccoli, 0),
    comments_count = coalesce(c.cnt, 0)
from (select id from public.posts) base
left join lateral (
  select count(*) filter (where reaction = '🥕')::int as carrots,
         count(*) filter (where reaction = '🥦')::int as broccoli
  from public.post_reactions where post_id = base.id
) r on true
left join lateral (
  select count(*)::int as cnt from public.post_comments where post_id = base.id
) c on true
where p.id = base.id
  and (p.carrots_count, p.broccoli_count, p.comments_count)
      is distinct from (coalesce(r.carrots,0), coalesce(r.broccoli,0), coalesce(c.cnt,0));

-- Переключение реакции теперь читает счётчики, а не пересчитывает их.
-- Триггер выше отрабатывает в конце предыдущего оператора, поэтому строка
-- posts к моменту чтения уже актуальна.
create or replace function public.toggle_post_reaction(p_post_id uuid, p_reaction text)
returns table (carrots int, broccoli int, mine text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_reaction is distinct from '🥕' and p_reaction is distinct from '🥦' then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not public.can_view_post(p_post_id) then
    raise exception 'post not visible' using errcode = '42501';
  end if;

  select r.reaction into v_cur
  from public.post_reactions r
  where r.post_id = p_post_id and r.user_id = v_uid
  for update;

  if v_cur = p_reaction then
    delete from public.post_reactions where post_id = p_post_id and user_id = v_uid;
  else
    insert into public.post_reactions (post_id, user_id, reaction)
    values (p_post_id, v_uid, p_reaction)
    on conflict (post_id, user_id) do update
      set reaction = excluded.reaction, created_at = now();
  end if;

  return query
    select p.carrots_count, p.broccoli_count,
           (select r.reaction from public.post_reactions r
             where r.post_id = p_post_id and r.user_id = v_uid)
    from public.posts p where p.id = p_post_id;
end;
$$;

revoke all on function public.toggle_post_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_post_reaction(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Аватары перестают ездить в каждой строке
-- ─────────────────────────────────────────────────────────────────────────
-- Аватар в EatAps — не ссылка, а data URL: base64-JPEG 256×256 на десятки
-- килобайт, и потолок колонки был 300 000 символов. list_feed отдавала его в
-- КАЖДОЙ строке поста: двадцать постов одного автора — двадцать копий одной
-- картинки в одном ответе. То же в поиске: тридцать карточек на каждое нажатие
-- клавиши.
--
-- Убираем avatar_url из list_feed и search_users. Клиент добирает картинки
-- через user_cards по УНИКАЛЬНЫМ авторам страницы (обычно 3–7 человек на
-- двадцать постов) и кэширует их у себя — см. src/lib/avatarCache.js.
--
-- Потолок колонки заодно приводим к реальности: 256×256 JPEG q=0.8 весит
-- 15–30 КБ, то есть около 40 000 символов base64. 300 000 — запас в десять раз,
-- за которым может приехать мегабайтная картинка.
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len
  check (avatar_url is null or char_length(avatar_url) <= 60000);

-- Строки, не влезающие в новый потолок, обнуляем: обрезанный base64 — это не
-- «картинка поменьше», а мусор, который браузер не покажет. Пусто честнее —
-- интерфейс нарисует инициал.
update public.profiles set avatar_url = null
 where avatar_url is not null and char_length(avatar_url) > 60000;

-- Зеркало из app_state — по тому же правилу.
create or replace function public.sync_profile_from_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(coalesce(new.state->'profile'->>'name', ''), 60), '');
  v_raw  text := new.state->'profile'->>'avatar';
  v_av   text := case when char_length(coalesce(v_raw, '')) between 1 and 60000
                      then v_raw end;
begin
  update public.profiles
     set display_name = v_name,
         avatar_url   = v_av
   where user_id = new.user_id
     and (display_name is distinct from v_name or avatar_url is distinct from v_av);
  return null;
end;
$$;

-- Меняется состав колонок, поэтому нужен DROP, а не CREATE OR REPLACE:
-- Postgres откажет с 42P13 «cannot change return type of existing function».
drop function if exists public.list_feed(int, timestamptz, uuid);

create or replace function public.list_feed(
  p_limit     int default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id             uuid,
  user_id        uuid,
  username       text,
  display_name   text,
  text           text,
  image_url      text,
  visibility     public.post_visibility,
  created_at     timestamptz,
  edited_at      timestamptz,
  carrots        int,
  broccoli       int,
  my_reaction    text,
  comments_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  blocked as (
    select b.blocked_id as id from public.blocks b, me where b.blocker_id = me.uid
    union
    select b.blocker_id from public.blocks b, me where b.blocked_id = me.uid
  ),
  friends as (
    select case when f.requester = me.uid then f.addressee else f.requester end as id
    from public.friendships f, me
    where f.status = 'accepted' and (f.requester = me.uid or f.addressee = me.uid)
  ),
  followed as (
    select f.following_id as id from public.follows f, me where f.follower_id = me.uid
  ),
  circle as (
    select uid as id from me
    union select id from followed
    union select id from friends
  )
  select
    p.id, p.user_id, pr.username, pr.display_name,
    p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    p.carrots_count, p.broccoli_count,
    (select r.reaction from public.post_reactions r
      where r.post_id = p.id and r.user_id = (select uid from me)),
    p.comments_count
  from public.posts p
  join circle             on circle.id = p.user_id
  join public.profiles pr on pr.user_id = p.user_id
  where
    (p_before_at is null
      or (p.created_at, p.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    and p.user_id not in (select id from blocked)
    and (
      p.user_id = (select uid from me)
      or p.visibility = 'public'
      or (p.visibility = 'followers'
          and (p.user_id in (select id from followed) or p.user_id in (select id from friends)))
      or (p.visibility = 'friends' and p.user_id in (select id from friends))
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_feed(int, timestamptz, uuid) from public, anon;
grant execute on function public.list_feed(int, timestamptz, uuid) to authenticated;

-- list_posts: те же счётчики колонками. Состав колонок не меняется, но
-- пересоздаём тело.
create or replace function public.list_posts(
  p_user_id uuid,
  p_limit   int default 20,
  p_before  timestamptz default null
)
returns table (
  id             uuid,
  user_id        uuid,
  text           text,
  image_url      text,
  visibility     public.post_visibility,
  created_at     timestamptz,
  edited_at      timestamptz,
  carrots        int,
  broccoli       int,
  my_reaction    text,
  comments_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with rel as (
    select
      p_user_id = auth.uid()                                       as is_me,
      public.is_blocked_between(p_user_id, auth.uid())              as is_blocked,
      public.is_friend_with(auth.uid(), p_user_id)                  as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  )
  select
    p.id, p.user_id, p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    p.carrots_count, p.broccoli_count,
    (select r.reaction from public.post_reactions r
      where r.post_id = p.id and r.user_id = auth.uid()),
    p.comments_count
  from public.posts p, rel
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and (
      rel.is_me
      or (not rel.is_blocked and (
            p.visibility = 'public'
            or (p.visibility = 'followers' and (rel.is_following or rel.is_friend))
            or (p.visibility = 'friends'   and rel.is_friend)
         ))
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;

-- user_profile: счётчик постов тоже читаем без подсчёта строк там, где можно,
-- и снижаем потолок user_cards — 200 карточек по 60 КБ это всё ещё 12 МБ.
create or replace function public.user_cards(p_user_ids uuid[])
returns table (user_id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where p.user_id = any(p_user_ids[1:60])
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_cards(uuid[]) from public, anon;
grant execute on function public.user_cards(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Курсорная пагинация в списках людей
-- ─────────────────────────────────────────────────────────────────────────
-- Ровно та ошибка, которую list_feed обходит намеренно: сортировка по
-- created_at desc с OFFSET. Появилась новая подписка — окно сдвинулось, и
-- человек видит дубли или пропускает строки. Переводим на тот же курсор
-- (created_at, user_id), что и лента.
drop function if exists public.list_followers(uuid, int, int);
drop function if exists public.list_following(uuid, int, int);
drop function if exists public.list_friends(uuid, int, int);

create or replace function public.list_followers(
  p_user_id uuid, p_limit int default 50,
  p_before_at timestamptz default null, p_before_id uuid default null
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.follower_id
  where f.following_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid())
    and (p_before_at is null
         or (f.created_at, p.user_id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by f.created_at desc, p.user_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

create or replace function public.list_following(
  p_user_id uuid, p_limit int default 50,
  p_before_at timestamptz default null, p_before_id uuid default null
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.follows f
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid())
    and (p_before_at is null
         or (f.created_at, p.user_id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by f.created_at desc, p.user_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100,
  p_before_at timestamptz default null, p_before_id uuid default null
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url, f.created_at
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.requester = p_user_id then f.addressee else f.requester end
  where f.status = 'accepted'
    and (f.requester = p_user_id or f.addressee = p_user_id)
    and not public.is_blocked_between(p.user_id, auth.uid())
    and (p_before_at is null
         or (f.created_at, p.user_id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by f.created_at desc, p.user_id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke all on function public.list_followers(uuid, int, timestamptz, uuid) from public, anon;
revoke all on function public.list_following(uuid, int, timestamptz, uuid) from public, anon;
revoke all on function public.list_friends(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_followers(uuid, int, timestamptz, uuid) to authenticated;
grant execute on function public.list_following(uuid, int, timestamptz, uuid) to authenticated;
grant execute on function public.list_friends(uuid, int, timestamptz, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 10a. Список диалогов перестаёт терять чаты
-- ─────────────────────────────────────────────────────────────────────────
-- Клиент брал 200 последних сообщений ПО ВСЕМ диалогам и схлопывал их по
-- собеседнику у себя. Если один активный чат занимал все двести строк,
-- остальные диалоги из списка пропадали — не «устаревали», а исчезали.
--
-- distinct on даёт ровно по строке на собеседника независимо от того, сколько
-- сообщений в самом активном чате.
create or replace function public.list_conversations(p_limit int default 100)
returns table (
  partner_id uuid,
  message_id uuid,
  sender     uuid,
  text       text,
  image_url  text,
  created_at timestamptz,
  unread     int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  last_msg as (
    select distinct on (partner)
      case when m.sender = (select uid from me) then m.recipient else m.sender end as partner,
      m.id, m.sender, m.text, m.image_url, m.created_at
    from public.messages m, me
    where m.sender = me.uid or m.recipient = me.uid
    order by partner, m.created_at desc
  )
  select
    l.partner, l.id, l.sender, l.text, l.image_url, l.created_at,
    (select count(*)::int from public.messages u, me
      where u.recipient = me.uid and u.sender = l.partner and u.read_at is null)
  from last_msg l
  where not public.is_blocked_between(l.partner, auth.uid())
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_conversations(int) from public, anon;
grant execute on function public.list_conversations(int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Ник нельзя сменить в обход set_username
-- ─────────────────────────────────────────────────────────────────────────
-- Политика "profiles update own" разрешала прямой UPDATE строки, а guard-триггер
-- защищал только user_id, display_name и avatar_url. То есть username менялся
-- запросом из консоли мимо set_username: ограничение формата и уникальный
-- индекс данные бы спасли, но нормализация («@», верхний регистр) обходилась,
-- и человек мог записать себе ник, который сам потом не введёт в поиске.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  -- Зеркальные поля клиент менять не может: их источник — app_state.
  if auth.uid() is not null and (
       new.display_name is distinct from old.display_name
    or new.avatar_url   is distinct from old.avatar_url
  ) then
    new.display_name := old.display_name;
    new.avatar_url   := old.avatar_url;
  end if;
  -- Ник меняется ТОЛЬКО через set_username: там нормализация и внятная причина
  -- отказа. Прямой UPDATE тихо откатываем к прежнему значению — исключение
  -- здесь сломало бы легальные UPDATE соседних колонок.
  --
  -- set_username работает как SECURITY DEFINER, то есть от владельца функции,
  -- и auth.uid() внутри неё по-прежнему равен вызывающему. Чтобы отличить её
  -- вызов от прямого UPDATE, она выставляет флаг в настройках транзакции.
  if auth.uid() is not null
     and new.username is distinct from old.username
     and coalesce(current_setting('eataps.username_change', true), '') <> 'on' then
    new.username := old.username;
  end if;
  return new;
end;
$$;

create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_new !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars of a-z, 0-9, _' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = v_new and user_id <> v_uid) then
    raise exception 'username is taken' using errcode = '23505';
  end if;

  -- Флаг живёт до конца транзакции (is_local = true), поэтому не протекает в
  -- следующий запрос того же соединения из пула.
  perform set_config('eataps.username_change', 'on', true);
  update public.profiles set username = v_new where user_id = v_uid;
  perform set_config('eataps.username_change', 'off', true);
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Лимиты расхода AI, которые нельзя обойти из браузера
-- ─────────────────────────────────────────────────────────────────────────
-- Месячный потолок считался деньгами — это правильно, — но у тарифа AI+ он был
-- null, а checkBudget на null отвечает безусловным «можно». Ограничения частоты
-- не было вовсе. Один аккаунт (в том числе получивший AI+ по промокоду) мог
-- в автоматическом режиме сжечь счёт владельца в Anthropic.
--
-- Потолок сам по себе задаётся в src/lib/aiBudget.js. Здесь — два механизма,
-- которые обязаны жить на сервере: суточный подпотолок и ограничение частоты.

-- Суточный расход пишем в ту же таблицу отдельной строкой периода. Формат
-- периода расширяем до 'YYYY-MM-DD', чтобы переиспользовать уже написанный
-- атомарный инкремент ai_usage_add, а не заводить вторую таблицу с той же
-- логикой (и той же гонкой, которую там уже решили).
do $$
declare
  r record;
begin
  -- Имя ограничения проставил Postgres автоматически (ai_usage_period_check),
  -- но полагаться на автогенерацию нельзя. Снимаем любое проверочное
  -- ограничение по колонке period, кроме нашего собственного, и ставим своё —
  -- уже с именем, чтобы следующая миграция не гадала.
  for r in
    select conname from pg_constraint
    where conrelid = 'public.ai_usage'::regclass
      and contype = 'c'
      and conname <> 'ai_usage_period_format'
      and pg_get_constraintdef(oid) like '%period%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.ai_usage drop constraint if exists ai_usage_period_format;
alter table public.ai_usage add constraint ai_usage_period_format
  check (period ~ '^\d{4}-\d{2}(-\d{2})?$');

-- Ограничение частоты — общее, не только для ассистента. Второй потребитель —
-- api/feedback.js, где лимит жил в new Map() в памяти процесса: на бессерверной
-- платформе экземпляров много, память между ними не общая, и чем сильнее поток,
-- тем менее действенным становился счётчик. То есть он не работал ровно тогда,
-- когда был нужен.
--
-- Окно фиксированное, а не скользящее: цель не в точности учёта, а в том, чтобы
-- цикл в чужом скрипте упёрся в стену.
--
-- key — произвольная строка: uuid пользователя, хэш IP или слово 'global'.
-- Сырой IP здесь не хранится намеренно: это персональные данные, а для счётчика
-- достаточно его хэша (см. api/feedback.js).
create table if not exists public.rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (bucket, key)
);

alter table public.rate_limits enable row level security;
-- Политик нет вовсе: таблица служебная, пишет и читает только сервер
-- (service_role), для которого RLS не действует.

-- Прежняя узкая таблица, если её успели создать ранней версией этого файла.
drop function if exists public.ai_rate_limit_take(uuid, int, interval);
drop table if exists public.ai_rate_limit;

-- Возвращает true, если запрос разрешён, и сразу засчитывает его. Одним
-- оператором: «прочитали → сравнили → записали» тремя запросами обходится
-- параллельными вкладками.
create or replace function public.rate_limit_take(
  p_bucket text,
  p_key    text,
  p_max    int,
  p_window interval default interval '1 minute'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  if p_key is null or btrim(p_key) = '' then
    return true;  -- нечего считать: ключа нет, ограничивать некого
  end if;

  insert into public.rate_limits (bucket, key, window_start, hits)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    set window_start = case
          when public.rate_limits.window_start < now() - p_window then now()
          else public.rate_limits.window_start
        end,
        hits = case
          when public.rate_limits.window_start < now() - p_window then 1
          else public.rate_limits.hits + 1
        end
  returning hits into v_hits;

  return v_hits <= greatest(p_max, 1);
end;
$$;

revoke all on function public.rate_limit_take(text, text, int, interval) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, text, int, interval) to service_role;

-- Строки, к которым давно не обращались, смысла не имеют.
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

create or replace function public.cleanup_rate_limits()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.cleanup_rate_limits() from public, anon, authenticated;

-- ── Обратная связь без входа ────────────────────────────────────────────────
-- api/feedback.js остаётся доступным гостю (форма «написать разработчику» живёт
-- в разделе «О приложении», а туда попадает и человек без аккаунта), но теперь
-- пишет обращение в ту же таблицу, что и поддержка. Значит, лимит частоты
-- опирается на данные, а не на память процесса, и владелец видит все обращения
-- в одном месте.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.support_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.support_messages drop constraint %I', r.conname);
  end loop;
end $$;

-- user_id становится необязательным: у анонимного совета автора нет.
alter table public.support_messages alter column user_id drop not null;

alter table public.support_messages add constraint support_messages_kind
  check (kind in ('support', 'coach_application', 'feedback'));


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Журнал событий Stripe
-- ─────────────────────────────────────────────────────────────────────────
-- Подпись вебхука проверялась, а вот порядок и повторы — нет: upsert
-- перезаписывал строку безусловно. Stripe не гарантирует порядок доставки и
-- повторяет события при неответе, поэтому задержавшийся
-- customer.subscription.updated со статусом active, пришедший после deleted,
-- возвращал человеку платный доступ.
create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Политик нет: таблица служебная, пишет только вебхук через service_role.

-- Отметка о времени события, по которой вебхук отсекает устаревшие апдейты.
alter table public.subscriptions add column if not exists event_at timestamptz;


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Чистка старых уведомлений
-- ─────────────────────────────────────────────────────────────────────────
-- Таблица растёт линейно и никогда не чистилась. Удаляем прочитанное старше
-- 90 дней: непрочитанное не трогаем ни при каком возрасте — это единственное,
-- что человек ещё не видел.
create or replace function public.cleanup_old_notifications(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.notifications
   where read_at is not null
     and created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 7));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.cleanup_old_notifications(int) from public, anon, authenticated;

-- Поставить на расписание (если в проекте включено расширение pg_cron):
--   select cron.schedule('eataps-cleanup', '17 3 * * *',
--     $$select public.cleanup_old_notifications(90), public.reconcile_friendships()$$);


-- ─────────────────────────────────────────────────────────────────────────
-- 15. Индексы под новые запросы
-- ─────────────────────────────────────────────────────────────────────────
-- Курсор в списках людей сортирует по (created_at desc, user_id desc);
-- существующие follows_following_idx / follows_follower_idx покрывают только
-- первую колонку, и на длинных списках досортировка съедала выигрыш.
create index if not exists follows_following_cursor_idx
  on public.follows (following_id, created_at desc, follower_id desc);
create index if not exists follows_follower_cursor_idx
  on public.follows (follower_id, created_at desc, following_id desc);

-- Собственная реакция в ленте ищется по (post_id, user_id) — это первичный
-- ключ post_reactions, отдельный индекс не нужен.
--
-- Бан проверяется теперь на каждой вставке поста, комментария, сообщения и
-- подписки, но отдельный индекс для этого не нужен и не может существовать:
-- bans.user_id — первичный ключ, а частичный индекс с предикатом по now()
-- Postgres не примет (функция не IMMUTABLE).
