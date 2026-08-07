// Нормализация ошибок: правильная категория решает, что приложение сделает —
// повторит, попросит войти заново или просто покажет текст. И наружу не должно
// утекать ничего технического.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ERR, normalizeError, isFatalSessionError, ruAuthError } from './authErrors.js'

const cat = (err) => normalizeError(err).category

test('ошибки входа распознаются и переводятся', () => {
  assert.equal(cat({ message: 'Invalid login credentials' }), ERR.AUTH)
  assert.equal(normalizeError({ message: 'Invalid login credentials' }).message, 'Неверный email или пароль')
  assert.equal(cat({ message: 'Email not confirmed' }), ERR.AUTH)
  assert.equal(cat({ message: 'User already registered' }), ERR.VALIDATION)
})

test('мёртвая сессия отличается от прочих ошибок авторизации', () => {
  const dead = { message: 'Invalid Refresh Token: Already Used' }
  assert.equal(cat(dead), ERR.SESSION)
  assert.equal(isFatalSessionError(dead), true)
  // Неверный пароль сессию не убивает — выкидывать человека из аккаунта нельзя.
  assert.equal(isFatalSessionError({ message: 'Invalid login credentials' }), false)
  assert.equal(isFatalSessionError({ message: 'Failed to fetch' }), false)
})

test('сетевые и временные сбои помечены как повторяемые', () => {
  for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch', 'Load failed']) {
    const n = normalizeError({ message: m })
    assert.equal(n.category, ERR.NETWORK)
    assert.equal(n.retryable, true)
  }
  assert.equal(normalizeError({ status: 503 }).retryable, true)
  assert.equal(normalizeError({ status: 429 }).category, ERR.RATE_LIMIT)
  assert.equal(normalizeError({ message: 'request timed out' }).category, ERR.TIMEOUT)
})

test('ошибка прав распознаётся, но пользователю не показывают слово RLS', () => {
  const n = normalizeError({ message: 'new row violates row-level security policy for table "app_state"' })
  assert.equal(n.category, ERR.PERMISSION)
  assert.ok(!/row-level|policy|app_state|RLS/i.test(n.message))
})

test('наружу не утекают названия таблиц, JWT и коды', () => {
  const leaky = [
    { message: 'JWT expired', status: 401 },
    { message: 'permission denied for table profiles', code: '42501' },
    { message: 'duplicate key value violates unique constraint "app_state_pkey"' },
    { message: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret' },
  ]
  for (const err of leaky) {
    const text = normalizeError(err).message
    assert.ok(!/jwt|eyJ|table|pkey|constraint|42501/i.test(text), `утечка в тексте: ${text}`)
  }
})

test('неизвестная ошибка не предлагает бесконечный повтор', () => {
  const n = normalizeError({ message: 'нечто небывалое' })
  assert.equal(n.category, ERR.UNKNOWN)
  assert.equal(n.retryable, false)
  assert.ok(n.message.length > 0)
})

test('пустой вход не роняет нормализацию', () => {
  for (const v of [null, undefined, '', 0, {}, new Error()]) {
    const n = normalizeError(v)
    assert.equal(typeof n.message, 'string')
    assert.ok(n.message.length > 0)
  }
})

test('ruAuthError остаётся совместимым со старым вызовом по строке', () => {
  assert.equal(ruAuthError('Invalid login credentials'), 'Неверный email или пароль')
  assert.equal(typeof ruAuthError(''), 'string')
})
