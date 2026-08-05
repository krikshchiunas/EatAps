// ─────────────────────────────────────────────────────────────────────────────
// Слой аналитики питания. Здесь ВСЯ математика статистики — UI-компоненты только
// рисуют результат. Считаем из существующего store.days (одна копия истории, без
// дублирования). Всё детерминированно и без побочных эффектов — можно мемоизировать.
//
// Сахар в приложении отдельно не хранится: оцениваем «свободные сахара» из
// углеводов через freeSugarShare (та же логика, что на экране дня). Ориентир по
// сахару — существующий в приложении лимит свободных сахаров (sugarLimit, 10%
// калорий по ВОЗ), а не выдуманная медицинская норма.
// ─────────────────────────────────────────────────────────────────────────────
import { sumDay, freeSugarShare, sugarLimit } from './nutrition.js'
import { keyOf, fromKey, addDays } from './date.js'

export const PERIODS = [
  { key: '7d', days: 7, label: '7 дней', gran: 'day' },
  { key: '30d', days: 30, label: '30 дней', gran: 'day' },
  { key: '6m', days: 182, label: '6 мес', gran: 'week' },
  { key: '1y', days: 365, label: '1 год', gran: 'month' },
]

// Порядок и оформление нутриентов. invert: меньше — лучше (сахар).
export const NUTRIENTS = [
  { key: 'kcal', label: 'Калории', short: 'Ккал', unit: 'ккал', color: 'var(--primary)' },
  { key: 'protein', label: 'Белки', short: 'Белки', unit: 'г', color: 'var(--good)' },
  { key: 'fat', label: 'Жиры', short: 'Жиры', unit: 'г', color: 'var(--warn)' },
  { key: 'carbs', label: 'Углеводы', short: 'Углеводы', unit: 'г', color: 'var(--accent)' },
  { key: 'sugar', label: 'Сахар', short: 'Сахар', unit: 'г', color: 'var(--danger)', invert: true },
]

// Допуск попадания «в норму» (доля от цели). Калории строже, макросы мягче.
// Экспортируется, чтобы график рисовал ту же зону допуска, что и статусы дней.
export const TOL = { kcal: 0.1, protein: 0.15, fat: 0.15, carbs: 0.15, sugar: 0 }

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const round1 = (n) => Math.round(n * 10) / 10

