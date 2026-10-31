import { useState } from 'react'
import { useStore } from '../store.jsx'
import { planByTier } from '../lib/subscription.js'
import { t, fmtDate } from '../lib/i18n.js'

// Форма ввода промокода — общая для экрана тарифов и «Настроек».
// Логика гашения одна (applyPromo из store), здесь только UI и текст ошибок:
// причина отказа («уже использован», «срок истёк») это часть нормального
// сценария, поэтому показывается человеку, а не проглатывается.
const PROMO_ERRORS = ['not_found', 'expired', 'exhausted', 'already_used', 'unauthorized', 'offline', 'failed']

export default function PromoRedeemForm({ label = t('promo.question') }) {
  const { applyPromo } = useStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    const value = code.trim()
    if (!value || busy) return
    setResult(null)
    setBusy(true)
    const res = await applyPromo(value)
    setBusy(false)
    if (res?.ok) {
      const until = fmtDate(res.until, { day: 'numeric', month: 'long' })
      const name = planByTier(res.tier)?.name || res.tier
      setResult({ ok: true, text: t('promo.done', { plan: name, date: until }) })
      setCode('')
    } else {
      const reason = PROMO_ERRORS.includes(res?.error) ? res.error : 'failed'
      setResult({ ok: false, text: t(`promo.err.${reason}`) })
    }
  }

  return (
    <form className="promo" onSubmit={submit}>
      {label && <label className="promo__label" htmlFor="promo-code">{label}</label>}
      <div className="promo__row">
        <input
          id="promo-code"
          className="promo__input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('promo.code')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
        />
        <button className="btn ghost promo__btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? '…' : t('promo.activate')}
        </button>
      </div>
      {result && (
        <p className={`promo__msg ${result.ok ? 'promo__msg--ok' : 'promo__msg--err'}`} role="status">
          {result.text}
        </p>
      )}
    </form>
  )
}
