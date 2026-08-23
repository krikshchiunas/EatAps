// ─────────────────────────────────────────────────────────────────────────────
// Личная библиотека еды: избранное, свои блюда (шаблоны приёмов), рецепты
// и память привычных порций.
//
// Зачем каждая часть:
//   • Избранное — «недавние» вымываются: съел что-то один раз, и постоянный
//     продукт уехал из списка. Закреплённое не вымывается никогда.
//   • Свои блюда — человек ест один и тот же завтрак из трёх продуктов;
//     без шаблона это три отдельных добавления каждое утро.
//   • Рецепты — готовишь кастрюлю на 4 порции: считать нужно всю кастрюлю,
//     а записывать в день одну тарелку.
//   • Память порций — «обычно ты кладёшь 180 г», чтобы не вводить вес заново.
//
// Все функции чистые: принимают состояние, возвращают новое. Никаких side-эффектов
// и обращений к стору — так их можно тестировать и переиспользовать.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeName } from './text.js'

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10
const r0 = (n) => Math.round(Number(n) || 0)
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Снимок продукта: то, что реально нужно, чтобы позже добавить его снова.
// Сахар и насыщенные жиры переносим ТОЛЬКО если они реально известны — иначе
// нули выдали бы отсутствие данных за измеренный ноль (см. stats.js realSugar).
export function foodSnapshot(food) {
  if (!food?.name) return null
  const snap = {
    name: food.name,
    emoji: food.emoji || '🍽️',
    unit: food.unit || 'г',
    grams: Number(food.grams) > 0 ? Number(food.grams) : null,
    kcal: r0(food.kcal),
    protein: r1(food.protein),
    carbs: r1(food.carbs),
    fat: r1(food.fat),
  }
  if (food.cat) snap.cat = food.cat
  if (food.type) snap.type = food.type
  if (Number.isFinite(Number(food.sugar))) snap.sugar = r1(food.sugar)
  if (Number.isFinite(Number(food.satFat))) snap.satFat = r1(food.satFat)
  if (food.barcode) snap.barcode = food.barcode
  return snap
}

// ── Избранное ─────────────────────────────────────────────────────────────────
export const MAX_FAVORITES = 60

// Ключ: имя + единица. Молоко в граммах и в миллилитрах — разные записи.
export function favoriteKey(food) {
  return `${normalizeName(food?.name)}|${food?.unit || 'г'}`
}

export function isFavorite(favorites, food) {
  const k = favoriteKey(food)
  return (favorites || []).some((f) => favoriteKey(f) === k)
}

// Переключить закрепление. Возвращает НОВЫЙ массив (или прежний, если нечего менять).
export function toggleFavorite(favorites, food) {
  const list = favorites || []
  const snap = foodSnapshot(food)
  if (!snap) return list
  const k = favoriteKey(snap)
  const existing = list.find((f) => favoriteKey(f) === k)
  if (existing) return list.filter((f) => favoriteKey(f) !== k)
  return [{ ...snap, id: uid(), pinnedAt: Date.now() }, ...list].slice(0, MAX_FAVORITES)
}

// ── Свои блюда (шаблоны приёмов) ──────────────────────────────────────────────
export const MAX_TEMPLATE_ITEMS = 30

export function makeTemplate(name, foods, emoji = '🍽️') {
  const items = (foods || []).map(foodSnapshot).filter(Boolean).slice(0, MAX_TEMPLATE_ITEMS)
  if (!name?.trim() || items.length === 0) return null
  return {
    id: uid(),
    name: name.trim(),
    emoji,
    items,
    createdAt: new Date().toISOString(),
    uses: 0,
  }
}

