-- Любимый ресторан — новое поле профиля с необязательной геолокацией.
-- Добавляем его в visible_diary (и, через неё, в friend_state).

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
        'favRestaurant',  a.state->'profile'->'favRestaurant',
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
