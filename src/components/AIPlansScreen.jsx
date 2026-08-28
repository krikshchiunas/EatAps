import { useState } from 'react'
import { useStore } from '../store.jsx'
import { PLANS, TIER } from '../lib/subscription.js'
import PromoRedeemForm from './PromoRedeemForm.jsx'

const PLAN_COPY = {
  [TIER.AI]: {
    tagline: 'Больше запросов к ассистенту каждый месяц.',
    bullets: [
      'Фото еды, разбор дневника, ответы на вопросы',
      'История за неделю — ассистент видит ваши паттерны',
      'Разбор дневника за период',
    ],
  },
  [TIER.AI_PLUS]: {
    tagline: 'Больше запросов и умная модель.',
    bullets: [
      'Более умная модель — точнее распознаёт блюда по фото',
      'История за 30 дней и долгая память о ваших привычках',
      'Больше запросов в месяц',
    ],
  },
  [TIER.AI_PREMIUM]: {
    tagline: 'Максимум без ограничений.',
    bullets: [
      'Самая умная модель и максимальный контекст',
      'История за 90 дней и глубокая память о привычках',
      'Без месячного лимита запросов',
    ],
  },
}

export default function AIPlansScreen({ onClose }) {
  const { purchaseSubscription, user } = useStore()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const handleBuy = async (tier) => {
    setError(null)
    if (!user) {
      setError('Войдите в аккаунт, чтобы оформить подписку.')
      return
    }
    setBusy(tier)
    try {
      const res = await purchaseSubscription(tier)
      // pending — редирект на Stripe уже начался, страница уходит.
      if (res?.pending) return
      setBusy(null)
    } catch (e) {
      setError(e?.message || 'Не удалось начать оплату.')
      setBusy(null)
    }
  }

  return (
    <div className="screen ai-plans">
      {onClose && (
        <button className="iconbtn" onClick={onClose} aria-label="Назад" style={{ fontSize: 22, marginBottom: 8 }}>‹</button>
      )}
      <div className="eyebrow ai-plans__eyebrow">🥕 Carrot</div>

      <div className="ai-hero">
        <div className="ai-hero__orb" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
            <path d="M12 3l1.9 5.1 5.1 1.9-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
            <path d="M19 15l.9 2.4 2.4.9-2.4.9L19 21.6l-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
          </svg>
        </div>
        <h1 className="h1 ai-hero__title">Умный помощник<br/>по питанию</h1>
        <p className="ai-hero__sub">Выберите тариф — и получите персональные подсказки, разбор рациона и быстрый счёт БЖУ прямо в EatAps.</p>
      </div>

      <div className="ai-plans__list">
        {PLANS.map((plan, i) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            copy={PLAN_COPY[plan.tier]}
            index={i}
            busy={busy === plan.tier}
            disabled={Boolean(busy)}
            onBuy={() => handleBuy(plan.tier)}
          />
        ))}
      </div>

      {error && (
        <div className="ai-error" role="alert">{error}</div>
      )}

      <PromoRedeemForm />

      <p className="ai-plans__foot">Оплата раз в месяц. Отмена в любой момент.</p>
    </div>
  )
}

function PlanCard({ plan, copy, index, busy, disabled, onBuy }) {
  const isHighlighted = plan.tier === TIER.AI_PLUS
  const isPremium = plan.tier === TIER.AI_PREMIUM
  return (
    <article
      className={`ai-card ${isHighlighted ? 'ai-card--plus' : ''} ${isPremium ? 'ai-card--premium' : ''}`}
      style={{ animationDelay: `${80 + index * 90}ms` }}
    >
      {(isHighlighted || isPremium) && <div className="ai-card__glow" aria-hidden />}
      <div className="ai-card__body">
        <div className="ai-card__head">
          <div className="ai-card__name">{plan.name}</div>
          {isHighlighted && <span className="ai-card__badge">Popular</span>}
          {isPremium && <span className="ai-card__badge">Max</span>}
        </div>

        <div className="ai-card__price">
          <span className="ai-card__amount">{plan.priceLabel}</span>
          <span className="ai-card__period">/{plan.period}</span>
        </div>

        <p className="ai-card__tagline">{copy.tagline}</p>

        <ul className="ai-card__list">
          {copy.bullets.map((b) => (
            <li key={b}>
              <span className="ai-card__dot" aria-hidden />
              {b}
            </li>
          ))}
        </ul>

        <button
          className={`btn ai-card__cta ${isHighlighted || isPremium ? '' : 'ghost'}`}
          onClick={onBuy}
          disabled={disabled}
        >
          {busy ? 'Открываем оплату…' : 'Оформить'}
        </button>
      </div>
    </article>
  )
}
