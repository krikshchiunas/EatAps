import { stripe, admin, PRICE_BY_TIER, getUserFromRequest, safeOrigin } from './_shared.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { tier, returnUrl } = req.body || {}
    const priceId = PRICE_BY_TIER[tier]
    if (!priceId) return res.status(400).json({ error: 'Unknown tier' })

    const user = await getUserFromRequest(req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const db = admin()

    // Достаём (или создаём) Stripe customer. Один customer на пользователя —
    // не плодим дубликатов при апгрейдах/переоформлениях.
    const { data: existing } = await db
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let customerId = existing?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: user.email || undefined,
        metadata: { user_id: user.id },
      })
      customerId = customer.id
      await db.from('subscriptions').upsert({
        user_id: user.id,
        tier: 'FREE',
        status: 'inactive',
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
    }

    const origin = safeOrigin(req, returnUrl)
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      client_reference_id: user.id,
      metadata: { user_id: user.id, tier },
      subscription_data: { metadata: { user_id: user.id, tier } },
      allow_promotion_codes: true,
    })

    return res.status(200).json({ url: session.url })
  } catch (e) {
    console.error('[stripe/checkout] error', e)
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
