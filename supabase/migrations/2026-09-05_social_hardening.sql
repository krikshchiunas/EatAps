-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — укрепление социальной системы: гонки, блокировки, пагинация,
-- идемпотентность сообщений.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не удаляет, кроме заведомого мусора: дублей строк
-- дружбы и уведомлений, ведущих в никуда.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЭТА МИГРАЦИЯ ИСПРАВЛЯЕТ И ПОЧЕМУ
--
-- 1. ДРУЖБА МОГЛА НЕ ВОЗНИКНУТЬ ВОВСЕ. С 2026-08-26 дружба — это взаимная
--    подписка, а строку friendships пишет триггер: вставили подписку — он
--    смотрит, есть ли встречная. Пока два человека подписываются друг на друга
--    ПО ОЧЕРЕДИ, всё сходится. Но если обе вставки идут одновременно, ни одна
--    транзакция не видит незакоммиченную строку другой (READ COMMITTED), и
--    условие «есть встречная подписка» ложно у обеих. Итог: взаимная подписка
--    есть, строки дружбы нет.
--
--    Это не теоретическая беда. От строки friendships зависели ЧТЕНИЕ ЧУЖОГО
--    ДНЕВНИКА (политика app_state), список друзей и счётчик друзей, а право
--    переписки считалось уже по подпискам. То есть пара оказывалась в
--    состоянии «переписываться можно, дневник не виден, в списке друзей друг
--    друга нет» — и починить это человек не мог никак.
--
--    Лечим с двух сторон:
--      • сериализуем пару advisory-локом ДО вставки в follows, чтобы вторая
--        транзакция дождалась первой и увидела её строку;
--      • снимаем зависимость прав от материализованной строки: и политика
--        дневника, и списки, и счётчики считаются теперь по подпискам, тем же
--        предикатом is_friend_with, что и переписка. Строка friendships
--        остаётся ровно одним: якорем уведомления «теперь вы друзья».
--
-- 2. БЛОКИРОВКА ОБХОДИЛАСЬ ЧЕРЕЗ СПИСКИ. list_followers/list_following
--    прятали из выдачи отдельных заблокированных людей, но не проверяли, а
--    имеет ли спрашивающий право вообще смотреть на ЭТОТ профиль.
--    Заблокировавший меня человек закрыт для меня в user_profile и в
--    list_posts — но его подписчиков и подписки я по-прежнему мог перечислить
--    прямым вызовом RPC. Это дыра именно в блокировке: интерфейс её не
--    показывал, но интерфейс и не является границей доступа.
--
-- 3. ОТВЕТЫ ЗАБЛОКИРОВАННЫХ БЫЛИ ВИДНЫ. Под общим постом третьего человека
--    ответ заблокированного отображался как ни в чём не бывало, и счётчик
--    ответов его учитывал. Блокировка должна работать везде, а не только там,
--    где люди встречаются напрямую.
--
-- 4. У СООБЩЕНИЙ НЕ БЫЛО ИДЕМПОТЕНТНОСТИ. Отправка — обычный INSERT: если
--    ответ потерялся в сети, клиент повторял вставку и в переписке появлялись
--    два одинаковых сообщения. Причём именно на плохой сети, то есть ровно
--    тогда, когда это заметнее всего. Вводим client_id, который клиент
--    придумывает ОДИН раз на сообщение и переиспользует при каждом повторе.
--
-- 5. ЛЕНТА ОТВЕТОВ И ПЕРЕПИСКА НЕ ИМЕЛИ ПАГИНАЦИИ. list_post_comments отдавала
--    первые 100 и на этом всё; история чата читалась запросом
--    «order by created_at asc limit 300», то есть в длинной переписке человек
--    получал САМЫЕ СТАРЫЕ триста сообщений и не видел ни одного свежего.
--
-- 6. N+1 НА СПИСКАХ ЛЮДЕЙ. Экран со списком спрашивал get_relationship по
--    одному человеку: пятьдесят строк — пятьдесят обращений к базе. Добавлен
--    пакетный relationships_with.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Дружба: пара уникальна независимо от порядка
-- ─────────────────────────────────────────────────────────────────────────
-- Существующее ограничение unique (requester, addressee) не мешает паре
-- (A,B) сосуществовать с (B,A): для базы это разные строки. Пока дружбу
-- создавал человек заявкой, вторая строка была невозможна по смыслу. Теперь
-- её создаёт триггер по обеим подпискам — и без ограничения на неупорядоченную
-- пару гонка даёт две строки дружбы и два уведомления об одном событии.

-- Дедупликация ДО индекса: оставляем самую раннюю строку на пару.
delete from public.friendships f
using public.friendships g
where least(f.requester, f.addressee)    = least(g.requester, g.addressee)
  and greatest(f.requester, f.addressee) = greatest(g.requester, g.addressee)
  and (f.created_at, f.id) > (g.created_at, g.id);

create unique index if not exists friendships_pair_uniq
  on public.friendships (least(requester, addressee), greatest(requester, addressee));


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Сериализация пары подписок
-- ─────────────────────────────────────────────────────────────────────────
-- Ключ здесь один: лок берётся в BEFORE-триггере, то есть ДО вставки строки.
-- Тогда вторая транзакция по той же паре ждёт первую, а когда дожидается —
-- её AFTER-триггер выполняет НОВЫЙ запрос, получает свежий снимок и видит уже
-- закоммиченную встречную подписку. Advisory-лок в AFTER-триггере эту задачу
-- не решил бы: снимок ко второй транзакции всё равно приехал бы старый.
--
-- Лок транзакционный (xact) — снимается сам на commit/rollback, забыть его
-- отпустить невозможно. Область — только эта пара людей, поэтому подписки
-- разных людей друг другу не мешают.
create or replace function public.lock_follow_pair()
returns trigger
language plpgsql
as $$
declare
  a uuid;
  b uuid;
