// ─────────────────────────────────────────────────────────────────────────────
// Тело и режим дня: вес и активность, записанные ПО ДНЯМ.
//
// Зачем: в онбординге человек указывает вес и активность ОДИН раз, и цели
// считаются от этих чисел навсегда. В жизни всё иначе — один день человек
// лежит на кровати, другой много ходит и тренируется; вес тоже меняется.
// Поэтому:
//   • day.weight   — взвешивание конкретного дня (кг), необязательное;
//   • day.activity — уровень активности конкретного дня, необязательный.
// Обоих полей может не быть — тогда берётся «последнее известное» (вес) или
// значение из профиля (активность). Так старые дни остаются валидными, а
// новые становятся точнее.
//
// Важное следствие: дневная цель по калориям больше НЕ константа из профиля.
// Она пересчитывается на каждый день из веса, актуального на этот день, и
// активности этого дня — см. createTargetResolver. Вся статистика и экран дня
// сравнивают факт с целью ИМЕННО ЭТОГО дня.
//
// Здесь только математика и выборки — никаких компонентов и побочных эффектов.
// ─────────────────────────────────────────────────────────────────────────────
import { ACTIVITY, computeTargets } from './nutrition.js'
import { fromKey } from './date.js'

// Порядок уровней от «лежал» к «очень активно». ACTIVITY (nutrition.js) остаётся
// единственным источником коэффициентов — здесь только оформление для выбора дня.
export const ACTIVITY_ORDER = ['sedentary', 'light', 'moderate', 'high']

export const ACTIVITY_DAY = {
  sedentary: { emoji: '🛋️', short: 'Лежал', desc: 'Дом, диван, работа сидя — почти без ходьбы' },
  light: { emoji: '🚶', short: 'Немного', desc: 'Обычный день: дорога, магазин, лёгкая ходьба' },
  moderate: { emoji: '🏃', short: 'Активно', desc: 'Много ходьбы или тренировка средней тяжести' },
  high: { emoji: '🔥', short: 'Очень', desc: 'Тяжёлая тренировка или физическая работа весь день' },
}

// Разумные границы веса: защита от опечаток («7 кг», «750 кг») — они бы
// превратили цель по калориям в бессмыслицу и испортили график.
export const WEIGHT_MIN = 20
export const WEIGHT_MAX = 400

export function isValidWeight(w) {
  const n = Number(w)
  return Number.isFinite(n) && n >= WEIGHT_MIN && n <= WEIGHT_MAX
}

export function isValidActivity(a) {
  return typeof a === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY, a)
}

// Вес, записанный в этот день (или null, если взвешивания не было).
export function dayWeight(day) {
  const n = Number(day?.weight)
  return isValidWeight(n) ? n : null
}

// Активность дня: явная запись дня → значение из профиля → 'light'.
// Пустая строка/мусор в day.activity игнорируются, а не ломают расчёт.
export function effectiveActivity(day, profile) {
  if (isValidActivity(day?.activity)) return day.activity
  if (isValidActivity(profile?.activity)) return profile.activity
  return 'light'
}

// Активность задана вручную именно для этого дня (UI показывает это иначе,
// чем унаследованное из профиля значение).
export function hasDayActivity(day) {
  return isValidActivity(day?.activity)
}

// ── Индекс взвешиваний ────────────────────────────────────────────────────────
// Ключи дат в формате YYYY-MM-DD сортируются лексикографически = хронологически,
// поэтому бинарный поиск по массиву ключей работает без разбора дат.
// Строим один раз на весь расчёт: иначе поиск «последнего веса до дня» для
// каждого из 365 дней давал бы квадратичную сложность.
export function buildWeightIndex(days) {
  const keys = []
  const weights = []
  const src = days && typeof days === 'object' ? days : {}
  for (const key of Object.keys(src).sort()) {
    const w = dayWeight(src[key])
    if (w == null) continue
    keys.push(key)
    weights.push(w)
  }
  return { keys, weights }
}

