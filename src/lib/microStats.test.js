// Тесты раздела «Витамины» в статистике: среднее за день по периоду.
//
// Главное, что здесь закреплено:
//   • среднее делится на число УЧТЁННЫХ дней — тех же, что у КБЖУ;
//   • еда и добавки складываются, но видны по отдельности;
//   • среднее не прячет режим: рядом с ним — «норма закрыта в N из M дней»;
//   • неразобранная запись — пробел в данных, а не ноль витаминов.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMicroStats, SOURCES_LIMIT } from './microStats.js'
import { computeStats } from './stats.js'
import { microsForEntry } from './foodMicros.js'
import { STATUS } from './microSummary.js'

const M = { sex: 'male', age: 30 }
const uid = () => Math.random().toString(36).slice(2)
const food = (name, grams, o = {}) => ({ id: uid(), name, grams, unit: 'г', kcal: 0, protein: 0, fat: 0, carbs: 0, ...o })
const pill = (name, provides, o = {}) => ({ id: uid(), name, emoji: '💊', unit: 'капс', dose: 1, provides, ...o })
// Дни подтверждены: отсев «внесённых наполовину» проверяется в stats.test.js,
// а здесь он только мешал бы — у продуктов-фикстур нет калорий.
const day = (meals = [], supps = []) => ({ meals, supps, statsConfirmed: true })

// Содержание вещества в 100 г продукта — из той же таблицы, что считает
// приложение. Тесты не должны дублировать справочник: поправят профиль —
// поедут ожидания вместе с ним.
const per100 = (name, key) => microsForEntry(food(name, 100)).values[key] || 0

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${msg || ''} ожидалось ≈${expected}, получилось ${actual}`)

function assertAllFinite(obj, path = 'root') {
  if (typeof obj === 'number') {
    assert.ok(Number.isFinite(obj), `${path} не конечно: ${obj}`)
    return
  }
  if (Array.isArray(obj)) return obj.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`))
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) assertAllFinite(obj[k], `${path}.${k}`)
}

// ── Среднее ───────────────────────────────────────────────────────────────────

test('среднее за день — сумма по дням, делённая на их число', () => {
  const days = {
    '2026-08-04': day([food('Морковь', 100)]),
    '2026-08-05': day([food('Морковь', 200)]),
  }
  const s = computeMicroStats(days, ['2026-08-04', '2026-08-05'], { profile: M })
  const a = per100('Морковь', 'vitA')
  assert.ok(a > 0, 'у моркови должен быть витамин A — иначе тест ничего не проверяет')
  assert.equal(s.days, 2)
  near(s.byKey.vitA.total, a * 1.5, 'витамин A:')
  near(s.byKey.vitA.fromFood, a * 1.5)
  assert.equal(s.byKey.vitA.fromSupp, 0)
})

test('считаются только переданные дни, остальные в среднее не попадают', () => {
  const days = {
    '2026-08-03': day([food('Морковь', 900)]), // вне списка
    '2026-08-04': day([food('Морковь', 100)]),
  }
  const s = computeMicroStats(days, ['2026-08-04', '2026-08-05'], { profile: M })
  // 2026-08-05 в дневнике нет — его и не считаем, а не делим на него.
  assert.equal(s.days, 1)
  near(s.byKey.vitA.total, per100('Морковь', 'vitA'))
})

test('дни берутся из статистики: пропущенный вручную день не влияет на средние', () => {
  const days = {
    '2026-08-04': { ...day([food('Морковь', 100)]), statsExcluded: true },
    '2026-08-05': day([food('Морковь', 200)]),
  }
  const stats = computeStats(days, M, '7d', '2026-08-05')
  assert.deepEqual(stats.loggedKeys, ['2026-08-05'])
  assert.equal(stats.loggedKeys.length, stats.loggedDays)
  const s = computeMicroStats(days, stats.loggedKeys, { profile: M })
  assert.equal(s.days, 1)
  near(s.byKey.vitA.total, per100('Морковь', 'vitA') * 2)
})

test('еда и добавки складываются, но видны по отдельности', () => {
  const days = {
    d1: day([food('Морковь', 100)], [pill('Витамин A', { vitA: 900 })]),
    d2: day([food('Морковь', 100)]),
  }
  const r = computeMicroStats(days, ['d1', 'd2'], { profile: M }).byKey.vitA
  const a = per100('Морковь', 'vitA')
  near(r.fromFood, a)
  near(r.fromSupp, 450, 'добавка один раз за два дня — половина дозы в среднем:')
  near(r.total, a + 450)
})

