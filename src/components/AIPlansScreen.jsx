import { useState } from 'react'
import { useStore } from '../store.jsx'
import { PLANS, TIER } from '../lib/subscription.js'

// Заглушки-описания. Владелец приложения заменит текст в PLAN_COPY.
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

export default function AIPlansScreen() {
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
      <div className="eyebrow ai-plans__eyebrow">AI-ассистент</div>

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

      <p className="ai-plans__foot">Оплата раз в месяц. Отмена в любой момент.</p>
    </div>
  )
}

function PlanCard({ plan, copy, index, busy, disabled, onBuy }) {
  const isPlus = plan.tier === TIER.AI_PLUS
  return (
    <article
      className={`ai-card ${isPlus ? 'ai-card--plus' : ''}`}
      style={{ animationDelay: `${80 + index * 90}ms` }}
    >
      {isPlus && <div className="ai-card__glow" aria-hidden />}
      <div className="ai-card__body">
        <div className="ai-card__head">
          <div className="ai-card__name">{plan.name}</div>
          {isPlus && <span className="ai-card__badge">Premium</span>}
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
          className={`btn ai-card__cta ${isPlus ? '' : 'ghost'}`}
          onClick={onBuy}
          disabled={disabled}
        >
          {busy ? 'Открываем оплату…' : 'Continue'}
        </button>
      </div>
    </article>
  )
}
