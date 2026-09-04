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

// Числовой балл (0–100) → ключ активности (для подписей и сводок по уровням).
export function scoreToActivityKey(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return 'light'
  if (n < 25) return 'sedentary'
  if (n < 50) return 'light'
  if (n < 75) return 'moderate'
  return 'high'
}

// ── Балл активности → множитель к BMR ────────────────────────────────────────
// Ключ активности (4 ступени) годится для анкеты, но НЕ для ползунка дня: через
// ступени баллы 0 и 24 давали одну и ту же цель, и ползунок справедливо выглядел
// «визуальной штукой». Поэтому балл переводится в множитель напрямую и линейно —
// каждый шаг ползунка что-то меняет.
//
// Балл, соответствующий уровню из анкеты. Единственный источник этих чисел:
// экран дня берёт их отсюда же (подпись ползунка), а прямая ниже проходит
// ровно через них. Иначе день без ручной отметки давал бы цель, чуть-чуть
// отличную от анкетной.
export const ACTIVITY_SCORE = { sedentary: 12, light: 37, moderate: 62, high: 87 }

// ── Шкала активности дня, привязанная к ШАГАМ ────────────────────────────────
//
// «Малоподвижно», «активно», «очень» — слова, под которыми каждый понимает своё.
// Один считает активным днём поход в магазин, другой — двадцать километров. От
// этого зависит цель по калориям, то есть сколько человеку сегодня есть, и
// гадать тут нельзя.
//
// Шаги — единственная мера, которая у человека есть в кармане: их показывает
// телефон, и с ними можно себя сверить, а не угадывать. Поэтому подпись у
// каждого уровня — не эпитет, а число шагов.
//
// Числа — ОРИЕНТИР, а не измерение: приложение не читает шагомер, и одинаковое
// число шагов у разных людей стоит разных калорий. Об этом сказано и на экране.
//
// Балл (score) остаётся прежней величиной 0–100 — той самой, из которой
// scoreToFactor делает множитель к BMR. Шаги лишь дают ей понятную опору:
// «обычный день» — это ровно та активность, под которую подобран light (1.375).
export const ACTIVITY_LEVELS = [
  { score: 3,   steps: 500,   emoji: '🛌', label: 'Лежачий день', hint: 'до 1000 шагов', desc: 'Весь день в постели: болезнь, восстановление' },
  { score: 18,  steps: 3000,  emoji: '🛋️', label: 'Почти не выходил', hint: '≈ 3 000 шагов', desc: 'Дом и работа сидя, до магазина и обратно' },
  { score: 37,  steps: 7000,  emoji: '🚶', label: 'Обычный день', hint: '≈ 7 000 шагов', desc: 'Дорога, дела, немного ходьбы — как у большинства' },
  { score: 55,  steps: 12000, emoji: '🚶‍♂️', label: 'Много ходил', hint: '≈ 12 000 шагов', desc: 'Долгая прогулка или день на ногах' },
  { score: 72,  steps: 20000, emoji: '🏃', label: 'Очень активно', hint: '≈ 20 000 шагов', desc: 'Долгая прогулка, поход или работа на ногах' },
  { score: 88,  steps: 30000, emoji: '🔥', label: 'На ногах весь день', hint: '≈ 30 000 шагов', desc: 'Тяжёлая физическая работа или долгий поход' },
  { score: 100, steps: 50000, emoji: '⛰️', label: 'Предел', hint: '≈ 50 000 шагов', desc: 'Марафон, горы, смена на стройке — так не бывает каждый день' },
]

// Уровень, ближайший к баллу. Балл может прийти любой (старые дни, анкета),
// а показать надо конкретную кнопку.
export function activityLevelFor(score) {
  const n = Number.isFinite(Number(score)) ? Number(score) : ACTIVITY_SCORE.light
  return ACTIVITY_LEVELS.reduce((best, lvl) => (
    Math.abs(lvl.score - n) < Math.abs(best.score - n) ? lvl : best
  ))
}

