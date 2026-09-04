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
// Округление, сохраняющее «неизвестно». От r1 отличается ровно одним: null
// остаётся null, а не становится нулём. Нужно там, где значение ХРАНИТСЯ, а не
// суммируется: в сумме отсутствующее и правда считается нулём, но в самой
// записи «мы не знаем» и «там ноль» — разные факты.
const rn = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10) / 10)
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
    // Неизвестное БЖУ остаётся неизвестным и здесь.
    //
    // Снимок кладут в избранное, в своё блюдо и в рецепт. Раньше r1(null) давало
    // 0, и продукт из глобальной базы, где БЖУ нет вовсе, «приобретал» ноль
    // белка ровно в тот момент, когда человек нажимал звёздочку: в поиске
    // честное «БЖУ не указаны», а в избранном уже «Б0 У0 Ж0». Одна и та же еда
    // не может знать о себе разное.
    protein: rn(food.protein),
    carbs: rn(food.carbs),
    fat: rn(food.fat),
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
//
// Результат кэшируется. Функция чистая, а зовут её очень много: память о
// продуктах пересобирается по всему журналу приёмов при каждом добавлении еды,
// и на трёх годах истории это 13 тысяч вызовов, где различных имён — десятки.
// Нормализация строки (нижний регистр, ё/й, диакритика, пробелы) съедала 70%
// всего пересчёта; на повторах она теперь не выполняется вовсе.
const KEY_CACHE = new Map()
const KEY_CACHE_MAX = 5000

export function favoriteKey(food) {
  const name = food?.name
  const unit = food?.unit || 'г'
  if (typeof name !== 'string') return `${normalizeName(name)}|${unit}`
  const memo = name + '\u0000' + unit
  const hit = KEY_CACHE.get(memo)
  if (hit !== undefined) return hit
  const key = `${normalizeName(name)}|${unit}`
  // Кэш ограничен: журнал может накопить тысячи различных названий, и вечно
  // растущая карта — это утечка. Переполнился — начинаем заново.
  if (KEY_CACHE.size >= KEY_CACHE_MAX) KEY_CACHE.clear()
  KEY_CACHE.set(memo, key)
  return key
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
  // Полный список не принимает новое — но и не теряет старое. Подробности в
  // сторе (toggleFavorite): вытеснение без тумбстоуна отменялось синхронизацией.
  if (list.length >= MAX_FAVORITES) return list
  return [{ ...snap, id: uid(), pinnedAt: Date.now() }, ...list]
}

// ── Свои блюда (шаблоны приёмов) и рецепты ───────────────────────────────────
//
// ВНИМАНИЕ: всё до раздела «Единая память о продуктах» — готовая и покрытая
// тестами модель БЕЗ интерфейса. Это не забытый мусор и не остаток удалённой
// фичи: расчёты сделаны заранее, экранов к ним ещё нет.
//
// Пользователю это ничего не стоит: ни одна из функций ниже не импортируется,
// и сборщик выбрасывает их целиком (в dist их нет ни в одном чанке).
//
// Чтобы включить, не хватает трёх вещей, и все три — за пределами этого файла:
//   1. хранение: шаблоны и рецепты как отдельные сущности в сторе, со своими
//      тумбстоунами и слиянием по HLC — иначе они не переживут синхронизацию;
//   2. экран сохранения: «Действия с приёмом» → «Сохранить как шаблон»;
//   3. показ: отдельная секция в листе добавления, рядом с «Моё».
//
// Пока их нет, ничего удалять не нужно — модель верна и ждёт интерфейса.
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
  // Считаем от ИТОГА кастрюли, а не от округлённой порции.
  //
  // recipePerServing округляет до целых калорий — это правильно для показа, но
  // умножать округлённое нельзя: полторы порции борща давали 422 ккал вместо
  // 421, а на трёх-четырёх порциях расхождение с суммой становится заметным.
  // Округляем ОДИН раз, в самом конце.
  const total = recipeTotals(recipe)
  const s = Math.max(1, Number(recipe?.servings) || 1)
  const n = Number(servingsEaten) > 0 ? Number(servingsEaten) : 1
  const k = n / s
  const per = {
    kcal: total.kcal * k,
    protein: total.protein * k,
    carbs: total.carbs * k,
    fat: total.fat * k,
    grams: total.grams * k,
    sugar: total.sugar == null ? null : total.sugar * k,
    satFat: total.satFat == null ? null : total.satFat * k,
  }
  const food = {
    name: recipe.name,
    emoji: recipe.emoji || '🍲',
    // По всему приложению пара (grams, unit) читается как «сколько и в чём»:
    // «150 г», «2 шт», «1,5 порции». Поэтому при unit: 'порция' в grams лежит
    // ЧИСЛО ПОРЦИЙ, как у составных блюд (CompositePortion), а не вес.
    //
    // Раньше сюда клали вес — и дневник печатал «260 порция». Заодно ломалась
    // память привычных порций: она запоминала бы 260 «порций».
    // Вес порции не теряется, он остаётся в portionGrams.
    unit: 'порция',
    grams: n,
    portionGrams: per.grams > 0 ? r0(per.grams) : null,
    kcal: r0(per.kcal),
    protein: r1(per.protein),
    carbs: r1(per.carbs),
    fat: r1(per.fat),
    recipeId: recipe.id,
    servings: n,
  }
  if (per.sugar != null) food.sugar = r1(per.sugar)
  if (per.satFat != null) food.satFat = r1(per.satFat)
  if (mealId) food.mealId = mealId
  return food
}

