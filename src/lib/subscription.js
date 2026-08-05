// Единый слой подписок для AI Assistant.
// Фронт знает только про тиры (FREE / AI / AI_PLUS). Соответствие тир→price_id
// живёт на бэке (api/stripe/_shared.js), поэтому Stripe-ключи в бандл не попадают.

export const TIER = Object.freeze({
  FREE: 'FREE',
  AI: 'AI',
  AI_PLUS: 'AI_PLUS',
})

export const STATUS = Object.freeze({
  INACTIVE: 'inactive',
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  UNPAID: 'unpaid',
})

export const PLANS = [
  {
    tier: TIER.AI,
    name: 'AI',
    priceLabel: '4,99 €',
    priceAmount: 499,
    currency: 'EUR',
    period: 'мес',
  },
  {
    tier: TIER.AI_PLUS,
    name: 'AI+',
    priceLabel: '8,99 €',
    priceAmount: 899,
    currency: 'EUR',
    period: 'мес',
  },
]

export function planByTier(tier) {
  return PLANS.find((p) => p.tier === tier) || null
}

export function defaultSubscription() {
  return {
    tier: TIER.FREE,
    status: STATUS.INACTIVE,
    currentPeriodEnd: null,
    provider: null,
    customerId: null,
    subscriptionId: null,
    cancelAtPeriodEnd: false,
  }
}

// Активный доступ к платным фичам. past_due держим включённым до канцела:
// пусть Stripe попробует списать ещё раз, а не отрубать пользователя мгновенно.
export function isActive(sub) {
  if (!sub) return false
  if (sub.tier === TIER.FREE) return false
  return sub.status === STATUS.ACTIVE || sub.status === STATUS.TRIALING || sub.status === STATUS.PAST_DUE
}

export function hasAI(sub) { return isActive(sub) }
export function hasAIPlus(sub) { return isActive(sub) && sub.tier === TIER.AI_PLUS }

// Оформление подписки: сервер создаёт Checkout Session, редиректим на Stripe.
// Возвращает { pending: true }; результат придёт по вебхуку в таблицу subscriptions,
// а фронт увидит его через Supabase Realtime и полл при возврате с ?checkout=success.
export async function checkout(tier, { session } = {}) {
  const token = session?.access_token
  if (!token) throw new Error('Требуется вход в аккаунт')

  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tier, returnUrl: window.location.origin }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || 'Не удалось начать оплату')

  window.location.href = data.url
  return { pending: true }
}

// Управление подпиской через Stripe Billing Portal (карта, апгрейд, отмена).
export async function openBillingPortal({ session } = {}) {
  const token = session?.access_token
  if (!token) throw new Error('Требуется вход в аккаунт')

  const res = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ returnUrl: window.location.origin }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || 'Не удалось открыть управление подпиской')

  window.location.href = data.url
  return { pending: true }
}

// Нормализуем строку из Supabase subscriptions → форма, которую держит стор.
export function subFromRow(row) {
  if (!row) return defaultSubscription()
  return {
    tier: row.tier || TIER.FREE,
    status: row.status || STATUS.INACTIVE,
    currentPeriodEnd: row.current_period_end || null,
    provider: 'stripe',
    customerId: row.stripe_customer_id || null,
    subscriptionId: row.stripe_subscription_id || null,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
  }
}
