import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCard, sanitizeCards } from './aiCards.js'

const ok = { name: 'Бутерброды с салями и сыром', grams: 140, kcal: 400, protein: 20, fat: 22, carbs: 28, meal: 'breakfast', confidence: 'medium', cat: 'dish' }

test('нормальная карточка проходит как есть', () => {
  const c = sanitizeCard(ok)
  assert.deepEqual(c, ok)
})

test('белка, жиров и углеводов не может быть больше, чем весит порция', () => {
  assert.equal(sanitizeCard({ ...ok, grams: 40 }), null)
})

test('БЖУ, дающие намного больше энергии, чем ккал, — сбой, а не оценка', () => {
  // 60 г белка в бутерброде на 400 ккал: 60×4 + 22×9 + 28×4 = 550.
  assert.equal(sanitizeCard({ ...ok, protein: 60 }), null)
  // Обратное законно: у пива калории от спирта, в БЖУ их нет.
  assert.ok(sanitizeCard({ name: 'Пиво', grams: 500, kcal: 215, protein: 3, fat: 0, carbs: 18 }))
})

test('калорийнее чистого жира еды не бывает', () => {
  assert.equal(sanitizeCard({ name: 'Орехи', grams: 30, kcal: 900, protein: 6, fat: 15, carbs: 5 }), null)
})

test('мусор в полях не превращается в цифры', () => {
  const c = sanitizeCard({ name: '  Каша  ', kcal: '200', protein: 'много', fat: -3, carbs: 30, cat: 'суп', meal: 'полдник', confidence: 'точно' })
  assert.equal(c.name, 'Каша')
  assert.equal(c.kcal, 200)
  assert.equal(c.protein, 0)
  assert.equal(c.fat, 0)
  assert.equal(c.grams, null)
  assert.equal(c.cat, undefined)
  assert.equal(c.meal, undefined)
  assert.equal(c.confidence, undefined)
  assert.equal(sanitizeCard({ name: '', kcal: 100 }), null)
  assert.equal(sanitizeCard({ name: 'Без калорий' }), null)
  assert.equal(sanitizeCard(null), null)
})

test('считается, сколько карточек отброшено', () => {
  const r = sanitizeCards([ok, { ...ok, protein: 90 }, null])
  assert.equal(r.cards.length, 1)
  assert.equal(r.dropped, 2)
  assert.deepEqual(sanitizeCards(undefined), { cards: [], dropped: 0 })
})