// Нормализация имени для аналитики: регистр, ё→е, лишние пробелы.
// В интерфейсе показываем человекочитаемое имя (самое частое написание).
export function normalizeName(s) {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

const hasMeals = (day) => Boolean(day && Array.isArray(day.meals) && day.meals.length > 0)

// Оценка сахара одного приёма: свободные сахара из углеводов.
export function mealSugar(m) {
  return (Number(m.carbs) || 0) * freeSugarShare(m.name)
}

// Итоги дня по всем нутриентам. Отсутствующие поля считаем нулём (неполные данные).
export function dayNutrients(meals = []) {
  const s = sumDay(meals)
  let sugar = 0
  for (const m of meals) sugar += mealSugar(m)
  return { kcal: s.kcal, protein: s.protein, fat: s.fat, carbs: s.carbs, sugar }
}

// Цель по нутриенту из профиля. Нет цели → null (аналитика покажет только факт).
function targetFor(key, profile) {
  const t = profile?.targets
  if (!t) return null
  if (key === 'kcal') return t.calories || null
  if (key === 'sugar') return t.calories ? sugarLimit(t.calories) : null
  return t[key] || null
}

// Статус дня/бакета по нутриенту относительно цели.
export function statusOf(value, target, key) {
  if (target == null || value == null) return 'none'
  if (key === 'sugar') return value > target ? 'over' : 'in' // меньше — лучше
  const tol = TOL[key] ?? 0.12
  if (value < target * (1 - tol)) return 'under'
  if (value > target * (1 + tol)) return 'over'
  return 'in'
}

// Цвет по статусу. Для сахара перебор — тревожный (danger), для остального — warn.
export function statusColor(status, invert = false) {
  if (status === 'in') return 'var(--good)'
  if (status === 'under') return 'var(--accent)'
  if (status === 'over') return invert ? 'var(--danger)' : 'var(--warn)'
  return 'var(--ink-3)'
}

// Список ключей дат периода (включая сегодня), от старых к новым.
function periodKeys(periodDays, today) {
  const start = addDays(today, -(periodDays - 1))
  const out = []
  let k = start
  while (k <= today) {
    out.push(k)
    k = addDays(k, 1)
  }
  return out
}

function weekStartKey(key) {
  const d = fromKey(key)
  const dow = (d.getDay() + 6) % 7 // Пн = 0
  d.setDate(d.getDate() - dow)
  return keyOf(d)
}

// Средний дневной нутриент по набору дат (только дни с записями). Нет данных → null.
function avgOver(days, keys, nutKey) {
  let sum = 0
  let n = 0
  for (const k of keys) {
    const day = days[k]
    if (!hasMeals(day)) continue
    sum += dayNutrients(day.meals)[nutKey]
    n += 1
  }
  return n ? sum / n : null
}

// Тренд относительно предыдущего равного периода.
function trendOf(days, keys, prevKeys, nutKey) {
  const cur = avgOver(days, keys, nutKey)
  const prev = avgOver(days, prevKeys, nutKey)
  if (cur == null || prev == null) return { delta: null, pct: null, dir: 'flat', prev }
  const delta = cur - prev
  const pct = prev !== 0 ? (delta / prev) * 100 : null
  const dir = Math.abs(delta) < prev * 0.02 ? 'flat' : delta > 0 ? 'up' : 'down'
  return { delta, pct, dir, prev }
}

// Разбиение периода на бакеты для графика (день / неделя / месяц).
// value бакета — средний дневной нутриент внутри бакета (по дням с записями),
// чтобы линия цели (дневная) оставалась сопоставимой на всех периодах.
function buildBuckets(days, keys, gran, nutKey) {
  if (gran === 'day') {
    return keys.map((k) => {
      const day = days[k]
      const logged = hasMeals(day)
      const d = fromKey(k)
      return {
        id: k,
        label: keys.length <= 7 ? DOW_SHORT[d.getDay()] : String(d.getDate()),
        full: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
        value: logged ? dayNutrients(day.meals)[nutKey] : null,
        loggedDays: logged ? 1 : 0,
      }
    })
  }

  // week / month — группируем и усредняем.
  const groups = new Map()
  for (const k of keys) {
    const gid = gran === 'week' ? weekStartKey(k) : k.slice(0, 7)
    if (!groups.has(gid)) groups.set(gid, [])
    groups.get(gid).push(k)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([gid, memberKeys]) => {
      let sum = 0
      let logged = 0
      for (const k of memberKeys) {
        const day = days[k]
        if (!hasMeals(day)) continue
        sum += dayNutrients(day.meals)[nutKey]
        logged += 1
      }
      let label
      let full
      if (gran === 'week') {
        const d = fromKey(gid)
        label = `${d.getDate()}.${d.getMonth() + 1}`
        full = `неделя с ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
      } else {
        const [y, m] = gid.split('-').map(Number)
        label = MONTH_SHORT[m - 1]
        full = `${MONTH_SHORT[m - 1]} ${y}`
      }
      return { id: gid, label, full, value: logged ? sum / logged : null, loggedDays: logged }
    })
}

// Полная статистика по одному нутриенту за период.
function nutrientStats(nutDef, days, keys, prevKeys, gran, profile) {
  const { key } = nutDef
  const target = targetFor(key, profile)
  const daily = [] // значения по дням с записями
  for (const k of keys) {
    const day = days[k]
    if (!hasMeals(day)) continue
    daily.push(dayNutrients(day.meals)[key])
  }

  const loggedDays = daily.length
  const total = daily.reduce((a, v) => a + v, 0)
  const avg = loggedDays ? total / loggedDays : 0
  const max = loggedDays ? Math.max(...daily) : 0
  const min = loggedDays ? Math.min(...daily) : 0

  let daysIn = 0
  let daysUnder = 0
  let daysOver = 0
  let devSum = 0
  if (target != null) {
    for (const v of daily) {
      const st = statusOf(v, target, key)
      if (st === 'in') daysIn += 1
      else if (st === 'under') daysUnder += 1
      else if (st === 'over') daysOver += 1
      devSum += v - target
    }
  }

  const series = buildBuckets(days, keys, gran, key).map((b) => ({
    ...b,
    status: b.value == null ? 'none' : statusOf(b.value, target, key),
  }))

  return {
    ...nutDef,
    target,
    loggedDays,
    total,
    avg,
    min,
    max,
    daysIn,
    daysUnder,
    daysOver,
    avgDeviation: target != null && loggedDays ? devSum / loggedDays : null,
    trend: trendOf(days, keys, prevKeys, key),
    series,
    gran,
  }
}

// Рейтинг продуктов и источники нутриентов за период.
function productStats(days, keys) {
  const groups = new Map()
  let totalMeals = 0
  const grand = { kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0 }

  for (const k of keys) {
    const day = days[k]
    if (!hasMeals(day)) continue
    for (const m of day.meals) {
      const norm = normalizeName(m.name)
      if (!norm) continue
      totalMeals += 1
      let g = groups.get(norm)
      if (!g) {
        g = {
          norm,
          names: new Map(),
          emoji: '',
          count: 0,
          grams: 0,
          gramUses: 0,
          kcal: 0,
          protein: 0,
          fat: 0,
          carbs: 0,
          sugar: 0,
        }
        groups.set(norm, g)
      }
      g.count += 1
      g.names.set(m.name, (g.names.get(m.name) || 0) + 1)
      if (!g.emoji && m.emoji) g.emoji = m.emoji
      if (m.unit !== 'мл' && Number(m.grams) > 0) {
        g.grams += Number(m.grams)
        g.gramUses += 1
      }
      const kcal = Number(m.kcal) || 0
      const protein = Number(m.protein) || 0
      const fat = Number(m.fat) || 0
      const carbs = Number(m.carbs) || 0
      const sugar = mealSugar(m)
      g.kcal += kcal
      g.protein += protein
      g.fat += fat
      g.carbs += carbs
      g.sugar += sugar
      grand.kcal += kcal
      grand.protein += protein
      grand.fat += fat
      grand.carbs += carbs
      grand.sugar += sugar
    }
  }

  const list = [...groups.values()].map((g) => {
    // Человекочитаемое имя — самое частое написание.
    let display = g.norm
    let best = -1
    for (const [name, c] of g.names) {
      if (c > best) {
        best = c
        display = name
      }
    }
    return {
      norm: g.norm,
      name: display,
      emoji: g.emoji || '🍽️',
      count: g.count,
      grams: g.grams,
      avgGrams: g.gramUses ? g.grams / g.gramUses : null,
      shareOfMeals: totalMeals ? g.count / totalMeals : 0,
      avgKcalPerUse: g.count ? g.kcal / g.count : 0,
      kcal: g.kcal,
      protein: g.protein,
      fat: g.fat,
      carbs: g.carbs,
      sugar: g.sugar,
    }
  })

  const frequent = [...list].sort((a, b) => b.count - a.count || b.kcal - a.kcal)

  const sourcesFor = (nutKey) =>
    list
      .filter((p) => p[nutKey] > 0)
      .sort((a, b) => b[nutKey] - a[nutKey])
      .map((p) => ({
        name: p.name,
        emoji: p.emoji,
        count: p.count,
        value: p[nutKey],
        percent: grand[nutKey] > 0 ? (p[nutKey] / grand[nutKey]) * 100 : 0,
      }))

  return {
    totalMeals,
    grand,
    frequent,
    sources: {
      kcal: sourcesFor('kcal'),
      protein: sourcesFor('protein'),
      fat: sourcesFor('fat'),
      carbs: sourcesFor('carbs'),
      sugar: sourcesFor('sugar'),
    },
  }
}

// ── Главная точка входа: собрать всю статистику за период ─────────────────────
export function computeStats(days, profile, periodKey, today = keyOf()) {
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[0]
  const keys = periodKeys(period.days, today)
  const prevKeys = periodKeys(period.days, addDays(keys[0], -1))

  const loggedKeys = keys.filter((k) => hasMeals(days[k]))
  const loggedDays = loggedKeys.length

  const nutrients = {}
  for (const def of NUTRIENTS) {
    nutrients[def.key] = nutrientStats(def, days, keys, prevKeys, period.gran, profile)
  }

  const products = productStats(days, keys)

  // Сводка «Общая динамика».
  const calTarget = targetFor('kcal', profile)
  let goalHitPct = null
  let bestDay = null
  let worstDay = null
  if (calTarget != null && loggedDays) {
    const kc = nutrients.kcal
    goalHitPct = Math.round((kc.daysIn / loggedDays) * 100)
    for (const k of loggedKeys) {
      const kcal = dayNutrients(days[k].meals).kcal
      const dev = kcal - calTarget
      if (!bestDay || Math.abs(dev) < Math.abs(bestDay.dev)) bestDay = { key: k, kcal, dev }
      if (!worstDay || Math.abs(dev) > Math.abs(worstDay.dev)) worstDay = { key: k, kcal, dev }
    }
  }

  const summary = {
    avg: {
      kcal: nutrients.kcal.avg,
      protein: nutrients.protein.avg,
      fat: nutrients.fat.avg,
      carbs: nutrients.carbs.avg,
      sugar: nutrients.sugar.avg,
    },
    goalHitPct,
    bestDay,
    worstDay,
    calTarget,
  }

  return {
    period,
    keys,
    loggedDays,
    totalDays: keys.length,
    totalMeals: products.totalMeals,
    hasData: loggedDays > 0,
    single: loggedDays === 1, // особый случай: одного дня мало для трендов
    nutrients,
    products,
    summary,
  }
}
