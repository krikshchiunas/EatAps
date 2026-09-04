// Тесты чистых функций аналитики. Запуск: `npm test` (node --test, без зависимостей).
// Данные контролируемые, дата передаётся явно (today) — детерминизм независимо от
// реального времени и часового пояса.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStats,
  foodHabits,
  mealSugar,
  realSugar,
  normalizeName,
  dayNutrients,
  statusOf,
  isLowLogged,
  countsInStats,
} from './stats.js'

const TODAY = '2026-08-05'
const meal = (o = {}) => ({ id: Math.random().toString(36).slice(2), name: 'Еда', kcal: 0, protein: 0, carbs: 0, fat: 0, ...o })
// Дни-фикстуры маленькие (десятки-сотни калорий против цели 1500), поэтому по
// правилу «день внесён не полностью» (см. countsInStats) они выпали бы из
// статистики. Эти тесты про другое — группировку, проценты, сахар, тренды, —
// поэтому дни помечены подтверждёнными. Сам механизм отсева проверяется
// отдельными тестами в конце файла, где он и есть предмет проверки.
const day = (...meals) => ({ meals, mood: null, wellbeing: [], note: '', statsConfirmed: true })

// День БЕЗ подтверждения — для тестов самого механизма отсева.
const rawDay = (...meals) => ({ meals, mood: null, wellbeing: [], note: '' })
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

// ── Привычки профиля: «чаще всего ем» / «реже всего ем» ──────────────────────
// Проверяем не только правильный ответ, но и то, что редкая случайность не
// становится характеристикой человека, а ничьи разводятся одинаково при каждом
// пересчёте (иначе у себя и у друга профиль показывал бы разное).

// n употреблений продукта, начиная с даты и дальше в прошлое по дню на приём.
function uses(target, name, n, from) {
  let k = from
  for (let i = 0; i < n; i++) {
    const d = target[k] || (target[k] = day())
    d.meals.push(meal({ name, emoji: '🍽️' }))
    k = `2026-08-${String(Number(k.slice(-2)) - 1).padStart(2, '0')}`
  }
}

test('привычки: без истории еды — ни частого, ни редкого продукта', () => {
  for (const input of [undefined, null, {}, { '2026-08-05': day() }]) {
    const h = foodHabits(input)
    assert.equal(h.most, null)
    assert.equal(h.rare, null)
    assert.equal(h.products, 0)
    assert.equal(h.totalMeals, 0)
  }
})

test('привычки: один продукт один раз — он самый частый, редкого нет', () => {
  const h = foodHabits({ '2026-08-05': day(meal({ name: 'Овсянка' })) })
  assert.equal(h.most.name, 'Овсянка')
  assert.equal(h.most.count, 1)
  assert.equal(h.rare, null) // из одного продукта «реже всего» не выводится
})

test('привычки: явный лидер побеждает по числу употреблений', () => {
  const days = {}
  uses(days, 'Овсянка', 5, '2026-08-05')
  uses(days, 'Кофе', 3, '2026-08-05')
  uses(days, 'Яблоко', 2, '2026-08-05')
  const h = foodHabits(days)
  assert.equal(h.most.name, 'Овсянка')
  assert.equal(h.most.count, 5)
  assert.equal(h.products, 3)
  assert.equal(h.totalMeals, 10)
})

test('привычки: съеденное однажды не становится «реже всего»', () => {
  const days = {}
  uses(days, 'Овсянка', 5, '2026-08-10')
  uses(days, 'Кофе', 4, '2026-08-10')
  uses(days, 'Яблоко', 3, '2026-08-10')
  uses(days, 'Колбаса', 1, '2026-08-10') // единичный случай за всю историю
  const h = foodHabits(days)
  assert.equal(h.most.name, 'Овсянка')
  assert.notEqual(h.rare.name, 'Колбаса')
  assert.equal(h.rare.name, 'Кофе') // самый редкий среди привычного (медиана = 3.5)
})

test('привычки: всё съедено по разу — редкого продукта нет вовсе', () => {
  const days = {
    '2026-08-05': day(meal({ name: 'Колбаса' })),
    '2026-08-04': day(meal({ name: 'Пахлава' })),
    '2026-08-03': day(meal({ name: 'Устрицы' })),
  }
  const h = foodHabits(days)
  assert.equal(h.most.name, 'Колбаса') // ничья по счётчику → съеденное позже
  assert.equal(h.rare, null)
})

test('привычки: одинаковая частота — ответ детерминирован и не совпадает сам с собой', () => {
  const days = {}
  uses(days, 'Кефир', 2, '2026-08-03')
  uses(days, 'Гречка', 2, '2026-08-04')
  uses(days, 'Творог', 2, '2026-08-05')
  const h = foodHabits(days)
  assert.equal(h.most.name, 'Творог') // ели позже всех
  assert.equal(h.rare.name, 'Гречка') // из оставшихся — та, что свежее
  assert.notEqual(h.most.name, h.rare.name)
  assert.deepEqual(foodHabits(days), h) // повторный расчёт даёт то же самое
})

