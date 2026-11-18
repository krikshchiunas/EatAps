// Экспорт обязан содержать ВСЁ: каждый раздел состояния и всё, что по нему
// рассчитывается (тренировки, цели, сахара, клетчатку, витамины и минералы).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExport, exportLimitDays, validateExportRange, rangeLength } from './exportData.js'
import { MICRONUTRIENTS } from './micronutrients.js'

const profile = { sex: 'male', age: 30, height: 180, weight: 80, activity: 'light', goal: 'maintain' }

const state = {
  profile,
  theme: 'dark',
  days: {
    '2026-11-10': {
      meals: [
        { id: 'a', name: 'Гречка', grams: 200, unit: 'г', kcal: 220, protein: 8, fat: 2, carbs: 42 },
        { id: 'b', name: 'Яблоко', grams: 150, unit: 'г', kcal: 78, protein: 0.4, fat: 0.3, carbs: 17 },
      ],
      mealSections: [],
      supps: [{ id: 's', name: 'Магний', provides: { mg: 200 } }],
      mood: 4, wellbeing: ['energy'], note: 'ok',
      weight: 79.5, activityScore: 70, strength: true,
    },
    '2026-11-11': { meals: [], mealSections: [], supps: [], mood: null, wellbeing: [], note: '', weight: 79.2 },
  },
  customFoods: [{ id: 'cf1', name: 'Мой батончик' }],
  customIngredients: [{ id: 'ci1', name: 'Мука' }],
  products: [{ id: 'p1', name: 'Гауда 45%', brand: 'Ламбер', kcal: 356, barcode: '4601234567893' }],
  favorites: [{ id: 'f1' }],
  templates: [{ id: 't1' }],
  recipes: [{ id: 'r1' }],
  supplements: [{ id: 'st1', name: 'Магний', provides: { mg: 200 } }],
  recents: ['гречка'],
  prefs: { microGoals: { vitC: 500 } },
  subscription: { tier: 'free' },
}

const now = new Date('2026-11-12T10:00:00Z')

test('сырой слой содержит каждый раздел состояния без исключений', () => {
  const out = buildExport(state, { now })
  for (const key of ['profile', 'theme', 'days', 'customFoods', 'customIngredients', 'products', 'favorites', 'templates', 'recipes', 'supplements', 'recents', 'prefs', 'subscription']) {
    assert.deepEqual(out.raw[key], state[key], key)
  }
})

test('по каждому дню посчитаны тренировка, вес, цели и все микронутриенты', () => {
  const out = buildExport(state, { now })
  const day = out.computed.days.find((d) => d.date === '2026-11-10')
  assert.equal(day.workout.strengthTraining, true)
  assert.equal(day.workout.activityScore, 70)
  assert.equal(day.body.weight, 79.5)
  assert.ok(day.targets.calories > 0)
  assert.equal(day.totals.kcal, 298)
  assert.ok(day.totals.fiber > 0)
  // Все вещества справочника, а не только «показанные на экране».
  assert.equal(day.micronutrients.length, MICRONUTRIENTS.length)
  const mg = day.micronutrients.find((r) => r.key === 'mg')
  assert.ok(mg.fromFood > 0, 'магний из гречки')
  assert.equal(mg.fromSupplements, 200)
  const c = day.micronutrients.find((r) => r.key === 'vitC')
  assert.equal(c.target, 500)
  assert.equal(c.personalTarget, true)
  // Каждая запись — со своим рассчитанным составом.
  assert.ok(Object.keys(day.meals[0].computed.micronutrients).length > 0)
  assert.equal(day.meals[0].name, 'Гречка')
})

test('сводки тренировок, веса и итоги периода', () => {
  const out = buildExport(state, { now })
  assert.deepEqual(out.computed.workouts.map((w) => w.date), ['2026-11-10'])
  assert.deepEqual(out.computed.weightHistory, [{ date: '2026-11-10', weight: 79.5 }, { date: '2026-11-11', weight: 79.2 }])
  const sum = out.computed.summary
  assert.equal(sum.daysInRange, 2)
  assert.equal(sum.daysWithFood, 1)
  assert.equal(sum.strengthTrainings, 1)
  assert.equal(sum.averagePerDay.kcal, 298)
  assert.deepEqual(sum.weight, { first: 79.5, last: 79.2, change: -0.3 })
  assert.equal(sum.micronutrientAverages.rows.length, MICRONUTRIENTS.length)
})

test('в файле нет социального: мыслей, ответов, переписки', () => {
  const out = buildExport(state, { now })
  assert.equal('account' in out, false)
})

test('период применяется включительно и только к дням', () => {
  const out = buildExport(state, { from: '2026-11-11', to: '2026-11-11', now })
  assert.deepEqual(Object.keys(out.raw.days), ['2026-11-11'])
  assert.deepEqual(out.computed.days.map((d) => d.date), ['2026-11-11'])
  assert.deepEqual(out.range, { from: '2026-11-11', to: '2026-11-11' })
  assert.deepEqual(out.computed.workouts, [])
  // Разделы без дат выгружаются целиком.
  assert.deepEqual(out.raw.recipes, state.recipes)
  assert.deepEqual(out.raw.supplements, state.supplements)
})