export function templateTotals(tpl) {
  return (tpl?.items || []).reduce(
    (a, m) => ({
      kcal: a.kcal + (Number(m.kcal) || 0),
      protein: r1(a.protein + (Number(m.protein) || 0)),
      carbs: r1(a.carbs + (Number(m.carbs) || 0)),
      fat: r1(a.fat + (Number(m.fat) || 0)),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

// Развернуть шаблон в список продуктов для добавления в конкретный приём пищи.
// id/createdAt здесь НЕ проставляем — их выдаёт store.addFood, чтобы у каждой
// записи было своё время добавления.
export function templateToEntries(tpl, mealId) {
  return (tpl?.items || []).map((m) => ({ ...m, mealId }))
}

// ── Рецепты ───────────────────────────────────────────────────────────────────
// Ингредиент хранит АБСОЛЮТНЫЕ значения на использованное количество, а не на
// 100 г: пересчёт делается один раз при добавлении ингредиента, дальше рецепт
// складывается простым суммированием и не накапливает ошибку округления.
export const MAX_RECIPE_ITEMS = 40

export function makeRecipe({ name, emoji = '🍲', servings = 1, items = [], notes = '' } = {}) {
  const clean = (items || []).map(foodSnapshot).filter(Boolean).slice(0, MAX_RECIPE_ITEMS)
  const s = Math.max(1, Math.round(Number(servings) || 1))
  if (!name?.trim()) return null
  return {
    id: uid(),
    name: name.trim(),
    emoji,
    servings: s,
    items: clean,
    notes: String(notes || '').slice(0, 500),
    createdAt: new Date().toISOString(),
  }
}

// Итог по ВСЕМУ рецепту (вся кастрюля).
export function recipeTotals(recipe) {
  const items = recipe?.items || []
  let kcal = 0, protein = 0, carbs = 0, fat = 0, grams = 0
  let sugar = 0, satFat = 0
  let sugarKnown = items.length > 0
  let satFatKnown = items.length > 0
  for (const m of items) {
    kcal += Number(m.kcal) || 0
    protein += Number(m.protein) || 0
    carbs += Number(m.carbs) || 0
    fat += Number(m.fat) || 0
    grams += Number(m.grams) || 0
    if (Number.isFinite(Number(m.sugar))) sugar += Number(m.sugar)
    else sugarKnown = false
    if (Number.isFinite(Number(m.satFat))) satFat += Number(m.satFat)
    else satFatKnown = false
  }
  const out = { kcal: r0(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), grams: r0(grams) }
  // Сахар/насыщенные жиры считаем известными, ТОЛЬКО если они есть у всех
  // ингредиентов: иначе сумма занижена и выдавать её за измеренную нельзя.
  if (sugarKnown) out.sugar = r1(sugar)
  if (satFatKnown) out.satFat = r1(satFat)
  return out
}

export function recipePerServing(recipe) {
  const total = recipeTotals(recipe)
  const s = Math.max(1, Number(recipe?.servings) || 1)
  const out = {
    kcal: r0(total.kcal / s),
    protein: r1(total.protein / s),
    carbs: r1(total.carbs / s),
    fat: r1(total.fat / s),
    grams: r0(total.grams / s),
  }
  if (total.sugar != null) out.sugar = r1(total.sugar / s)
  if (total.satFat != null) out.satFat = r1(total.satFat / s)
  return out
}

// Превратить съеденное количество порций в запись для дня.
// servingsEaten может быть дробным (полтарелки = 0.5).
export function recipeToFood(recipe, servingsEaten = 1, mealId) {
  const per = recipePerServing(recipe)
  const n = Number(servingsEaten) > 0 ? Number(servingsEaten) : 1
  const food = {
    name: recipe.name,
    emoji: recipe.emoji || '🍲',
    unit: 'порция',
    grams: per.grams > 0 ? r0(per.grams * n) : null,
    kcal: r0(per.kcal * n),
    protein: r1(per.protein * n),
    carbs: r1(per.carbs * n),
    fat: r1(per.fat * n),
    recipeId: recipe.id,
    servings: n,
  }
  if (per.sugar != null) food.sugar = r1(per.sugar * n)
  if (per.satFat != null) food.satFat = r1(per.satFat * n)
  if (mealId) food.mealId = mealId
  return food
}

// ── Память привычных порций ───────────────────────────────────────────────────
export const PORTION_SAMPLE = 12 // сколько последних использований учитываем
export const PORTION_MIN_USES = 2 // одно измерение — ещё не «привычка»

function median(sorted) {
  const n = sorted.length
  if (n === 0) return null
  const mid = n >> 1
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Строит { "имя|ед": { grams, uses, unit, name } } по истории дней.
// Медиана, а не среднее: одна разовая порция на 500 г не должна перекашивать
// подсказку. Идём от свежих дней к старым и берём последние PORTION_SAMPLE
// использований — привычки меняются, старые данные не должны тянуть назад.
export function buildPortionMemory(days) {
  const src = days && typeof days === 'object' ? days : {}
  const buckets = new Map()

  for (const dateKey of Object.keys(src).sort().reverse()) {
    for (const m of src[dateKey]?.meals || []) {
      const grams = Number(m?.grams)
      if (!m?.name || !Number.isFinite(grams) || grams <= 0) continue
      const key = favoriteKey(m)
      let b = buckets.get(key)
      if (!b) {
        b = { name: m.name, unit: m.unit || 'г', values: [] }
        buckets.set(key, b)
      }
      if (b.values.length < PORTION_SAMPLE) b.values.push(grams)
    }
  }

  const out = {}
  for (const [key, b] of buckets) {
    if (b.values.length < PORTION_MIN_USES) continue
    const med = median([...b.values].sort((x, y) => x - y))
    out[key] = { grams: Math.round(med), uses: b.values.length, unit: b.unit, name: b.name }
  }
  return out
}

// Привычная порция для продукта, если она уже сложилась.
export function suggestPortion(memory, food) {
  if (!memory || !food?.name) return null
  return memory[favoriteKey(food)] || null
}
