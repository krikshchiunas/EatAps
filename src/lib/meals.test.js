// Группировка дня по приёмам пищи для профиля. Главное, что проверяется:
// с экрана не может пропасть еда. У друга день приезжает без mealSections, и
// наивная группировка потеряла бы всё, что он записал в свой приём пищи.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupDayByMeal, getMealSections, stdId, OTHER_ID, STANDARD_TYPES } from './meals.js'

const food = (id, extra) => ({ id, name: id, kcal: 100, ...extra })

test('стандартные приёмы есть всегда, даже в пустом дне', () => {
  const groups = groupDayByMeal({ meals: [] })
  assert.deepEqual(
    groups.map((g) => g.section.id),
    STANDARD_TYPES.map(stdId),
  )
  assert.ok(groups.every((g) => g.foods.length === 0))
})

test('продукты раскладываются по явному mealId', () => {
  const day = {
    meals: [
      food('a', { mealId: stdId('breakfast') }),
      food('b', { mealId: stdId('dinner') }),
      food('c', { mealId: stdId('breakfast') }),
    ],
  }
  const byId = new Map(groupDayByMeal(day).map((g) => [g.section.id, g.foods.map((f) => f.id)]))
  assert.deepEqual(byId.get(stdId('breakfast')), ['a', 'c'])
  assert.deepEqual(byId.get(stdId('dinner')), ['b'])
  assert.deepEqual(byId.get(stdId('lunch')), [])
})

test('старые записи без mealId раскладываются по легаси-полю type', () => {
  const day = { meals: [food('a', { type: 'lunch' }), food('b', { type: 'snack' })] }
  const byId = new Map(groupDayByMeal(day).map((g) => [g.section.id, g.foods.map((f) => f.id)]))
  assert.deepEqual(byId.get(stdId('lunch')), ['a'])
  assert.deepEqual(byId.get(stdId('snack')), ['b'])
})

test('продукт из пользовательского приёма виден, когда сам приём в дне есть', () => {
  const day = {
    meals: [food('a', { mealId: 'custom-1' })],
    mealSections: [{ id: 'custom-1', type: 'custom', customName: 'После тренировки', sortOrder: 9 }],
  }
  const groups = groupDayByMeal(day)
  const g = groups.find((x) => x.section.id === 'custom-1')
  assert.ok(g, 'секция должна быть в списке')
  assert.deepEqual(g.foods.map((f) => f.id), ['a'])
  assert.equal(g.section.label, 'После тренировки')
})

test('у друга (день без mealSections) еда из его приёма не пропадает', () => {
  // Ровно то, что отдаёт friend_state: только meals, без секций.
  const day = { meals: [food('a', { mealId: 'custom-1' }), food('b', { mealId: stdId('lunch') })] }
  const groups = groupDayByMeal(day)
  const shown = groups.flatMap((g) => g.foods.map((f) => f.id))
  assert.deepEqual(shown.sort(), ['a', 'b'], 'на экране должны быть ОБА продукта')
  const other = groups.find((g) => g.section.id === OTHER_ID)
  assert.ok(other, 'приёмник «Без категории» появляется сам')
  assert.deepEqual(other.foods.map((f) => f.id), ['a'])
})

test('приёмник «Без категории» стоит сразу после стандартных приёмов', () => {
  const day = { meals: [food('a', { mealId: 'нет такого' })] }
  const ids = groupDayByMeal(day).map((g) => g.section.id)
  assert.equal(ids[STANDARD_TYPES.length], OTHER_ID)
})

test('нераспознанный type и отсутствие приёма дают одну секцию, а не две', () => {
  const day = { meals: [food('a', { type: 'бранч' }), food('b', { mealId: 'custom-1' })] }
  const groups = groupDayByMeal(day)
  const others = groups.filter((g) => g.section.id === OTHER_ID)
  assert.equal(others.length, 1)
  assert.deepEqual(others[0].foods.map((f) => f.id).sort(), ['a', 'b'])
})

test('битый и пустой день не роняют экран', () => {
  for (const junk of [null, undefined, {}, { meals: null }, { meals: 'нет' }]) {
    const groups = groupDayByMeal(junk)
    assert.equal(groups.length, STANDARD_TYPES.length)
  }
})

test('getMealSections не изменился для дневника: «Без категории» только по факту', () => {
  assert.ok(!getMealSections({ meals: [] }).some((s) => s.id === OTHER_ID))
  assert.ok(getMealSections({ meals: [food('a', { type: 'бранч' })] }).some((s) => s.id === OTHER_ID))
})