test('пустой список дней — нули, а не NaN', () => {
  const s = computeMicroStats({}, [], { profile: M })
  assert.equal(s.days, 0)
  assert.equal(s.byKey.vitC.total, 0)
  assert.equal(s.byKey.vitC.status, STATUS.NONE)
  assert.equal(s.coverage.ratio, 1)
  assertAllFinite(s)
})

// ── Дни против среднего ───────────────────────────────────────────────────────

test('среднее «в норме» не прячет, что норму закрыли не каждый день', () => {
  // 200 мг витамина C в один день и ноль в другой: в среднем 100 при норме
  // 90 — «норма», хотя закрыта она была только один день из двух.
  const days = {
    d1: day([food('Вода', 200)], [pill('Витамин C', { vitC: 200 })]),
    d2: day([food('Вода', 200)]),
  }
  const r = computeMicroStats(days, ['d1', 'd2'], { profile: M }).byKey.vitC
  assert.equal(r.target, 90)
  near(r.total, 100)
  assert.equal(r.status, STATUS.DONE)
  assert.equal(r.daysDone, 1)
  assert.equal(r.daysOver, null, 'у витамина C нет «ориентира не превышать»')
  assert.equal(r.daysWith, 1)
})

test('у натрия считаются дни выше ориентира, а не «закрытая норма»', () => {
  const salt = per100('Соль', 'na')
  assert.ok(salt > 0)
  const days = {
    d1: day([food('Соль', 10)]), // ~3,9 г натрия — выше ориентира
    d2: day([food('Соль', 1)]),
  }
  const r = computeMicroStats(days, ['d1', 'd2'], { profile: M }).byKey.na
  near(r.total, salt * 0.055)
  assert.equal(r.status, STATUS.LIMIT)
  assert.equal(r.daysOver, 1)
  assert.equal(r.daysDone, null)
})

// ── Нормы и пределы ───────────────────────────────────────────────────────────

test('личная норма сильнее справочной', () => {
  const days = { d1: day([food('Вода', 200)], [pill('Витамин C', { vitC: 300 })]) }
  const r = computeMicroStats(days, ['d1'], { profile: M, goals: { vitC: 500 } }).byKey.vitC
  assert.equal(r.target, 500)
  assert.equal(r.personal, true)
  assert.equal(r.status, STATUS.LOW)
})

test('нормы зависят от пола: железа женщине нужно больше', () => {
  const s = computeMicroStats({ d1: day() }, ['d1'], { profile: { sex: 'female', age: 30 } })
  assert.equal(s.byKey.fe.target, 18)
  assert.equal(computeMicroStats({ d1: day() }, ['d1'], { profile: M }).byKey.fe.target, 8)
})

test('предел «только для добавок» и в среднем не считает еду', () => {
  // Магнием из семечек верхний предел не превысить: он про таблетки.
  const seeds = computeMicroStats({ d1: day([food('Тыквенные семечки', 100)]) }, ['d1'], { profile: M }).byKey.mg
  assert.ok(seeds.fromFood > 350)
  assert.equal(seeds.overUl, false)

  const pills = computeMicroStats({
    d1: day([food('Вода', 200)], [pill('Магний', { mg: 500 })]),
    d2: day([food('Вода', 200)], [pill('Магний', { mg: 500 })]),
  }, ['d1', 'd2'], { profile: M }).byKey.mg
  near(pills.fromSupp, 500)
  assert.equal(pills.overUl, true)
  assert.equal(pills.status, STATUS.UL)
})

// ── Что показывать ────────────────────────────────────────────────────────────

test('витамины и основные минералы видны всегда, даже по нулям', () => {
  const s = computeMicroStats({ d1: day([food('Вода', 200)]) }, ['d1'], { profile: M })
  for (const key of ['vitD', 'b12', 'ca', 'fe', 'mg', 'omega3']) {
    assert.equal(s.byKey[key].shown, true, `${key} должен быть в списке`)
  }
  assert.ok(s.groups.some((g) => g.key === 'vitamin'))
  assert.ok(s.groups.some((g) => g.key === 'mineral'))
})

test('необязательные вещества появляются, только когда они про этого человека', () => {
  const plain = { d1: day([food('Вода', 200)]) }
  assert.equal(computeMicroStats(plain, ['d1'], { profile: M }).byKey.creatine.shown, false)
  assert.equal(computeMicroStats(plain, ['d1'], { profile: M, stackKeys: new Set(['creatine']) }).byKey.creatine.shown, true, 'в стеке')
  assert.equal(computeMicroStats(plain, ['d1'], { profile: M, stackKeys: ['creatine'] }).byKey.creatine.shown, true, 'стек массивом')
  assert.equal(computeMicroStats(plain, ['d1'], { profile: M, goals: { creatine: 5 } }).byKey.creatine.shown, true, 'своя норма')

  const steak = computeMicroStats({ d1: day([food('Говядина', 300)]) }, ['d1'], { profile: M })
  assert.equal(steak.byKey.creatine.shown, true, 'пришёл с едой')
  assert.ok(steak.groups.find((g) => g.key === 'sport').rows.some((r) => r.key === 'creatine'))
})