// Последнее взвешивание НА дату или РАНЬШЕ неё. Если таких нет — fallback
// (обычно вес из профиля: он и есть «первое взвешивание» с онбординга).
export function weightAt(index, dateKey, fallback = null) {
  const { keys, weights } = index || {}
  if (!keys || keys.length === 0) return isValidWeight(fallback) ? Number(fallback) : null
  let lo = 0
  let hi = keys.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid] <= dateKey) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found === -1) return isValidWeight(fallback) ? Number(fallback) : null
  return weights[found]
}

// ── Цели, пересчитанные на конкретный день ────────────────────────────────────
// Возвращает функцию (dateKey, day) → targets. Внутри кэш по паре вес+активность:
// у большинства пользователей различных пар единицы, а дней — сотни.
export function createTargetResolver(days, profile) {
  const index = buildWeightIndex(days)
  const fallbackWeight = profile?.weight
  const cache = new Map()
  const base = profile?.targets || null

  return function targetsFor(dateKey, day) {
    const weight = weightAt(index, dateKey, fallbackWeight)
    const activity = effectiveActivity(day, profile)

    // Профиль без роста/возраста/пола (частичный онбординг, битые данные) —
    // считать Mifflin-St Jeor не из чего. Отдаём цели профиля как есть.
    if (!isValidWeight(weight) || !Number.isFinite(Number(profile?.height)) || !Number.isFinite(Number(profile?.age))) {
      return base
    }

    const ck = `${weight}|${activity}`
    if (cache.has(ck)) return cache.get(ck)
    // computeTargets возвращает null, если профиля не хватает на расчёт. Тогда
    // отдаём цели из профиля — как и в ветке выше. Кэшируем и этот случай:
    // has() вместо проверки на истинность, иначе null пересчитывался бы заново
    // на каждый день года.
    const t = computeTargets({ ...profile, weight, activity }) || base
    cache.set(ck, t)
    return t
  }
}

// Разовый расчёт целей одного дня (для экрана дня — там дней три, индекс не нужен).
export function targetsForDay(days, dateKey, profile) {
  return createTargetResolver(days, profile)(dateKey, days?.[dateKey])
}

// ── История веса ──────────────────────────────────────────────────────────────
// Только дни с реальным взвешиванием, по возрастанию даты.
export function weightSeries(days, keys) {
  const src = days && typeof days === 'object' ? days : {}
  const out = []
  for (const k of keys) {
    const w = dayWeight(src[k])
    if (w != null) out.push({ key: k, weight: w })
  }
  return out
}

// Скользящее среднее по последним `window` ЗАПИСЯМ (не календарным дням).
// Дневной вес скачет на ±1–2 кг из-за воды и еды — сырая линия вводит в
// заблуждение, сглаженная показывает настоящее направление.
export function movingAverage(series, window = 7) {
  if (!Array.isArray(series) || series.length === 0) return []
  const out = []
  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - window + 1)
    let sum = 0
    for (let j = from; j <= i; j++) sum += series[j].weight
    out.push({ key: series[i].key, weight: sum / (i - from + 1) })
  }
  return out
}

