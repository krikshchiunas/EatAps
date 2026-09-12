// ─────────────────────────────────────────────────────────────────────────────
// Лимит AI: гонка, обрывы и повторный расчёт.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
//
// Прежний порядок «прочитать расход → решить → списать» не атомарен: сто
// одновременных запросов читали один и тот же остаток, все проходили проверку
// и все уходили в модель. Дневной лимит FREE — три запроса.
//
// Теперь решение принимает база внутри списания (ai_reserve). Настоящего
// Postgres в тестах нет, поэтому ниже стоит заглушка, ТОЧНО воспроизводящая
// его семантику: операции над счётчиком выполняются по одной (как под блокировкой
// строки), решение принимается по итогу ПОСЛЕ списания, не влезший резерв
// возвращается.
//
// Заглушка проверяет не Postgres, а КОНТРАКТ, на который рассчитывает код
// эндпоинта: что решение приходит из той же операции, что и списание.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callWithBudget, reserve, settle } from './_shared.js'

// Заглушка базы: повторяет ai_reserve / ai_settle из миграции 2026-09-12_ai_ledger.
function ledgerDb() {
  const usage = new Map()   // `${user}|${period}` → spent
  const requests = new Map() // requestId → { user, period, reserved, status }
  // Очередь сериализует операции — ровно то, что делает блокировка строки
  // ai_usage в Postgres: параллельные вызовы выстраиваются друг за другом.
  let chain = Promise.resolve()
  const serialize = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.then(() => {}, () => {})
    return next
  }

  const rpc = async (name, a) => serialize(async () => {
    // Небольшая асинхронная пауза внутри операции: без неё «параллельность»
    // теста была бы фиктивной.
    await Promise.resolve()

    if (name === 'ai_reserve') {
      const key = `${a.p_user_id}|${a.p_period}`
      if (requests.has(a.p_request_id)) {
        return { data: { ok: true, duplicate: true, spent: usage.get(key) || 0 }, error: null }
      }
      requests.set(a.p_request_id, {
        user: a.p_user_id, period: a.p_period, reserved: a.p_micro, status: 'reserved',
      })
      const after = (usage.get(key) || 0) + a.p_micro
      usage.set(key, after)
      if (a.p_budget != null && after > a.p_budget) {
        usage.set(key, after - a.p_micro)
        requests.get(a.p_request_id).status = 'denied'
        return { data: { ok: false, reason: 'exhausted', spent: usage.get(key) }, error: null }
      }
      return { data: { ok: true, spent: after, remaining: a.p_budget == null ? null : a.p_budget - after }, error: null }
    }

    if (name === 'ai_settle') {
      const row = requests.get(a.p_request_id)
      if (!row) return { data: { ok: false, reason: 'unknown_request' }, error: null }
      if (row.status !== 'reserved') return { data: { ok: true, duplicate: true }, error: null }
      const key = `${row.user}|${row.period}`
      const next = Math.max(0, (usage.get(key) || 0) + (a.p_actual_micro - row.reserved))
      usage.set(key, next)
      row.status = 'settled'
      return { data: { ok: true, spent: next }, error: null }
    }

    return { data: null, error: null }
  })

  return { rpc, usage, requests, spentOf: (u, p) => usage.get(`${u}|${p}`) || 0 }
}

const OK_RESPONSE = { content: [{ type: 'text', text: '{"reply":"ок"}' }], usage: { input_tokens: 100, output_tokens: 50 } }

// FREE: дневной лимит ≈ 16 666 микродолларов, один запрос ≈ 4 500 → 3 запроса.
const FREE_ARGS = {
  userId: 'u1', tier: 'FREE', kind: 'chat', model: 'claude-haiku-4-5',
  system: 's', messages: [{ role: 'user', content: 'привет' }],
  inputTokens: 1000, maxOutputTokens: 700,
}

test('сто одновременных запросов не проходят мимо дневного лимита', async () => {
  const db = ledgerDb()
  let modelCalls = 0
  const call = async () => { modelCalls++; return OK_RESPONSE }

  const results = await Promise.all(
    Array.from({ length: 100 }, () => callWithBudget({ ...FREE_ARGS, db, call })),
  )

  const allowed = results.filter((r) => !r.denied).length
  const denied = results.filter((r) => r.denied === 'exhausted').length

  assert.equal(allowed + denied, 100, 'часть запросов завершилась непонятно чем')
  assert.ok(allowed > 0, 'не прошёл ни один запрос — лимит слишком строг')
  assert.ok(allowed <= 4,
    `сквозь дневной лимит прошло ${allowed} запросов вместо 3-4 — гонка не закрыта`)
  assert.equal(modelCalls, allowed, 'модель вызвана не столько раз, сколько разрешено')
})

