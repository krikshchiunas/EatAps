// ─────────────────────────────────────────────────────────────────────────────
// Слой аналитики питания. Здесь ВСЯ математика статистики — UI-компоненты только
// рисуют результат. Считаем из существующего store.days (одна копия истории, без
// дублирования). Всё детерминированно и без побочных эффектов — можно мемоизировать.
//
// Сахар: у части продуктов (ручной ввод, напитки) есть реальное поле `sugar`
// («из них сахар»). Там, где его нет (продукты из базы, конструкторы), значение
// НЕ измерено — оно ОЦЕНИВАЕТСЯ из углеводов через freeSugarShare. Поэтому в UI
// это «Оценка сахара» (приблизительно), а не достоверное количество свободных
// сахаров; строгого сравнения с лимитом ВОЗ у сахара нет.
// ─────────────────────────────────────────────────────────────────────────────
import { sumDay, freeSugarShare, sumAdvanced, satFatLimit } from './nutrition.js'
import { keyOf, fromKey, addDays } from './date.js'

export const PERIODS = [
  { key: '7d', days: 7, label: '7 дней', gran: 'day' },
  { key: '30d', days: 30, label: '30 дней', gran: 'day' },
  { key: '6m', days: 182, label: '6 мес', gran: 'week' },
  { key: '1y', days: 365, label: '1 год', gran: 'month' },
]

