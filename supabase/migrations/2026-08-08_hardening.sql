-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — устранение слабостей, найденных при аудите системы аккаунтов.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Имя в заявке в друзья больше нельзя подделать
-- ─────────────────────────────────────────────────────────────────────────
-- requester_name приходил из тела запроса и показывался адресату как есть.
-- То есть заявку можно было подписать любым именем — «Мама», «Поддержка
-- EatAps», именем другого пользователя. Классическая социальная инженерия:
-- человек принимает заявку, думая, что знает отправителя, и открывает ему
-- свой дневник.
--
-- Теперь имя берётся на сервере из профиля самого отправителя, а присланное
-- значение игнорируется.
create or replace function public.set_requester_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select nullif(trim(a.state->'profile'->>'name'), '')
    into new.requester_name
  from public.app_state a
  where a.user_id = new.requester;
  return new;
end;
$$;

drop trigger if exists friendships_set_requester_name on public.friendships;
create trigger friendships_set_requester_name
  before insert or update of requester_name on public.friendships
  for each row execute function public.set_requester_name();

-- Разовая чистка уже сохранённых имён: приводим к настоящим.
update public.friendships f
set requester_name = (
  select nullif(trim(a.state->'profile'->>'name'), '')
  from public.app_state a where a.user_id = f.requester
)
where f.status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ограничение размера состояния
-- ─────────────────────────────────────────────────────────────────────────
-- save_app_state принимала jsonb любого размера. Один аккаунт мог записать
-- сотни мегабайт и раздуть базу — ни платного тарифа, ни квоты это не
-- спрашивает. 5 МБ с огромным запасом покрывают годы дневника: аватар
-- сжимается до пары сотен килобайт, запись о продукте весит десятки байт.
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

  if octet_length(p_state::text) > 5 * 1024 * 1024 then
    raise exception 'state is too large' using errcode = '54000';
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

  select a.revision, a.updated_at, a.state into v_rev, v_at, v_st
    from public.app_state a where a.user_id = v_uid;

  return query select coalesce(v_rev, 0::bigint), v_at, v_st, true;
end;
$$;

revoke all on function public.save_app_state(jsonb, bigint) from public, anon;
grant execute on function public.save_app_state(jsonb, bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Ограничение размера запроса имён друзей
-- ─────────────────────────────────────────────────────────────────────────
-- friend_briefs принимала массив любой длины: сто тысяч идентификаторов в
-- одном вызове — дешёвый способ нагрузить базу. Больше 500 друзей у человека
-- всё равно не бывает.
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
  where a.user_id = any(p_user_ids[1:500])
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
-- 4. Ограничения бакета с фотографиями чата
-- ─────────────────────────────────────────────────────────────────────────
-- Политика разрешала любому авторизованному класть в свою папку файл любого
-- размера и любого типа. Ограничение «сжимаем до 1280px и JPEG» жило только
-- в клиентском коде, то есть не было ограничением вовсе: прямым запросом
-- можно было залить гигабайты чего угодно и использовать хранилище проекта
-- как бесплатный файлообменник.
update storage.buckets
set file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'chat-images';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Заявки в друзья: защита от массовой рассылки
-- ─────────────────────────────────────────────────────────────────────────
-- Публичные ID выдаются подряд (AA000001, AA000002…), а find_user_by_public_id
-- отдаёт по ним UUID любому авторизованному. Это позволяет перебрать всех
-- пользователей и завалить их заявками. Читать чужие данные при этом нельзя —
-- RLS не пускает, — но спам возможен. Ограничиваем частоту исходящих заявок.
create or replace function public.limit_friend_requests()
returns trigger
language plpgsql
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.friendships
  where requester = new.requester
    and created_at > now() - interval '1 hour';

  if v_recent >= 30 then
    raise exception 'too many friend requests, try later' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit
  before insert on public.friendships
  for each row execute function public.limit_friend_requests();

create index if not exists friendships_requester_created_idx
  on public.friendships (requester, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Друг не получает настроение, самочувствие и личную заметку дня
-- ─────────────────────────────────────────────────────────────────────────
-- friend_state отдавала объект дня целиком. На экране друга видно только
-- список еды, но в объекте лежат также mood, wellbeing и note — а это куда
-- более личные вещи, чем перечень продуктов: «болит голова», «плохо спал»,
-- свободная заметка о самочувствии. Отдавать то, что не отображается, — это
-- раздача данных без причины. Оставляем из дня ровно meals.
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