test('привычки: из двух продуктов «реже всего» не выводится', () => {
  const days = {}
  uses(days, 'Овсянка', 5, '2026-08-05')
  uses(days, 'Кофе', 4, '2026-08-05')
  const h = foodHabits(days)
  assert.equal(h.most.name, 'Овсянка')
  assert.equal(h.rare, null)
})

test('привычки: одинаковые продукты агрегируются как в аналитике', () => {
  const days = {
    '2026-08-05': day(meal({ name: 'Гречка' }), meal({ name: 'гречка ' })),
    '2026-08-04': day(meal({ name: 'Гречка' }), meal({ name: 'Кофе' })),
  }
  const h = foodHabits(days)
  assert.equal(h.products, 2)
  assert.equal(h.most.name, 'Гречка') // самое частое написание
  assert.equal(h.most.count, 3)
})

test('привычки: новые приёмы пищи меняют результат сами по себе', () => {
  const days = {}
  uses(days, 'Овсянка', 3, '2026-08-05')
  uses(days, 'Кофе', 2, '2026-08-05')
  assert.equal(foodHabits(days).most.name, 'Овсянка')
  uses(days, 'Кофе', 4, '2026-08-12') // человек записал ещё четыре кофе
  assert.equal(foodHabits(days).most.name, 'Кофе')
})

// ── Учёт дня в статистике ─────────────────────────────────────────────────────
// Смысл механизма: человеку было лень записать всё съеденное, статистика
// занижается и врёт. Такие дни не должны молча портить средние.

test('isLowLogged: калорий сильно меньше цели → день выглядит недозаполненным', () => {
  // 400 из 1500 — меньше 40% цели.
  assert.equal(isLowLogged(rawDay(meal({ kcal: 400 })), withTargets), true)
  // 1200 из 1500 — нормальный день.
  assert.equal(isLowLogged(rawDay(meal({ kcal: 1200 })), withTargets), false)
  // Без цели по калориям судить не о чем.
  assert.equal(isLowLogged(rawDay(meal({ kcal: 400 })), {}), false)
  // Пустой день — не «недозаполненный», он просто пустой.
  assert.equal(isLowLogged(rawDay(), withTargets), false)
})

test('isLowLogged использует переданную цель дня, а не цель профиля', () => {
  const d = rawDay(meal({ kcal: 900 }))
  // При цели профиля 1500 — 900 это 60%, нормально.
  assert.equal(isLowLogged(d, withTargets), false)
  // Но в активный день цель была 2500 — те же 900 это уже 36%.
  assert.equal(isLowLogged(d, withTargets, 2500), true)
})

test('countsInStats: недозаполненный день не считается, пока не подтверждён', () => {
  const low = rawDay(meal({ kcal: 400 }))
  assert.equal(countsInStats(low, withTargets), false)
  assert.equal(countsInStats({ ...low, statsConfirmed: true }, withTargets), true)
})

test('countsInStats: «пропустить день» исключает независимо от калорий', () => {
  const full = rawDay(meal({ kcal: 1500 }))
  assert.equal(countsInStats(full, withTargets), true)
  assert.equal(countsInStats({ ...full, statsExcluded: true }, withTargets), false)
  // Пустой день не считается никогда.
  assert.equal(countsInStats(rawDay(), withTargets), false)
})

test('пропущенный день не портит средние', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 1500 })),
    '2026-08-04': day(meal({ kcal: 1500 })),
    '2026-08-03': { ...day(meal({ kcal: 200 })), statsExcluded: true }, // забыл записать
  }
  const s = computeStats(days, withTargets, '7d', TODAY)
  assert.equal(s.loggedDays, 2, 'пропущенный день не считается заполненным')
  assert.equal(s.excludedDays, 1)
  assert.equal(s.nutrients.kcal.avg, 1500, 'среднее не должно проседать из-за пропуска')
})

test('недозаполненные дни ждут решения и видны в сводке', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 1500 })),
    '2026-08-04': rawDay(meal({ kcal: 200 })), // записал только кофе и бросил
  }
  const s = computeStats(days, withTargets, '7d', TODAY)
  assert.equal(s.loggedDays, 1)
  assert.equal(s.pendingLowDays, 1)
  assert.equal(s.excludedDays, 0)
  assert.equal(s.nutrients.kcal.avg, 1500)
})

test('график и средние отсеивают одни и те же дни', () => {
  const days = {
    '2026-08-05': day(meal({ kcal: 1500 })),
    '2026-08-04': rawDay(meal({ kcal: 100 })), // недозаполненный
  }
  const s = computeStats(days, withTargets, '7d', TODAY)
  const points = s.nutrients.kcal.series.filter((b) => b.value != null)
  assert.equal(points.length, s.loggedDays, 'на графике не должно быть дней, которых нет в средних')
})

