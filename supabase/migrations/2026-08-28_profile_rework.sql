-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — переработка профиля: одна актуальная модель вместо двух
--
-- ЧТО МЕНЯЕТСЯ. Профиль на клиенте состоит из имени, аватара, ника, био и
-- одного поля про еду — «MY guilty pleasure». Строки «Я это обожаю» и «Ок»
-- считаются по дневнику, а не заполняются руками, поэтому полей под них нет.
--
-- Старая модель (favDish, favRestaurant и списки noGos/toGos — «да в еде» /
-- «нет в еде») удалена из приложения целиком: её нечем заполнить и негде
-- показать. Пока friend_state продолжает их отдавать, удалённая модель живёт
-- дальше в трафике — друг получает поля, которых нет ни на одном экране.
-- Здесь это и закрывается: список полей сужается до видимого.
--
-- ЧТО ЭТО НЕ ДЕЛАЕТ. Строки app_state не переписываются. У давних аккаунтов
-- старые ключи остаются лежать в блобе до первого сохранения профиля — клиент
-- затирает их при сохранении сам (MyProfileSheet), а до тех пор их не
-- показывает и не отдаёт: friendView.js отбрасывает лишнее вторым слоем.
-- Массовый update чужого JSON ради косметики опаснее, чем безвредный остаток.
--
-- СОВМЕСТИМОСТЬ. Состав ключей внутри 'profile' не является контрактом
-- PostgREST: функция возвращает jsonb целиком. Старый фронтенд с новой базой
-- просто не найдёт favDish/noGos и не покажет соответствующие строки — ровно
-- то же самое он делает для аккаунта, где эти поля не заполнены. Новый
-- фронтенд со старой базой получит лишние ключи и отбросит их в friendView.js.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- friend_state — только те поля профиля, которые рисует вкладка «О себе»
-- ─────────────────────────────────────────────────────────────────────────
-- Тело функции повторяет версию из 2026-08-25_social_graph.sql: проверка
-- блокировки и дружбы, дневник только по дням с 'meals', составные блюда.
-- Изменён ровно один фрагмент — список ключей 'profile'.
create or replace function public.friend_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id = auth.uid()
      or (not public.is_blocked_between(p_user_id, auth.uid())
          and public.is_friend_with(auth.uid(), p_user_id))
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

revoke all on function public.friend_state(uuid) from public, anon;
grant execute on function public.friend_state(uuid) to authenticated;
