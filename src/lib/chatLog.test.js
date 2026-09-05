import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeMessages, settleMessage, failMessage, newClientId, isTempId } from './chatLog.js'

const at = (s) => `2026-09-05T10:00:${String(s).padStart(2, '0')}.000Z`

// ── Главный инвариант: гонка «история против подписки» ────────────────────────
// Сообщение пришло по realtime РАНЬШЕ, чем догрузилась история. Прежний код
// делал setMessages(историю) и терял его.
test('ответ истории не затирает сообщение, пришедшее по realtime раньше', () => {
  const live = [{ id: 'live', created_at: at(9) }]           // прилетело первым
  const history = [{ id: 'a', created_at: at(1) }, { id: 'b', created_at: at(2) }]
  const merged = mergeMessages(live, history)
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'live'])
})

test('слияние идемпотентно: повтор той же страницы ничего не меняет', () => {
  const page = [{ id: 'a', created_at: at(1) }, { id: 'b', created_at: at(2) }]
  const once = mergeMessages([], page)
  const twice = mergeMessages(once, page)
  assert.deepEqual(twice, once)
})

test('дубль realtime-события не создаёт второй строки', () => {
  const evt = { id: 'x', created_at: at(3) }
  const list = mergeMessages([], [evt], [evt], [evt])
  assert.equal(list.length, 1)
})

test('более поздний источник перекрывает поля более раннего', () => {
  const history = [{ id: 'a', created_at: at(1), read_at: null, reactions: {} }]
  const update = [{ id: 'a', created_at: at(1), read_at: at(5) }]
  const [row] = mergeMessages(history, update)
  assert.equal(row.read_at, at(5))
  // Поле, которого в обновлении не было, сохраняется.
  assert.deepEqual(row.reactions, {})
})

test('порядок детерминирован при совпадении времени', () => {
  const same = [{ id: 'b', created_at: at(1) }, { id: 'a', created_at: at(1) }]
  assert.deepEqual(mergeMessages([], same).map((m) => m.id), ['a', 'b'])
  assert.deepEqual(mergeMessages([], [...same].reverse()).map((m) => m.id), ['a', 'b'])
})

test('догрузка более ранних страниц встаёт наверх, а не в конец', () => {
  const recent = [{ id: 'c', created_at: at(30) }]
  const older = [{ id: 'a', created_at: at(10) }, { id: 'b', created_at: at(20) }]
  assert.deepEqual(mergeMessages(recent, older).map((m) => m.id), ['a', 'b', 'c'])
})

// ── Подтверждение и сбой отправки ────────────────────────────────────────────
test('серверная строка занимает место временной, а не добавляется к ней', () => {
  const list = [{ id: 'temp-1', created_at: at(5), status: 'sending', text: 'привет' }]
  const next = settleMessage(list, 'temp-1', { id: 'real', created_at: at(5), text: 'привет' })
  assert.deepEqual(next.map((m) => m.id), ['real'])
  assert.equal(next[0].status, undefined)
})

test('если серверная строка уже приехала по realtime, дубля не возникает', () => {
  const list = [
    { id: 'real', created_at: at(5), text: 'привет' },     // прилетело раньше ответа
    { id: 'temp-1', created_at: at(5), status: 'sending' },
  ]
  const next = settleMessage(list, 'temp-1', { id: 'real', created_at: at(5), text: 'привет' })
  assert.deepEqual(next.map((m) => m.id), ['real'])
})

test('сбой сохраняет данные для повтора', () => {
  const list = [{ id: 'temp-1', created_at: at(5), status: 'sending' }]
  const next = failMessage(list, 'temp-1', { text: 'привет', file: null })
  assert.equal(next[0].status, 'failed')
  assert.deepEqual(next[0]._payload, { text: 'привет', file: null })
})

// ── Ключ идемпотентности ─────────────────────────────────────────────────────
test('ключ идемпотентности — валидный UUID и не повторяется', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const ids = new Set()
  for (let i = 0; i < 200; i++) {
    const id = newClientId()
    assert.match(id, re, `не UUID: ${id}`)
    ids.add(id)
  }
  assert.equal(ids.size, 200)
})

// Колонка client_id имеет тип uuid, поэтому запасной путь обязан отдавать
// именно UUID. У общего newId последний рубеж — «время + случайные хвосты»,
// и он этому требованию не отвечает; здесь проверяем, что подмена сработала.
const realCrypto = globalThis.crypto
const withCrypto = (value, fn) => {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true })
  try { fn() } finally {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true })
  }
}

test('без криптографии ключ всё равно остаётся UUID', () => {
  withCrypto(undefined, () => {
    const id = newClientId()
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

test('ключ берётся у crypto.randomUUID, когда он есть', () => {
  withCrypto({ randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, () => {
    assert.equal(newClientId(), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
})

test('временные идентификаторы отличимы от серверных', () => {
  assert.equal(isTempId('temp-abc'), true)
  assert.equal(isTempId('9f1c0c2a-0000-4000-8000-000000000000'), false)
  assert.equal(isTempId(undefined), false)
})

test('мусор во входных данных не роняет слияние', () => {
  const list = mergeMessages(null, undefined, [null, { id: null }, { id: 'a', created_at: 'не дата' }])
  assert.deepEqual(list.map((m) => m.id), ['a'])
})

// ─────────────────────────────────────────────────────────────────────────────
// Смена собеседника.
//
// Пока история ПЕРЕЗАПИСЫВАЛА список, открыть чат с другим человеком поверх
// уже открытого было безопасно случайно: чужие сообщения стирались заодно.
// Со слиянием эта случайная защита исчезла, и сброс стал обязательным —
// иначе переписки двух людей склеиваются в одну ленту. Тест фиксирует, что
// слияние само по себе НЕ разделяет собеседников: разделять обязан вызывающий.
// ─────────────────────────────────────────────────────────────────────────────
test('слияние не разделяет собеседников — это работа вызывающего', () => {
  const withAnna = [{ id: 'a1', created_at: at(10), sender: 'anna' }]
  const withBoris = [{ id: 'b1', created_at: at(20), sender: 'boris' }]
  const merged = mergeMessages(withAnna, withBoris)
  assert.equal(merged.length, 2,
    'mergeMessages складывает всё, что ей дали: ChatView обязан сбросить список при смене friend.id')
})

test('после сброса остаётся только новая переписка', () => {
  const withAnna = [{ id: 'a1', created_at: at(10), sender: 'anna' }]
  const withBoris = [{ id: 'b1', created_at: at(20), sender: 'boris' }]
  // Ровно то, что делает эффект: сначала [], потом слияние страницы.
  const afterReset = mergeMessages([], withBoris)
  assert.deepEqual(afterReset.map((m) => m.id), ['b1'])
  void withAnna
})