// Порядок и оформление нутриентов. estimate: значение приблизительное/эвристическое
// (не лабораторное измерение) — disclaimer поясняет это под графиком в StatsScreen.
export const NUTRIENTS = [
  { key: 'kcal', label: 'Калории', short: 'Ккал', unit: 'ккал', color: 'var(--primary)' },
  { key: 'protein', label: 'Белки', short: 'Белки', unit: 'г', color: 'var(--good)' },
  {
    key: 'qualityProtein', label: 'Белок высокого качества', short: 'Кач. белок', unit: 'г', color: 'var(--good)', estimate: true,
    disclaimer: 'Ориентировочная оценка качества источника белка по типу продукта (учитывается белок из продуктов с оценкой 7 из 10 и выше). Это не медицинский показатель и не лабораторные данные конкретного продукта.',
  },
  { key: 'fat', label: 'Жиры', short: 'Жиры', unit: 'г', color: 'var(--warn)' },
  {
    key: 'satFat', label: 'Насыщенные жиры', short: 'Насыщ. жиры', unit: 'г', color: 'var(--warn)', invert: true, estimate: true,
    disclaimer: 'Берутся из реальных данных продукта, если они указаны, иначе оцениваются по типу продукта (мясо, молочное, кондитерка и т.п.). Дневной ориентир — не более 10% калорий (рекомендация ВОЗ), отдельно от общей нормы жиров.',
  },
  { key: 'carbs', label: 'Углеводы', short: 'Углеводы', unit: 'г', color: 'var(--accent)' },
  {
    key: 'complexCarb', label: 'Сложные углеводы', short: 'Слож. угл.', unit: 'г', color: 'var(--accent)', estimate: true,
    disclaimer: 'Доля углеводов из круп, картофеля, бобовых и цельнозерновых продуктов — продуктовая классификация по типу продукта, а не медицинский показатель «полезных» углеводов. Сахар, сладости и напитки в неё не входят.',
  },
  {
    key: 'sugar', label: 'Оценка сахара', short: 'Сахар', unit: 'г', color: 'var(--danger)', invert: true, estimate: true,
    disclaimer: '≈ Приблизительная оценка: сахар рассчитан из углеводов там, где не указан отдельно. Это ориентир, а не точное количество свободных сахаров.',
  },
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

const safeNum = (x) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

// Реальное поле «из них сахар» у приёма, если задано положительное число.
// Пустой ручной ввод сохраняется как 0 — считаем его «не указано» и оцениваем.
export function realSugar(m) {
  const n = Number(m?.sugar)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Сахар приёма: берём реальное поле, если оно есть, иначе ОЦЕНКА из углеводов.
export function mealSugar(m) {
  const real = realSugar(m)
  return real != null ? real : safeNum(m?.carbs) * freeSugarShare(m?.name)
}

// Итоги дня по всем нутриентам. Отсутствующие поля считаем нулём (неполные данные).
export function dayNutrients(meals = []) {
  const s = sumDay(meals)
  let sugar = 0
  for (const m of meals) sugar += mealSugar(m)
  const adv = sumAdvanced(meals)
  return {
    kcal: safeNum(s.kcal), protein: safeNum(s.protein), fat: safeNum(s.fat), carbs: safeNum(s.carbs),
    sugar: safeNum(sugar),
    satFat: safeNum(adv.satFat), complexCarb: safeNum(adv.complexCarb), qualityProtein: safeNum(adv.qualityProtein),
  }
}

// Цель по нутриенту из профиля. Приводим к конечному числу > 0, иначе null
// (аналитика покажет только факт). У сахара/сложных углеводов/качества белка
// пользовательской цели нет вовсе — не сравниваем оценку с нормой как с
// достоверными данными. У насыщенных жиров цель считается отдельно от общей
// нормы жиров (см. satFatLimit).
function targetFor(key, profile) {
  const t = profile?.targets
  if (!t || key === 'sugar' || key === 'complexCarb' || key === 'qualityProtein') return null
  if (key === 'satFat') {
    const cal = Number(t.calories)
    return Number.isFinite(cal) && cal > 0 ? satFatLimit(cal) : null
  }
  const raw = key === 'kcal' ? t.calories : t[key]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Статус дня/бакета по нутриенту относительно цели.
export function statusOf(value, target, key) {
  if (target == null || value == null) return 'none'
  if (key === 'sugar' || key === 'satFat') return value > target ? 'over' : 'in' // меньше — лучше
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
  let sugarEstimated = false // хоть один приём без реального поля sugar
  const grand = { kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, satFat: 0, complexCarb: 0, qualityProtein: 0 }

  for (const k of keys) {
    const day = days[k]
    if (!hasMeals(day)) continue
    for (const m of day.meals) {
      const norm = normalizeName(m.name)
      if (!norm) continue
      if (realSugar(m) == null) sugarEstimated = true
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
          satFat: 0,
          complexCarb: 0,
          qualityProtein: 0,
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
      const adv = sumAdvanced([m])
      g.kcal += kcal
      g.protein += protein
      g.fat += fat
      g.carbs += carbs
      g.sugar += sugar
      g.satFat += adv.satFat
      g.complexCarb += adv.complexCarb
      g.qualityProtein += adv.qualityProtein
      grand.kcal += kcal
      grand.protein += protein
      grand.fat += fat
      grand.carbs += carbs
      grand.sugar += sugar
      grand.satFat += adv.satFat
      grand.complexCarb += adv.complexCarb
      grand.qualityProtein += adv.qualityProtein
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
      satFat: g.satFat,
      complexCarb: g.complexCarb,
      qualityProtein: g.qualityProtein,
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
    sugarEstimated,
    grand,
    frequent,
    sources: {
      kcal: sourcesFor('kcal'),
      protein: sourcesFor('protein'),
      qualityProtein: sourcesFor('qualityProtein'),
      fat: sourcesFor('fat'),
      satFat: sourcesFor('satFat'),
      carbs: sourcesFor('carbs'),
      complexCarb: sourcesFor('complexCarb'),
      sugar: sourcesFor('sugar'),
    },
  }
}

// ── Главная точка входа: собрать всю статистику за период ─────────────────────
export function computeStats(days, profile, periodKey, today = keyOf()) {
  const D = days && typeof days === 'object' ? days : {} // не падаем на null/undefined
  const period = PERIODS.find((p) => p.key === periodKey) || PERIODS[0]
  const keys = periodKeys(period.days, today)
  const prevKeys = periodKeys(period.days, addDays(keys[0], -1))

  const loggedKeys = keys.filter((k) => hasMeals(D[k]))
  const loggedDays = loggedKeys.length

  const nutrients = {}
  for (const def of NUTRIENTS) {
    nutrients[def.key] = nutrientStats(def, D, keys, prevKeys, period.gran, profile)
  }

  const products = productStats(D, keys)
  nutrients.sugar.estimated = products.sugarEstimated

  // Сводка «Общая динамика».
  const calTarget = targetFor('kcal', profile)
  let goalHitPct = null
  let daysInTarget = null
  let bestDay = null
  let worstDay = null
  if (calTarget != null && loggedDays) {
    const kc = nutrients.kcal
    daysInTarget = kc.daysIn
    goalHitPct = Math.round((kc.daysIn / loggedDays) * 100)
    for (const k of loggedKeys) {
      const kcal = dayNutrients(D[k].meals).kcal
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
    daysInTarget,
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
    sugarEstimated: products.sugarEstimated,
    hasData: loggedDays > 0,
    single: loggedDays === 1, // особый случай: одного дня мало для трендов
    nutrients,
    products,
    summary,
  }
}