begin
  -- Ветвление по tg_op обязательно: в DELETE-триггере NEW не назначен вовсе,
  -- и coalesce(new.follower_id, old.follower_id) упал бы на обращении к полю,
  -- а не вернул бы второй аргумент.
  if tg_op = 'INSERT' then
    a := new.follower_id;  b := new.following_id;
  else
    a := old.follower_id;  b := old.following_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(a, b)::text || '|' || greatest(a, b)::text, 20260905)
  );

  if tg_op = 'INSERT' then return new; end if;
  return old;
end;
$$;

-- Имя триггера выбрано так, чтобы он шёл ПЕРВЫМ: BEFORE-триггеры Postgres
-- выполняет в алфавитном порядке, а 'follows_aa_pair_lock' < 'follows_rate_limit'.
-- Лок должен быть взят раньше любой другой проверки, иначе смысла в нём нет.
drop trigger if exists follows_aa_pair_lock on public.follows;
create trigger follows_aa_pair_lock
  before insert or delete on public.follows
  for each row execute function public.lock_follow_pair();


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Приведение строки дружбы к графу — одна функция на все случаи
-- ─────────────────────────────────────────────────────────────────────────
-- Идемпотентна: сколько раз ни позови, состояние сходится к «строка есть
-- тогда и только тогда, когда подписка взаимна». Поэтому её безопасно звать
-- и из триггера подписки, и из ремонтного прохода, и повторно.
--
-- p_a — тот, кто подписался ПЕРВЫМ: он становится requester и получает
-- уведомление «теперь вы друзья». Второй нажал кнопку сам и всё знает.
create or replace function public.reconcile_friendship(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    return;
  end if;

  if public.is_friend_with(p_a, p_b) then
    insert into public.friendships (requester, addressee, status)
    values (p_a, p_b, 'accepted')
    on conflict do nothing;
  else
    delete from public.friendships f
     where least(f.requester, f.addressee)    = least(p_a, p_b)
       and greatest(f.requester, f.addressee) = greatest(p_a, p_b);
  end if;
end;
$$;

revoke all on function public.reconcile_friendship(uuid, uuid) from public, anon, authenticated;

-- Триггер подписки больше не решает сам, что делать, — он только сообщает,
-- какая пара изменилась. Вся логика в одном месте.
create or replace function public.sync_friendship_from_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.reconcile_friendship(new.following_id, new.follower_id);
    return new;
  end if;
  perform public.reconcile_friendship(old.follower_id, old.following_id);
  return old;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Разовый ремонт уже разъехавшихся пар
-- ─────────────────────────────────────────────────────────────────────────
-- Уведомления на время ремонта сняты: иначе каждая пара, которой гонка не
-- дала строку месяц назад, получила бы сегодня «теперь вы друзья».
drop trigger if exists friendships_notify on public.friendships;

-- Строка без взаимной подписки — не дружба.
delete from public.friendships f
 where not public.is_friend_with(f.requester, f.addressee);

-- Взаимная подписка без строки — потерянная дружба. Порядок пары берём по
-- UUID: для уже существующих связей «кто первый подписался» неизвестно, а
-- уведомления по ним всё равно не рассылаются.
insert into public.friendships (requester, addressee, status)
select distinct least(f.follower_id, f.following_id), greatest(f.follower_id, f.following_id), 'accepted'
from public.follows f
join public.follows r
  on r.follower_id = f.following_id and r.following_id = f.follower_id
on conflict do nothing;

create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friendship();


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Права перестают зависеть от материализованной строки
-- ─────────────────────────────────────────────────────────────────────────
-- Раньше «друг» имел два разных определения: is_friend_with (подписки) для
-- переписки и строка friendships для дневника, списков и счётчиков. Два
-- определения одного и того же — это две вещи, которые рано или поздно
-- разойдутся; собственно, они и разошлись (см. шапку). Остаётся одно.

-- 5.1. Дневник питания.
drop policy if exists "own state select" on public.app_state;
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "state select self, friends or coach" on public.app_state;
create policy "state select self, friends or coach" on public.app_state
  for select using (
    auth.uid() = app_state.user_id
    or (
      public.is_friend_with(auth.uid(), app_state.user_id)
      and not public.is_blocked_between(auth.uid(), app_state.user_id)
    )
    or exists (
      select 1 from public.coach_links l
      where l.status = 'accepted'
        and l.coach = auth.uid()
        and l.client = app_state.user_id
    )
  );

-- 5.1.2. ПРОВЕРКА БЛОКИРОВКИ В ПОЛИТИКЕ ПОДПИСКИ НЕ РАБОТАЛА.
--
-- Политика «follows insert own» с 2026-08-25 выглядела так:
--
--     and not exists (
--       select 1 from public.blocks b
--       where (b.blocker_id = following_id and b.blocked_id = follower_id)
--          or (b.blocker_id = follower_id  and b.blocked_id = following_id)
--     )
--
-- Замысел: подписаться нельзя ни на того, кого заблокировал я, ни на того, кто
-- заблокировал меня. Работала только первая половина.
--
-- Причина в том, что выражение политики выполняется ОТ ИМЕНИ ВЫЗЫВАЮЩЕГО, и
-- обращение к public.blocks внутри него подчиняется политике самой blocks:
--
--     for select using (auth.uid() = blocker_id)
--
-- То есть строка «он заблокировал меня» для меня невидима, подзапрос её не
-- находит, и первая ветка условия всегда ложна. Заблокированный человек мог
-- спокойно подписаться на того, кто его заблокировал: контент ему всё равно не
-- показывался (can_view_post и posts select зовут is_blocked_between, а она
-- SECURITY DEFINER и видит обе стороны), но он появлялся в списке подписчиков
-- блокирующего и накручивал ему счётчик — то есть блокировка переставала быть
-- тихой ровно для того, кто её поставил.
--
-- Лечится тем же способом, каким уже решён этот вопрос везде: единственной
-- функцией, которой видны обе стороны.
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not public.is_blocked_between(follower_id, following_id)
  );