test('цель дня учитывает вес, записанный до начала периода', () => {
  const out = buildExport(state, { from: '2026-11-11', to: '2026-11-11', now })
  const full = buildExport(state, { now })
  assert.deepEqual(out.computed.days[0].targets, full.computed.days.find((d) => d.date === '2026-11-11').targets)
})

const sub = (tier, status = 'active') => ({ tier, status })

test('лимит длины периода по тарифу', () => {
  assert.equal(exportLimitDays(sub('FREE')), 7)
  assert.equal(exportLimitDays(sub('AI')), 31)
  assert.equal(exportLimitDays(sub('AI_PLUS')), 183)
  assert.equal(exportLimitDays(sub('AI_PREMIUM')), null)
  // Истёкшая платная подписка — бесплатный лимит.
  assert.equal(exportLimitDays(sub('AI_PREMIUM', 'canceled')), 7)
  assert.equal(exportLimitDays(null), 7)
})

test('проверка периода: границы включительно', () => {
  assert.equal(rangeLength('2026-11-10', '2026-11-10'), 1)
  assert.equal(rangeLength('2026-03-01', '2026-03-31'), 31) // через перевод часов
  assert.deepEqual(validateExportRange('2026-11-01', '2026-11-07', sub('FREE')), { ok: true })
  assert.deepEqual(validateExportRange('2026-11-01', '2026-11-08', sub('FREE')), { ok: false, error: 'limit', limit: 7 })
  assert.deepEqual(validateExportRange('2026-01-01', '2026-01-31', sub('AI')), { ok: true })
  assert.equal(validateExportRange('2026-01-01', '2026-02-01', sub('AI')).error, 'limit')
  assert.deepEqual(validateExportRange('2026-01-01', '2026-07-02', sub('AI_PLUS')), { ok: true })
  assert.equal(validateExportRange('2026-01-01', '2026-07-03', sub('AI_PLUS')).error, 'limit')
  assert.deepEqual(validateExportRange('2015-01-01', '2026-11-16', sub('AI_PREMIUM')), { ok: true })
  assert.equal(validateExportRange('2026-11-08', '2026-11-01', sub('AI_PREMIUM')).error, 'order')
  assert.equal(validateExportRange('', '2026-11-01', sub('AI_PREMIUM')).error, 'invalid')
})

test('экспорт сериализуется в JSON и не падает на пустом состоянии', () => {
  assert.doesNotThrow(() => JSON.stringify(buildExport(state, { now })))
  const empty = buildExport({}, { now })
  assert.deepEqual(empty.computed.days, [])
  assert.equal(empty.computed.summary.averagePerDay.kcal, null)
  assert.doesNotThrow(() => JSON.stringify(empty))
})

test('добавки за период: дни приёма, суммы веществ, витамины от добавок в средних', () => {
  const out = buildExport(state, { from: '2026-11-10', to: '2026-11-11', now })
  assert.deepEqual(out.computed.supplements.map((s) => [s.name, s.daysTaken, s.daysInRange, s.adherencePct]), [['Магний', 1, 2, 50]])
  assert.deepEqual(out.computed.supplements[0].totalProvides, { mg: 200 })
  assert.deepEqual(out.computed.supplements[0].dates, ['2026-11-10'])
})

test('статистика выбранного периода — как на экране «Статистика»', () => {
  const days = {}
  for (let i = 1; i <= 14; i++) {
    const k = `2026-10-${String(i).padStart(2, '0')}`
    days[k] = {
      meals: [{ id: 'g' + i, name: 'Гречка', grams: 600, unit: 'г', kcal: 1900, protein: 70, fat: 50, carbs: 280 },
        { id: 'c' + i, name: 'Курица', grams: 150, unit: 'г', kcal: 250, protein: 35, fat: 10, carbs: 0 }],
      mealSections: [], supps: [{ id: 's' + i, name: 'Витамин D3', provides: { vitD: 50 } }],
      mood: 4, wellbeing: [], note: '', weight: 80 - i * 0.1, strength: i % 2 === 0,
    }
  }
  const out = buildExport({ profile, days, prefs: {} }, { from: '2026-10-08', to: '2026-10-14', now })
  const st = out.computed.statistics
  assert.equal(st.days, 7)
  assert.equal(st.granularity, 'day')
  assert.equal(st.loggedDays, 7)
  assert.deepEqual(st.loggedKeys, ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'])
  assert.equal(st.summary.avg.kcal, 2150)
  // Сравнение с предыдущими 7 днями (01–07 октября) — тоже из истории.
  assert.equal(st.nutrients.kcal.series.length, 7)
  assert.ok(st.products.frequent.some((p) => p.name === 'Гречка'))
  assert.equal(st.body.weight.current, 78.6)
  assert.equal(st.body.weight.delta, -0.6) // без хвоста двоичной дроби
  // Средние витаминов — по тем же учтённым дням, витамин D — от добавки.
  const d = out.computed.summary.micronutrientAverages
  assert.equal(d.countedDays, 7)
  assert.equal(d.rows.find((r) => r.key === 'vitD').fromSupp, 50)
  assert.equal(statsGran(40), 'week')
  assert.equal(statsGran(400), 'month')
})

function statsGran(n) {
  const days = { '2026-01-01': { meals: [], mealSections: [], supps: [], wellbeing: [] } }
  const to = new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10)
  return buildExport({ profile, days }, { from: '2026-01-01', to, now }).computed.statistics.granularity
}