// Тренд веса: наклон линейной регрессии, переведённый в кг/неделю.
// Меньше двух точек — тренда нет (одна точка не задаёт направление).
export function weightTrend(series) {
  if (!Array.isArray(series) || series.length < 2) return { perWeek: null, dir: 'flat', span: 0 }
  const t0 = fromKey(series[0].key).getTime()
  const xs = series.map((p) => (fromKey(p.key).getTime() - t0) / 86400000) // дни
  const ys = series.map((p) => p.weight)
  const n = xs.length
  const mx = xs.reduce((a, v) => a + v, 0) / n
  const my = ys.reduce((a, v) => a + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  // Все взвешивания в один день — наклон не определён.
  if (den === 0) return { perWeek: null, dir: 'flat', span: xs[n - 1] - xs[0] }
  const perDay = num / den
  const perWeek = perDay * 7
  // Порог 0.1 кг/нед: ниже этого — шум весов, а не тренд.
  const dir = Math.abs(perWeek) < 0.1 ? 'flat' : perWeek > 0 ? 'up' : 'down'
  return { perWeek, dir, span: xs[n - 1] - xs[0] }
}

// ── ИМТ ───────────────────────────────────────────────────────────────────────
// Грубый популяционный ориентир, НЕ диагноз: не различает мышцы и жир,
// некорректен для спортсменов, детей, беременных. UI обязан это писать.
export function bmi(weight, heightCm) {
  const w = Number(weight)
  const h = Number(heightCm) / 100
  if (!isValidWeight(w) || !Number.isFinite(h) || h <= 0.5 || h > 2.7) return null
  return w / (h * h)
}

export function bmiBand(value) {
  if (value == null) return null
  if (value < 18.5) return { key: 'under', label: 'ниже нормы', color: 'var(--accent)' }
  if (value < 25) return { key: 'normal', label: 'в пределах нормы', color: 'var(--good)' }
  if (value < 30) return { key: 'over', label: 'выше нормы', color: 'var(--warn)' }
  return { key: 'obese', label: 'значительно выше нормы', color: 'var(--danger)' }
}

// ── Свод по весу за период ────────────────────────────────────────────────────
// goal — целевой вес из профиля (profile.weightGoal), необязателен.
export function weightSummary(days, keys, profile) {
  const series = weightSeries(days, keys)
  const smooth = movingAverage(series, 7)
  const trend = weightTrend(series)
  const first = series[0] || null
  const last = series[series.length - 1] || null
  const goal = isValidWeight(profile?.weightGoal) ? Number(profile.weightGoal) : null

  const current = last?.weight ?? null
  const delta = first && last ? last.weight - first.weight : null
  const min = series.length ? Math.min(...series.map((p) => p.weight)) : null
  const max = series.length ? Math.max(...series.map((p) => p.weight)) : null

  let remaining = null
  let etaWeeks = null
  if (goal != null && current != null) {
    remaining = goal - current
    // Прогноз только если движемся В СТОРОНУ цели — иначе «через ∞ недель»
    // было бы бессмысленным и демотивирующим числом.
    if (trend.perWeek != null && Math.abs(trend.perWeek) >= 0.1 && Math.sign(trend.perWeek) === Math.sign(remaining)) {
      etaWeeks = Math.abs(remaining / trend.perWeek)
    }
  }

  const b = bmi(current, profile?.height)

  return {
    series,
    smooth,
    trend,
    entries: series.length,
    current,
    first: first?.weight ?? null,
    delta,
    min,
    max,
    goal,
    remaining,
    etaWeeks,
    bmi: b,
    bmiBand: bmiBand(b),
  }
}

// ── Свод по активности за период ──────────────────────────────────────────────
// Считаем ТОЛЬКО дни с явно указанной активностью: подставлять сюда значение
// профиля значило бы придумать данные, которых человек не вводил.
export function activitySummary(days, keys, profile) {
  const src = days && typeof days === 'object' ? days : {}
  const counts = { sedentary: 0, light: 0, moderate: 0, high: 0 }
  let marked = 0
  let factorSum = 0

  for (const k of keys) {
    const day = src[k]
    if (!hasDayActivity(day)) continue
    counts[day.activity] += 1
    marked += 1
    factorSum += ACTIVITY[day.activity].factor
  }

  const profileFactor = ACTIVITY[effectiveActivity(null, profile)]?.factor ?? 1.375
  const busiest = ACTIVITY_ORDER.reduce((best, k) => (counts[k] > counts[best] ? k : best), ACTIVITY_ORDER[0])

  return {
    counts,
    markedDays: marked,
    totalDays: keys.length,
    avgFactor: marked ? factorSum / marked : null,
    profileFactor,
    // Насколько реальные дни активнее/пассивнее «среднего» из профиля.
    vsProfile: marked ? factorSum / marked - profileFactor : null,
    mostCommon: marked ? busiest : null,
  }
}