-- 5.1.3. «Был(а) в сети» — тот же круг и то же определение.
-- Политика presence осталась с 2026-08-06 и читала friendships напрямую: при
-- потерянной гонке двое переписывались, но не видели присутствия друг друга.
-- Круг доступа не меняется (себя и друзей) — меняется способ спросить.
drop policy if exists "presence select self or friends" on public.presence;
create policy "presence select self or friends" on public.presence
  for select using (
    auth.uid() = presence.user_id
    or (
      public.is_friend_with(auth.uid(), presence.user_id)
      and not public.is_blocked_between(auth.uid(), presence.user_id)
    )
  );

-- 5.2. Имя и аватар друга (используется пушем о новом сообщении).
-- ПОЧЕМУ ЗДЕСЬ DROP, А НЕ ПРОСТО CREATE OR REPLACE.
--
-- У функции, возвращающей таблицу, набор OUT-параметров — часть её типа, и
-- create or replace менять его не умеет:
--     42P13: cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
-- Причём достаточно расхождения в ОДНОМ имени или типе колонки.
--
-- Знать заранее, какой формы функция лежит в конкретной базе, нельзя: историю
-- этого проекта накатывали по-разному — отдельными миграциями, склеенным
-- setup_all.sql (который какое-то время был испорчен) и правками из редактора.
-- Поэтому не полагаемся на совпадение формы, а снимаем функцию и создаём
-- заново. Права выдаются тут же, следом за созданием, — drop их забирает.
--
-- Безопасно: все функции ниже вызываются только клиентом через RPC. На них не
-- ссылается ни одна политика и ни одно представление — в политиках живут
-- is_friend_with, is_blocked_between и can_view_post, а их этот файл не трогает.

drop function if exists public.friend_briefs(uuid[]);

create or replace function public.friend_briefs(p_user_ids uuid[])
returns table (user_id uuid, name text, avatar text)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         a.state->'profile'->>'name',
         a.state->'profile'->>'avatar'
  from public.app_state a
  where a.user_id = any(p_user_ids[1:200])
    and (a.user_id = auth.uid() or public.is_friend_with(auth.uid(), a.user_id));
$$;

revoke all on function public.friend_briefs(uuid[]) from public, anon;
grant execute on function public.friend_briefs(uuid[]) to authenticated;

-- 5.3. Список друзей — прямо из подписок.
-- «Дружим с» — это момент, когда подписка стала взаимной, то есть более
-- поздняя из двух. Раньше сюда попадала дата строки friendships, которой при
-- потерянной гонке просто не существовало.
--
-- Добавлена и проверка блокировки на владельца списка: без неё человек,
-- который меня заблокировал, оставался для меня перечислимым — см. п. 2 шапки.
drop function if exists public.list_friends(uuid, int, int);