// ── Цели, пересчитанные на каждый день ────────────────────────────────────────
// Вес и активность живут в дне, поэтому дневная цель — не константа.

const bodyProfile = { sex: 'male', age: 30, height: 180, weight: 80, activity: 'light', goal: 'maintain', targets: { calories: 2500, protein: 128, fat: 75, carbs: 320 } }

test('в активный день цель по калориям выше, чем в день на диване', () => {
  // Мужчина 30 лет, 180 см, 80 кг, поддержание веса:
  // активный день → ≈3070 ккал, день на диване → ≈2140 ккал.
  const days = {
    '2026-08-05': { ...rawDay(meal({ kcal: 3000 })), activity: 'high' },
    '2026-08-04': { ...rawDay(meal({ kcal: 3000 })), activity: 'sedentary' },
  }
  const s = computeStats(days, bodyProfile, '7d', TODAY)
  const busy = s.nutrients.kcal.series.find((b) => b.id === '2026-08-05')
  const lazy = s.nutrients.kcal.series.find((b) => b.id === '2026-08-04')

  assert.ok(busy.target > lazy.target, 'цель активного дня должна быть выше')
  // Одинаково съеденные 3000 ккал: в активный день это норма, в ленивый — перебор.
  assert.equal(busy.status, 'in')
  assert.equal(lazy.status, 'over')
  assert.equal(s.summary.calTargetVaried, true, 'цель менялась — UI обязан это показать')
})

test('вес дня влияет на цель и переносится вперёд', () => {
  const days = {
    '2026-08-01': { ...rawDay(meal({ kcal: 2000 })), weight: 100 },
    '2026-08-05': rawDay(meal({ kcal: 2000 })), // взвешивания нет — держится 100 кг
  }
  const s = computeStats(days, bodyProfile, '7d', TODAY)
  const first = s.nutrients.kcal.series.find((b) => b.id === '2026-08-01')
  const later = s.nutrients.kcal.series.find((b) => b.id === '2026-08-05')
  assert.equal(first.target, later.target, 'последний известный вес держится до нового взвешивания')
  assert.ok(first.target > bodyProfile.targets.calories, 'при 100 кг цель выше, чем при 80 кг из профиля')
})

test('свод по весу и активности считается по всем дням периода', () => {
  const days = {
    '2026-08-05': { ...rawDay(), weight: 79, activity: 'high' }, // взвесился, но не ел
    '2026-08-01': { ...rawDay(), weight: 81 },
  }
  const s = computeStats(days, bodyProfile, '7d', TODAY)
  assert.equal(s.body.weight.entries, 2, 'день без еды всё равно даёт точку веса')
  assert.equal(s.body.weight.current, 79)
  assert.equal(s.body.weight.delta, -2)
  assert.equal(s.body.activity.markedDays, 1)
  assert.equal(s.hasData, false, 'еды нет — статистики питания тоже')
})

test('недельный срез: неполная неделя помечена', () => {
  const days = { '2026-08-05': day(meal({ kcal: 1500 })) }
  const s = computeStats(days, withTargets, '7d', TODAY)
  assert.ok(s.weekly.length >= 1)
  assert.ok(s.weekly.every((w) => typeof w.partial === 'boolean'))
  const current = s.weekly[s.weekly.length - 1]
  assert.equal(current.partial, true, 'текущая неделя ещё не закончилась')
})

// ── Измеренный ноль сахара против незаполненного поля ────────────────────────

test('явно указанный нулевой сахар не подменяется оценкой', () => {
  // Сливочное масло: сахара в нём нет по-настоящему. Раньше ноль читался как
  // «не заполнено», и приложение дорисовывало сахар из углеводов.
  const butter = { name: 'Масло сливочное', carbs: 0.8, sugar: 0, sugarSrc: 'measured' }
  assert.equal(realSugar(butter), 0)
  assert.equal(mealSugar(butter), 0, 'оценка не должна включаться')
})

test('старые записи с нулём по-прежнему считаются незаполненными', () => {
  // Дневники, накопленные прошлыми версиями, писали 0 в смысле «нет данных».
  // Начать считать их измеренными значило бы задним числом изменить историю.
  const legacy = { name: 'Печенье', carbs: 60, sugar: 0 }
  assert.equal(realSugar(legacy), null)
  assert.ok(mealSugar(legacy) > 0, 'для них оценка из углеводов остаётся')
})

test('положительный сахар не требует пометки', () => {
  assert.equal(realSugar({ sugar: 12.5 }), 12.5)
  assert.equal(realSugar({ sugar: 12.5, sugarSrc: 'measured' }), 12.5)
})