// ── Память привычных порций ───────────────────────────────────────────────────
// Привычная порция считается в buildFoodMemory ниже — вместе с частотой и
// свежестью, по тому же обходу журнала приёмов. Отдельной реализации
// (buildPortionMemory/suggestPortion) здесь больше нет: две функции считали
// одно и то же по одним и тем же данным, и расходиться они могли только в
// сторону ошибки.
export const PORTION_SAMPLE = 12 // сколько последних использований учитываем
export const PORTION_MIN_USES = 2 // одно измерение — ещё не «привычка»

function median(sorted) {
  const n = sorted.length
  if (n === 0) return null
  const mid = n >> 1
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ── Единая память о продуктах ────────────────────────────────────────────────
// Три РАЗНЫЕ сущности, которые нельзя смешивать в одну кучу:
//
//   • Избранное (favorites) — человек закрепил сам. Не вымывается никогда,
//     системой не пересчитывается.
//   • Частое (frequent) — ВЫЧИСЛЕНО по поведению. Руками не управляется:
//     то, что можно посчитать, не должно быть ещё одной кнопкой.
//   • Недавнее (recent) — временная память последних добавлений.
//
// И отдельно от всех трёх — журнал приёмов (`days[].meals`): там каждый факт
// еды со своим временем и повторами. Память о продукте — одна запись на
// продукт. Смешать их значило бы либо потерять статистику, либо засорить
// список одинаковыми строками.
//
// ИСТОЧНИК ИСТИНЫ для «частого» и «недавнего» — журнал приёмов, а не список
// `recents` в сторе. Причины две: журнал сливается между устройствами по
// сущностям (счётчик в `recents` при слиянии терялся), и он полон — `recents`
// обрезан сорока записями.

// Период полураспада «свежести»: использование месячной давности весит вдвое
// меньше вчерашнего. Иначе продукт, который ели полгода назад пятьдесят раз,
// вечно стоял бы выше того, что человек ест сейчас.
export const FREQUENT_HALF_LIFE_DAYS = 21
const DAY_MS = 86400000

// Насколько глубоко в прошлое имеет смысл смотреть.
//
// При периоде полураспада в 21 день использование годичной давности весит
// 0.5^(365/21) ≈ 0.000006 — на порядки ниже любого порога «частого», то есть на
// сортировку оно не влияет вообще никак. «Недавнее» и так ограничено тридцатью
// днями. Поэтому старше окна не читаем: выдача та же, а работа перестаёт расти
// вместе с историей — что на полугоде, что на пяти годах она одинакова.
//
// Год, а не полгода: за окном теряется не только вес, но и привычная порция.
// Человек, который ел плов прошлой осенью, при следующем поиске должен увидеть
// свои 300 г, а не пустое поле.
export const MEMORY_WINDOW_DAYS = 365

// Вклад одного использования с учётом давности: 1 сегодня → 0.5 через 21 день.
export function recencyWeight(ageDays, halfLife = FREQUENT_HALF_LIFE_DAYS) {
  if (!(ageDays > 0)) return 1
  return Math.pow(0.5, ageDays / halfLife)
}

// Дата дня (ключ вида 2026-09-02) → миллисекунды. Разбираем вручную:
// `new Date('2026-09-02')` — это UTC-полночь, и в минусовых поясах день
// «съезжает» на сутки назад.
function dayMs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '')
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
}

