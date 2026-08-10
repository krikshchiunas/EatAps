-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — публичный профиль: списки «не ем»/«люблю» и «Мои мысли».
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
--
-- Порядок деплоя не важен в обе стороны:
--   • старый фронтенд + новая база — ничего не меняется, новые таблицы никто
--     не читает;
--   • новый фронтенд + старая база — вкладка «Мысли» покажет, что раздел пока
--     недоступен (RPC нет → клиент это переживает), списки «не ем»/«люблю» у
--     друга просто не отобразятся, свои сохранятся в app_state как обычно.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Друг видит списки «не ем» и «люблю»
-- ─────────────────────────────────────────────────────────────────────────
-- Это осознанное расширение видимого, а не побочный эффект нового экрана:
-- noGos/toGos по смыслу то же самое «пара слов о себе», что и bio, только
-- структурированное, и рисуются они на том же экране профиля. Всё остальное
-- (вес, рост, возраст, пол, цель, активность, настроение и заметки дня)
-- остаётся закрытым — список полей по-прежнему белый.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid() or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = p_user_id)
          or (f.addressee = auth.uid() and f.requester = p_user_id)
        )
    )
    then jsonb_strip_nulls(jsonb_build_object(
      'profile', jsonb_build_object(
        'name',          a.state->'profile'->'name',
        'avatar',        a.state->'profile'->'avatar',
        'bio',           a.state->'profile'->'bio',
        'favRestaurant', a.state->'profile'->'favRestaurant',
        'favDish',       a.state->'profile'->'favDish',
        'noGos',         a.state->'profile'->'noGos',
        'toGos',         a.state->'profile'->'toGos',
        'targets',       jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
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

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. «Мои мысли» — посты
-- ─────────────────────────────────────────────────────────────────────────
-- Отдельная таблица, а НЕ поле в app_state. app_state — один блоб на
-- пользователя с версионированием (compare-and-swap) и лимитом 5 МБ: посты
-- растут бесконечно, читаются чужими людьми и должны иметь собственные права
-- доступа. Внутри блоба ни того, ни другого не сделать.
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text,
  image_url  text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  check (text is not null or image_url is not null),
  check (text is null or char_length(text) <= 2000),
  check (image_url is null or char_length(image_url) <= 500)
);

create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);

alter table public.posts enable row level security;

-- Читать пост может автор или принятый друг автора. Тот же предикат, что у
-- app_state: круг «кто меня видит» в приложении ровно один, и заводить второй
-- (публичные посты, подписчики) означало бы новую модель приватности.
drop policy if exists "posts select" on public.posts;
create policy "posts select" on public.posts
  for select using (
    auth.uid() = posts.user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = posts.user_id)
          or (f.addressee = auth.uid() and f.requester = posts.user_id)
        )
    )
  );

-- Писать можно только от своего имени: user_id из тела запроса обязан
-- совпасть с auth.uid(), подделать авторство нельзя.
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts
  for delete using (auth.uid() = user_id);

-- Автор правит текст и фото, но не авторство и не дату создания: иначе пост
-- можно было бы «состарить» или переписать на другого человека. edited_at
-- ставит сервер — клиент об этом не спрашивают.
create or replace function public.guard_post_update()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
    raise exception 'post ownership and creation time are immutable';
  end if;
  if new.text is distinct from old.text or new.image_url is distinct from old.image_url then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists posts_update_guard on public.posts;
create trigger posts_update_guard
  before update on public.posts
  for each row execute function public.guard_post_update();

-- Защита от заливки мусора: тот же приём, что у заявок в друзья.
create or replace function public.limit_posts()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.posts
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'too many posts, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.limit_posts();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Общая проверка «мне виден этот пост»
-- ─────────────────────────────────────────────────────────────────────────
-- Нужна в политиках реакций и комментариев. SECURITY DEFINER намеренно:
-- функция обязана читать posts НАПРЯМУЮ. Обычная функция внутри политики
-- смотрела бы на posts через RLS и утащила бы за собой рекурсию политик.
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (
        p.user_id = auth.uid()
        or exists (
          select 1 from public.friendships f
          where f.status = 'accepted'
            and (
              (f.requester = auth.uid() and f.addressee = p.user_id)
              or (f.addressee = auth.uid() and f.requester = p.user_id)
            )
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid) from public, anon;
grant execute on function public.can_view_post(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Реакции: 🥕 «мне нравится» и 🥦 «не моё»
-- ─────────────────────────────────────────────────────────────────────────
-- Одна реакция на человека и пост (первичный ключ), поэтому «переключить»
-- всегда однозначно. Набор значений закрыт списком, как у реакции в чате:
-- это не поле свободного ввода, которое пишется в чужую строку.
create table if not exists public.post_reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reaction   text not null check (reaction in ('🥕', '🥦')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_reactions_post_idx on public.post_reactions (post_id);

alter table public.post_reactions enable row level security;

-- ЧИТАТЬ можно ТОЛЬКО свою реакцию. Это не мелочь: если разрешить читать все
-- строки поста, то, открыв пост друга, я получу user_id всех, кто на него
-- отреагировал, — то есть кусок списка друзей автора, включая людей, которых
-- я не знаю. Наружу отдаются только счётчики, и делает это RPC ниже.
drop policy if exists "post reactions select own" on public.post_reactions;
create policy "post reactions select own" on public.post_reactions
  for select using (auth.uid() = user_id);

-- Штатный путь записи — toggle_post_reaction. Политики ниже существуют как
-- второй слой: даже прямым запросом нельзя поставить реакцию под чужим
-- именем или на пост, которого не видно.
drop policy if exists "post reactions insert own" on public.post_reactions;
create policy "post reactions insert own" on public.post_reactions
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id));

drop policy if exists "post reactions update own" on public.post_reactions;
create policy "post reactions update own" on public.post_reactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "post reactions delete own" on public.post_reactions;
create policy "post reactions delete own" on public.post_reactions
  for delete using (auth.uid() = user_id);

-- Переключение делает СЕРВЕР по auth.uid(): p_user_id клиент не передаёт и
-- передать не может. Повторная та же реакция снимает её, другая — заменяет.
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
    select
      (select count(*) from public.post_reactions r where r.post_id = p_post_id and r.reaction = '🥕')::int,
      (select count(*) from public.post_reactions r where r.post_id = p_post_id and r.reaction = '🥦')::int,
      (select r.reaction from public.post_reactions r where r.post_id = p_post_id and r.user_id = v_uid);
end;
$$;

revoke all on function public.toggle_post_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_post_reaction(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Ответы на мысль
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

drop policy if exists "post comments select" on public.post_comments;
create policy "post comments select" on public.post_comments
  for select using (public.can_view_post(post_id));

drop policy if exists "post comments insert own" on public.post_comments;
create policy "post comments insert own" on public.post_comments
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id));

