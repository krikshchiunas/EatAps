import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReply, dedupeAsk } from './_shared.js'

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

// ── Обрезанный ответ ──────────────────────────────────────────────────────────
// Ответ упирается в max_tokens чаще, чем кажется: модель начинает писать
// карточки еды и не успевает закрыть JSON. Раньше человек видел в чате
// `{"reply": "Твой завтрак...` — сырую разметку.

test('обрыв по max_tokens: показываем написанный текст, а не сырой JSON', () => {
  const r = parseReply({
    content: [{ type: 'text', text: '{"reply": "Завтрак неплохой, но белка маловато' }],
    stop_reason: 'max_tokens',
  })
  assert.equal(r.reply, 'Завтрак неплохой, но белка маловато')
  assert.equal(r.truncated, true)
  assert.deepEqual(r.cards, [])
  assert.ok(!r.reply.includes('{'), 'в ответ уехала разметка JSON')
})

test('экранирование внутри оборванной строки разворачивается', () => {
  const r = parseReply({
    content: [{ type: 'text', text: '{"reply": "Сказал \\"хватит\\" и пошёл\\nдальше, но' }],
    stop_reason: 'max_tokens',
  })
  assert.ok(r.reply.includes('«') || r.reply.includes('"хватит"'), r.reply)
  assert.ok(!r.reply.includes('\\n'), 'осталась экранированная последовательность')
})

test('оборвалось до текста — показываем понятную фразу, а не скобки', () => {
  const r = parseReply({
    content: [{ type: 'text', text: '{"cards": [{"name": "Овся' }],
    stop_reason: 'max_tokens',
  })
  assert.equal(r.malformed, true)
  assert.ok(!r.reply.includes('{'), `в ответ уехала разметка: ${r.reply}`)
  assert.ok(r.reply.length > 10)
})

test('карточки обрезанного ответа не попадают в дневник', () => {
  const r = parseReply({
    content: [{ type: 'text', text: '{"reply":"Записал","cards":[{"name":"Овсянка","kcal":300},{"name":"Кофе"}]}' }],
    stop_reason: 'max_tokens',
  })
  assert.equal(r.reply, 'Записал')
  assert.deepEqual(r.cards, [], 'недописанная карточка не должна доехать до дневника')
  assert.equal(r.truncated, true)
})

test('целый ответ карточки не теряет', () => {
  const r = parseReply({
    content: [{ type: 'text', text: '{"reply":"Записал","cards":[{"name":"Овсянка","kcal":300}]}' }],
    stop_reason: 'end_turn',
  })
  assert.equal(r.cards.length, 1)
  assert.equal(r.truncated, undefined)
})

// ── Уточняющий вопрос не повторяется дважды ──────────────────────────────────
// На живом прогоне модель клала один и тот же вопрос и в reply, и в ask, а
// интерфейс их склеивает — человек читал «Что в бутерброде? Что в бутерброде?».

test('повтор вопроса вырезается из reply', () => {
  const r = dedupeAsk(
    'Уточни: что в бутерброде? Хлеб какой, начинка, масло или нет?',
    'Что в бутерброде? Хлеб какой, начинка, масло или нет?',
  )
  assert.equal(r, '', 'reply состоял только из повтора вопроса')
})

test('полезная часть reply остаётся, повтор уходит', () => {
  const r = dedupeAsk('Плов бывает разный по жирности. Уточни, с маслом или на бульоне?', 'С маслом или на бульоне?')
  assert.equal(r, 'Плов бывает разный по жирности.')
})

test('без ask reply не трогаем', () => {
  assert.equal(dedupeAsk('Записал 320 г плова.', null), 'Записал 320 г плова.')
  assert.equal(dedupeAsk('Записал.', ''), 'Записал.')
})

test('короткий ответ не съедается совпадением служебных слов', () => {
  assert.equal(dedupeAsk('Ок.', 'Сколько это в граммах?'), 'Ок.')
})

test('parseReply вычищает повтор целиком', () => {
  const r = parseReply({
    content: [{ type: 'text', text: JSON.stringify({
      reply: 'Уточни: что в бутерброде?',
      ask: 'Что в бутерброде?',
      cards: [],
    }) }],
    stop_reason: 'end_turn',
  })
  assert.equal(r.reply, '')
  assert.equal(r.ask, 'Что в бутерброде?')
})
