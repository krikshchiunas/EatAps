// Экспорт обязан содержать ВСЁ: каждый раздел состояния и всё, что по нему
// рассчитывается (тренировки, цели, сахара, клетчатку, витамины и минералы).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExport } from './exportData.js'
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
  for (const key of ['profile', 'theme', 'days', 'customFoods', 'customIngredients', 'favorites', 'templates', 'recipes', 'supplements', 'recents', 'prefs', 'subscription']) {
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

test('сводки тренировок, веса и периодов', () => {
  const out = buildExport(state, { now })
  assert.deepEqual(out.computed.workouts.map((w) => w.date), ['2026-11-10'])
  assert.deepEqual(out.computed.weightHistory, [{ date: '2026-11-10', weight: 79.5 }, { date: '2026-11-11', weight: 79.2 }])
  assert.deepEqual(out.computed.periods.map((p) => p.period), ['7d', '30d', '6m', '1y'])
})

test('экспорт сериализуется в JSON и не падает на пустом состоянии', () => {
  assert.doesNotThrow(() => JSON.stringify(buildExport(state, { now, account: { thoughts: [] } })))
  const empty = buildExport({}, { now })
  assert.deepEqual(empty.computed.days, [])
  assert.doesNotThrow(() => JSON.stringify(empty))
})
