// Генератор идентификаторов обязан работать там, где нет crypto.randomUUID:
// Safari до 15.4 и любой незащищённый контекст (открыли приложение с телефона
// по http://192.168.x.x, чтобы проверить). Раньше прямое обращение бросало
// исключение прямо в обработчике «добавить продукт».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newId } from './uuid.js'

const realCrypto = globalThis.crypto

function withCrypto(value, fn) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true })
  try { fn() } finally {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true })
  }
}

const unique = (n, make) => new Set(Array.from({ length: n }, make)).size

test('использует crypto.randomUUID, когда он есть', () => {
  withCrypto({ randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, () => {
    assert.equal(newId(), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
})

test('без randomUUID собирает UUID v4 из getRandomValues', () => {
  withCrypto({ getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = i * 7 % 256; return b } }, () => {
    const id = newId()
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

test('без криптографии вообще всё равно выдаёт идентификатор', () => {
  withCrypto(undefined, () => {
    const id = newId()
    assert.equal(typeof id, 'string')
    assert.ok(id.length >= 12, 'слишком короткий: ' + id)
  })
})

test('бросающая криптография не роняет вызов', () => {
  withCrypto({ get randomUUID() { throw new Error('запрещено политикой') } }, () => {
    assert.doesNotThrow(() => newId())
  })
})

test('идентификаторы не повторяются ни в одном из режимов', () => {
  assert.equal(unique(500, newId), 500, 'штатный режим')
  withCrypto({ getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); return b } }, () => {
    assert.equal(unique(500, newId), 500, 'через getRandomValues')
  })
  withCrypto(undefined, () => {
    assert.equal(unique(500, newId), 500, 'запасной вариант без криптографии')
  })
})
