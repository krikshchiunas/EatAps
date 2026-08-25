import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TIER, STATUS, TIER_RANK, bestTier, activeGrant, effectiveSubscription, defaultSubscription, isActive, hasAIPlus,
} from './subscription.js'

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString()
const grant = (tier, days, code = 'CODE') => ({ tier, granted_until: inDays(days), code })
const stripe = (tier, status = STATUS.ACTIVE) => ({ ...defaultSubscription(), tier, status })

test('порядок тарифов задан явно', () => {
  assert.ok(TIER_RANK[TIER.FREE] < TIER_RANK[TIER.AI])
  assert.ok(TIER_RANK[TIER.AI] < TIER_RANK[TIER.AI_PLUS])
})

test('bestTier выбирает старший и не падает на мусоре', () => {
  assert.equal(bestTier(TIER.FREE, TIER.AI), TIER.AI)
  assert.equal(bestTier(TIER.AI_PLUS, TIER.AI), TIER.AI_PLUS)
  assert.equal(bestTier(TIER.AI, TIER.AI), TIER.AI)
  assert.equal(bestTier(undefined, undefined), TIER.FREE)
  assert.equal(bestTier('МУСОР', TIER.AI), TIER.AI)
})

// ── Выдачи ───────────────────────────────────────────────────────────────────
test('просроченная выдача не действует', () => {
  assert.equal(activeGrant([grant(TIER.AI_PLUS, -1)]), null)
})

test('из двух действующих выигрывает старший тариф', () => {
  const g = activeGrant([grant(TIER.AI, 30, 'A'), grant(TIER.AI_PLUS, 5, 'B')])
  assert.equal(g.tier, TIER.AI_PLUS)
  assert.equal(g.code, 'B', 'даже если срок у него короче — тариф важнее')
})

test('при равном тарифе выигрывает более длинный срок', () => {
  const g = activeGrant([grant(TIER.AI, 5, 'A'), grant(TIER.AI, 40, 'B')])
  assert.equal(g.code, 'B')
})

test('мусор в списке выдач игнорируется', () => {
  assert.doesNotThrow(() => activeGrant([null, {}, { tier: 'AI' }, { granted_until: inDays(5) }]))
  assert.equal(activeGrant([null, {}]), null)
})

// ── Итоговый доступ ──────────────────────────────────────────────────────────
test('промокод открывает доступ там, где подписки нет', () => {
  const sub = effectiveSubscription(null, [grant(TIER.AI_PLUS, 30)])
  assert.equal(sub.tier, TIER.AI_PLUS)
  assert.ok(isActive(sub), 'иначе UI покажет платный экран поверх выданного доступа')
  assert.ok(hasAIPlus(sub))
  assert.equal(sub.via, 'promo')
})

test('оплаченный тариф не понижается более слабым промокодом', () => {
  const sub = effectiveSubscription(stripe(TIER.AI_PLUS), [grant(TIER.AI, 30)])
  assert.equal(sub.tier, TIER.AI_PLUS)
  assert.equal(sub.via, undefined, 'это по-прежнему подписка Stripe, а не промо')
})

test('промокод усиливает более слабую подписку', () => {
  const sub = effectiveSubscription(stripe(TIER.AI), [grant(TIER.AI_PLUS, 7)])
  assert.equal(sub.tier, TIER.AI_PLUS)
  assert.equal(sub.via, 'promo')
})

test('отменённая подписка Stripe не мешает промокоду', () => {
  // Вебхук при отмене ставит tier=FREE и статус canceled. Промокод обязан
  // продолжать действовать — он выдан независимо от оплаты.
  const sub = effectiveSubscription(stripe(TIER.FREE, STATUS.CANCELED), [grant(TIER.AI, 10)])
  assert.equal(sub.tier, TIER.AI)
  assert.ok(isActive(sub))
})

test('истёкший промокод возвращает человека на его настоящий тариф', () => {
  const sub = effectiveSubscription(stripe(TIER.FREE, STATUS.INACTIVE), [grant(TIER.AI_PLUS, -1)])
  assert.equal(sub.tier, TIER.FREE)
  assert.equal(isActive(sub), false)
})

test('срок промокода показывается как срок доступа, а не период оплаты', () => {
  const g = grant(TIER.AI_PLUS, 14)
  const sub = effectiveSubscription(stripe(TIER.FREE, STATUS.INACTIVE), [g])
  assert.equal(sub.currentPeriodEnd, g.granted_until)
  assert.equal(sub.promoUntil, g.granted_until)
  assert.equal(sub.promoCode, g.code)
})

test('без выдач подписка возвращается как есть', () => {
  const base = stripe(TIER.AI)
  assert.deepEqual(effectiveSubscription(base, []), base)
  assert.deepEqual(effectiveSubscription(base), base)
})

// ── applyPromo: устойчивость к сбою перечитывания ───────────────────────────
// Модель того, что делает store.jsx: гашение прошло, но повторное чтение
// список выдач вернуло не то (или пусто) из-за сетевого сбоя. Доступ обязан
// открыться немедленно, а не только после перезагрузки.
function mergeAfterRedeem(pulled, redeemedCode, redeemed) {
  const key = String(redeemedCode).trim().toUpperCase()
  const known = { code: key, tier: redeemed.tier, granted_until: redeemed.until }
  return pulled.some((g) => g.code === key) ? pulled : [...pulled, known]
}

test('перечитывание вернуло пусто — выданный доступ всё равно на месте', () => {
  const merged = mergeAfterRedeem([], 'eataps30', { tier: TIER.AI_PLUS, until: inDays(30) })
  const g = activeGrant(merged)
  assert.equal(g.tier, TIER.AI_PLUS)
})

test('перечитывание успело — дублей не появляется', () => {
  const fresh = [{ code: 'EATAPS30', tier: TIER.AI_PLUS, granted_until: inDays(30) }]
  const merged = mergeAfterRedeem(fresh, 'eataps30', { tier: TIER.AI_PLUS, until: inDays(29) })
  assert.equal(merged.length, 1, 'источник правды — то, что реально прочитано с сервера')
})

test('код нормализуется в верхний регистр так же, как на сервере', () => {
  const merged = mergeAfterRedeem([], '  eataps30 ', { tier: TIER.AI, until: inDays(10) })
  assert.equal(merged[0].code, 'EATAPS30')
})
