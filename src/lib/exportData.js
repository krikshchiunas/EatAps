// Полная выгрузка данных пользователя (DSGVO, право на переносимость).
//
// Два слоя в одном файле:
//   • raw      — состояние приложения как есть, все разделы без исключений: по
//                нему данные можно восстановить или перенести в другой сервис;
//   • computed — то, что приложение РАСЧИТЫВАЕТ и показывает, но не хранит:
//                цели дня, суммы, сахара и клетчатка, насыщенные жиры, каждый
//                витамин и минерал (еда + добавки), тренировки и активность,
//                статистика за периоды. Без этого слоя «минералы» в файл не
//                попадали вовсе — в хранилище их нет, они выводятся из записей.
//   • account  — то, что живёт на сервере в отдельных таблицах (мысли,
//                комментарии, переписка, подписки, тренер, челленджи, ИИ):
//                собирается fetchAccountExport и передаётся сюда готовым.
import { sumDay, sumQuality, sumAdvanced, freeSugarOf, fiberOf, sugarLimit, fiberGoal, satFatLimit, carbGrade } from './nutrition.js'
import { estimateSaturatedFat, classifyComplexCarb, estimateProteinQuality } from './nutritionClassification.js'
import { microsForEntry } from './foodMicros.js'
import { buildMicroSummary } from './microSummary.js'
import { microTargets, MICRONUTRIENTS } from './micronutrients.js'
import { stackMicroKeys, suppTotals } from './suppStack.js'
import { createTargetResolver, dayWeight, effectiveActivity, effectiveActivityFactor, hasDayActivity, profileTargets } from './body.js'
import { PERIODS, computeStats, foodHabits } from './stats.js'
import { computeMicroStats } from './microStats.js'

export const EXPORT_VERSION = 2

const RAW_KEYS = [
  'profile', 'theme', 'days', 'customFoods', 'customIngredients', 'favorites',
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

// Итоги периодов — как на экране статистики. Без заготовок графиков (keys,
// weekly, nutrients — по ячейке на каждый календарный день, даже пустой: это
// дублирует computed.days и раздувало файл до полумегабайта на один день) и без
// трёх копий одних и тех же строк микронутриентов с полным справочным текстом.
function periodsOut(days, profile, goals, stackKeys, today) {
  return PERIODS.map((p) => {
    const s = computeStats(days, profile, p.key, today)
    const m = computeMicroStats(days, s.loggedKeys || [], { profile, goals, stackKeys })
    return {
      period: p.key,
      totalDays: s.totalDays,
      loggedDays: s.loggedDays,
      excludedDays: s.excludedDays,
      countedDates: s.loggedKeys,
      summary: s.summary,
      body: s.body,
      products: s.products,
      insights: s.insights,
      micronutrientAverages: {
        coverage: m.coverage,
        rows: (m.rows || []).map(({ def, shown, ...row }) => row),
      },
    }
  })
}

// state   — состояние стора (useStore());
// account — результат fetchAccountExport или null (гость/офлайн);
// now     — для тестов.
export function buildExport(state, { account = null, now = new Date(), user = null, deviceId = null } = {}) {
  const s = state || {}
  const days = s.days && typeof s.days === 'object' ? s.days : {}
  const profile = s.profile || null
  const prefs = s.prefs || {}
  const goals = (typeof prefs.microGoals === 'object' && prefs.microGoals) || {}
  const stack = Array.isArray(s.supplements) ? s.supplements : []
  const stackKeys = stackMicroKeys(stack)
  const resolve = createTargetResolver(days, profile)
  const today = now.toISOString().slice(0, 10)

  const raw = Object.fromEntries(RAW_KEYS.map((k) => [k, s[k] ?? null]))
  const dates = Object.keys(days).sort()

  return {
    format: 'eataps-export',
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    user: user ? { id: user.id, email: user.email || null, createdAt: user.created_at || null } : null,
    deviceId,
    raw,
    computed: {
      profile: {
        targets: profileTargets(profile),
        micronutrientTargets: microTargets(profile, goals),
        micronutrientCatalog: MICRONUTRIENTS.map((d) => ({
          key: d.key, name: d.label, unit: d.unit, group: d.group, kind: d.kind, ul: d.ul, ulScope: d.ulScope,
        })),
      },
      days: dates.map((date) => dayOut(date, days[date], { resolve, profile, goals, stackKeys })),
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
      periods: periodsOut(days, profile, goals, stackKeys, today),
      foodHabits: foodHabits(days),
    },
    account,
  }
}
