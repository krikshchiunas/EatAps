// ─────────────────────────────────────────────────────────────────────────────
// Вебхук Stripe: повторы, порядок доставки и отображение цены в тариф.
//
// Проверяется то, что уже один раз ломалось или могло сломаться молча:
//
//   • незаданная переменная цены выдавала ВЫСШИЙ тариф вместо FREE;
//   • переупорядоченная доставка оставляла живой тариф у отменённой подписки;
//   • повторная доставка проходила весь путь заново.
//
// Настоящего Stripe и настоящей базы в тестовом окружении нет, поэтому оба
// подменяются заглушками. Проверяется РЕШЕНИЕ обработчика (какой тариф, какой
// код ответа, сколько раз применено), а не работа чужих сервисов.
// ─────────────────────────────────────────────────────────────────────────────
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const ENV_KEYS = ['STRIPE_PRICE_AI', 'STRIPE_PRICE_AI_PLUS', 'STRIPE_PRICE_AI_PREMIUM']

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

// ── Отображение цены в тариф ─────────────────────────────────────────────────
test('незаданная цена не выдаёт высший тариф', async () => {
  process.env.STRIPE_PRICE_AI = 'price_ai'
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  // STRIPE_PRICE_AI_PREMIUM намеренно не задана — как в .env.example.
  const { tierForPrice, tierByPrice } = await import('./_shared.js')

  // Прежняя карта строилась вычисляемыми ключами, и незаданная переменная
  // давала ключ "undefined". Он не должен существовать вовсе.
  assert.ok(!Object.hasOwn(tierByPrice(), 'undefined'),
    'в карте есть ключ "undefined" — отказ определить цену выдаст тариф')

  assert.equal(tierForPrice(undefined), 'FREE')
  assert.equal(tierForPrice(null), 'FREE')
  assert.equal(tierForPrice(''), 'FREE')
  assert.equal(tierForPrice('price_unknown'), 'FREE')
  assert.equal(tierForPrice('price_ai'), 'AI')
  assert.equal(tierForPrice('price_plus'), 'AI_PLUS')
})

test('все цены заданы — тарифы определяются точно', async () => {
  process.env.STRIPE_PRICE_AI = 'price_ai'
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  process.env.STRIPE_PRICE_AI_PREMIUM = 'price_premium'
  const { tierForPrice } = await import('./_shared.js')
  assert.equal(tierForPrice('price_premium'), 'AI_PREMIUM')
  assert.equal(tierForPrice(undefined), 'FREE')
})

test('мёртвый статус закрывает платный доступ при любой цене', async () => {
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  const { tierForSubscription } = await import('./_shared.js')
  const sub = (status) => ({ status, items: { data: [{ price: { id: 'price_plus' } }] } })

  for (const live of ['active', 'trialing', 'past_due']) {
    assert.equal(tierForSubscription(sub(live)), 'AI_PLUS', `${live} должен давать доступ`)
  }
  for (const dead of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
    assert.equal(tierForSubscription(sub(dead)), 'FREE', `${dead} обязан закрывать доступ`)
  }
})

test('подписка без элементов не даёт тариф', async () => {
  process.env.STRIPE_PRICE_AI = 'price_ai'
  const { tierForSubscription } = await import('./_shared.js')
  assert.equal(tierForSubscription({ status: 'active', items: { data: [] } }), 'FREE')
  assert.equal(tierForSubscription({ status: 'active' }), 'FREE')
  assert.equal(tierForSubscription(null), 'FREE')
})

// ── Разбор события ───────────────────────────────────────────────────────────
test('идентификатор подписки достаётся из всех интересных событий', async () => {
  const { subscriptionIdFromEvent } = await import('./webhook.js')
  const cases = [
    ['checkout.session.completed', { subscription: 'sub_1' }, 'sub_1'],
    ['checkout.session.completed', { subscription: { id: 'sub_2' } }, 'sub_2'],
    ['customer.subscription.created', { id: 'sub_3' }, 'sub_3'],
    ['customer.subscription.updated', { id: 'sub_4' }, 'sub_4'],
    ['customer.subscription.deleted', { id: 'sub_5' }, 'sub_5'],
    ['customer.subscription.paused', { id: 'sub_6' }, 'sub_6'],
    ['invoice.payment_failed', { subscription: 'sub_7' }, 'sub_7'],
    // basil: ссылка на подписку переехала внутрь parent
    ['invoice.payment_failed', { parent: { subscription_details: { subscription: 'sub_8' } } }, 'sub_8'],
    ['invoice.payment_succeeded', { subscription: 'sub_9' }, 'sub_9'],
    ['customer.created', { id: 'cus_1' }, null],
    ['ping.unknown', {}, null],
  ]
  for (const [type, object, expected] of cases) {
    assert.equal(subscriptionIdFromEvent({ type, data: { object } }), expected, `${type}`)
  }
})

test('конец периода читается из обеих версий API', async () => {
  const { periodEndOf } = await import('./webhook.js')
  const ts = 1800000000
  assert.equal(periodEndOf({ current_period_end: ts }), new Date(ts * 1000).toISOString())
  assert.equal(periodEndOf({ items: { data: [{ current_period_end: ts }] } }), new Date(ts * 1000).toISOString())
  assert.equal(periodEndOf({}), null)
})