// Строит память о продуктах по журналу приёмов.
//
// Возвращает Map «имя|единица» → {
//   key, name, emoji, unit, cat,
//   uses,          — сколько раз добавляли (реальный счёт, без затухания)
//   score,         — частота с поправкой на свежесть (для сортировки)
//   lastUsed,      — миллисекунды последнего добавления
//   lastGrams,     — количество в последний раз
//   typicalGrams,  — привычная порция (медиана последних PORTION_SAMPLE)
//   snapshot,      — снимок последнего добавления (абсолютные значения)
// }
//
// Порции берём медианой, а не средним: разовая тарелка на 500 г не должна
// перекашивать подсказку.
export function buildFoodMemory(days, now = Date.now()) {
  const src = days && typeof days === 'object' ? days : {}
  const out = new Map()
  // От свежих дней к старым: так первым встреченным снимком продукта будет
  // самый последний, и «повторить» повторит именно его.
  const dates = Object.keys(src).sort().reverse()

  for (const dateKey of dates) {
    const ms = dayMs(dateKey)
    if (ms == null) continue
    const ageDays = Math.max(0, (now - ms) / DAY_MS)
    // Дальше окна смотреть незачем, а дни отсортированы — выходим совсем.
    // Это делает пересчёт независимым от того, сколько лет человек ведёт
    // журнал: у него может накопиться пять лет истории, работы будет столько
    // же, сколько при полугоде.
    if (ageDays > MEMORY_WINDOW_DAYS) break
    const weight = recencyWeight(ageDays)

    for (const m of src[dateKey]?.meals || []) {
      if (!m?.name) continue
      const key = favoriteKey(m)
      let e = out.get(key)
      if (!e) {
        e = {
          key,
          name: m.name,
          emoji: m.emoji || '🍽️',
          unit: m.unit || 'г',
          cat: m.cat || null,
          uses: 0,
          score: 0,
          lastUsed: ms,
          lastGrams: Number(m.grams) > 0 ? Number(m.grams) : null,
          typicalGrams: null,
          snapshot: foodSnapshot(m),
          _portions: [],
        }
        out.set(key, e)
      }
      e.uses += 1
      e.score += weight
      const grams = Number(m.grams)
      if (Number.isFinite(grams) && grams > 0 && e._portions.length < PORTION_SAMPLE) {
        e._portions.push(grams)
      }
    }
  }

  for (const e of out.values()) {
    if (e._portions.length >= PORTION_MIN_USES) {
      e.typicalGrams = Math.round(median([...e._portions].sort((x, y) => x - y)))
    }
    delete e._portions
  }
  return out
}

// Часто едим: по вычисленному счёту с поправкой на свежесть.
//
// minUses отсекает случайные разовые продукты — «часто» из одного раза не
// бывает. minScore отсекает заброшенное: пятьдесят порций овсянки прошлой зимой
// дают счёт 0.07 и формально стоят в списке последними, но человеку показывают
// «часто едите» — а он это давно не ест. Порог в единицу означает «осталось
// хотя бы одно свежее использование по весу».
export const FREQUENT_MIN_SCORE = 1

export function frequentFoods(memory, { limit = 8, minUses = 3, minScore = FREQUENT_MIN_SCORE } = {}) {
  return [...(memory?.values?.() || [])]
    .filter((e) => e.uses >= minUses && e.score >= minScore)
    .sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed)
    .slice(0, limit)
}

// Недавнее: строго по времени последнего добавления, и только то, что и правда
// недавнее. Без окна сюда попадала еда полугодовой давности — просто потому,
// что свежее ничего не осталось; «недавним» это не является, и подпись врала.
export const RECENT_WINDOW_DAYS = 30

export function recentFoods(memory, { limit = 8, exclude, windowDays = RECENT_WINDOW_DAYS, now = Date.now() } = {}) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude || [])
  const cutoff = now - windowDays * DAY_MS
  return [...(memory?.values?.() || [])]
    .filter((e) => !skip.has(e.key) && e.lastUsed >= cutoff)
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, limit)
}

// Привычная порция для продукта: сперва память, затем прошлое количество.
// null означает «не знаем» — подставлять выдуманное число нельзя.
export function memoryPortion(memory, food) {
  const e = memory?.get?.(favoriteKey(food))
  if (!e) return null
  const g = e.typicalGrams ?? e.lastGrams
  return g > 0 ? g : null
}