-- UPDATE-политики нет вовсе: комментарий нельзя отредактировать — ни чужой,
-- ни свой. Отсутствие политики означает запрет для всех, и это надёжнее
-- любого списка разрешённых полей.

-- Удалить может автор комментария или владелец поста: свою ветку человек
-- должен уметь чистить сам, иначе единственным модератором остаёмся мы.
drop policy if exists "post comments delete" on public.post_comments;
create policy "post comments delete" on public.post_comments
  for delete using (
    auth.uid() = user_id
    or exists (select 1 from public.posts p where p.id = post_comments.post_id and p.user_id = auth.uid())
  );

create or replace function public.limit_post_comments()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.post_comments
  where user_id = new.user_id and created_at > now() - interval '1 hour';

  if v_recent >= 120 then
    raise exception 'too many comments, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists post_comments_rate_limit on public.post_comments;
create trigger post_comments_rate_limit
  before insert on public.post_comments
  for each row execute function public.limit_post_comments();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Чтение ленты
-- ─────────────────────────────────────────────────────────────────────────
-- Отдаём посты вместе со СЧЁТЧИКАМИ реакций и своей реакцией. Именно поэтому
-- это RPC, а не обычный select со связанными таблицами: связанный select
-- вернул бы строки реакций, то есть поимённый список отреагировавших (см.
-- политику в разделе 4). Проверка дружбы — внутри, как в friend_state.
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
  select
    p.id, p.user_id, p.text, p.image_url, p.created_at, p.edited_at,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥕')::int,
    (select count(*) from public.post_reactions r where r.post_id = p.id and r.reaction = '🥦')::int,
    (select r.reaction from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    (select count(*) from public.post_comments c where c.post_id = p.id)::int
  from public.posts p
  where p.user_id = p_user_id
    and (p_before is null or p.created_at < p_before)
    and (
      p_user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester = auth.uid() and f.addressee = p_user_id)
            or (f.addressee = auth.uid() and f.requester = p_user_id)
          )
      )
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.list_posts(uuid, int, timestamptz) from public, anon;
grant execute on function public.list_posts(uuid, int, timestamptz) to authenticated;

-- Ответы вместе с именем и фото автора.
--
-- ВАЖНО, что это значит для приватности: отвечая на мысль друга, человек
-- показывает своё имя и аватар остальным друзьям автора — в том числе тем,
-- с кем он сам не дружит. Для ветки ответов это неизбежно (без имени ответ
-- не имеет смысла), но это осознанный шаг, а не случайность: наружу уходят
-- ровно имя и фото — те же два поля, что и в friend_briefs, и ничего больше.
create or replace function public.list_post_comments(p_post_id uuid, p_limit int default 100)
returns table (
  id            uuid,
  user_id       uuid,
  text          text,
  created_at    timestamptz,
  author_name   text,
  author_avatar text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.user_id, c.text, c.created_at,
         a.state->'profile'->>'name',
         a.state->'profile'->>'avatar'
  from public.post_comments c
  left join public.app_state a on a.user_id = c.user_id
  where c.post_id = p_post_id
    and public.can_view_post(p_post_id)
  order by c.created_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_post_comments(uuid, int) from public, anon;
grant execute on function public.list_post_comments(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Бакет для фотографий из «Мыслей»
-- ─────────────────────────────────────────────────────────────────────────
-- Устроен так же, как chat-images: заливать можно только в свою папку {uid}/,
-- размер и типы ограничены на стороне базы, а не только в клиенте.
--
-- Бакет публичный на чтение — как и у чата. Это значит: у кого есть точный
-- URL, тот увидит картинку без проверки дружбы. Сам URL содержит uuid и не
-- перебирается, ссылку на него не отдаёт ни один запрос без прав, но
-- рассчитывать на бакет как на границу доступа нельзя — границей остаётся RLS
-- на posts.
insert into storage.buckets (id, name, public)
  values ('post-images', 'post-images', true)
  on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'post-images';

drop policy if exists "post-images read" on storage.objects;
create policy "post-images read" on storage.objects
  for select using (bucket_id = 'post-images');

drop policy if exists "post-images write own" on storage.objects;
create policy "post-images write own" on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-images delete own" on storage.objects;
create policy "post-images delete own" on storage.objects
  for delete using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