// ── Силовая тренировка ───────────────────────────────────────────────────────
//
// Считается ОТДЕЛЬНО от ходьбы, и это не придирка к оформлению. Штанга и шаги —
// разные траты: час в зале даёт немного шагов, но заметный расход, и человек,
// отметивший «обычный день», не должен из-за тренировки вручную подкручивать
// ползунок ходьбы, гадая, на сколько.
//
// Величина: силовая на 45–60 минут средней тяжести — примерно +15% к основному
// обмену за сутки (около 280 ккал при обмене 1870). Выражена надбавкой к
// КОЭФФИЦИЕНТУ активности, а не отдельным слагаемым к калориям, и это не
// оформление: computeTargets считает белки, жиры и углеводы ОТ калорий, поэтому
// калории, добавленные мимо коэффициента, не попали бы в макросы — человек
// получил бы +280 ккал без единого грамма белка под них.
//
// Надбавка постоянная, потому что и расход на тренировке, и основной обмен
// растут вместе с массой тела: доля между ними держится куда лучше, чем
// абсолютное число калорий.
export const STRENGTH_FACTOR_BONUS = 0.15

// (прибавка за тренировку считается ниже — strengthDeltaForDay)

export function hasStrength(day) {
  return day?.strength === true
}

// Наклон выводим из самих коэффициентов ACTIVITY, а не вписываем числом:
// поменяется ACTIVITY — прямая поедет за ним и опоры останутся точными.
const FACTOR_SLOPE =
  (ACTIVITY.high.factor - ACTIVITY.sedentary.factor) /
  (ACTIVITY_SCORE.high - ACTIVITY_SCORE.sedentary)

// Балл ползунка (0–100) в множитель к BMR. Края выходят за четыре уровня:
// 0 ≈ 1.12 (постельный режим), 100 ≈ 1.82 (нагрузка спортсмена).
export function scoreToFactor(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return ACTIVITY.light.factor
  const x = Math.min(100, Math.max(0, n))
  const f = ACTIVITY.light.factor + (x - ACTIVITY_SCORE.light) * FACTOR_SLOPE
  // Округление до 4 знаков: ключ кэша целей не должен плодиться из-за
  // плавающей точки, на калориях это меньше 0.1 ккал.
  return Math.round(f * 10000) / 10000
}

// Балл, который стоит в дне, пока человек не отметил активность руками.
//
// Приоритет: личная настройка «что ставить по умолчанию» → уровень из анкеты →
// обычный день. Настройка нужна потому, что анкета спрашивает про образ жизни
// один раз и словами, а живёт человек по-разному: у одного «по умолчанию» это
// три тысячи шагов, у другого двенадцать. Пока он не выбрал сам, ничего не
// меняем — иначе цель поехала бы у всех разом.
export function profileScore(profile) {
  const own = Number(profile?.defaultActivityScore)
  if (Number.isFinite(own)) return Math.min(100, Math.max(0, own))
  return ACTIVITY_SCORE[profile?.activity] ?? ACTIVITY_SCORE.light
}

// Активность дня: числовой балл → ключ → из профиля → 'light'.
// Пустая строка/мусор в day.activity игнорируются, а не ломают расчёт.
export function effectiveActivity(day, profile) {
  const score = day?.activityScore
  if (score != null && Number.isFinite(Number(score))) return scoreToActivityKey(score)
  if (isValidActivity(day?.activity)) return day.activity
  if (isValidActivity(profile?.activity)) return profile.activity
  return 'light'
}

// Множитель к BMR для этого дня: балл ползунка (непрерывно) → ключ дня →
// ключ профиля. Именно он идёт в расчёт КБЖУ, в отличие от effectiveActivity,
// который остаётся «ступенчатым» и нужен только для подписей и сводок.
// Множитель к BMR за ХОДЬБУ (без силовой) — нужен отдельно, чтобы показать на
// экране, сколько добавила именно тренировка.
export function walkFactor(day, profile) {
  const score = day?.activityScore
  if (score != null && Number.isFinite(Number(score))) return scoreToFactor(Number(score))
  if (isValidActivity(day?.activity)) return ACTIVITY[day.activity].factor
  return scoreToFactor(profileScore(profile))
}

