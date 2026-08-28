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

// ─────────────────────────────────────────────────────────────────────────────
// Регрессии по аудиту 2026-08-28: ответ модели — недоверенные данные.
// До правки карточки уходили в клиент как есть, а приведение типов делал уже
// интерфейс. Граница валидации не должна проходить по UI.
// ─────────────────────────────────────────────────────────────────────────────

test('карточка с мусором вместо чисел отбрасывается, а не рисуется как NaN', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'Вот что вижу',
    cards: [
      { name: 'Плов', kcal: 'много', protein: 10 },          // kcal не число
      { name: '', kcal: 300 },                                // нет имени
      { name: 'Овсянка', kcal: 250, protein: 'x', fat: null, carbs: 40 },
      null,
      'строка вместо объекта',
      { kcal: 100 },                                          // нет имени
    ],
  })))
  assert.equal(r.cards.length, 1, 'уцелеть должна только валидная карточка')
  assert.equal(r.cards[0].name, 'Овсянка')
  assert.equal(r.cards[0].protein, 0, 'нечисловой белок превращается в 0, а не в NaN')
  assert.equal(r.cards[0].fat, 0)
  assert.equal(r.cards[0].carbs, 40)
  for (const v of Object.values(r.cards[0])) {
    assert.ok(!Number.isNaN(v), 'ни одно поле карточки не должно быть NaN')
  }
})

test('отрицательные и бесконечные значения не проходят', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'ок',
    cards: [{ name: 'Тест', kcal: 100, protein: -50, fat: 1e400, carbs: 10 }],
  })))
  assert.equal(r.cards[0].protein, 0, 'отрицательный белок недопустим')
  assert.equal(r.cards[0].fat, 0, 'Infinity в JSON становится null и обнуляется')
})

test('нереальные числа обрезаются потолком, а не уезжают в дневник', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'ок',
    cards: [{ name: 'Тест', kcal: 999999999, grams: 1e9, protein: 1, fat: 1, carbs: 1 }],
  })))
  assert.ok(r.cards[0].kcal <= 20000)
  assert.ok(r.cards[0].grams <= 100000)
})

test('несуществующий приём пищи и уверенность обнуляются', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'ок',
    cards: [{ name: 'Тест', kcal: 100, meal: 'полдник', confidence: 'абсолютная' }],
  })))
  assert.equal(r.cards[0].meal, null)
  assert.equal(r.cards[0].confidence, null)
})

test('модель не может вернуть сто карточек на один банан', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ name: `Блюдо ${i}`, kcal: 100 }))
  const r = parseReply(wrap(JSON.stringify({ reply: 'ок', cards: many })))
  assert.equal(r.cards.length, 10)
})

test('валидный JSON, который не объект, не превращается в пустой ответ', () => {
  assert.equal(parseReply(wrap('123')).malformed, true)
  assert.ok(parseReply(wrap('123')).reply.length > 0)
  assert.equal(parseReply(wrap('[1,2,3]')).malformed, true)
  assert.equal(parseReply(wrap('"просто текст"')).reply, 'просто текст')
})

test('битые блоки content не роняют разбор', () => {
  assert.ok(parseReply({ content: [null, { type: 'text' }, { type: 'image' }] }).reply.length > 0)
  assert.ok(parseReply({ content: 'не массив' }).reply.length > 0)
  assert.ok(parseReply(null).reply.length > 0)
  assert.ok(parseReply(undefined).reply.length > 0)
})

test('длинные поля обрезаются, а не уходят в интерфейс целиком', () => {
  const r = parseReply(wrap(JSON.stringify({
    reply: 'р'.repeat(50000),
    ask: 'в'.repeat(5000),
    memory: 'м'.repeat(5000),
    cards: [{ name: 'и'.repeat(500), kcal: 100 }],
  })))
  assert.ok(r.reply.length <= 4000)
  assert.ok(r.ask.length <= 500)
  assert.ok(r.memory.length <= 300)
  assert.ok(r.cards[0].name.length <= 80)
})
