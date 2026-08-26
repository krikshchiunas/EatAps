-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ник вместо публичного ID, дружба вместо заявок.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Единственное, что удаляется безвозвратно, — колонка
-- profiles.public_id и незакрытые заявки в друзья (они превращаются в
-- подписки, см. раздел 5).
--
-- ВНИМАНИЕ: после этого файла НЕЛЬЗЯ прогонять по отдельности
-- 2026-08-09_unpredictable_public_id.sql — он пишет в колонку, которой больше
-- нет. В составе setup_all.sql порядок соблюдён и всё сходится.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО ЭТА МИГРАЦИЯ МЕНЯЕТ ПРИНЦИПИАЛЬНО
--
-- 1. У человека остаётся ОДИН адрес — ник (profiles.username). Уникальный,
--    редактируемый, единственный способ найти другого человека. Публичный
--    12-символьный код (7K4M-9XPQ-2RTV) исчезает целиком: колонка, четыре
--    функции вокруг неё и весь клиентский код.
--
--    Зачем: код существовал ровно для одной задачи — «дай мне себя найти, не
--    раскрывая себя поиску». Ту же задачу решает ник, но его человек выбирает
--    сам, диктует вслух и помнит. Два разных адреса у одного профиля означали
--    два способа найти человека и две поверхности, которые надо защищать.
--
--    Цена решения названа прямо: код был неугадываемым (2^60 вариантов), а ник
--    — угадываемым по построению. Перебор ников найдёт зарегистрированные
--    аккаунты. Но эта дверь уже открыта миграцией 2026-08-25: поиск по
--    префиксу имени и ника доступен любому авторизованному. Здесь она не
--    открывается заново, а сужается — искать теперь можно ТОЛЬКО по нику
--    целиком или по его началу, но не по отображаемому имени.
--
-- 2. ДРУЖБА = ВЗАИМНАЯ ПОДПИСКА. Заявок и подтверждений больше нет.
--
--    До этого файла дружба была отдельной сущностью с заявкой, ожиданием и
--    подтверждением. Теперь она производная: A подписан на B и B подписан на A
--    — значит, друзья. Отписался кто угодно из двоих — дружба кончилась.
--
--    Таблица friendships при этом ОСТАЁТСЯ и остаётся не случайно: на неё
--    ссылаются восемь живых политик и функций из ранних миграций (чтение
--    app_state друга, политики post_reactions и post_comments, friend_briefs,
--    тренерская проверка). drop table ... cascade снёс бы вместе с ней эти
--    политики, то есть открыл бы данные, а не закрыл. Поэтому таблица
--    превращается в ПРОИЗВОДНУЮ: её пишет триггер на follows, а клиентские
--    INSERT/UPDATE/DELETE-политики закрываются. Без этого клиент мог бы
--    вставить строку дружбы сам и получить право переписки, которого ему никто
--    не давал.
--
--    ⚠ ПОСЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ. Дневник питания и личные сообщения
--    открыты друзьям. «Подписаться в ответ» — жест куда более лёгкий, чем
--    «принять заявку»: раньше между чужим человеком и дневником стояло
--    осознанное подтверждение, теперь — одно нажатие в ответ на чужую
--    подписку. Круг доступа к дневнику расширяется. Решение владельца
--    продукта, принятое явно; правило «дневник и личка — друзьям» не
--    меняется, меняется определение друга.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ник перестаёт зависеть от публичного ID
-- ─────────────────────────────────────────────────────────────────────────
-- claim_username брала хвост public_id как гарантированно уникальную основу
-- для запасного ника. Колонки не будет, поэтому основой становится хвост
-- UUID: он уникален по построению ровно так же.

create or replace function public.claim_username(p_user_id uuid, p_hint text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := public.slugify_username(p_hint);
  v_try  text;
  v_n    int := 0;
begin
  -- Слишком короткая или пустая основа — берём хвост UUID пользователя.
  -- Восемь шестнадцатеричных знаков на порядки перекрывают любое обозримое
  -- число аккаунтов, а цикл ниже добьёт даже такое совпадение.
  if v_base is null or char_length(v_base) < 3 then
    v_base := 'eater_' || lower(right(replace(p_user_id::text, '-', ''), 8));
  end if;

  v_try := v_base;
  loop
    exit when not exists (
      select 1 from public.profiles where username = v_try and user_id <> p_user_id
    );
    v_n := v_n + 1;
    if v_n > 50 then
      v_try := 'eater_' || lower(right(replace(gen_random_uuid()::text, '-', ''), 10));
      exit;
    end if;
    -- Обрезаем основу так, чтобы вместе с суффиксом уложиться в 20 символов.
    v_try := substr(v_base, 1, 19 - char_length(v_n::text)) || '_' || v_n::text;
  end loop;

  return v_try;
end;
$$;

revoke all on function public.claim_username(uuid, text) from public, anon;


-- Регистрация: строка профиля создаётся сразу с ником, одним INSERT.
-- Двухшаговый вариант (вставить, потом обновить) после NOT NULL на username
-- падал бы на первом же шаге.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, public.claim_username(new.id, null))
  on conflict (user_id) do nothing;
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. user_brief переезжает с кода на ник
-- ─────────────────────────────────────────────────────────────────────────
-- Функция отдавала (public_id, name) и пряталa код от посторонних. Прятать
-- больше нечего: ник и так публичен — его отдаёт поиск. Меняется набор
-- колонок, поэтому нужен DROP, а не CREATE OR REPLACE.

