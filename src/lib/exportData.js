// Полная выгрузка данных пользователя (DSGVO, право на переносимость).
//
// Выгружается выбранный период (с — по, включительно); его длина ограничена
// тарифом — см. EXPORT_LIMIT_DAYS. Два слоя в одном файле:
//   • raw      — дни периода как есть плюс все разделы, не привязанные к датам
//                (свои продукты, рецепты, добавки, настройки): по нему данные
//                можно восстановить или перенести в другой сервис;
//   • computed — то, что приложение РАСЧИТЫВАЕТ и показывает, но не хранит:
//                цели дня, суммы, сахара и клетчатка, насыщенные жиры, каждый
//                витамин и минерал (еда + добавки), тренировки и активность,
//                итоги периода. В хранилище этого нет — выводится из записей.
// Социальное (мысли, ответы, реакции, переписка) сюда не входит.
import { sumDay, sumQuality, sumAdvanced, freeSugarOf, fiberOf, sugarLimit, fiberGoal, satFatLimit, carbGrade } from './nutrition.js'
import { estimateSaturatedFat, classifyComplexCarb, estimateProteinQuality } from './nutritionClassification.js'
import { microsForEntry } from './foodMicros.js'
import { buildMicroSummary } from './microSummary.js'
import { microTargets, MICRONUTRIENTS } from './micronutrients.js'
import { stackMicroKeys, suppTotals, stackKey } from './suppStack.js'
import { createTargetResolver, dayWeight, effectiveActivity, effectiveActivityFactor, hasDayActivity, profileTargets } from './body.js'
import { computeStats, foodHabits } from './stats.js'
import { computeMicroStats } from './microStats.js'
import { TIER, isActive } from './subscription.js'

export const EXPORT_VERSION = 3

const RAW_KEYS = [
  'profile', 'theme', 'days', 'customFoods', 'customIngredients', 'products', 'favorites',
  'templates', 'recipes', 'supplements', 'recents', 'prefs', 'subscription',
]

const round = (n, d = 3) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  const k = 10 ** d
  return Math.round(v * k) / k
}

const roundValues = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, round(v)]))

// Название, единица и группа вещества — один раз в micronutrientCatalog, а не в
// каждой строке каждого дня: за год это десятки мегабайт повторов.
function microRowOut(r) {
  return {
    key: r.key,
    fromFood: round(r.fromFood),
    fromSupplements: round(r.fromSupp),
    total: round(r.total),
    target: round(r.target),
    personalTarget: r.personal,
    percentOfTarget: r.pct != null ? round(r.pct * 100, 1) : null,
    overUpperLimit: r.overUl,
    status: r.status,
  }
}

function entryOut(m) {
  const sat = estimateSaturatedFat(m)
  const complex = classifyComplexCarb(m)
  const pq = Number(m.protein) > 0 ? estimateProteinQuality(m) : null
  const sugar = freeSugarOf(m)
  const fiber = fiberOf(m)
  const micros = microsForEntry(m)
  return {
    ...m,
    computed: {
      sugarTotal: round(sugar.total, 1),
      freeSugar: round(sugar.grams, 1),
      sugarSource: sugar.source,
      fiber: round(fiber.grams, 1),
      fiberSource: fiber.source,
      saturatedFat: round(sat.grams, 1),
      saturatedFatConfidence: sat.confidence,
      complexCarbShare: round(complex.share, 3),
      complexCarbConfidence: complex.confidence,
      proteinDiaas: pq?.diaas ?? null,
      proteinQualityConfidence: pq?.confidence ?? null,
      micronutrients: roundValues(micros.values),
      micronutrientsConfidence: micros.confidence,
      micronutrientProfile: micros.profileId ?? null,
    },
  }
}

function dayOut(date, day, { resolve, profile, goals, stackKeys }) {
  const meals = Array.isArray(day?.meals) ? day.meals : []
  const supps = Array.isArray(day?.supps) ? day.supps : []
  const targets = resolve(date, day) || null
  const totals = sumDay(meals)
  const quality = sumQuality(meals)
  const advanced = sumAdvanced(meals)
  const kcalTarget = Number(targets?.calories) || null
  const sugarLim = kcalTarget ? sugarLimit(kcalTarget) : null
  const micro = buildMicroSummary({ meals, supps, profile, goals, stackKeys })
  const suppSum = suppTotals(day)

  return {
    date,
    workout: {
      strengthTraining: Boolean(day?.strength),
      activityLevel: effectiveActivity(day, profile),
      activityScore: day?.activityScore ?? null,
      activitySetForDay: hasDayActivity(day),
      activityFactor: effectiveActivityFactor(day, profile),
    },
    body: { weight: dayWeight(day) },
    wellbeing: { mood: day?.mood ?? null, symptoms: day?.wellbeing || [], note: day?.note || '' },
    stats: { excluded: Boolean(day?.statsExcluded), confirmed: Boolean(day?.statsConfirmed) },
    targets: targets && {
      ...targets,
      freeSugarLimit: sugarLim,
      fiberGoal: fiberGoal(),
      saturatedFatLimit: kcalTarget ? satFatLimit(kcalTarget) : null,
    },
    totals: {
      ...totals,
      freeSugar: quality.freeSugar,
      fiber: quality.fiber,
      saturatedFat: advanced.satFat,
      complexCarbs: advanced.complexCarb,
      qualityProtein: advanced.qualityProtein,
      qualityProteinShare: advanced.qualityProteinShare != null ? round(advanced.qualityProteinShare, 3) : null,
      carbsBySource: quality.buckets,
    },
    confidence: {
      saturatedFat: advanced.satFatConfidence,
      complexCarbs: advanced.complexCarbConfidence,
      qualityProtein: advanced.qualityProteinConfidence,
    },
    carbGrade: sugarLim != null
      ? carbGrade({ freeSugar: quality.freeSugar, sugarLimit: sugarLim, fiber: quality.fiber, fiberGoal: fiberGoal(), carbs: totals.carbs }).level
      : null,
    micronutrients: micro.rows.map(microRowOut),
    micronutrientAlerts: micro.alerts?.map((a) => ({ key: a.key, level: a.level, text: a.text })) || [],
    supplementTotals: roundValues(suppSum),
    mealSections: day?.mealSections || [],
    meals: meals.map(entryOut),
    supplements: supps,
  }
}