test('последовательные запросы упираются в тот же предел', async () => {
  const db = ledgerDb()
  let modelCalls = 0
  const call = async () => { modelCalls++; return OK_RESPONSE }

  let allowed = 0
  for (let i = 0; i < 20; i++) {
    const r = await callWithBudget({ ...FREE_ARGS, db, call })
    if (!r.denied) allowed++
  }
  // Расчёт по факту возвращает неизрасходованное, поэтому последовательных
  // запросов проходит БОЛЬШЕ, чем параллельных, — и это правильно: человек
  // платит за то, что реально потратил.
  assert.ok(allowed >= 3, `последовательно прошло всего ${allowed}`)
  assert.equal(modelCalls, allowed)
  const [key] = [...db.usage.keys()]
  assert.ok(db.usage.get(key) > 0, 'расход не записан вовсе')
})

test('безлимитный тариф не ограничивается', async () => {
  const db = ledgerDb()
  const call = async () => OK_RESPONSE
  const results = await Promise.all(
    Array.from({ length: 30 }, () => callWithBudget({ ...FREE_ARGS, tier: 'AI_PLUS', db, call })),
  )
  assert.equal(results.filter((r) => r.denied).length, 0, 'безлимитный тариф получил отказ')
})

test('ошибка модели возвращает резерв, а не съедает его', async () => {
  const db = ledgerDb()
  const call = async () => { const e = new Error('529'); e.status = 529; e.usage = null; throw e }

  await assert.rejects(() => callWithBudget({ ...FREE_ARGS, db, call }))

  const [key] = [...db.usage.keys()]
  assert.equal(db.usage.get(key), 0,
    'после ошибки модели резерв остался списанным — человек теряет лимит за чужой сбой')
})

test('сгоревшие при ошибке токены остаются списанными', async () => {
  const db = ledgerDb()
  // Модель успела посчитать вход и упасть на выдаче: за вход платит пользователь.
  const call = async () => {
    const e = new Error('500')
    e.status = 500
    e.usage = { input_tokens: 1000, output_tokens: 0 }
    throw e
  }
  await assert.rejects(() => callWithBudget({ ...FREE_ARGS, db, call }))
  const key = [...db.usage.keys()][0]
  assert.equal(db.usage.get(key), 1000, 'сгоревший вход не списан — обрыв станет способом обойти лимит')
})

test('повторный расчёт по одному запросу не возвращает лимит дважды', async () => {
  const db = ledgerDb()
  const period = '2026-09-12'
  await reserve({ requestId: 'r1', userId: 'u9', period, micro: 5000, budget: 100000, db })
  assert.equal(db.spentOf('u9', period), 5000)

  await settle({ requestId: 'r1', actualMicro: 1000, db })
  assert.equal(db.spentOf('u9', period), 1000, 'первый расчёт не применён')

  // Повтор (ретрай, гонка, двойная доставка) обязан ничего не менять.
  await settle({ requestId: 'r1', actualMicro: 1000, db })
  await settle({ requestId: 'r1', actualMicro: 1000, db })
  assert.equal(db.spentOf('u9', period), 1000,
    'повторный расчёт списал ещё раз — лимит можно было бы восстанавливать бесконечно')
})

test('повторный резерв с тем же идентификатором не списывает дважды', async () => {
  const db = ledgerDb()
  const period = '2026-09-12'
  await reserve({ requestId: 'r2', userId: 'u8', period, micro: 4000, budget: 100000, db })
  const again = await reserve({ requestId: 'r2', userId: 'u8', period, micro: 4000, budget: 100000, db })
  assert.equal(again.duplicate, true)
  assert.equal(db.spentOf('u8', period), 4000, 'повтор заявки списал второй раз')
})

test('недоступный учёт закрывает доступ, а не открывает', async () => {
  const failing = { rpc: async () => ({ data: null, error: { message: 'connection refused' } }) }
  let modelCalls = 0
  const call = async () => { modelCalls++; return OK_RESPONSE }
  const r = await callWithBudget({ ...FREE_ARGS, db: failing, call })
  assert.equal(r.denied, 'unavailable')
  assert.equal(modelCalls, 0, 'модель вызвана при недоступном учёте — расход пошёл бы мимо лимита')
})

test('отказ по лимиту не доходит до модели', async () => {
  const db = ledgerDb()
  let modelCalls = 0
  const call = async () => { modelCalls++; return OK_RESPONSE }
  // Выбираем лимит целиком.
  for (let i = 0; i < 10; i++) await callWithBudget({ ...FREE_ARGS, db, call })
  const before = modelCalls
  const r = await callWithBudget({ ...FREE_ARGS, db, call })
  if (r.denied === 'exhausted') {
    assert.equal(modelCalls, before, 'при отказе по лимиту модель всё равно вызвана')
  }
})