create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100, p_offset int default 0
)
returns table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.username, p.display_name, p.avatar_url,
         greatest(f.created_at, r.created_at)
  from public.follows f
  join public.follows r
    on r.follower_id = f.following_id and r.following_id = f.follower_id
  join public.profiles p on p.user_id = f.following_id
  where f.follower_id = p_user_id
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by greatest(f.created_at, r.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_friends(uuid, int, int) from public, anon;
grant execute on function public.list_friends(uuid, int, int) to authenticated;

-- 5.3.1. САМА ТАБЛИЦА ПОДПИСОК ЗАКРЫВАЕТСЯ ОТ ПОСТОРОННИХ.
--
-- Проверки блокировки в list_followers/list_following, добавленные ниже, без
-- этого шага не стоят ничего. Политика на follows звучала так:
--
--     for select using (auth.role() = 'authenticated')
--
-- то есть ЛЮБОЙ вошедший читал таблицу целиком обычным запросом PostgREST:
--
--     GET /rest/v1/follows?follower_id=eq.<uuid>
--
-- Заблокировавший меня человек оставался полностью перечислимым — со всеми
-- своими подписками и подписчиками, — просто мимо RPC. Ужесточать функции и
-- оставлять открытой таблицу под ними — это охранять дверь при снятой стене.
--
-- Обоснование прежней политики («счётчики на профиле нечем посчитать») больше
-- не действует: и счётчики, и списки давно считает user_profile /
-- list_followers / list_following — SECURITY DEFINER-функции, которым RLS не
-- препятствует. Прямого чтения follows в клиенте нет ни одного: там только
-- insert (подписаться) и delete (отписаться, убрать подписчика).
--
-- Оставляем ровно своё: строки, где я одна из сторон. Это не ограничивает
-- продуктовую модель — чужие подписчики по-прежнему видны через RPC, но уже с
-- проверкой блокировки.
drop policy if exists "follows select" on public.follows;
create policy "follows select own" on public.follows
  for select using (auth.uid() = follower_id or auth.uid() = following_id);

-- 5.4. Подписчики и подписки — та же проверка «а можно ли смотреть на этого
-- человека вообще».
drop function if exists public.list_followers(uuid, int, int);

create or replace function public.list_followers(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
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
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

drop function if exists public.list_following(uuid, int, int);

create or replace function public.list_following(
  p_user_id uuid, p_limit int default 50, p_offset int default 0
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
    and not public.is_blocked_between(p_user_id, auth.uid())
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_followers(uuid, int, int) from public, anon;
revoke all on function public.list_following(uuid, int, int) from public, anon;
grant execute on function public.list_followers(uuid, int, int) to authenticated;
grant execute on function public.list_following(uuid, int, int) to authenticated;

-- 5.5. Профиль со счётчиками. Друзья считаются по взаимным подпискам.
drop function if exists public.user_profile(uuid);

create or replace function public.user_profile(p_user_id uuid)
returns table (
  user_id         uuid,
  username        text,
  display_name    text,
  avatar_url      text,
  followers_count int,
  following_count int,
  friends_count   int,
  posts_count     int
)
language sql
stable
security definer
set search_path = public
as $$
  with rel as (
    select
      p_user_id = auth.uid()                                                    as is_me,
      public.is_friend_with(auth.uid(), p_user_id)                              as is_friend,
      exists (select 1 from public.follows f
               where f.follower_id = auth.uid() and f.following_id = p_user_id) as is_following
  )
  select
    p.user_id, p.username, p.display_name, p.avatar_url,
    (select count(*) from public.follows f where f.following_id = p.user_id)::int,
    (select count(*) from public.follows f where f.follower_id  = p.user_id)::int,
    (select count(*) from public.follows f
      join public.follows r on r.follower_id = f.following_id and r.following_id = f.follower_id
      where f.follower_id = p.user_id)::int,
    (select count(*) from public.posts po, rel
      where po.user_id = p.user_id
        and (rel.is_me
             or po.visibility = 'public'
             or (po.visibility = 'followers' and (rel.is_following or rel.is_friend))
             or (po.visibility = 'friends'   and rel.is_friend)))::int
  from public.profiles p
  where p.user_id = p_user_id
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_profile(uuid) from public, anon;
grant execute on function public.user_profile(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отношение сразу с несколькими людьми
-- ─────────────────────────────────────────────────────────────────────────
-- Ровно то же, что get_relationship, но на список. Экран с пятьюдесятью
-- людьми делал пятьдесят запросов; здесь это один запрос и четыре индексных
-- скана, ограниченных теми же пятьюдесятью идентификаторами.
--
-- Набор колонок повторяет get_relationship, чтобы клиент разбирал ответ той
-- же функцией и не завёл вторую трактовку одних и тех же флагов.
drop function if exists public.relationships_with(uuid[]);

create or replace function public.relationships_with(p_user_ids uuid[])
returns table (
  user_id       uuid,
  following     boolean,
  followed_by   boolean,
  mutual_follow boolean,
  friend        boolean,
  blocked       boolean,
  blocked_by    boolean
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
    ids.id in (select id from bb)
  from ids, me
  where ids.id <> me.uid;
$$;

revoke all on function public.relationships_with(uuid[]) from public, anon;
grant execute on function public.relationships_with(uuid[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Ответы: блокировка, профиль как источник имени, пагинация
-- ─────────────────────────────────────────────────────────────────────────
-- Три исправления в одной функции.
--
--   • Заблокированные исчезают из ветки. Раньше блокировка работала только
--     там, где люди встречались напрямую, а под общим постом ответ
--     заблокированного был виден.
--
--   • Имя и аватар берутся из profiles, а не из app_state. profiles — и есть
--     публичная витрина (её наполняет триггер app_state_profile_sync); чтение
--     чужого блоба состояния ради двух полей было лишним обращением к самым
--     чувствительным данным приложения. Заодно появился ник — без него в
--     ветке нельзя отличить двух Денисов.
--
--   • Пагинация курсором и порядок «сначала новые». Отдаём последние N;
--     клиент переворачивает список и догружает более ранние по курсору.
--     Прежние «первые 100 по возрастанию» означали, что в популярной ветке
--     свежих ответов не видно вовсе.
--
-- Набор колонок меняется, поэтому нужен DROP: create or replace на смену
-- OUT-параметров отвечает 42P13.
-- Снимаем ОБЕ возможные формы: старую двухаргументную и новую — на случай,
-- если предыдущий прогон этого файла оборвался на более позднем шаге и
-- четырёхаргументная версия уже успела появиться.
drop function if exists public.list_post_comments(uuid, int);
drop function if exists public.list_post_comments(uuid, int, timestamptz, uuid);

create or replace function public.list_post_comments(
  p_post_id   uuid,
  p_limit     int default 30,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id              uuid,
  user_id         uuid,
  text            text,
  created_at      timestamptz,
  author_name     text,
  author_avatar   text,
  author_username text
)
language sql
stable
security definer
set search_path = public
as $$
  with blocked as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = auth.uid()
    union
    select b.blocker_id     from public.blocks b where b.blocked_id = auth.uid()
  )
  select c.id, c.user_id, c.text, c.created_at,
         p.display_name, p.avatar_url, p.username
  from public.post_comments c
  left join public.profiles p on p.user_id = c.user_id
  where c.post_id = p_post_id
    and public.can_view_post(p_post_id)
    and c.user_id not in (select id from blocked)
    and (
      p_before_at is null
      or (c.created_at, c.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.list_post_comments(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_post_comments(uuid, int, timestamptz, uuid) to authenticated;


-- Политика самой таблицы ответов — тем же правилом, что и функция чтения.
--
-- Без этого фильтр по блокировке в list_post_comments обходится так же, как
-- обходились списки подписчиков: обычным запросом PostgREST
--     GET /rest/v1/post_comments?post_id=eq.<uuid>
-- Политика пускала по can_view_post и ничего не знала про блокировки, то есть
-- ответ заблокированного человека приезжал в обход функции. Клиент прямых
-- чтений этой таблицы не делает — только insert и delete, — поэтому
-- ужесточение ничего не ломает.
drop policy if exists "post comments select" on public.post_comments;
create policy "post comments select" on public.post_comments
  for select using (
    public.can_view_post(post_id)
    and not public.is_blocked_between(post_comments.user_id, auth.uid())
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Лента: друзья из подписок, счётчик ответов без заблокированных
-- ─────────────────────────────────────────────────────────────────────────
-- Тело повторяет версию из 2026-08-25 с тремя правками: CTE friends считается
-- по взаимным подпискам, а не по строкам friendships; счётчик ответов не
-- учитывает заблокированных; из круга ленты убран union с friends — после
-- смены определения друзья и так подмножество подписок, и лишняя ветка
-- union'а только сбивала планировщик.
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
  avatar_url     text,
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
  followed as (
    select f.following_id as id from public.follows f, me where f.follower_id = me.uid
  ),
  friends as (
    select f.following_id as id
    from public.follows f, me
    where f.follower_id = me.uid
      and exists (
        select 1 from public.follows r
        where r.follower_id = f.following_id and r.following_id = me.uid
      )
  ),
  circle as (
    select uid as id from me
    union select id from followed
  )
  select
    p.id, p.user_id, pr.username, pr.display_name, pr.avatar_url,
    p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = (select uid from me)),
    (select count(*) from public.post_comments c
      where c.post_id = p.id and c.user_id not in (select id from blocked))::int
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
      or (p.visibility = 'followers' and p.user_id in (select id from followed))
      or (p.visibility = 'friends'   and p.user_id in (select id from friends))
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_feed(int, timestamptz, uuid) from public, anon;
grant execute on function public.list_feed(int, timestamptz, uuid) to authenticated;

-- Посты одного человека — тот же счётчик ответов без заблокированных.
drop function if exists public.list_posts(uuid, int, timestamptz);

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
  ),
  blocked as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = auth.uid()
    union
    select b.blocker_id     from public.blocks b where b.blocked_id = auth.uid()
  )
  select
    p.id, p.user_id, p.text, p.image_url, p.visibility, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    (select count(*) from public.post_comments c
      where c.post_id = p.id and c.user_id not in (select id from blocked))::int
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


-- ─────────────────────────────────────────────────────────────────────────
-- 9. Уведомления не переживают того, о чём рассказывали
-- ─────────────────────────────────────────────────────────────────────────
-- entity_id у уведомления — не внешний ключ (типы сущностей разные), поэтому
-- каскад его не чистит. В итоге после удаления поста в центре событий
-- оставалось «X отреагировал на вашу мысль», ведущее в никуда. Чистим
-- триггерами — там же, где сущность исчезает.

create or replace function public.cleanup_post_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications n
   where (n.entity_type = 'post' and n.entity_id = old.id)
      or (n.entity_type = 'comment'
          and n.metadata ? 'post_id'
          and n.metadata->>'post_id' = old.id::text);
  return old;
end;
$$;

drop trigger if exists posts_notify_cleanup on public.posts;
create trigger posts_notify_cleanup
  after delete on public.posts
  for each row execute function public.cleanup_post_notifications();

create or replace function public.cleanup_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where entity_type = 'comment' and entity_id = old.id;
  return old;
end;
$$;

drop trigger if exists post_comments_notify_cleanup on public.post_comments;
create trigger post_comments_notify_cleanup
  after delete on public.post_comments
  for each row execute function public.cleanup_comment_notification();

-- Блокировка чистила события только у того, кто блокировал. У второго
-- оставалось «X подписался на вас» от человека, чей профиль ему больше не
-- открыть, — нажатие вело в пустоту. Блокировка симметрична по последствиям,
-- даже если она односторонняя по смыслу.
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

  delete from public.notifications
   where (recipient_id = new.blocker_id and actor_id = new.blocked_id)
      or (recipient_id = new.blocked_id and actor_id = new.blocker_id);

  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 10. Частота реакций и ответов
-- ─────────────────────────────────────────────────────────────────────────
-- У постов, ответов, подписок и заявок лимит частоты был, у реакций — нет.
-- А реакция ещё и переводит уведомление обратно в непрочитанное (upsert в
-- push_notification), то есть переключением 🥕/🥦 можно было безостановочно
-- дёргать чужой бейдж. Потолок высокий: живой человек до него не доберётся.
create or replace function public.limit_post_reactions()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.post_reactions
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 300 then
    raise exception 'too many reactions, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists post_reactions_rate_limit on public.post_reactions;
create trigger post_reactions_rate_limit
  before insert or update on public.post_reactions
  for each row execute function public.limit_post_reactions();

-- Заодно закрываем щель в политике реакций. INSERT проверял can_view_post, а
-- UPDATE — только авторство строки:
--
--     for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
--
-- То есть поставив реакцию на пост, пока он был виден, человек мог менять её и
-- после того, как автор сузил видимость или заблокировал его. Счётчик под
-- чужим постом продолжал бы дёргаться от того, кому этот пост больше не
-- показывают. Разница невелика, но правило «право на действие проверяется в
-- момент действия» не должно иметь исключений без причины.
drop policy if exists "post reactions update own" on public.post_reactions;
create policy "post reactions update own" on public.post_reactions
  for update using (auth.uid() = user_id and public.can_view_post(post_id))
          with check (auth.uid() = user_id and public.can_view_post(post_id));

-- Оба лимита частоты считают строки по user_id за час, а индекса под этот
-- счёт не было ни у реакций, ни у ответов: каждая вставка means seq scan по
-- всей таблице. На тысяче строк незаметно, на миллионе — это цена каждого
-- лайка.
create index if not exists post_reactions_user_time_idx
  on public.post_reactions (user_id, created_at desc);
create index if not exists post_comments_user_time_idx
  on public.post_comments (user_id, created_at desc);

-- Индекс по (visibility, created_at) не обслуживает ни одного запроса: и
-- list_feed, и list_posts начинают с user_id, а visibility — колонка из
-- четырёх значений, по которой начинать сканирование бессмысленно. Лишний
-- индекс — это замедление каждой публикации ради нуля выигрыша на чтении.
drop index if exists public.posts_visibility_created_idx;


-- ─────────────────────────────────────────────────────────────────────────
-- 11. Ник нельзя менять как перчатки
-- ─────────────────────────────────────────────────────────────────────────
-- Ник — единственный адрес человека, и по нему его узнают. Ничем не
-- ограниченная смена означает, что освободившийся ник тут же занимает другой
-- человек, а переписка и упоминания начинают вести не туда. Сутки — не
-- препятствие тому, кто выбирает себе имя, но препятствие тому, кто
-- перебирает чужие.
alter table public.profiles add column if not exists username_changed_at timestamptz;

create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_new  text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  v_cur  text;
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_new !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars of a-z, 0-9, _' using errcode = '22023';
  end if;

  select username, username_changed_at into v_cur, v_last
  from public.profiles where user_id = v_uid;

  -- Сохранение без изменения — не смена ника и под ограничение не попадает:
  -- человек мог просто нажать «Сохранить» в редакторе профиля.
  if v_cur = v_new then
    return v_new;
  end if;

  if v_last is not null and v_last > now() - interval '1 day' then
    raise exception 'username was changed recently' using errcode = '54000';
  end if;

  if exists (select 1 from public.profiles where username = v_new and user_id <> v_uid) then
    raise exception 'username is taken' using errcode = '23505';
  end if;

  perform set_config('eataps.trusted_profile_write', 'on', true);
  update public.profiles
     set username = v_new, username_changed_at = now()
   where user_id = v_uid;
  perform set_config('eataps.trusted_profile_write', 'off', true);
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11.1. ДВЕ СЛОМАННЫЕ ВЕЩИ В ОДНОМ ТРИГГЕРЕ
-- ─────────────────────────────────────────────────────────────────────────
-- guard_profile_update с 2026-08-25 не переписывался, и в нём накопилось два
-- отказа — оба тихих, оба в самом центре регистрации.
--
-- ПЕРВЫЙ: ссылка на колонку, которой больше нет.
--
--     if new.user_id is distinct from old.user_id
--        or new.public_id is distinct from old.public_id then
--
-- Колонку public_id удалила миграция 2026-08-26_nickname_identity, а триггер
-- остался прежним. PL/pgSQL разрешает обращения к полям записи во время
-- выполнения, поэтому файл прогонялся без единой жалобы, а падало уже потом —
-- КАЖДЫЙ UPDATE по profiles, с 42703 «record "new" has no field public_id».
--
-- Что это ломало на живой базе:
--   • смену ника — set_username делает UPDATE и получает эту ошибку;
--   • сохранение состояния — save_app_state дёргает триггер
--     app_state_profile_sync, тот делает UPDATE по profiles, и падение
--     уносит всю транзакцию сохранения.
--
-- Почему это не заметили сразу: sync_profile_from_state обновляет строку
-- только когда имя или аватар РАСХОДЯТСЯ с копией. Существующим аккаунтам
-- копию проставил разовый бэкфилл той же миграции, у них расхождения нет и
-- UPDATE не выполняется вовсе. Ошибку встречает ровно тот, кто ЗАВЁЛ аккаунт
-- после миграции или изменил имя либо фото. То есть каждый новый человек.
--
-- ВТОРОЙ: защита зеркальных полей отменяла сама зеркалирование.
--
--     if auth.uid() is not null and (new.display_name is distinct from old...)
--       then new.display_name := old.display_name;
--
-- Замысел верный: display_name и avatar_url — копия из app_state, и клиент не
-- должен править их прямым запросом. Но условие «есть auth.uid()» истинно и
-- внутри sync_profile_from_state: SECURITY DEFINER меняет роль, а не JWT, и
-- auth.uid() внутри триггера — по-прежнему тот, кто сохранил состояние.
-- Поэтому единственная законная запись в эти колонки откатывалась вместе с
-- незаконными, и после первой миграции публичная витрина не обновлялась
-- больше никогда: у новых аккаунтов имя и аватар оставались пустыми, и лента,
-- поиск и списки людей показывали «Без имени» с буквой вместо фотографии.
--
-- Различаем законную запись явным признаком, а не косвенным. Признак ставит
-- сама зеркалирующая функция и тут же снимает; он транзакционный (третий
-- аргумент set_config — true), поэтому не переживает запрос и не может
-- утечь на соседний через пул соединений.
create or replace function public.sync_profile_from_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(left(coalesce(new.state->'profile'->>'name', ''), 60), '');
  v_raw  text := new.state->'profile'->>'avatar';
  -- Имя обрезать можно: слишком длинное имя остаётся именем. Аватар — нельзя:
  -- это base64-строка, и обрезанная она не картинка, а мусор. Поэтому сверх
  -- потолка пишем NULL, и интерфейс рисует инициал.
  v_av   text := case when char_length(coalesce(v_raw, '')) between 1 and 300000
                      then v_raw end;
begin
  perform set_config('eataps.trusted_profile_write', 'on', true);
  update public.profiles
     set display_name = v_name,
         avatar_url   = v_av
   where user_id = new.user_id
     and (display_name is distinct from v_name or avatar_url is distinct from v_av);
  perform set_config('eataps.trusted_profile_write', 'off', true);
  return null;
end;
$$;

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

  -- Всё, что не пришло от доверенной серверной функции, откатывается целиком.
  -- Ник в этом списке не случайно: политика «profiles update own» разрешала
  -- клиенту PATCH по своей строке без разбора колонок, то есть ник можно было
  -- сменить прямым запросом мимо set_username — без снятия «собаки», без
  -- проверки частоты и без нормализации. Уникальность и формат ловили бы
  -- ограничения таблицы, но не подмену адреса раз в минуту.
  if auth.uid() is not null
     and coalesce(current_setting('eataps.trusted_profile_write', true), 'off') <> 'on' then
    new.username            := old.username;
    new.username_changed_at := old.username_changed_at;
    new.display_name        := old.display_name;
    new.avatar_url          := old.avatar_url;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_update_guard on public.profiles;
create trigger profiles_update_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- И вторым слоем — сама возможность прямой записи убирается. После правок
-- выше клиентский UPDATE не может изменить НИ ОДНОЙ колонки profiles: всё
-- откатывается триггером. Политика, которая не разрешает ничего, — это не
-- политика, а обещание, что когда-нибудь кто-нибудь добавит в таблицу колонку
-- и забудет про guard. Пишут в profiles только SECURITY DEFINER-функции
-- (set_username, sync_profile_from_state, claim_username при регистрации), а
-- им политики не нужны.
drop policy if exists "profiles update own" on public.profiles;

-- Разовое восстановление витрины для всех, кого сломал прежний триггер.
-- В SQL Editor auth.uid() пуст и guard не вмешался бы и так, но полагаться на
-- это не будем: файл могут прогнать инструментом, который передаёт JWT.
select set_config('eataps.trusted_profile_write', 'on', false);

update public.profiles p
   set display_name = nullif(left(coalesce(a.state->'profile'->>'name', ''), 60), ''),
       avatar_url   = case
                        when char_length(coalesce(a.state->'profile'->>'avatar', '')) between 1 and 300000
                        then a.state->'profile'->>'avatar'
                      end
  from public.app_state a
 where a.user_id = p.user_id
   and (
     p.display_name is distinct from nullif(left(coalesce(a.state->'profile'->>'name', ''), 60), '')
     or p.avatar_url is distinct from case
          when char_length(coalesce(a.state->'profile'->>'avatar', '')) between 1 and 300000
          then a.state->'profile'->>'avatar'
        end
   );

select set_config('eataps.trusted_profile_write', 'off', false);


-- ─────────────────────────────────────────────────────────────────────────
-- 12. Поиск: сначала те, с кем уже есть связь
-- ─────────────────────────────────────────────────────────────────────────
-- Условие отбора не меняется (ник, с начала строки, от трёх символов) —
-- меняется только порядок. Человек, которого я ищу по трём буквам, чаще всего
-- тот, на кого я уже подписан или кто подписан на меня.
drop function if exists public.search_users(text, int);

create or replace function public.search_users(p_query text, p_limit int default 20)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', ''))) as v
  )
  select p.user_id, p.username, p.display_name, p.avatar_url
  from public.profiles p, q
  where char_length(q.v) >= 3
    and p.user_id <> auth.uid()
    and p.username like q.v || '%'
    and not public.is_blocked_between(p.user_id, auth.uid())
  order by
    (p.username = q.v) desc,
    (exists (select 1 from public.follows f
              where f.follower_id = auth.uid() and f.following_id = p.user_id)) desc,
    (exists (select 1 from public.follows f
              where f.follower_id = p.user_id and f.following_id = auth.uid())) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 13. Сообщения: идемпотентность, границы, пагинация
-- ─────────────────────────────────────────────────────────────────────────

-- 13.1. Ключ идемпотентности.
-- Клиент придумывает его ОДИН раз на сообщение и повторяет при каждой попытке
-- отправки. Тогда «ответ потерялся, шлём ещё раз» — это повтор той же строки,
-- а не второе сообщение. Частичный уникальный индекс: у старых сообщений
-- ключа нет и не будет, а NULL'ы в уникальный индекс не должны попадать
-- вовсе — их там были бы миллионы.
alter table public.messages add column if not exists client_id uuid;

create unique index if not exists messages_sender_client_idx
  on public.messages (sender, client_id) where client_id is not null;

-- 13.2. Потолок длины текста.
-- Его не было вообще: колонка text без ограничения означает, что одним
-- запросом можно положить в чужую переписку мегабайт. Ставим ограничение
-- только если существующие данные ему удовлетворяют — иначе миграция упала бы
-- на чьей-нибудь длинной цитате, а чинить это в разгар прогона нечем.
do $$
begin
  if not exists (select 1 from public.messages where char_length(text) > 4000) then
    alter table public.messages drop constraint if exists messages_text_len;
    alter table public.messages add constraint messages_text_len
      check (text is null or char_length(text) <= 4000);
  else
    raise notice 'messages_text_len не поставлен: есть сообщения длиннее 4000 символов';
  end if;
end $$;

-- 13.3. Отправка через RPC.
--
-- Почему не прямой INSERT, как раньше:
--   • sender приходил из тела запроса. Подделать его не давала политика
--     (auth.uid() = sender), но правило «сервер определяет, кто действует»
--     не должно держаться на том, что проверку не забыли написать;
--   • повтор при обрыве сети давал дубликат — теперь его снимает client_id;
--   • reply_to не проверялся ничем. Можно было ответить на сообщение из
--     ЧУЖОЙ переписки: сама цитата рисуется из reply_snapshot, который тоже
--     присылает клиент, так что содержимого это не раскрывало, — но связывало
--     сообщение с посторонней строкой и оставляло след в базе.
--
-- Функция намеренно SECURITY INVOKER (по умолчанию): вставку по-прежнему
-- проверяет политика messages — дружба и отсутствие блокировки. Дублировать
-- эти условия внутри значило бы завести второе место, где они могут разойтись.
drop function if exists public.send_message(uuid, text, text, jsonb, uuid, jsonb, text, uuid);

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
  if v_text is null and p_image_url is null and p_meal_ref is null then
    raise exception 'empty message' using errcode = '22023';
  end if;
  if char_length(coalesce(v_text, '')) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  -- Карточка блюда — это снимок из дневника, а не место для произвольного
  -- JSON. Потолок мягкий, но он есть.
  if p_meal_ref is not null and char_length(p_meal_ref::text) > 8000 then
    raise exception 'meal reference is too large' using errcode = '22001';
  end if;

  -- Уже отправляли — возвращаем ту же строку. Это и есть идемпотентность:
  -- повтор не создаёт второго сообщения и не выглядит для клиента ошибкой.
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
  -- Гонка двух попыток с одним ключом: победила соседняя. Отдаём её строку —
  -- для человека это ровно то, чего он добивался.
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

-- 13.4. Чтение истории — курсором и с конца.
--
-- Прежний клиентский запрос читал историю так:
--     .order('created_at', { ascending: true }).limit(300)
-- То есть брал САМЫЕ СТАРЫЕ триста сообщений. В переписке короче трёхсот
-- реплик разницы не видно, и ошибка прожила незамеченной; в переписке длиннее
-- человек открывал чат и не находил в нём ни одного свежего сообщения.
--
-- Здесь порядок обратный (сначала новые) и есть курсор по (created_at, id) —
-- клиент переворачивает страницу и догружает более ранние при прокрутке вверх.
--
-- Условие по паре записано через least/greatest не для красоты: ровно в таком
-- виде лежит индекс messages_pair_idx, и запрос ложится на него целиком.
-- Форма «(sender=a and recipient=b) or (sender=b and recipient=a)», которой
-- пользовался клиент, этим индексом воспользоваться не может.
drop function if exists public.list_messages(uuid, int, timestamptz, uuid);

create or replace function public.list_messages(
  p_peer      uuid,
  p_limit     int default 40,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.messages m
  where auth.uid() is not null
    and p_peer is not null
    and least(m.sender, m.recipient)    = least(auth.uid(), p_peer)
    and greatest(m.sender, m.recipient) = greatest(auth.uid(), p_peer)
    and auth.uid() in (m.sender, m.recipient)
    and (
      p_before_at is null
      or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_messages(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.list_messages(uuid, int, timestamptz, uuid) to authenticated;

-- 13.5. Список диалогов.
--
-- Клиент собирал его так: выгрузить последние 200 сообщений по всем перепискам
-- и сгруппировать на месте. Два изъяна. Первый: активная переписка с одним
-- человеком вытесняет из выборки всех остальных, и диалог с редким
-- собеседником просто исчезает из списка. Второй: по сети едет текст двухсот
-- сообщений ради двух десятков строк предпросмотра.
--
-- DISTINCT ON по собеседнику берёт по одному последнему сообщению на диалог —
-- ровно то, что нужно списку, и ни строкой больше.
--
-- Форма запроса — union all из двух половин (что я отправил, что получил), а
-- не одно `where sender = me or recipient = me`. Причина в индексах: условие
-- через OR не ложится ни на один из них и приводит к чтению всей таблицы
-- сообщений — ВСЕХ пользователей, не только своих. Две половины ложатся на
-- messages_sender_time_idx и messages_recipient_idx каждая.
create index if not exists messages_sender_time_idx
  on public.messages (sender, created_at desc);

drop function if exists public.list_conversations(int);

create or replace function public.list_conversations(p_limit int default 100)
returns table (
  peer_id      uuid,
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
  select c.peer_id, c.id, c.sender, c.text, c.image_url, c.has_meal, c.created_at,
         (select count(*)::int from public.messages u
           where u.recipient = auth.uid() and u.sender = c.peer_id and u.read_at is null)
  from conv c
  where not public.is_blocked_between(c.peer_id, auth.uid())
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_conversations(int) from public, anon;
grant execute on function public.list_conversations(int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 14. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- messages и notifications уже в публикации (schema.sql и 2026-08-25).
-- Здесь только страховка на случай базы, поднятой в другом порядке.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
