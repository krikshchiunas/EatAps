import { useState } from 'react'
import { useStore } from '../store.jsx'
import { hasAIPlus } from '../lib/subscription.js'

export default function AIHomeScreen() {
  const { subscription, openSubscriptionPortal } = useStore()
  const plus = hasAIPlus(subscription)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const manage = async () => {
    setError(null); setBusy(true)
    try {
      const res = await openSubscriptionPortal()
      if (res?.pending) return
    } catch (e) {
      setError(e?.message || 'Не удалось открыть портал.')
    }
    setBusy(false)
  }

  return (
    <div className="screen ai-home">
      <div className="ai-home__topbar">
        <div className={`ai-badge ${plus ? 'ai-badge--plus' : ''}`}>{plus ? 'AI+ · Premium' : 'AI'}</div>
        <button className="iconbtn" onClick={manage} disabled={busy} aria-label="Управление подпиской">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      <div className="ai-home__stage">
        <div className={`ai-home__orb ${plus ? 'ai-home__orb--plus' : ''}`} aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="56" height="56">
            <path d="M12 3l1.9 5.1 5.1 1.9-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
            <path d="M19 15l.9 2.4 2.4.9-2.4.9L19 21.6l-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
          </svg>
        </div>

        <h1 className="h1 ai-home__title">AI Assistant</h1>
        <p className="ai-home__sub">
          Разбор рациона, распознавание блюд и подсказки под ваши цели. Уже совсем скоро — прямо здесь.
        </p>

        <div className="ai-home__soon">
          <span className="ai-home__pulse" aria-hidden />
          Coming soon
        </div>

        {error && <div className="ai-error" role="alert" style={{ marginTop: 18 }}>{error}</div>}
      </div>

      <p className="ai-home__foot">
        {plus ? 'Ваш тариф: AI+ (Premium)' : 'Ваш тариф: AI'}
      </p>
    </div>
  )
}
