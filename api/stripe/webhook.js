import { stripe, admin, TIER_BY_PRICE } from './_shared.js'

// Stripe требует ИМЕННО сырое тело для проверки подписи. Отключаем встроенный
// парсер Vercel и читаем поток сами.
export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function findUserByCustomer(customerId) {
  const { data } = await admin()
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.user_id || null
}

// Конец оплаченного периода. В API-версии 2025-03-31 (basil) и новее это поле
// у самой подписки убрали — оно переехало на элемент подписки. Читаем оба
// места, чтобы код не зависел от того, какая версия API вшита в SDK и какая
// настроена у вебхука: иначе current_period_end молча писался бы как NULL.
function periodEndOf(subscription) {
  const ts = subscription?.current_period_end
    ?? subscription?.items?.data?.[0]?.current_period_end
  return ts ? new Date(ts * 1000).toISOString() : null
}

// Ссылка на подписку в счёте — та же история: в basil поле invoice.subscription
// заменено на invoice.parent.subscription_details.subscription. Возвращаем id
// строкой (в part версий поле приходит развёрнутым объектом).
function subscriptionIdOf(invoice) {
  const raw = invoice?.subscription
    ?? invoice?.parent?.subscription_details?.subscription
  return typeof raw === 'string' ? raw : raw?.id || null
}

// Приводим Stripe-подписку к строке в нашей таблице. Если статус не «живой»
// (canceled/incomplete_expired/…) — тир сбрасываем в FREE, чтобы фронт закрыл
// доступ.
//
// eventAt — момент СОБЫТИЯ в Stripe, а не момент его обработки. Stripe не
// гарантирует порядок доставки и повторяет события при неответе, поэтому
// задержавшийся customer.subscription.updated со статусом active, пришедший
// после deleted, возвращал человеку платный доступ. Теперь строка обновляется,
// только если событие новее уже записанного.
async function upsertSubscription({ userId, customerId, subscription, eventAt }) {
  if (!userId) return
  const priceId = subscription?.items?.data?.[0]?.price?.id
  const mappedTier = TIER_BY_PRICE[priceId] || 'FREE'
  const liveStatuses = new Set(['active', 'trialing', 'past_due'])
  const tier = liveStatuses.has(subscription.status) ? mappedTier : 'FREE'
  const db = admin()

  const { data: current } = await db
    .from('subscriptions')
    .select('event_at')
    .eq('user_id', userId)
    .maybeSingle()

  // Строго «меньше»: событие с той же меткой — это тот же момент, и
  // переписывать по нему нечего.
  if (current?.event_at && eventAt && new Date(eventAt) < new Date(current.event_at)) {
    console.warn('[stripe/webhook] пропущено устаревшее событие', {
      userId, eventAt, current: current.event_at,
    })
    return
  }

  await db.from('subscriptions').upsert({
    user_id: userId,
    tier,
    status: subscription.status,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    current_period_end: periodEndOf(subscription),
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    event_at: eventAt,
    updated_at: new Date().toISOString(),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not set')
    return res.status(500).send('Webhook not configured')
  }

  let raw
  try { raw = await readRawBody(req) } catch (e) {
    return res.status(400).send('Cannot read body')
  }

  let event
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret)
  } catch (e) {
    console.error('[stripe/webhook] signature verify failed:', e.message)
    return res.status(400).send(`Webhook Error: ${e.message}`)
  }

  // Идемпотентность. Stripe повторяет доставку, пока не получит 200, — при
  // медленном ответе одно и то же событие приходит дважды и обрабатывалось
  // дважды. Журнал делает повтор безвредным: первичный ключ по event_id не даёт
  // вставить строку второй раз, и мы выходим до всякой записи.
  //
  // Отметка ставится ДО обработки: повторная доставка, пришедшая, пока первая
  // ещё выполняется, не должна пойти вторым потоком.
  const eventAt = event.created ? new Date(event.created * 1000).toISOString() : null
  try {
    const { error: dupErr } = await admin()
      .from('stripe_events')
      .insert({ event_id: event.id, type: event.type })
    if (dupErr) {
      if (dupErr.code === '23505') {
        return res.status(200).json({ received: true, duplicate: true })
      }
      // Журнал недоступен (не прогнана миграция) — обрабатываем как раньше.
      // Пропустить событие хуже: человек останется без оплаченного доступа.
      console.error('[stripe/webhook] журнал событий недоступен', dupErr.message)
    }
  } catch (e) {
    console.error('[stripe/webhook] журнал событий недоступен', e.message)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object
        const userId = s.client_reference_id || s.metadata?.user_id
        if (s.subscription) {
          const sub = await stripe().subscriptions.retrieve(s.subscription)
          await upsertSubscription({ userId, customerId: s.customer, subscription: sub, eventAt })
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        let userId = sub.metadata?.user_id
        if (!userId) userId = await findUserByCustomer(sub.customer)
        await upsertSubscription({ userId, customerId: sub.customer, subscription: sub, eventAt })
        break
      }
      case 'invoice.payment_failed': {
        const subId = subscriptionIdOf(event.data.object)
        if (subId) {
          const sub = await stripe().subscriptions.retrieve(subId)
          const userId = sub.metadata?.user_id || (await findUserByCustomer(sub.customer))
          await upsertSubscription({ userId, customerId: sub.customer, subscription: sub, eventAt })
        }
        break
      }
      default:
        break
    }
    return res.status(200).json({ received: true })
  } catch (e) {
    console.error('[stripe/webhook] handler error', e)
    // Отметку о событии снимаем: иначе повторная доставка от Stripe увидит её
    // в журнале и молча пропустит событие, которое на самом деле не обработано.
    try { await admin().from('stripe_events').delete().eq('event_id', event.id) } catch {}
    return res.status(500).json({ error: 'handler failed' })
  }
}
