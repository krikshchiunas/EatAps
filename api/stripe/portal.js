import { stripe, admin, getUserFromRequest, safeOrigin } from './_shared.js'

// Stripe Billing Portal: пользователь сам меняет способ оплаты, апгрейд/даунгрейд
// плана и отмену подписки. Требует конфигурации Portal в Dashboard → Settings →
// Billing → Customer portal (иначе .create бросит ошибку).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const user = await getUserFromRequest(req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: sub } = await admin()
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'No customer' })

    const origin = safeOrigin(req, req.body?.returnUrl)
    const session = await stripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: origin,
    })
    return res.status(200).json({ url: session.url })
  } catch (e) {
    console.error('[stripe/portal] error', e)
    return res.status(500).json({ error: 'Portal failed' })
  }
}
