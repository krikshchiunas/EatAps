import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShareData, macroShares, CARD_THEMES, CARD_W, CARD_H } from './shareCard.js'

const meal = (o = {}) => ({ id: Math.random().toString(36).slice(2), name: 'Еда', kcal: 0, protein: 0, carbs: 0, fat: 0, ...o })
const day = (...meals) => ({ meals, mealSections: [], mood: null, wellbeing: [], note: '' })

test('карточка собирает итоги дня и человеческую дату', () => {
  const d = buildShareData(day(
    meal({ name: 'Овсянка', kcal: 300, protein: 10, carbs: 50, fat: 6 }),
    meal({ name: 'Курица', kcal: 400, protein: 45, carbs: 0, fat: 12 }),
  ), '2026-08-23', { name: 'Денис' })

  assert.equal(d.kcal, 700)
  assert.equal(d.protein, 55)
  assert.equal(d.carbs, 50)
  assert.equal(d.fat, 18)
  assert.equal(d.mealCount, 2)
  assert.equal(d.dateLabel, '23 августа')
  assert.equal(d.name, 'Денис')
  assert.equal(d.empty, false)
})

test('одинаковые продукты складываются в одну строку со счётчиком', () => {
  const d = buildShareData(day(
    meal({ name: 'Кофе', kcal: 40 }),
    meal({ name: 'Кофе', kcal: 40 }),
    meal({ name: 'Кофе', kcal: 40 }),
  ), '2026-08-23')

  assert.equal(d.top.length, 1)
  assert.equal(d.top[0].count, 3)
  assert.equal(d.top[0].kcal, 120)
})

test('в топе не больше пяти строк и они по убыванию калорий', () => {
  const d = buildShareData(day(
    meal({ name: 'A', kcal: 100 }), meal({ name: 'B', kcal: 700 }),
    meal({ name: 'C', kcal: 300 }), meal({ name: 'D', kcal: 500 }),
    meal({ name: 'E', kcal: 200 }), meal({ name: 'F', kcal: 600 }),
    meal({ name: 'G', kcal: 50 }),
  ), '2026-08-23')

  assert.equal(d.top.length, 5)
  assert.deepEqual(d.top.map((x) => x.name), ['B', 'F', 'D', 'C', 'E'])
})

test('пустой день не ломает карточку', () => {
  const d = buildShareData(day(), '2026-08-23')
  assert.equal(d.empty, true)
  assert.equal(d.kcal, 0)
  assert.deepEqual(d.top, [])

  const noDay = buildShareData(null, '2026-08-23')
  assert.equal(noDay.empty, true)
  assert.equal(noDay.kcal, 0)
})

test('продукты без названия в карточку не попадают', () => {
  const d = buildShareData(day(meal({ name: '', kcal: 100 }), meal({ name: '   ', kcal: 50 })), '2026-08-23')
  assert.deepEqual(d.top, [])
})

test('доли макросов считаются по калориям, а не по граммам', () => {
  // 10 г жира = 90 ккал, 10 г белка = 40 ккал: по граммам доли были бы равны.
  const s = macroShares({ protein: 10, fat: 10, carbs: 0 })
  assert.ok(s.fat > s.protein, 'жир даёт больше энергии и должен занимать больше полосы')
  assert.ok(Math.abs(s.protein + s.fat + s.carbs - 1) < 1e-9, 'доли в сумме дают единицу')
})

test('нулевой день не делит на ноль', () => {
  assert.deepEqual(macroShares({ protein: 0, fat: 0, carbs: 0 }), { protein: 0, fat: 0, carbs: 0 })
  const neg = macroShares({ protein: -5, fat: 0, carbs: 0 })
  assert.equal(neg.protein, 0, 'отрицательные значения не должны давать отрицательную полосу')
})

test('обе темы карточки задают полный набор цветов', () => {
  const keys = ['bg', 'surface', 'ink', 'ink2', 'ink3', 'primary', 'accent', 'track']
  for (const theme of ['light', 'dark']) {
    for (const k of keys) {
      assert.match(CARD_THEMES[theme][k], /^#[0-9A-Fa-f]{6}$/, `${theme}.${k} должен быть цветом`)
    }
  }
})

test('формат карточки — вертикальные 4:5, которые соцсети не режут', () => {
  assert.equal(CARD_W, 1080)
  assert.equal(CARD_H, 1350)
  assert.ok(Math.abs(CARD_W / CARD_H - 0.8) < 1e-9)
})

test('в карточку не попадают личные данные', () => {
  const d = buildShareData({
    meals: [meal({ name: 'Овсянка', kcal: 300 })],
    weight: 79.4,
    activity: 'high',
    wellbeing: ['Стресс', 'Тяжесть'],
    note: 'поссорился с начальником',
  }, '2026-08-23', { name: 'Денис' })

  const dump = JSON.stringify(d)
  assert.ok(!dump.includes('79.4'), 'вес публиковать нельзя')
  assert.ok(!dump.includes('Стресс'), 'самочувствие публиковать нельзя')
  assert.ok(!dump.includes('начальником'), 'заметка дня публиковаться не должна')
  assert.equal(d.weight, undefined)
  assert.equal(d.note, undefined)
})
