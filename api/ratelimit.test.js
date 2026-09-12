// Ключ ограничения частоты — граница доверия: если его выбирает отправитель,
// лимита нет. Раньше так и было: ключом служил ЛЕВЫЙ элемент X-Forwarded-For,
// то есть та часть цепочки, которую клиент дописывает сам.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callerKey, rateLimit } from './_ratelimit.js'

const req = (headers) => ({ headers })

test('вошедший пользователь опознаётся по себе, а не по адресу', () => {
  // Иначе смена сети (Wi-Fi → мобильный) обнуляла бы счётчик.
  assert.equal(callerKey(req({ 'x-forwarded-for': '1.2.3.4' }), 'user-1'), 'user:user-1')
})

test('подделанный левый элемент X-Forwarded-For не даёт новой корзины', () => {
  // Клиент прислал свой адрес слева, доверенный узел дописал настоящий справа.
  // Ключ обязан строиться по ПРАВОМУ.
  const spoofed = req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })
  const spoofed2 = req({ 'x-forwarded-for': '8.8.8.8, 203.0.113.7' })
  assert.equal(callerKey(spoofed), 'ip:203.0.113.7')
  assert.equal(callerKey(spoofed), callerKey(spoofed2),
    'смена подделанного элемента дала другую корзину — лимит обходится заголовком')
})

test('одиночный адрес берётся как есть', () => {
  assert.equal(callerKey(req({ 'x-forwarded-for': '203.0.113.7' })), 'ip:203.0.113.7')
})

test('x-real-ip предпочитается списку', () => {
  assert.equal(
    callerKey(req({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '9.9.9.9, 1.1.1.1' })),
    'ip:203.0.113.9',
  )
})

test('без адреса все попадают в одну корзину, а не в безлимит', () => {
  assert.equal(callerKey(req({})), 'ip:unknown')
  assert.equal(callerKey(req({ 'x-forwarded-for': '   ' })), 'ip:unknown')
})

// ── Поведение при недоступном счётчике ───────────────────────────────────────
test('по умолчанию недоступный счётчик закрывает точку', async () => {
  // Для точки, которая пишет наружу (телеграм владельца), «не пропустить»
  // безопаснее, чем «пропустить без лимита».
  const saved = process.env.SUPABASE_URL
  delete process.env.SUPABASE_URL
  try {
    const r = await rateLimit({ bucket: 'test', key: 'k', limit: 1 })
    assert.equal(r.allowed, false, 'при отказе базы точка осталась открытой')
  } finally {
    if (saved) process.env.SUPABASE_URL = saved
  }
})

test('failOpen оставляет точку рабочей, когда это осознанный выбор', async () => {
  const saved = process.env.SUPABASE_URL
  delete process.env.SUPABASE_URL
  try {
    const r = await rateLimit({ bucket: 'test', key: 'k', limit: 1, failOpen: true })
    assert.equal(r.allowed, true)
  } finally {
    if (saved) process.env.SUPABASE_URL = saved
  }
})
