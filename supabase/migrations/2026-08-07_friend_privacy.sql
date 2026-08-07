-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — друг видит ровно то, что показано в интерфейсе, и ничего больше.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ 2026-08-06_account_sync.sql.
-- Идемпотентно, данные не трогает.
--
-- Что решает:
--   1. Политика SELECT на app_state пускала принятого друга ко ВСЕЙ строке
--      состояния. В интерфейсе друга видно имя, фото, био, любимые места, цель
--      по калориям и дневник — но прочитать из строки можно было заодно вес,
--      возраст, рост, пол, все настройки и историю поиска. Разрыв между
--      «что показано» и «что доступно» — это и есть утечка.
--      Теперь SELECT на app_state только свой, а друзьям отдаёт выборку через
--      функцию, которая физически не возвращает лишних полей.
--   2. Если триггер handle_new_user когда-то не отработал, у человека навсегда
--      не было public_id — и его нельзя было добавить в друзья, без единого
--      признака проблемы. Добавлен ensure_public_id(): выдаёт ID и чинит
--      пропуск при первом же обращении.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Состояние друга — только видимая часть
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: RLS обойдён намеренно, авторизация — проверка принятой
-- дружбы внутри функции. p_user_id участвует только в этой проверке и в
-- выборке; подставить произвольный ID и получить чужие данные нельзя.
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
      -- Профиль: только поля, которые реально рисуются в FriendAccount.
      -- Вес, рост, возраст, пол, цель и уровень активности сюда НЕ входят.
      'profile', jsonb_build_object(
        'name',          a.state->'profile'->'name',
        'avatar',        a.state->'profile'->'avatar',
        'bio',           a.state->'profile'->'bio',
        'favRestaurant', a.state->'profile'->'favRestaurant',
        'favDish',       a.state->'profile'->'favDish',
        'targets',       jsonb_build_object('calories', a.state->'profile'->'targets'->'calories')
      ),
      'days', coalesce(a.state->'days', '{}'::jsonb),
      -- Составные блюда нужны, чтобы раскрыть состав записи в дневнике.
      -- Обычные свои продукты и ингредиенты другу не отдаём.
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
-- 2. Имя и фото друзей списком — одним запросом, без остального состояния
-- ─────────────────────────────────────────────────────────────────────────
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
  where a.user_id = any(p_user_ids)
    and (
      a.user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester = auth.uid() and f.addressee = a.user_id)
            or (f.addressee = auth.uid() and f.requester = a.user_id)
          )
      )
    );
$$;

revoke all on function public.friend_briefs(uuid[]) from public, anon;
grant execute on function public.friend_briefs(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Закрываем прямое чтение чужого состояния
-- ─────────────────────────────────────────────────────────────────────────
-- ВАЖНО, ПОРЯДОК: сначала задеплойте фронтенд, потом выполните этот файл.
-- Новый фронтенд работает и до, и после миграции: он пробует RPC и при её
-- отсутствии откатывается на прямой запрос. А вот СТАРЫЙ фронтенд после смены
-- политики покажет карточку друга пустой — данные целы, но читать их он не
-- умеет. Поэтому фронтенд идёт первым.
drop policy if exists "state select self or friends" on public.app_state;
drop policy if exists "own state select" on public.app_state;
create policy "own state select" on public.app_state
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Самолечение публичного ID
-- ─────────────────────────────────────────────────────────────────────────
-- Возвращает public_id текущего пользователя, при отсутствии — выдаёт.
-- Раньше сбой триггера handle_new_user означал, что человека навсегда нельзя
-- добавить в друзья, и заметить это было нечем.
create or replace function public.ensure_public_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select public_id into v_id from public.profiles where user_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.profiles (user_id, public_id)
  values (v_uid, public.generate_public_id())
  on conflict (user_id) do nothing
  returning public_id into v_id;

  -- Параллельный вызов успел вставить строку первым — читаем её.
  if v_id is null then
    select public_id into v_id from public.profiles where user_id = v_uid;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_public_id() from public, anon;
grant execute on function public.ensure_public_id() to authenticated;

-- Разовый добор для тех, у кого ID не выдался раньше.
insert into public.profiles (user_id, public_id)
select u.id, public.generate_public_id()
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
order by u.created_at
on conflict (user_id) do nothing;
