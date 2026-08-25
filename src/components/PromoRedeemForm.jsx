import { useState } from 'react'
import { useStore } from '../store.jsx'

// Форма ввода промокода — общая для экрана тарифов и «Настроек».
// Логика гашения одна (applyPromo из store), здесь только UI и текст ошибок:
// причина отказа («уже использован», «срок истёк») это часть нормального
// сценария, поэтому показывается человеку, а не проглатывается.
const PROMO_ERRORS = {
  not_found: 'Такого кода нет. Проверьте написание.',
  expired: 'Срок действия кода истёк.',
  exhausted: 'Код уже разобрали — все использования закончились.',
  already_used: 'Вы уже активировали этот код.',
  unauthorized: 'Войдите в аккаунт, чтобы активировать код.',
  offline: 'Нет связи. Проверьте интернет.',
  failed: 'Не получилось активировать код. Попробуйте ещё раз.',
}

export default function PromoRedeemForm({ label = 'Есть промокод?' }) {
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
      const until = new Date(res.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      const name = res.tier === 'AI_PLUS' ? 'AI+' : 'AI'
      setResult({ ok: true, text: `Готово: ${name} до ${until}.` })
      setCode('')
    } else {
      setResult({ ok: false, text: PROMO_ERRORS[res?.error] || PROMO_ERRORS.failed })
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
          placeholder="Код"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
        />
        <button className="btn ghost promo__btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? '…' : 'Активировать'}
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