// ── Сколько дней можно выгрузить за раз ──────────────────────────────────────
// Длина выбранного периода (с — по, включительно), а не «только последние
// дни»: бесплатно можно выгрузить любую неделю истории. null — без ограничения.
export const EXPORT_LIMIT_DAYS = Object.freeze({
  [TIER.FREE]: 7,
  [TIER.AI]: 31,
  [TIER.AI_PLUS]: 183,
  [TIER.AI_PREMIUM]: null,
})

export function exportLimitDays(subscription) {
  const tier = isActive(subscription) ? subscription.tier : TIER.FREE
  return tier in EXPORT_LIMIT_DAYS ? EXPORT_LIMIT_DAYS[tier] : EXPORT_LIMIT_DAYS[TIER.FREE]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

// Дней в периоде включительно: 10.11–10.11 — один день.
export function rangeLength(from, to) {
  return dayNumber(to) - dayNumber(from) + 1
}

// { ok: true } или { ok: false, error: 'invalid' | 'order' | 'limit', limit }.
export function validateExportRange(from, to, subscription) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return { ok: false, error: 'invalid' }
  if (from > to) return { ok: false, error: 'order' }
  const limit = exportLimitDays(subscription)
  if (limit != null && rangeLength(from, to) > limit) return { ok: false, error: 'limit', limit }
  return { ok: true }
}

const avg = (list, pick) => {
  const vals = list.map(pick).filter((v) => Number.isFinite(v))
  return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null
}

// Итоги выбранного периода. Средние — по дням, где есть еда: пустой день
// означает «не записывал», а не «ничего не ел».
function rangeSummary(dayRows, days, { profile, goals, stackKeys, countedDates }) {
  const fed = dayRows.filter((d) => d.meals.length > 0)
  const weights = dayRows.filter((d) => d.body.weight != null)
  // Средние витаминов — по тем же дням, что учитывает статистика (как на
  // экране: дни «недозаписанные» и исключённые туда не входят).
  const micro = computeMicroStats(days, countedDates || fed.map((d) => d.date), { profile, goals, stackKeys })
  return {
    daysInRange: dayRows.length,
    daysWithFood: fed.length,
    strengthTrainings: dayRows.filter((d) => d.workout.strengthTraining).length,
    averagePerDay: {
      kcal: avg(fed, (d) => d.totals.kcal),
      protein: avg(fed, (d) => d.totals.protein),
      fat: avg(fed, (d) => d.totals.fat),
      carbs: avg(fed, (d) => d.totals.carbs),
      fiber: avg(fed, (d) => d.totals.fiber),
      freeSugar: avg(fed, (d) => d.totals.freeSugar),
      saturatedFat: avg(fed, (d) => d.totals.saturatedFat),
    },
    weight: weights.length
      ? {
          first: weights[0].body.weight,
          last: weights[weights.length - 1].body.weight,
          change: round(weights[weights.length - 1].body.weight - weights[0].body.weight, 1),
        }
      : null,
    micronutrientAverages: {
      countedDays: micro.days,
      coverage: micro.coverage,
      rows: (micro.rows || []).map(({ def, shown, ...row }) => row),
    },
  }
}

