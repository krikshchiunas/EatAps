import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReply } from './_shared.js'

const wrap = (text) => ({ content: [{ type: 'text', text }] })

test('обычный JSON разбирается в ответ и карточки', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'Плов, около 410 ккал.',
    ask: null,
    cards: [{ name: 'Плов', grams: 320, kcal: 410, protein: 18, fat: 16, carbs: 48, meal: 'lunch', confidence: 'medium' }],
    memory: null,
  })))
  assert.equal(r.reply, 'Плов, около 410 ккал.')
  assert.equal(r.cards.length, 1)
  assert.equal(r.cards[0].name, 'Плов')
  assert.equal(r.malformed, undefined)
})

test('обёртка ```json снимается — модель любит её добавлять', () => {
  const r = parseReply(wrap('```json\n{"reply":"Ок","cards":[]}\n```'))
  assert.equal(r.reply, 'Ок')
  assert.equal(r.malformed, undefined)
})

test('уточняющий вопрос доезжает отдельным полем', () => {
  const r = parseReply(wrap('{"reply":"","ask":"На масле или на пару?","cards":[]}'))
  assert.equal(r.ask, 'На масле или на пару?')
})

test('сломанный ответ не роняет экран, а показывает текст как есть', () => {
  const r = parseReply(wrap('Извините, я не понял вопрос'))
  assert.equal(r.malformed, true)
  assert.equal(r.reply, 'Извините, я не понял вопрос')
  assert.deepEqual(r.cards, [])
})

test('пустой ответ модели даёт понятный текст, а не пустой пузырь', () => {
  const r = parseReply({ content: [] })
  assert.ok(r.reply.length > 0)
})

test('список карточек обрезается — модель не должна залить дневник', () => {
  const cards = Array.from({ length: 50 }, (_, i) => ({ name: `Блюдо ${i}`, kcal: 100 }))
  const r = parseReply(wrap(JSON.stringify({ reply: 'вот', cards })))
  assert.equal(r.cards.length, 10)
})

test('память обрезается по длине — в prefs не должен уехать роман', () => {
  const r = parseReply(wrap(JSON.stringify({ reply: 'ок', cards: [], memory: 'я'.repeat(1000) })))
  assert.equal(r.memory.length, 300)
})

test('cards не массив — не падаем', () => {
  const r = parseReply(wrap('{"reply":"ок","cards":"нет"}'))
  assert.deepEqual(r.cards, [])
})

// ── Порядок реплик ───────────────────────────────────────────────────────────
// Проверяем ту же нормализацию, что делает chat.js: в модель нельзя отправить
// историю, начинающуюся с ответа ассистента, — API отвечает 400.
function normalizeTurns(history, context) {
  const turns = history
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text || '') }))
    .filter((m) => m.content)
  while (turns.length && turns[0].role === 'assistant') turns.shift()
  return context ? [{ role: 'user', content: context }, ...turns] : turns
}

test('ведущее приветствие ассистента не уезжает в модель', () => {
  const out = normalizeTurns([
    { role: 'assistant', text: 'Привет!' },
    { role: 'user', text: 'Сколько белка?' },
  ], '')
  assert.equal(out.length, 1)
  assert.equal(out[0].role, 'user')
  assert.equal(out[0].content, 'Сколько белка?')
})

test('контекст идёт отдельной репликой, а не приклеен к вопросу', () => {
  const out = normalizeTurns([{ role: 'user', text: 'Сколько белка?' }], '## ПРОФИЛЬ\n{...}')
  assert.equal(out.length, 2)
  assert.ok(out[0].content.startsWith('## ПРОФИЛЬ'))
  assert.equal(out[1].content, 'Сколько белка?')
})

test('первой репликой всегда пользователь', () => {
  for (const ctx of ['', '## ПРОФИЛЬ']) {
    const out = normalizeTurns([
      { role: 'assistant', text: 'Привет' },
      { role: 'assistant', text: 'Ещё раз привет' },
      { role: 'user', text: 'Вопрос' },
    ], ctx)
    assert.equal(out[0].role, 'user')
  }
})

test('пустые реплики отбрасываются', () => {
  const out = normalizeTurns([{ role: 'user', text: '' }, { role: 'user', text: 'Есть' }], '')
  assert.equal(out.length, 1)
})
