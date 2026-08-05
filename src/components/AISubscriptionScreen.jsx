import { useState } from 'react'
import { useStore } from '../store.jsx'
import { PLANS, TIER, isActive, hasAIPlus, planByTier } from '../lib/subscription.js'

// Заглушки-описания. Реальный текст владелец заменит в PLAN_COPY.
const PLAN_COPY = {
  [TIER.AI]: {
    tagline: 'Персональный AI-ассистент по питанию.',
    bullets: [
      'Распознаёт блюда и считает БЖУ',
      'Отвечает на вопросы о рационе',
      'Подсказывает, что съесть под ваши цели',
    ],
  },
  [TIER.AI_PLUS]: {
    tagline: 'Всё, что в AI, и глубокая аналитика.',
    bullets: [
      'Разбор недели и рекомендации',
      'Приоритетная скорость ответа',
      'Расширенные форматы и инсайты',
    ],
  },
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function AISubscriptionScreen({ onClose }) {
  const { subscription, purchaseSubscription, openSubscriptionPortal, user } = useStore()
  const active = isActive(subscription)

  return (
    <div className="screen">
      <div className="topbar">
        <button className="iconbtn" onClick={onClose} aria-label="Назад">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="eyebrow">AI-ассистент</div>
        <div style={{ width: 40 }} />
      </div>

      <h1 className="h1" style={{ margin: '4px 0 6px' }}>
        {active ? 'Ваш AI активен' : 'Умный помощник по питанию'}
      </h1>
      <p className="muted" style={{ fontSize: 15, marginBottom: 20 }}>
        {active
          ? 'Подписка открывает все AI-возможности EatAps.'
          : 'Выберите подписку, чтобы получить персональные подсказки и разбор рациона.'}
      </p>

      {active ? (
        <ActiveState
          subscription={subscription}
          onManage={openSubscriptionPortal}
          onUpgrade={() => purchaseSubscription(TIER.AI_PLUS)}
        />
      ) : (
        <PlansState onPurchase={purchaseSubscription} needsAuth={!user} />
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 22, textAlign: 'center' }}>
        Оплата раз в месяц. Отмена в любой момент.
      </p>
    </div>
  )
}

function PlansState({ onPurchase, needsAuth }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const handleBuy = async (tier) => {
    setError(null)
    if (needsAuth) {
      setError('Войдите в аккаунт, чтобы оформить подписку.')
      return
    }
    setBusy(tier)
    try {
      const res = await onPurchase(tier)
      // pending — редирект на Stripe, страница уже уходит; busy оставляем.
      if (res?.pending) return
      setBusy(null)
    } catch (e) {
      setError(e?.message || 'Не удалось начать оплату.')
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      {PLANS.map((plan) => (
        <PlanCard
          key={plan.tier}
          plan={plan}
          copy={PLAN_COPY[plan.tier]}
          busy={busy === plan.tier}
          disabled={Boolean(busy)}
          onBuy={() => handleBuy(plan.tier)}
        />
      ))}
      {error && (
        <div className="card" style={{ padding: 14, background: 'var(--surface-2)', color: 'var(--danger)', fontSize: 14 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function PlanCard({ plan, copy, busy, disabled, onBuy }) {
  const isPlus = plan.tier === TIER.AI_PLUS
  return (
    <div className={`plan-card ${isPlus ? 'plan-card--plus' : ''}`}>
      <div className="plan-card__head">
        <div className="plan-card__name">{plan.name}</div>
        {isPlus && <span className="plan-card__badge">Максимум</span>}
      </div>

      <div className="plan-card__price">
        <span className="plan-card__amount">{plan.priceLabel}</span>
        <span className="plan-card__period">/{plan.period}</span>
      </div>

      <p className="plan-card__tagline">{copy.tagline}</p>

      <ul className="plan-card__list">
        {copy.bullets.map((b) => (
          <li key={b}>
            <span className="plan-card__dot" aria-hidden />
            {b}
          </li>
        ))}
      </ul>

      <button
        className={`btn ${isPlus ? '' : 'ghost'}`}
        style={{ marginTop: 18 }}
        onClick={onBuy}
        disabled={disabled}
      >
        {busy ? 'Оформляем…' : `Подключить ${plan.name}`}
      </button>
    </div>
  )
}

function ActiveState({ subscription, onManage, onUpgrade }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const plan = planByTier(subscription.tier)
  const plus = hasAIPlus(subscription)

  const doManage = async () => {
    setError(null); setBusy('manage')
    try { await onManage(); return } catch (e) { setError(e?.message || 'Не удалось открыть портал.') }
    setBusy(null)
  }
  const doUpgrade = async () => {
    setError(null); setBusy('upgrade')
    try {
      const res = await onUpgrade()
      if (res?.pending) return
    } catch (e) { setError(e?.message || 'Не удалось начать оплату.') }
    setBusy(null)
  }

  return (
    <div className="stack">
      <div className="plan-card plan-card--active">
        <div className="plan-card__head">
          <div className="plan-card__name">{plan?.name || 'AI'}</div>
          <span className="plan-card__badge">
            {subscription.cancelAtPeriodEnd ? 'До конца периода' : 'Активна'}
          </span>
        </div>
        <div className="plan-card__price">
          <span className="plan-card__amount">{plan?.priceLabel}</span>
          <span className="plan-card__period">/{plan?.period}</span>
        </div>
        {subscription.currentPeriodEnd && (
          <p className="plan-card__tagline">
            {subscription.cancelAtPeriodEnd ? 'Доступ до ' : 'Следующее списание: '}
            {formatDate(subscription.currentPeriodEnd)}
          </p>
        )}
      </div>

      {!plus && (
        <div className="plan-card plan-card--plus">
          <div className="plan-card__head">
            <div className="plan-card__name">AI+</div>
            <span className="plan-card__badge">Апгрейд</span>
          </div>
          <div className="plan-card__price">
            <span className="plan-card__amount">{planByTier(TIER.AI_PLUS).priceLabel}</span>
            <span className="plan-card__period">/мес</span>
          </div>
          <p className="plan-card__tagline">{PLAN_COPY[TIER.AI_PLUS].tagline}</p>
          <button className="btn" style={{ marginTop: 14 }} disabled={busy === 'upgrade'} onClick={doUpgrade}>
            {busy === 'upgrade' ? 'Открываем оплату…' : 'Перейти на AI+'}
          </button>
        </div>
      )}

      <button className="btn ghost" disabled={busy === 'manage'} onClick={doManage}>
        {busy === 'manage' ? 'Открываем…' : 'Управление подпиской'}
      </button>

      {error && (
        <div className="card" style={{ padding: 14, background: 'var(--surface-2)', color: 'var(--danger)', fontSize: 14 }}>
          {error}
        </div>
      )}
    </div>
  )
}
