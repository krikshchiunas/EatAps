// Что именно видно о друге.
//
// Ограничение живёт в двух местах намеренно. Основное — в базе: RPC
// friend_state отдаёт только эти поля, и обойти её нельзя, потому что прямое
// чтение чужой строки app_state закрыто политикой. Здесь — второй слой: даже
// если функция вернёт лишнее (старая миграция, откат политики, ручной запрос),
// в приложение оно не попадёт.
//
// Список полей ровно соответствует тому, что рисует UserProfileView. Вес, рост,
// возраст, пол, цель, уровень активности, настройки и история поиска в него не
// входят и входить не должны: их нет на экране друга.

import { normalizeProfileList } from './profileLists.js'

const PROFILE_FIELDS = ['name', 'avatar', 'bio', 'favRestaurant', 'favDish']

// Списки «не ем» / «люблю». Они на экране профиля с обеих сторон — свой профиль
// и профиль друга рисует один компонент, — поэтому уезжают другу так же, как
// bio. Это осознанное расширение видимого, а не побочный эффект: по смыслу это
// то же «пара слов о себе», только структурированное.
const PROFILE_LIST_FIELDS = ['noGos', 'toGos']

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

export function projectFriendProfile(raw) {
  const p = isObj(raw) ? raw : {}
  const out = {}
  for (const k of PROFILE_FIELDS) {
    if (typeof p[k] === 'string' && p[k]) out[k] = p[k]
  }
  for (const k of PROFILE_LIST_FIELDS) {
    const list = normalizeProfileList(p[k])
    if (list.length) out[k] = list
  }
  // Из целей — только норма калорий: она показана как ориентир под кольцом.
  const calories = Number(p.targets?.calories)
  if (Number.isFinite(calories) && calories > 0) out.targets = { calories }
  return out
}

// Составные блюда нужны, чтобы раскрыть состав записи в дневнике друга.
// Обычные свои продукты и ингредиенты — нет.
function projectCustomFoods(list) {
  if (!Array.isArray(list)) return []
  return list.filter((f) => isObj(f) && f.kind === 'composite' && f.recipe)
}

// Из дня друг видит только список еды. Настроение, самочувствие и заметка —
// нет: на экране друга их не показывают, а по содержанию они куда личнее
// списка продуктов («болит голова», «поругались»). Отдавать то, что не
// отображается, значит раздавать данные без причины.
function projectDays(raw) {
  if (!isObj(raw)) return {}
  const out = {}
  for (const date in raw) {
    const day = raw[date]
    out[date] = { meals: Array.isArray(day?.meals) ? day.meals : [] }
  }
  return out
}

export function projectFriendState(raw) {
  const s = isObj(raw) ? raw : {}
  return {
    profile: projectFriendProfile(s.profile),
    days: projectDays(s.days),
    customFoods: projectCustomFoods(s.customFoods),
  }
}