// Личная надбавка к релевантности поиска: 0..1.
//
// Складывается из закрепления (человек выбрал явно) и частоты с поправкой на
// свежесть. Величина НАМЕРЕННО ограничена сверху и в поиске умножается на
// небольшой потолок (MEMORY_BOOST_MAX): персонализация поднимает продукт внутри
// тира релевантности, но не может вытащить нерелевантный продукт наверх.
//
// Продукты с вариантами приготовления записываются в журнал под уточнённым
// именем («Куриная грудка, варёная»), поэтому память индексируется ещё и по
// части названия до запятой — иначе привычная еда не узнавалась бы в поиске.
export function memoryBoost(memory, favorites) {
  const favKeys = new Set((favorites || []).map((f) => favoriteKey(f)))
  const byBase = new Map()
  let top = 0
  for (const e of memory?.values?.() || []) {
    if (e.score > top) top = e.score
    const base = `${normalizeName(e.name).split(',')[0].trim()}|${e.unit}`
    const prev = byBase.get(base)
    if (!prev || e.score > prev) byBase.set(base, e.score)
  }
  if (!top) top = 1

  return (food) => {
    const key = favoriteKey(food)
    const entry = memory?.get?.(key)
    const base = `${normalizeName(food?.name).split(',')[0].trim()}|${food?.unit || 'г'}`
    const score = Math.max(entry?.score || 0, byBase.get(base) || 0)
    // Корень сглаживает: разница между «ел 1 раз» и «ел 5 раз» важнее, чем
    // между «40 раз» и «50 раз».
    const freq = Math.sqrt(Math.min(1, score / top))
    return Math.min(1, (favKeys.has(key) ? 0.5 : 0) + freq * 0.5)
  }
}

// ── Пересчёт между «съедено» и «на 100» ──────────────────────────────────────
// В журнале приёмов значения АБСОЛЮТНЫЕ (съел 180 г — вот их калорийность),
// а в базе, «моём» и избранном — на 100 г/мл. Перевод между ними нужен, чтобы
// повторное добавление и закрепление работали с одними и теми же продуктами.
//
// Это пропорциональный пересчёт реальных чисел, а не восполнение пробелов:
// если количество неизвестно, пересчитать нельзя, и функция возвращает null —
// подставлять правдоподобное число вместо ответа «не знаю» нельзя.

// Запись приёма → продукт «на 100». null, если количество неизвестно.
export function toPer100(entry) {
  const grams = Number(entry?.grams)
  if (!entry?.name || !Number.isFinite(grams) || grams <= 0) return null
  const k = 100 / grams
  const out = {
    name: entry.name,
    emoji: entry.emoji || '🍽️',
    unit: entry.unit || 'г',
    kcal: r0((Number(entry.kcal) || 0) * k),
    // Пересчёт на 100 г не создаёт знания: неизвестное остаётся неизвестным.
    protein: rn(entry.protein == null ? null : Number(entry.protein) * k),
    carbs: rn(entry.carbs == null ? null : Number(entry.carbs) * k),
    fat: rn(entry.fat == null ? null : Number(entry.fat) * k),
  }
  if (entry.cat) out.cat = entry.cat
  if (Number.isFinite(Number(entry.sugar))) out.sugar = r1(Number(entry.sugar) * k)
  if (Number.isFinite(Number(entry.satFat))) out.satFat = r1(Number(entry.satFat) * k)
  return out
}

// Снимок приёма, пересчитанный на другое количество. Если количество то же —
// возвращаем снимок КАК ЕСТЬ: повтор вчерашней порции обязан дать ровно те же
// цифры, а не «почти те же» после двух округлений.
export function scaleSnapshot(snap, grams) {
  if (!snap?.name) return null
  const from = Number(snap.grams)
  const to = Number(grams)
  if (!Number.isFinite(to) || to <= 0) return { ...snap }
  if (!Number.isFinite(from) || from <= 0) return { ...snap }
  if (from === to) return { ...snap }
  const k = to / from
  const out = {
    ...snap,
    grams: Math.round(to * 10) / 10,
    kcal: r0(snap.kcal * k),
    protein: r1((Number(snap.protein) || 0) * k),
    carbs: r1((Number(snap.carbs) || 0) * k),
    fat: r1((Number(snap.fat) || 0) * k),
  }
  if (Number.isFinite(Number(snap.sugar))) out.sugar = r1(Number(snap.sugar) * k)
  if (Number.isFinite(Number(snap.satFat))) out.satFat = r1(Number(snap.satFat) * k)
  return out
}

// Готовая запись для повторного добавления одним касанием: привычная порция,
// а если привычки ещё нет — прошлое количество. Обе величины настоящие.
export function repeatEntry(memoryEntry) {
  if (!memoryEntry?.snapshot) return null
  const grams = memoryEntry.typicalGrams ?? memoryEntry.lastGrams
  return scaleSnapshot(memoryEntry.snapshot, grams)
}
