// Единый слой подписок для AI Assistant.
// Фронт знает только про тиры (FREE / AI / AI_PLUS). Соответствие тир→price_id
// живёт на бэке (api/stripe/_shared.js), поэтому Stripe-ключи в бандл не попадают.

export const TIER = Object.freeze({
  FREE: 'FREE',
  AI: 'AI',
  AI_PLUS: 'AI_PLUS',
  AI_PREMIUM: 'AI_PREMIUM',
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
    name: 'Carrot+',
    priceLabel: '7,99 €',
    priceAmount: 799,
    currency: 'EUR',
    period: 'мес',
  },
  {
    tier: TIER.AI_PLUS,
    name: 'Carrot Pro',
    priceLabel: '12,99 €',
    priceAmount: 1299,
    currency: 'EUR',
    period: 'мес',
  },
  {
    tier: TIER.AI_PREMIUM,
    name: 'Carrot Premium',
    priceLabel: '24,99 €',
    priceAmount: 2499,
    currency: 'EUR',
    period: 'мес',
  },
]

// ── Промокоды ────────────────────────────────────────────────────────────────
// Источников доступа два и они независимы: Stripe (таблица subscriptions) и
// промокод (promo_grants). Складывать их в одну строку нельзя — вебхук Stripe
// перезаписывает свою строку целиком и стёр бы выданный доступ. Поэтому
// действующий тариф считается здесь, в одном месте на весь проект.
export const TIER_RANK = Object.freeze({ [TIER.FREE]: 0, [TIER.AI]: 1, [TIER.AI_PLUS]: 2, [TIER.AI_PREMIUM]: 3 })

export function bestTier(a, b) {
  return (TIER_RANK[b] ?? 0) > (TIER_RANK[a] ?? 0) ? b : (a || TIER.FREE)
}

// Действующая выдача по промокоду: лучший тариф среди непросроченных.
// Если у человека два кода, побеждает старший тариф, а срок берётся его.
export function activeGrant(grants = [], now = Date.now()) {
  let best = null
  for (const g of grants) {
    if (!g?.tier || !g?.granted_until) continue
    if (new Date(g.granted_until).getTime() <= now) continue
    if (!best || TIER_RANK[g.tier] > TIER_RANK[best.tier]) best = g
    else if (TIER_RANK[g.tier] === TIER_RANK[best.tier]
             && new Date(g.granted_until) > new Date(best.granted_until)) best = g
  }
  return best
}

// Итоговая подписка для UI и лимитов: Stripe плюс промокод, побеждает лучшее.
// Тир, выданный кодом, помечаем via: 'promo' — чтобы экран не предлагал
// «управление подпиской» там, где никакой подписки в Stripe нет.
export function effectiveSubscription(stripeSub, grants = [], now = Date.now()) {
  const base = stripeSub || defaultSubscription()
  const grant = activeGrant(grants, now)
  if (!grant) return base

  const stripeTier = isActive(base) ? base.tier : TIER.FREE
  if (TIER_RANK[grant.tier] <= TIER_RANK[stripeTier]) return base

  return {
    ...base,
    tier: grant.tier,
    status: STATUS.ACTIVE,
    via: 'promo',
    promoCode: grant.code,
    promoUntil: grant.granted_until,
    // Оплаченный период Stripe тут ни при чём — показываем срок промокода.
    currentPeriodEnd: grant.granted_until,
  }
}

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
export function hasAIPlus(sub) { return isActive(sub) && (sub.tier === TIER.AI_PLUS || sub.tier === TIER.AI_PREMIUM) }
export function hasAIPremium(sub) { return isActive(sub) && sub.tier === TIER.AI_PREMIUM }

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
