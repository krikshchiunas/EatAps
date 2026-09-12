// Оформление подписки: создаём (или находим) клиента Stripe и выдаём ссылку
// на страницу оплаты.
//
// ─────────────────────────────────────────────────────────────────────────────
// ГОНКА, КОТОРАЯ ЗДЕСЬ БЫЛА
//
// Прежний порядок: прочитать stripe_customer_id → если пусто, создать клиента
// → записать. Два одновременных нажатия «Оплатить» (двойной тап, две вкладки,
// повтор после таймаута) читали пустоту ОБА и создавали в Stripe ДВУХ
// клиентов. Второй затирал первого в базе, и подписка, оформленная на первого,
// оставалась висеть у клиента, о котором приложение больше не знало: вебхук по
// ней не находил пользователя, а портал управления открывался не туда.
//
// Защита двойная, и обе половины нужны:
//
//   1. КЛЮЧ ИДЕМПОТЕНТНОСТИ на стороне Stripe. Два запроса с одним ключом
//      создают один объект — второй получает копию первого, а не новый.
//      Ключ привязан к пользователю, поэтому у одного человека клиент ровно
//      один, сколько бы раз он ни нажал.
//
//   2. АТОМАРНАЯ ЗАПИСЬ на стороне базы (stripe_customer_claim): побеждает
//      первый записавший, остальным возвращается уже сохранённое значение.
//      Нужна потому, что ключи идемпотентности Stripe живут сутки, а гонка
//      возможна и позже — например, после ручной правки строки.
import { stripe, admin, priceByTier, getUserFromRequest, safeOrigin } from './_shared.js'
import { isAllowedOrigin } from './origin.js'
import { rateLimit, callerKey } from '../_ratelimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Заголовок Origin браузер ставит сам и подделать его со страницы нельзя.
  // Это не единственная защита (ниже требуется токен), а отсечка запросов с
  // чужих сайтов.
  const origin = req.headers.origin || req.headers.referer || ''
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const { tier, returnUrl } = req.body || {}
    const priceId = priceByTier()[tier]
    if (!priceId) return res.status(400).json({ error: 'Unknown tier' })

    const user = await getUserFromRequest(req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    // Каждая сессия оплаты — объект в Stripe, а первый вызов ещё и создаёт
    // клиента. Живому человеку десяти попыток в час хватает с запасом.
    // failOpen: true — недоступный счётчик не должен мешать людям платить.
    const limited = await rateLimit({
      bucket: 'stripe:checkout', key: callerKey(req, user.id),
      limit: 10, windowSeconds: 3600, failOpen: true,
    })
    if (!limited.allowed) {
      res.setHeader('Retry-After', String(limited.retryAfter))
      return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' })
    }

    const db = admin()

    const { data: existing, error: readErr } = await db
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (readErr) {
      console.error('[stripe/checkout] чтение подписки не удалось:', readErr.message)
      return res.status(503).json({ error: 'Try again later' })
    }

    let customerId = existing?.stripe_customer_id
    if (!customerId) {
      // Ключ идемпотентности привязан к пользователю: повторный вызов вернёт
      // ТОГО ЖЕ клиента, а не создаст второго.
      const customer = await stripe().customers.create(
        { email: user.email || undefined, metadata: { user_id: user.id } },
        { idempotencyKey: `eataps-customer-${user.id}` },
      )
      // Побеждает первый записавший; нам возвращается победившее значение.
      const { data: claimed, error: claimErr } = await db.rpc('stripe_customer_claim', {
        p_user_id: user.id,
        p_customer_id: customer.id,
      })
      if (claimErr) {
        console.error('[stripe/checkout] закрепление клиента не удалось:', claimErr.message)
        return res.status(503).json({ error: 'Try again later' })
      }
      customerId = claimed || customer.id
    }

    const origin_ = safeOrigin(req, returnUrl)
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin_}/?checkout=success`,
      cancel_url: `${origin_}/?checkout=cancel`,
      client_reference_id: user.id,
      metadata: { user_id: user.id, tier },
      subscription_data: { metadata: { user_id: user.id, tier } },
      allow_promotion_codes: true,
    })

    return res.status(200).json({ url: session.url })
  } catch (e) {
    // Наружу — обобщённо: сообщения Stripe содержат внутренние идентификаторы.
    console.error('[stripe/checkout] ошибка', e?.message)
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
