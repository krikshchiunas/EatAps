import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictReaction, applyServerReaction, CARROT, BROCCOLI } from './reactions.js'

const post = (over = {}) => ({ id: 'p', carrots: 0, broccoli: 0, my_reaction: null, ...over })

test('первая реакция увеличивает свой счётчик', () => {
  const next = predictReaction(post(), CARROT)
  assert.equal(next.carrots, 1)
  assert.equal(next.my_reaction, CARROT)
})

test('повторное нажатие по своей реакции снимает её', () => {
  const next = predictReaction(post({ carrots: 3, my_reaction: CARROT }), CARROT)
  assert.equal(next.carrots, 2)
  assert.equal(next.my_reaction, null)
})

// Тот самый угол, ради которого правило записано в одном месте: переключение
// обязано и снять старую, и поставить новую — иначе счётчики разъезжаются.
test('переключение с 🥕 на 🥦 двигает оба счётчика', () => {
  const next = predictReaction(post({ carrots: 2, broccoli: 5, my_reaction: CARROT }), BROCCOLI)
  assert.equal(next.carrots, 1)
  assert.equal(next.broccoli, 6)
  assert.equal(next.my_reaction, BROCCOLI)
})

test('счётчик не уходит в минус на рассинхроне', () => {
  const next = predictReaction(post({ carrots: 0, my_reaction: CARROT }), CARROT)
  assert.equal(next.carrots, 0)
})

test('нажатие туда-обратно возвращает исходное состояние', () => {
  const start = post({ carrots: 4, broccoli: 1 })
  const there = predictReaction(start, CARROT)
  const back = predictReaction(there, CARROT)
  assert.deepEqual(back, { ...start, carrots: 4, broccoli: 1, my_reaction: null })
})

test('незнакомая реакция ничего не меняет', () => {
  const start = post({ carrots: 2 })
  assert.equal(predictReaction(start, '💩'), start)
  assert.equal(predictReaction(start, undefined), start)
})

test('исходный объект не мутируется', () => {
  const start = post({ carrots: 1 })
  predictReaction(start, CARROT)
  assert.equal(start.carrots, 1)
  assert.equal(start.my_reaction, null)
})

// Сервер главнее: его ответ перезаписывает предсказание, а не складывается с ним.
test('ответ сервера перезаписывает счётчики целиком', () => {
  const guessed = predictReaction(post({ carrots: 0 }), CARROT) // предсказали 1
  const settled = applyServerReaction(guessed, { carrots: 7, broccoli: 2, mine: CARROT })
  assert.equal(settled.carrots, 7)
  assert.equal(settled.broccoli, 2)
  assert.equal(settled.my_reaction, CARROT)
})

test('сервер снял реакцию — mine приходит пустым', () => {
  const settled = applyServerReaction(post({ carrots: 1, my_reaction: CARROT }), { carrots: 0, broccoli: 0, mine: null })
  assert.equal(settled.my_reaction, null)
})

test('пустой ответ сервера не портит пост', () => {
  const p = post({ carrots: 3 })
  assert.equal(applyServerReaction(p, null), p)
})