test('«норма закрыта у N из M» не считает натрий и вещества без нормы', () => {
  const s = computeMicroStats({ d1: day([food('Соль', 10), food('Говядина', 300)]) }, ['d1'], { profile: M })
  for (const g of s.groups) {
    assert.ok(g.done <= g.total, `${g.key}: закрыто больше, чем есть`)
    const counted = g.rows.filter((r) => r.def.kind !== 'limit' && r.target != null).length
    assert.equal(g.total, counted, g.key)
  }
  assert.equal(s.done, s.groups.reduce((a, g) => a + g.done, 0))
  assert.equal(s.total, s.groups.reduce((a, g) => a + g.total, 0))
})

// ── Источники ─────────────────────────────────────────────────────────────────

test('источники: продукты и добавки вместе, по убыванию, доли от общего итога', () => {
  const days = {
    d1: day([food('Лосось', 100)], [pill('Витамин D3', { vitD: 50 })]),
    d2: day([food('Вода', 200)], [pill('Витамин D3', { vitD: 50 })]),
  }
  const r = computeMicroStats(days, ['d1', 'd2'], { profile: M }).byKey.vitD
  const salmon = per100('Лосось', 'vitD')
  assert.equal(r.sources.length, 2)
  assert.equal(r.sources[0].name, 'Витамин D3')
  assert.equal(r.sources[0].supp, true)
  near(r.sources[0].total, 100)
  near(r.sources[0].perDay, 50)
  near(r.sources[0].share, 100 / (100 + salmon))
  assert.equal(r.sources[1].name, 'Лосось')
  assert.equal(r.sources[1].supp, false)
  near(r.sources[0].share + r.sources[1].share, 1)
})

test('одинаковый продукт в разных написаниях — один источник', () => {
  const days = { d1: day([food('Морковь', 100), food('морковь ', 100), food('МОРКОВЬ', 50)]) }
  const r = computeMicroStats(days, ['d1'], { profile: M }).byKey.vitA
  assert.equal(r.sources.length, 1)
  assert.equal(r.sources[0].name, 'Морковь')
  near(r.sources[0].share, 1)
})

test('источников не больше лимита', () => {
  const days = { d1: day(['Морковь', 'Шпинат', 'Тыква', 'Батат', 'Яйцо'].map((n) => food(n, 100))) }
  const r = computeMicroStats(days, ['d1'], { profile: M }).byKey.vitA
  assert.equal(r.sources.length, SOURCES_LIMIT)
  for (let i = 1; i < r.sources.length; i++) assert.ok(r.sources[i - 1].total >= r.sources[i].total)
})

// ── Честность итога ───────────────────────────────────────────────────────────

test('неразобранные записи видны в покрытии и не считаются нулями', () => {
  const days = {
    d1: day([
      food('Морковь', 100),
      food('Плов', 2, { unit: 'порция' }), // масса неизвестна — посчитать не от чего
      food('Нечто без названия в справочнике', 100),
    ]),
  }
  const s = computeMicroStats(days, ['d1'], { profile: M })
  assert.equal(s.coverage.total, 3)
  assert.equal(s.coverage.covered, 1)
  near(s.coverage.ratio, 1 / 3)
  near(s.byKey.vitA.total, per100('Морковь', 'vitA'))
})

test('мусор в дневнике не роняет расчёт', () => {
  const days = {
    a: null,
    b: { meals: null, supps: null },
    c: {
      meals: [null, {}, { name: 'Морковь', grams: 'abc' }, { name: 'Морковь', grams: -5 }],
      supps: [null, 'x', { provides: null }, { name: 'Y', provides: { vitC: 'NaN', vitD: -3, zzz: 5 } }],
    },
  }
  const s = computeMicroStats(days, ['a', 'b', 'c', 'нет-такого'], { profile: null, goals: null, stackKeys: null })
  assert.equal(s.days, 2) // b и c: дни есть, просто пустые
  assert.equal(s.byKey.vitC.total, 0)
  assert.equal(s.byKey.vitD.total, 0)
  assertAllFinite(s)
  assert.doesNotThrow(() => computeMicroStats(null, null))
  assert.doesNotThrow(() => computeMicroStats(undefined, undefined, undefined))
})