drop function if exists public.user_brief(uuid);

create or replace function public.user_brief(p_user uuid)
returns table (username text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.username, p.display_name
  from public.profiles p
  where p.user_id = p_user
    and not public.is_blocked_between(p.user_id, auth.uid());
$$;

revoke all on function public.user_brief(uuid) from public, anon;
grant execute on function public.user_brief(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Публичный ID удаляется
-- ─────────────────────────────────────────────────────────────────────────
-- Порядок обязателен: сначала функции, которые читают колонку, потом сама
-- колонка. Иначе DROP COLUMN упрётся в зависимости.

drop function if exists public.find_user_by_public_id(text);
drop function if exists public.ensure_public_id();
drop function if exists public.generate_public_id();
drop function if exists public.normalize_public_id(text);

alter table public.profiles drop constraint if exists profiles_public_id_format;
alter table public.profiles drop column if exists public_id;

-- Последовательность старого формата убрана ещё в 2026-08-09; строка ниже —
-- на случай базы, где тот файл не прогоняли.
drop sequence if exists public.public_id_seq;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ник — обязательный и единственный адрес
-- ─────────────────────────────────────────────────────────────────────────

-- Профиль без строки в profiles — человек, которого нельзя ни найти, ни
-- показать. Такое случалось при сбое триггера регистрации; раньше это чинила
-- ensure_public_id при первом обращении, теперь чиним разом.
--
-- Ник здесь НЕ выдаём: claim_username проверяет занятость обычным SELECT, а он
-- не видит строки, вставляемые этим же запросом. Два человека с одинаковым
-- именем получили бы один ник и уронили бы вставку на уникальном индексе.
-- Поэтому ники раздаёт цикл ниже — по одному, и каждый следующий видит
-- предыдущего.
insert into public.profiles (user_id)
select u.id
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

-- Ник тем, у кого его ещё нет. Цикл, а не один UPDATE: claim_username должна
-- видеть ники, выданные на предыдущих шагах, иначе два пустых профиля с
-- одинаковым именем получили бы один и тот же ник.
do $$
declare
  r record;
begin
  for r in
    select p.user_id, a.state->'profile'->>'name' as nm
    from public.profiles p
    left join public.app_state a on a.user_id = p.user_id
    where p.username is null
  loop
    update public.profiles
       set username = public.claim_username(r.user_id, r.nm)
     where user_id = r.user_id;
  end loop;
end $$;

-- Теперь ник есть у всех, и это можно закрепить. NOT NULL здесь — не
-- формальность: ник стал единственным способом найти человека, и профиль без
-- него невидим для всего приложения.
alter table public.profiles alter column username set not null;

-- Раз NULL невозможен, ветка «username is null or …» в ограничении формата
-- лишняя. Регистр по-прежнему только нижний: уникальный индекс по text
-- различал бы «Andrej» и «andrej», и два человека получили бы визуально
-- неотличимые адреса.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9_]{3,20}$');


-- Смена ника. Ведущая «собака» снимается на входе: человек, привыкший к
-- @nickname в других приложениях, вставит её по привычке, и отказ «недопустимый
-- символ» был бы придиркой, а не защитой. В базе и в интерфейсе ник живёт без
-- приставки.
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

  update public.profiles set username = v_new where user_id = v_uid;
  return v_new;
end;
$$;

revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;


-- Найти человека по нику целиком. Занимает место find_user_by_public_id:
-- ровно та же роль — превратить то, что человек продиктовал, в UUID.
-- Нужна там, где нельзя пройти через поиск: приглашение тренера.
create or replace function public.find_user_by_username(p_username text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.profiles p
  where p.username = lower(btrim(regexp_replace(coalesce(p_username, ''), '^@+', '')))
    and not public.is_blocked_between(p.user_id, auth.uid())
  limit 1;
$$;

revoke all on function public.find_user_by_username(text) from public, anon;
grant execute on function public.find_user_by_username(text) to authenticated;


-- Поиск людей — ТОЛЬКО по нику.
--
-- Отображаемое имя выпадает из условия поиска намеренно. Во-первых, оно
-- неуникально: по запросу «Денис» вернулся бы десяток одинаковых строк, и
-- выбрать среди них нужного человека не по чему. Во-вторых, имя человек не
-- выбирал как адрес — он писал его для друзей, а не для того, чтобы по нему
-- его находили посторонние. Ник он выбирает именно как адрес.
--
-- Совпадение по-прежнему только С НАЧАЛА строки и от трёх символов: поиск
-- подстрокой ('%a%') вернул бы почти всю базу по одной букве.
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
    -- Точное совпадение выше префиксного, дальше по алфавиту.
    (p.username = q.v) desc,
    p.username
  limit least(greatest(coalesce(p_limit, 20), 1), 30);
$$;

revoke all on function public.search_users(text, int) from public, anon;
grant execute on function public.search_users(text, int) to authenticated;

-- Индекс по имени больше не обслуживает ни одного запроса.
drop index if exists public.profiles_display_name_prefix_idx;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Дружба становится производной от подписок
-- ─────────────────────────────────────────────────────────────────────────

-- 5.1. Клиент теряет право писать в friendships.
-- Строку теперь создаёт и удаляет только сервер. Оставленная INSERT-политика
-- была бы дырой: право переписки проверяется через дружбу, и клиент,
-- вставивший строку сам, выписал бы себе доступ в чужую личку.
drop policy if exists "friendship insert" on public.friendships;
drop policy if exists "friendship update" on public.friendships;
drop policy if exists "friendship delete" on public.friendships;
-- SELECT остаётся: свои связи человек читать должен.

-- 5.2. Механика заявок демонтируется.
-- Ограничение частоты заявок и подстановка имени заявителя не просто
-- бесполезны — они вредны: оба триггера срабатывали бы на строки, которые
-- теперь пишет сервер, и лимит «30 в час» ронял бы обычное «подписаться в
-- ответ» тридцать первому человеку.
drop trigger if exists friendships_rate_limit on public.friendships;
drop trigger if exists friendships_set_requester_name on public.friendships;
drop function if exists public.limit_friend_requests();
drop function if exists public.set_requester_name();

-- Колонка requester_name остаётся пустой, но не удаляется: на неё ссылается
-- разовый UPDATE в 2026-08-08_hardening.sql, и её удаление сломало бы
-- повторный прогон того файла. Пустая неиспользуемая колонка дешевле, чем
-- миграция, после которой ранние файлы перестают быть идемпотентными.

-- 5.3. Триггеры подписок снимаются на время переноса данных.
-- follows_rate_limit иначе оборвал бы бэкфилл на 200-й подписке, а
-- follows_notify разослал бы уведомление «на вас подписались» за каждую
-- дружбу, которой уже год.
drop trigger if exists follows_rate_limit on public.follows;
drop trigger if exists follows_notify on public.follows;

-- Принятая дружба → две подписки. Без этого шага все существующие друзья
-- перестали бы быть друзьями и потеряли бы доступ к переписке.
insert into public.follows (follower_id, following_id)
select f.requester, f.addressee
from public.friendships f
where f.status = 'accepted' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

insert into public.follows (follower_id, following_id)
select f.addressee, f.requester
from public.friendships f
where f.status = 'accepted' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

-- Незакрытая заявка → односторонняя подписка заявителя. Это ровно то, что он
-- выражал: интерес к человеку. Согласия адресата подписка не требует и в
-- новой модели, так что ничего сверх уже возможного заявитель не получает —
-- он мог бы нажать «Подписаться» и сам.
insert into public.follows (follower_id, following_id)
select f.requester, f.addressee
from public.friendships f
where f.status = 'pending' and f.requester <> f.addressee
  and not public.is_blocked_between(f.requester, f.addressee)
on conflict do nothing;

-- Сами заявки и уведомления о них больше не существуют как класс.
delete from public.notifications where type = 'FRIEND_REQUEST';
delete from public.friendships where status = 'pending';

-- 5.4. Единственный источник ответа «друзья ли мы» — подписки.
-- Определение живёт здесь, а не в материализованной таблице, намеренно: даже
-- если строка friendships почему-то разойдётся с графом, права будут
-- посчитаны по графу.
create or replace function public.is_friend_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (
       select 1 from public.follows f
       where f.follower_id = p_a and f.following_id = p_b
     )
     and exists (
       select 1 from public.follows f
       where f.follower_id = p_b and f.following_id = p_a
     );
$$;

revoke all on function public.is_friend_with(uuid, uuid) from public, anon;
grant execute on function public.is_friend_with(uuid, uuid) to authenticated;

-- 5.5. Материализация: строка friendships появляется и исчезает вместе со
-- взаимностью подписки.
create or replace function public.sync_friendship_from_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Дружба возникает только в момент, когда подписка стала взаимной.
    if exists (
      select 1 from public.follows f
      where f.follower_id = new.following_id and f.following_id = new.follower_id
    ) then
      -- requester — тот, кто подписался ПЕРВЫМ (объект нынешней подписки).
      -- Это не бухгалтерия: именно он должен получить уведомление «теперь вы
      -- друзья», потому что второй только что нажал кнопку сам и всё знает.
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

  -- Отписка любой из сторон — дружба кончилась.
  delete from public.friendships f
   where (f.requester = old.follower_id  and f.addressee = old.following_id)
      or (f.requester = old.following_id and f.addressee = old.follower_id);
  return old;
end;
$$;

-- 5.6. Уведомление о дружбе. Промежуточного состояния «заявка» больше нет,
-- поэтому и веток стало на две меньше: дружба может только появиться.
create or replace function public.notify_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_notification(
    new.requester, new.addressee, 'FRIEND_ACCEPTED', 'friendship', new.id
  );
  return new;
end;
$$;

-- 5.7. Приведение таблицы к инварианту — ДО того, как включены триггеры
-- уведомлений. Иначе каждая пара, дружившая до миграции, получила бы
-- уведомление «теперь вы друзья» о дружбе годовой давности.
drop trigger if exists friendships_notify on public.friendships;

-- Дружба без взаимной подписки (например, та, где блокировка помешала
-- бэкфиллу) — не дружба.
delete from public.friendships f
 where not public.is_friend_with(f.requester, f.addressee);

-- Взаимная подписка без строки — недостающая дружба. Кто из двоих
-- «requester», для уже существующих связей значения не имеет: уведомления по
-- ним не рассылаются, а все чтения симметричны. Берём пару в порядке UUID,
-- чтобы результат не зависел от порядка строк.
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
on conflict (requester, addressee) do nothing;

-- 5.8. Все триггеры обратно. Порядок именно такой: сначала данные приведены в
-- порядок, потом включается автоматика.
create trigger friendships_notify
  after insert on public.friendships
  for each row execute function public.notify_on_friendship();

create trigger follows_rate_limit
  before insert on public.follows
  for each row execute function public.limit_follows();

create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

drop trigger if exists follows_sync_friendship_ins on public.follows;
create trigger follows_sync_friendship_ins
  after insert on public.follows
  for each row execute function public.sync_friendship_from_follows();

drop trigger if exists follows_sync_friendship_del on public.follows;
create trigger follows_sync_friendship_del
  after delete on public.follows
  for each row execute function public.sync_friendship_from_follows();


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Отношение между двумя людьми
-- ─────────────────────────────────────────────────────────────────────────
-- Набор колонок сохранён, чтобы не переучивать вызывающий код, но два поля
-- про заявки теперь всегда false: заявок не существует. Признак дружбы
-- считается из подписок, а не из материализованной строки, — по той же
-- причине, что и в is_friend_with.
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
  friendship_id            uuid
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
  fr as (
    select f.id
    from public.friendships f, me
    where (f.requester = me.uid and f.addressee = p_user_id)
       or (f.requester = p_user_id and f.addressee = me.uid)
    limit 1
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
    (select id from fr)
  from fo, bl;
$$;

revoke all on function public.get_relationship(uuid) from public, anon;
grant execute on function public.get_relationship(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Список друзей
-- ─────────────────────────────────────────────────────────────────────────
-- Отдаёт сразу карточку человека — как list_followers и list_following.
-- Раньше клиент читал friendships напрямую и шёл вторым запросом в
-- friend_briefs за именами; теперь имя и аватар публичны, и второй запрос
-- перестал быть нужен.
create or replace function public.list_friends(
  p_user_id uuid, p_limit int default 100, p_offset int default 0
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
  order by f.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_friends(uuid, int, int) from public, anon;
grant execute on function public.list_friends(uuid, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 8. Личные сообщения
-- ─────────────────────────────────────────────────────────────────────────
-- Политика не меняется ни на символ — меняется смысл is_friend_with под ней.
-- Переписка по-прежнему только между друзьями, но «друзья» отныне означает
-- «подписаны друг на друга». Пересоздаём её здесь, чтобы это было записано в
-- том же файле, что и смена определения, а не додумывалось при чтении.
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    auth.uid() = sender
    and sender <> recipient
    and public.is_friend_with(sender, recipient)
    and not public.is_blocked_between(sender, recipient)
  );