// ── Применение события: порядок и повторы ────────────────────────────────────
// Заглушка базы воспроизводит ровно то поведение, которое обеспечивает
// stripe_subscription_sync: более старое событие отбрасывается.
function fakeDb() {
  const state = { row: null, syncCalls: 0 }
  return {
    state,
    rpc: async (fn, args) => {
      if (fn !== 'stripe_subscription_sync') return { data: null, error: null }
      state.syncCalls++
      const prev = state.row
      const incoming = args.p_event_created
      const stale = prev?.last_event_created && incoming && incoming < prev.last_event_created
      if (stale) return { data: false, error: null }
      state.row = {
        tier: args.p_tier,
        status: args.p_status,
        last_event_created: incoming,
        last_event_id: args.p_event_id,
      }
      return { data: true, error: null }
    },
  }
}

const EARLY = '2026-09-01T10:00:00.000Z'
const LATE = '2026-09-01T12:00:00.000Z'

function eventOf(type, id, object) {
  return { id, type, data: { object } }
}

test('более старое событие не воскрешает отменённый тариф', async () => {
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  const { applyEvent } = await import('./webhook.js')
  const db = fakeDb()

  // Готовим модуль Stripe так, чтобы retrieve возвращал то, что мы зададим.
  const subs = {
    sub_x_late: { id: 'sub_x', status: 'canceled', customer: 'cus_1', items: { data: [] }, metadata: { user_id: 'u1' } },
    sub_x_early: { id: 'sub_x', status: 'active', customer: 'cus_1', metadata: { user_id: 'u1' }, items: { data: [{ price: { id: 'price_plus' } }] } },
  }

  let current = 'sub_x_late'
  const sdk = { subscriptions: { retrieve: async () => subs[current] } }

  // 1. Приходит ПОЗДНЕЕ событие: подписка отменена.
  current = 'sub_x_late'
  await applyEvent({ db, sdk, event: eventOf('customer.subscription.deleted', 'evt_late', { id: 'sub_x' }), eventCreated: LATE })
  assert.equal(db.state.row.tier, 'FREE', 'отмена не закрыла доступ')

  // 2. Следом приходит БОЛЕЕ РАННЕЕ событие с живой подпиской.
  current = 'sub_x_early'
  const res = await applyEvent({ db, sdk, event: eventOf('customer.subscription.updated', 'evt_early', { id: 'sub_x' }), eventCreated: EARLY })

  assert.equal(res.applied, false, 'устаревшее событие применено')
  assert.equal(db.state.row.tier, 'FREE', 'устаревшее событие воскресило платный тариф')
})

test('состояние берётся у Stripe, а не из тела события', async () => {
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  const { applyEvent } = await import('./webhook.js')
  // У Stripe подписка ОТМЕНЕНА…
  const sdk = { subscriptions: { retrieve: async () => ({
    id: 'sub_y', status: 'canceled', customer: 'cus_1', items: { data: [] }, metadata: { user_id: 'u1' },
  }) } }
  const db = fakeDb()
  // …а в теле события она «живая». Верить надо Stripe.
  await applyEvent({ db, sdk, event: eventOf('customer.subscription.updated', 'evt_1', {
    id: 'sub_y', status: 'active', items: { data: [{ price: { id: 'price_plus' } }] },
  }), eventCreated: LATE })
  assert.equal(db.state.row.tier, 'FREE',
    'тариф взят из тела события — переупорядоченная доставка сможет выдать доступ')
  assert.equal(db.state.row.status, 'canceled')
})

test('исчезнувшая в Stripe подписка закрывает доступ, а не роняет обработку', async () => {
  const { applyEvent } = await import('./webhook.js')
  const sdk = { subscriptions: { retrieve: async () => {
    const e = new Error('No such subscription')
    e.statusCode = 404
    e.code = 'resource_missing'
    throw e
  } } }
  const db = fakeDb()
  // Пользователь находится по клиенту, поэтому metadata не нужна — но и
  // клиента здесь нет: событие должно быть аккуратно пропущено.
  const res = await applyEvent({ db, sdk, event: eventOf('customer.subscription.deleted', 'evt_404', { id: 'sub_z' }), eventCreated: LATE })
  assert.equal(res.ignored, 'unknown user', 'подписка без владельца должна быть пропущена, а не применена')
})

test('недоступность Stripe помечается как временная — Stripe обязан повторить', async () => {
  const { applyEvent } = await import('./webhook.js')
  const sdk = { subscriptions: { retrieve: async () => { throw new Error('connection reset') } } }
  const db = fakeDb()
  await assert.rejects(
    () => applyEvent({ db, sdk, event: eventOf('customer.subscription.updated', 'evt_net', { id: 'sub_q' }), eventCreated: LATE }),
    (e) => e.transient === true,
    'сетевой сбой не помечен временным — событие потеряется навсегда',
  )
})

test('недоступность базы помечается как временная', async () => {
  process.env.STRIPE_PRICE_AI_PLUS = 'price_plus'
  const { applyEvent } = await import('./webhook.js')
  const sdk = { subscriptions: { retrieve: async () => ({
    id: 'sub_w', status: 'active', customer: 'cus_1', metadata: { user_id: 'u1' },
    items: { data: [{ price: { id: 'price_plus' } }] },
  }) } }
  const db = { rpc: async () => ({ data: null, error: { message: 'connection refused' } }) }
  await assert.rejects(
    () => applyEvent({ db, sdk, event: eventOf('customer.subscription.updated', 'evt_db', { id: 'sub_w' }), eventCreated: LATE }),
    (e) => e.transient === true,
    'отказ базы не помечен временным — подписка молча не обновится',
  )
})

test('неинтересное событие не трогает подписку', async () => {
  const { applyEvent } = await import('./webhook.js')
  const db = fakeDb()
  const res = await applyEvent({ db, sdk: null, event: eventOf('customer.created', 'evt_c', { id: 'cus_1' }), eventCreated: LATE })
  assert.equal(res.ignored, 'customer.created')
  assert.equal(db.state.syncCalls, 0, 'запись в подписку на постороннем событии')
})