export function effectiveActivityFactor(day, profile) {
  const base = walkFactor(day, profile)
  return hasStrength(day) ? Math.round((base + STRENGTH_FACTOR_BONUS) * 10000) / 10000 : base
}

// Активность задана вручную именно для этого дня.
export function hasDayActivity(day) {
  if (day?.activityScore != null && Number.isFinite(Number(day.activityScore))) return true
  if (hasStrength(day)) return true
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
    const activityFactor = effectiveActivityFactor(day, profile)

    // Профиль без роста/возраста/пола (частичный онбординг, битые данные) —
    // считать Mifflin-St Jeor не из чего. Отдаём цели профиля как есть.
    if (!isValidWeight(weight) || !Number.isFinite(Number(profile?.height)) || !Number.isFinite(Number(profile?.age))) {
      return base
    }

    const ck = `${weight}|${activityFactor}`
    let t = cache.get(ck)
    if (!t) {
      t = computeTargets({ ...profile, weight, activityFactor })
      cache.set(ck, t)
    }
    return t
  }
}

// Норма профиля «вообще» — без привязки к дню: анкетный вес и анкетная
// активность. Считается заново, а не берётся из profile.targets: сохранённое
// значение осталось от той версии формулы, при которой человек проходил
// онбординг, и после любой правки расчёта начинает врать. Сохранённые targets
// остаются фолбэком для профилей без роста/возраста.
export function profileTargets(profile) {
  if (!profile) return null
  const w = Number(profile.weight)
  if (!isValidWeight(w) || !Number.isFinite(Number(profile.height)) || !Number.isFinite(Number(profile.age))) {
    return profile.targets || null
  }
  return computeTargets(profile)
}

// Разовый расчёт целей одного дня (для экрана дня — там дней три, индекс не нужен).
export function targetsForDay(days, dateKey, profile) {
  return createTargetResolver(days, profile)(dateKey, days?.[dateKey])
}

// Сколько калорий добавляет к цели ИМЕННО силовая — разница двух целей одного
// и того же дня, с отметкой и без неё.
//
// Считать отдельной формулой («15% от обмена») нельзя, и это выяснилось на
// экране: цели округляются до десятков каждая, поэтому разность округлённых
// целей (280) и округлённая разность (270) расходятся. Человек видит оба числа
// сразу — «+270 ккал» под кнопкой и скачок 2820 → 3100 — и это выглядит как
// ошибка в расчёте. Возвращаем ровно ту разницу, которую он и увидит.
//
// Один резолвер на оба вызова: внутри кэш по (вес, коэффициент), поэтому вторая
// цель считается без повторного обхода истории веса.
export function strengthDeltaForDay(days, dateKey, profile) {
  const day = days?.[dateKey] || {}
  const resolve = createTargetResolver(days, profile)
  const on = resolve(dateKey, { ...day, strength: true })
  const off = resolve(dateKey, { ...day, strength: false })
  const a = Number(on?.calories)
  const b = Number(off?.calories)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  return a - b
}

// Цель того же дня, но БЕЗ ручной отметки активности — то есть по активности из
// анкеты. Нужна экрану дня, чтобы показать, на сколько ползунок сдвинул цель.
// Вес берётся тот же (актуальный на эту дату), меняется только активность.
export function baselineTargetsForDay(days, dateKey, profile) {
  return createTargetResolver(days, profile)(dateKey, null)
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
    // День может быть отмечен только баллом (ползунок) — тогда day.activity нет,
    // и обращаться к ACTIVITY[day.activity] напрямую нельзя.
    counts[effectiveActivity(day, null)] += 1
    marked += 1
    factorSum += effectiveActivityFactor(day, null)
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
