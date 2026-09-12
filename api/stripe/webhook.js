// Вебхук Stripe.
//
// ─────────────────────────────────────────────────────────────────────────────
// ТРИ СВОЙСТВА, КОТОРЫЕ ЗДЕСЬ ОБЯЗАНЫ ВЫПОЛНЯТЬСЯ
//
//   1. ПОДЛИННОСТЬ. Тело запроса проверяется подписью Stripe. Без этого адрес
//      вебхука — публичная кнопка «выдать себе подписку».
//
//   2. ИДЕМПОТЕНТНОСТЬ. Stripe повторяет доставку, пока не получит 2xx.
//      Одно и то же событие обязано примениться один раз.
//
//   3. УСТОЙЧИВОСТЬ К ПОРЯДКУ. Stripe прямо предупреждает, что порядок
//      доставки не гарантирован. Раньше обработчик слепо писал в базу
//      состояние из тела события, и пара «updated (active) → deleted
//      (canceled)», пришедшая наоборот, оставляла живой тариф у отменённой
//      подписки.
//
// Как выполняется третье: тело события НЕ считается истиной о подписке.
// Из него берётся только идентификатор, а состояние ЗАПРАШИВАЕТСЯ у Stripe —
// оттуда всегда приходит текущее. Плюс запись в базу защищена временем
// события (stripe_subscription_sync), поэтому даже два одновременных
// экземпляра функции не могут применить более старое поверх более нового.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ОТВЕЧАЕМ STRIPE
//
//   200 — событие применено, было применено раньше или неинтересно нам.
//   400 — подпись не сошлась либо тело не читается. Повтор не поможет.
//   500 — временный отказ (Stripe недоступен, база недоступна). ПУСТЬ ПОВТОРИТ.
//
// Разница между 200 и 500 здесь существенная: ответить 200 на временный сбой
// значит потерять событие навсегда, а ответить 500 на неинтересное событие
// значит получить бесконечный цикл повторов.
import {
  stripe, admin, getStripeUserId, tierForSubscription, LIVE_STATUSES,
} from './_shared.js'

// Stripe требует ИМЕННО сырое тело для проверки подписи. Отключаем встроенный
// парсер Vercel и читаем поток сами.
export const config = { api: { bodyParser: false } }

// Потолок на размер тела: без него единственный запрос может съесть память
// функции. Настоящее событие Stripe на порядки меньше.
const MAX_BODY_BYTES = 1024 * 1024

async function readRawBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

// Конец оплаченного периода. В API-версии 2025-03-31 (basil) и новее это поле
// у самой подписки убрали — оно переехало на элемент подписки. Читаем оба
// места, чтобы код не зависел от того, какая версия API вшита в SDK.
function periodEndOf(subscription) {
  const ts = subscription?.current_period_end
    ?? subscription?.items?.data?.[0]?.current_period_end
  return ts ? new Date(ts * 1000).toISOString() : null
}

// Ссылка на подписку в счёте — та же история: в basil поле invoice.subscription
// заменено на invoice.parent.subscription_details.subscription.
function subscriptionIdOf(invoice) {
  const raw = invoice?.subscription
    ?? invoice?.parent?.subscription_details?.subscription
  return typeof raw === 'string' ? raw : raw?.id || null
}

// Из события достаём ТОЛЬКО идентификатор подписки. Состояние возьмём у Stripe.
function subscriptionIdFromEvent(event) {
  const o = event.data?.object
  switch (event.type) {
    case 'checkout.session.completed':
      return typeof o?.subscription === 'string' ? o.subscription : o?.subscription?.id || null
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end':
      return o?.id || null
    case 'invoice.payment_failed':
    case 'invoice.payment_succeeded':
    case 'invoice.paid':
      return subscriptionIdOf(o)
    default:
      return null
  }
}

