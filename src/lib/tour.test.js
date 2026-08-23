import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIPS, TOUR_PREF, tipById, isTipSeen, nextTip, markSeen, resetTips, seenCount } from './tour.js'

const FULL = { loggedDays: 10, mealsToday: 10 }

test('подсказки идут по одной и в заданном порядке', () => {
  const first = nextTip({}, FULL)
  assert.equal(first.id, TIPS[0].id)

  const afterFirst = nextTip({ [TOUR_PREF]: markSeen({}, first.id) }, FULL)
  assert.equal(afterFirst.id, TIPS[1].id, 'вторая подсказка — следующая по списку')
})

test('подсказка не показывается, пока условие не выполнено', () => {
  // Новичок без единого дня: листать нечего, продуктов нет.
  const fresh = nextTip({}, { loggedDays: 0, mealsToday: 0 })
  assert.equal(fresh, null, 'не учим жестам на пустом экране')

  const withMeal = nextTip({}, { loggedDays: 0, mealsToday: 1 })
  assert.equal(withMeal.id, 'food-swipe', 'появился продукт — уместна подсказка про свайп строки')
})

test('увиденная подсказка больше не возвращается', () => {
  let prefs = {}
  for (let i = 0; i < TIPS.length + 3; i++) {
    const tip = nextTip(prefs, FULL)
    if (!tip) break
    prefs = { [TOUR_PREF]: markSeen(prefs, tip.id) }
  }
  assert.equal(nextTip(prefs, FULL), null, 'все подсказки исчерпаны')
  assert.equal(seenCount(prefs), TIPS.length)
})

test('markSeen не мутирует исходные настройки', () => {
  const prefs = { [TOUR_PREF]: { 'day-swipe': true } }
  const next = markSeen(prefs, 'food-swipe')
  assert.equal(prefs[TOUR_PREF]['food-swipe'], undefined, 'исходный объект должен остаться прежним')
  assert.equal(next['day-swipe'], true, 'прежние отметки сохраняются')
  assert.equal(next['food-swipe'], true)
})

test('сброс возвращает подсказки', () => {
  const prefs = { [TOUR_PREF]: { 'day-swipe': true, 'food-swipe': true } }
  const cleared = { [TOUR_PREF]: resetTips() }
  assert.equal(seenCount(prefs), 2)
  assert.equal(seenCount(cleared), 0)
  assert.equal(nextTip(cleared, FULL).id, TIPS[0].id)
})

test('битые настройки не ломают подсказки', () => {
  for (const bad of [null, undefined, { [TOUR_PREF]: null }, { [TOUR_PREF]: 'да' }, { [TOUR_PREF]: 42 }]) {
    assert.equal(isTipSeen(bad, 'day-swipe'), false)
    assert.equal(seenCount(bad), 0)
    assert.ok(nextTip(bad, FULL))
  }
})

test('у каждой подсказки есть всё нужное для отрисовки', () => {
  const ids = new Set()
  for (const t of TIPS) {
    assert.ok(t.id && !ids.has(t.id), `id должен быть уникальным: ${t.id}`)
    ids.add(t.id)
    assert.ok(t.title && t.title.length < 60)
    assert.ok(t.text && t.text.length > 20, 'текст должен объяснять жест, а не называть его')
    assert.ok(t.emoji)
    assert.equal(typeof t.when, 'function')
  }
  assert.equal(tipById(TIPS[0].id).title, TIPS[0].title)
  assert.equal(tipById('нет такой'), null)
})
