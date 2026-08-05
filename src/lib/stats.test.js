// Тесты чистых функций аналитики. Запуск: `npm test` (node --test, без зависимостей).
// Данные контролируемые, дата передаётся явно (today) — детерминизм независимо от
// реального времени и часового пояса.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStats,
  mealSugar,
  realSugar,
  normalizeName,
  dayNutrients,
  statusOf,
} from './stats.js'

const TODAY = '2026-08-05'
const meal = (o = {}) => ({ id: Math.random().toString(36).slice(2), name: 'Еда', kcal: 0, protein: 0, carbs: 0, fat: 0, ...o })
const day = (...meals) => ({ meals, mood: null, wellbeing: [], note: '' })
const withTargets = { targets: { calories: 1500, protein: 100, fat: 50, carbs: 150 } }

// Рекурсивно проверяем, что все ЧИСЛА в объекте конечны (null/строки допустимы).
function assertAllFinite(obj, path = 'root') {
  if (typeof obj === 'number') {
    assert.ok(Number.isFinite(obj), `${path} не конечно: ${obj}`)
    return
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`))
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) assertAllFinite(obj[k], `${path}.${k}`)
}

test('границы периода: 7 дней включают ровно сегодня и −6 дней', () => {
  const s = computeStats({}, withTargets, '7d', TODAY)
  assert.equal(s.keys.length, 7)
  assert.equal(s.keys[0], '2026-07-30')
  assert.equal(s.keys[6], '2026-08-05')
  assert.equal(s.totalDays, 7)
})

test('переход через месяц и год в ключах периода', () => {
  const s = computeStats({}, withTargets, '7d', '2026-01-02')
  assert.equal(s.keys[0], '2025-12-27') // ушли в прошлый год
  assert.equal(s.keys[6], '2026-01-02')
  assert.equal(s.keys.length, 7)
})

test('средние, минимум и максимум — по заполненным дням', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 2000 })),
    '2026-08-04': day(meal({ kcal: 1000 })),
    '2026-08-03': day(meal({ kcal: 1500 })),
    '2026-08-02': day(), // пустой день — НЕ учитывается в среднем
  }
  const k = computeStats(days, withTargets, '7d', TODAY).nutrients.kcal
  assert.equal(k.loggedDays, 3)
  assert.equal(k.avg, 1500)
  assert.equal(k.min, 1000)
  assert.equal(k.max, 2000)
  assert.equal(k.total, 4500)
})

test('полнота данных: заполнено X из Y, пустые дни не исчезают', () => {
  const days = {}
  for (let i = 0; i < 8; i++) days[`2026-08-0${i + 1}`.slice(0, 10)] = day(meal({ kcal: 1500 }))
  // 8 заполненных дней в периоде 30 дней
  const filled = {}
  ;['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].forEach((d) => {
    filled[d] = day(meal({ kcal: 1500 }))
  })
  const s = computeStats(filled, withTargets, '30d', TODAY)
  assert.equal(s.loggedDays, 8)
  assert.equal(s.totalDays, 30)
  assert.equal(s.hasData, true)
})

test('процент достижения цели считается среди заполненных дней', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 1500 })), // в норме
    '2026-08-04': day(meal({ kcal: 1650 })), // 1500*1.1 — верхняя граница, ещё «в норме»
    '2026-08-03': day(meal({ kcal: 1000 })), // недобор
  }
  const s = computeStats(days, withTargets, '7d', TODAY)
  assert.equal(s.nutrients.kcal.daysIn, 2)
  assert.equal(s.nutrients.kcal.daysUnder, 1)
  assert.equal(s.nutrients.kcal.daysOver, 0)
  assert.equal(s.summary.daysInTarget, 2)
  assert.equal(s.loggedDays, 3)
  assert.equal(s.summary.goalHitPct, Math.round((2 / 3) * 100)) // 67
})

test('statusOf: границы допуска калорий (±10%)', () => {
  assert.equal(statusOf(1350, 1500, 'kcal'), 'in') // ровно нижняя граница
  assert.equal(statusOf(1349, 1500, 'kcal'), 'under')
  assert.equal(statusOf(1650, 1500, 'kcal'), 'in') // ровно верхняя граница
  assert.equal(statusOf(1651, 1500, 'kcal'), 'over')
  assert.equal(statusOf(100, null, 'kcal'), 'none') // нет цели
})

test('тренд относительно предыдущего равного периода', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 2000 })), // текущий период
    '2026-07-29': day(meal({ kcal: 1000 })), // предыдущий период (−7 от старта)
  }
  const tr = computeStats(days, withTargets, '7d', TODAY).nutrients.kcal.trend
  assert.equal(tr.delta, 1000)
  assert.equal(tr.dir, 'up')
  assert.equal(Math.round(tr.pct), 100)
})

test('проценты источников нутриента суммируются в 100', () => {
  const days = {
    '2026-08-05': day(meal({ name: 'A', kcal: 300 }), meal({ name: 'B', kcal: 100 })),
  }
  const src = computeStats(days, withTargets, '7d', TODAY).products.sources.kcal
  assert.equal(src.length, 2)
  assert.equal(src[0].name, 'A')
  assert.equal(src[0].value, 300)
  assert.equal(Math.round(src[0].percent), 75)
  assert.equal(Math.round(src[1].percent), 25)
  assert.equal(Math.round(src[0].percent + src[1].percent), 100)
})

test('агрегация недель (6 мес): бакет = среднее по своим дням', () => {
  const days = {
    '2026-08-03': day(meal({ kcal: 1000 })), // Пн
    '2026-08-05': day(meal({ kcal: 2000 })), // Ср той же недели
  }
  const k = computeStats(days, withTargets, '6m', TODAY).nutrients.kcal
  assert.equal(k.gran, 'week')
  const nonNull = k.series.filter((b) => b.value != null)
  assert.equal(nonNull.length, 1) // обе записи в одной неделе
  assert.equal(nonNull[0].value, 1500) // (1000+2000)/2
})

test('агрегация месяцев (1 год) с переходом через год', () => {
  const days = {
    '2025-12-15': day(meal({ kcal: 1000 })),
    '2026-01-15': day(meal({ kcal: 2000 })),
  }
  const k = computeStats(days, withTargets, '1y', TODAY).nutrients.kcal
  assert.equal(k.gran, 'month')
  const nonNull = k.series.filter((b) => b.value != null)
  assert.equal(nonNull.length, 2) // декабрь 2025 и январь 2026 — разные бакеты
  assert.deepEqual(nonNull.map((b) => b.value).sort((a, b) => a - b), [1000, 2000])
})

test('пустой период: без данных и без ошибок', () => {
  const s = computeStats({}, withTargets, '7d', TODAY)
  assert.equal(s.hasData, false)
  assert.equal(s.loggedDays, 0)
  assert.equal(s.nutrients.kcal.avg, 0)
  assert.equal(s.summary.goalHitPct, null)
  assertAllFinite(s)
})

test('один заполненный день: single=true, тренд не считается', () => {
  const s = computeStats({ '2026-08-05': day(meal({ kcal: 1500 })) }, withTargets, '7d', TODAY)
  assert.equal(s.loggedDays, 1)
  assert.equal(s.single, true)
  assert.equal(s.nutrients.kcal.trend.delta, null) // нет предыдущего периода
})

test('нет целей: только факт, без процентов и без падения', () => {
  const days = { '2026-08-05': day(meal({ kcal: 1500 })) }
  for (const profile of [null, {}, { targets: null }, { targets: { calories: 0 } }, { targets: { calories: 'abc' } }]) {
    const s = computeStats(days, profile, '7d', TODAY)
    assert.equal(s.nutrients.kcal.target, null)
    assert.equal(s.summary.goalHitPct, null)
    assert.equal(s.nutrients.kcal.avg, 1500) // среднее всё равно считается
    assertAllFinite(s)
  }
})

test('продукт без части нутриентов и «мусорные» значения → без NaN/Infinity', () => {
  const days = {
    '2026-08-05': day(
      meal({ name: 'Кола', kcal: '200', protein: undefined, carbs: null, fat: 'x', sugar: '5' }),
      meal({ name: '', kcal: NaN }), // пустое имя — пропускается в рейтинге
    ),
  }
  const s = computeStats(days, { targets: { calories: '2000' } }, '30d', TODAY)
  assert.equal(s.nutrients.kcal.target, 2000) // строковая цель приведена к числу
  assert.ok(Number.isFinite(s.nutrients.protein.avg))
  assertAllFinite(s)
})

test('одинаковые продукты с разным регистром группируются в один', () => {
  const days = {
    '2026-08-05': day(meal({ name: 'Банан', kcal: 90 })),
    '2026-08-04': day(meal({ name: 'банан ', kcal: 90 })),
  }
  const freq = computeStats(days, withTargets, '7d', TODAY).products.frequent
  assert.equal(freq.length, 1)
  assert.equal(freq[0].count, 2)
})

test('реальный ноль — это запись, а не отсутствие данных', () => {
  const days = { '2026-08-05': day(meal({ name: 'Вода', kcal: 0 })) }
  const s = computeStats(days, withTargets, '7d', TODAY)
  assert.equal(s.loggedDays, 1) // день с нулевым приёмом всё равно заполнен
  assert.equal(s.nutrients.kcal.avg, 0)
  assert.equal(s.nutrients.kcal.min, 0)
})

test('сахар: реальное поле имеет приоритет, иначе — оценка из углеводов', () => {
  assert.equal(realSugar({ sugar: 20 }), 20)
  assert.equal(realSugar({ sugar: 0 }), null) // пустой ручной ввод (0) — не «указано»
  assert.equal(realSugar({}), null)
  assert.equal(mealSugar({ sugar: 20, carbs: 100, name: 'что-то' }), 20) // берём реальное
  assert.equal(mealSugar({ carbs: 100, name: 'Сахар' }), 100) // оценка: freeSugarShare=1
  assert.ok(Math.abs(mealSugar({ carbs: 100, name: 'Рис' }) - 5) < 0.01) // оценка: 0.05*100
})

test('флаг sugarEstimated: true если хоть один продукт без реального сахара', () => {
  const estimated = computeStats(
    { '2026-08-05': day(meal({ name: 'Рис', carbs: 50 })) }, // без поля sugar
    withTargets, '7d', TODAY,
  )
  assert.equal(estimated.sugarEstimated, true)

  const measured = computeStats(
    { '2026-08-05': day(meal({ name: 'Кола', carbs: 30, sugar: 25 })) }, // есть sugar>0
    withTargets, '7d', TODAY,
  )
  assert.equal(measured.sugarEstimated, false)
})

test('у сахара нет цели/лимита (не сравниваем оценку с нормой ВОЗ)', () => {
  const s = computeStats({ '2026-08-05': day(meal({ name: 'Кола', carbs: 30 })) }, withTargets, '7d', TODAY)
  assert.equal(s.nutrients.sugar.target, null)
  assert.equal(s.nutrients.sugar.estimate, true)
})

test('normalizeName: регистр, ё→е, пробелы', () => {
  assert.equal(normalizeName('  Банан  '), 'банан')
  assert.equal(normalizeName('Гречка Ёжик'), 'гречка ежик')
  assert.equal(normalizeName(undefined), '')
})

test('dayNutrients устойчив к строкам и отсутствующим полям', () => {
  const r = dayNutrients([{ name: 'x', kcal: '200', protein: undefined, carbs: null, fat: 'z' }])
  assert.equal(r.kcal, 200)
  assert.equal(r.protein, 0)
  assert.equal(r.carbs, 0)
  assert.equal(r.fat, 0)
  assert.ok(Number.isFinite(r.sugar))
})