// Кому принадлежит подписка. Метаданные ставит наш же checkout, поэтому им
// можно верить; если их нет — ищем по идентификатору клиента в своей базе.
async function resolveUserId(db, event, subscription) {
  const o = event.data?.object
  const fromSession = event.type === 'checkout.session.completed'
    ? (o?.client_reference_id || o?.metadata?.user_id)
    : null
  const direct = fromSession || subscription?.metadata?.user_id
  if (direct) return direct

  const customerId = typeof subscription?.customer === 'string'
    ? subscription.customer
    : subscription?.customer?.id
  return customerId ? getStripeUserId(customerId, db) : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET не задан')
    return res.status(500).send('Webhook not configured')
  }

  const sig = req.headers['stripe-signature']
  if (!sig) return res.status(400).send('Missing signature')

  let raw
  try {
    raw = await readRawBody(req)
  } catch (e) {
    console.error('[stripe/webhook] тело не прочитано:', e.message)
    return res.status(400).send('Cannot read body')
  }

  let event
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret)
  } catch (e) {
    // Наружу не пересказываем сообщение библиотеки: оно описывает внутренности
    // проверки подписи и подсказывает, как её обходить.
    console.error('[stripe/webhook] подпись не сошлась:', e.message)
    return res.status(400).send('Invalid signature')
  }

  const db = admin()
  const eventCreated = event.created ? new Date(event.created * 1000).toISOString() : null

  // ── Заявка на обработку ────────────────────────────────────────────────────
  let claim
  try {
    const { data, error } = await db.rpc('stripe_event_claim', {
      p_event_id: event.id,
      p_event_type: event.type,
      p_created: eventCreated,
    })
    if (error) throw new Error(error.message)
    claim = data
  } catch (e) {
    // Журнал недоступен — обрабатывать нельзя: без него идемпотентности нет.
    // Просим Stripe повторить.
    console.error('[stripe/webhook] журнал событий недоступен:', e.message)
    return res.status(500).json({ error: 'event log unavailable' })
  }

  if (claim === 'duplicate') {
    return res.status(200).json({ received: true, duplicate: true })
  }

  // ── Обработка ──────────────────────────────────────────────────────────────
  try {
    const result = await applyEvent({ db, sdk: stripe(), event, eventCreated })
    await db.rpc('stripe_event_finish', { p_event_id: event.id, p_ok: true, p_error: null })
    return res.status(200).json({ received: true, ...result })
  } catch (e) {
    const transient = e?.transient === true
    await db.rpc('stripe_event_finish', {
      p_event_id: event.id, p_ok: false, p_error: e?.message || 'unknown',
    }).catch(() => {})
    console.error('[stripe/webhook] обработка не удалась', {
      eventId: event.id, type: event.type, transient, message: e?.message,
    })
    // Временный сбой — пусть Stripe повторит. Постоянный (событие про чужого
    // клиента, неизвестная форма данных) повторять бессмысленно.
    return transient
      ? res.status(500).json({ error: 'retry later' })
      : res.status(200).json({ received: true, skipped: true })
  }
}

function transientError(message) {
  const err = new Error(message)
  err.transient = true
  return err
}

// Клиент Stripe и клиент базы приходят ПАРАМЕТРАМИ, а не берутся из модуля.
// Так эту функцию можно прогнать тестом на любых сценариях доставки, не
// подменяя экспорты модуля (в ES-модулях они неизменяемы) и не поднимая
// настоящий Stripe.
async function applyEvent({ db, sdk, event, eventCreated }) {
  const subId = subscriptionIdFromEvent(event)
  if (!subId) return { ignored: event.type }

  // Состояние берём У STRIPE, а не из тела события: только так переупорядоченная
  // доставка не может записать устаревшее состояние.
  let subscription
  try {
    subscription = await sdk.subscriptions.retrieve(subId)
  } catch (e) {
    // 404 — подписки больше нет: считаем её отменённой и закрываем доступ.
    // Это не временный сбой, а нормальный исход для удалённой подписки.
    if (e?.statusCode === 404 || e?.code === 'resource_missing') {
      subscription = { id: subId, status: 'canceled', items: { data: [] } }
    } else {
      throw transientError(`Stripe недоступен: ${e?.message || 'неизвестно'}`)
    }
  }

  const userId = await resolveUserId(db, event, subscription)
  if (!userId) {
    // Подписка не наша (или клиент удалён из базы). Повторять нечего.
    return { ignored: 'unknown user' }
  }

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id || null

  const tier = tierForSubscription(subscription)

  const { data, error } = await db.rpc('stripe_subscription_sync', {
    p_user_id: userId,
    p_tier: tier,
    p_status: subscription.status || 'inactive',
    p_customer_id: customerId,
    p_subscription_id: subscription.id || null,
    p_current_period_end: periodEndOf(subscription),
    p_cancel_at_period_end: !!subscription.cancel_at_period_end,
    p_event_created: eventCreated,
    p_event_id: event.id,
  })
  if (error) throw transientError(`база недоступна: ${error.message}`)

  // false означает «событие старше уже применённого» — это штатный исход,
  // а не ошибка: отвечаем Stripe успехом, чтобы он не повторял вечно.
  return data === false
    ? { applied: false, reason: 'stale event' }
    : { applied: true, tier, status: subscription.status }
}

export { subscriptionIdFromEvent, periodEndOf, subscriptionIdOf, applyEvent, LIVE_STATUSES }