// Добавки за период: что, сколько дней из периода, сколько раз и в какой
// сумме принято. Одна и та же добавка в разные дни — по stackKey, как в стеке.
function supplementsOut(dayRows, rangeDays) {
  const by = new Map()
  for (const d of dayRows) {
    for (const e of d.supplements) {
      const k = stackKey(e)
      let r = by.get(k)
      if (!r) {
        r = { name: e.name, emoji: e.emoji || '💊', unit: e.unit || 'шт', dates: new Set(), timesTaken: 0, totalDose: 0, provides: {} }
        by.set(k, r)
      }
      r.dates.add(d.date)
      r.timesTaken += 1
      r.totalDose += Number(e.dose) || 1
      for (const key in e.provides || {}) r.provides[key] = (r.provides[key] || 0) + (Number(e.provides[key]) || 0)
    }
  }
  return [...by.values()]
    .map((r) => ({
      name: r.name,
      emoji: r.emoji,
      unit: r.unit,
      daysTaken: r.dates.size,
      daysInRange: rangeDays,
      adherencePct: rangeDays > 0 ? round((r.dates.size / rangeDays) * 100, 1) : null,
      timesTaken: r.timesTaken,
      totalDose: round(r.totalDose, 2),
      totalProvides: roundValues(r.provides),
      averagePerTakenDay: roundValues(Object.fromEntries(Object.entries(r.provides).map(([k, v]) => [k, v / r.dates.size]))),
      dates: [...r.dates],
    }))
    .sort((a, b) => b.daysTaken - a.daysTaken || a.name.localeCompare(b.name))
}

// Графики — с той же детализацией, что на экране статистики: до месяца по
// дням, до полугода по неделям, дальше по месяцам.
const granFor = (n) => (n <= 31 ? 'day' : n <= 183 ? 'week' : 'month')

// Статистика за выбранный период — тот же расчёт, что у экрана «Статистика»
// (средние, попадание в цель, лучший/худший день, частые продукты, вес и ИМТ,
// активность, недельный срез, связи еды и самочувствия), включая сравнение
// с предыдущим таким же по длине периодом. Считается по ВСЕЙ истории: иначе
// не с чем было бы сравнить и не по чему вести цели.
function statisticsOut(allDays, profile, from, to) {
  const n = rangeLength(from, to)
  const { period, keys, ...stats } = computeStats(allDays, profile, { key: 'custom', days: n, gran: granFor(n) }, to)
  return { from, to, days: n, granularity: period.gran, ...deepRound(stats) }
}

// Экран округляет при показе, а в файл суммы уходили с хвостом двоичной дроби
// («-0.9000000000000057 кг»).
function deepRound(v) {
  if (typeof v === 'number') return round(v)
  if (Array.isArray(v)) return v.map(deepRound)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRound(x)]))
  return v
}

// state — состояние стора (useStore());
// from, to — 'YYYY-MM-DD', включительно; проверку по тарифу делает
//   validateExportRange, здесь период просто применяется;
// now — для тестов.
export function buildExport(state, { from, to, now = new Date() } = {}) {
  const s = state || {}
  const allDays = s.days && typeof s.days === 'object' ? s.days : {}
  const profile = s.profile || null
  const prefs = s.prefs || {}
  const goals = (typeof prefs.microGoals === 'object' && prefs.microGoals) || {}
  const stack = Array.isArray(s.supplements) ? s.supplements : []
  const stackKeys = stackMicroKeys(stack)
  // Цели считаются по ВСЕЙ истории: вес на первый день периода может быть
  // записан раньше него.
  const resolve = createTargetResolver(allDays, profile)

  const dates = Object.keys(allDays).filter((d) => (!from || d >= from) && (!to || d <= to)).sort()
  const days = Object.fromEntries(dates.map((d) => [d, allDays[d]]))
  const raw = Object.fromEntries(RAW_KEYS.map((k) => [k, k === 'days' ? days : s[k] ?? null]))
  const dayRows = dates.map((date) => dayOut(date, days[date], { resolve, profile, goals, stackKeys }))
  const rangeFrom = from || dates[0] || null
  const rangeTo = to || dates[dates.length - 1] || null
  const statistics = rangeFrom && rangeTo ? statisticsOut(allDays, profile, rangeFrom, rangeTo) : null
  const rangeDays = rangeFrom && rangeTo ? rangeLength(rangeFrom, rangeTo) : 0

  return {
    format: 'eataps-export',
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    range: { from: rangeFrom, to: rangeTo },
    raw,
    computed: {
      profile: {
        targets: profileTargets(profile),
        micronutrientTargets: microTargets(profile, goals),
        micronutrientCatalog: MICRONUTRIENTS.map((d) => ({
          key: d.key, name: d.label, unit: d.unit, group: d.group, kind: d.kind, ul: d.ul, ulScope: d.ulScope,
        })),
      },
      summary: rangeSummary(dayRows, days, { profile, goals, stackKeys, countedDates: statistics?.loggedKeys }),
      statistics,
      supplements: supplementsOut(dayRows, rangeDays),
      days: dayRows,
      workouts: dates
        .filter((d) => days[d]?.strength || hasDayActivity(days[d]))
        .map((d) => ({
          date: d,
          strengthTraining: Boolean(days[d]?.strength),
          activityLevel: effectiveActivity(days[d], profile),
          activityScore: days[d]?.activityScore ?? null,
        })),
      weightHistory: dates
        .map((d) => ({ date: d, weight: dayWeight(days[d]) }))
        .filter((r) => r.weight != null),
      foodHabits: foodHabits(days),
    },
  }
}
