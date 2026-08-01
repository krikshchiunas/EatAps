import { useState } from 'react'
import { useStore } from '../store.jsx'

export default function AuthSheet({ onClose }) {
  const { auth } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {type:'err'|'ok', text}

  const run = async (fn, okText) => {
    setBusy(true)
    setMsg(null)
    try {
      const { error } = (await fn()) || {}
      if (error) setMsg({ type: 'err', text: error.message })
      else if (okText) setMsg({ type: 'ok', text: okText })
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Что-то пошло не так' })
    } finally {
      setBusy(false)
    }
  }

  const emailOk = /\S+@\S+\.\S+/.test(email)

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Вход в EatAps</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          Войдите, чтобы данные сохранялись в облаке и синхронизировались между устройствами.
        </p>

        <div className="stack">
          <button className="btn ghost" disabled={busy} onClick={() => run(() => auth.signInOAuth('google'))}>
            <span style={{ fontWeight: 700 }}>G</span> Продолжить с Google
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => auth.signInOAuth('apple'))}>
             Продолжить с Apple
          </button>
        </div>

        <div className="row" style={{ alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>или по email</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <div className="field">
          <label>Email</label>
          <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="name@mail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input className="input" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <div className="row gap8">
          <button className="btn" style={{ flex: 1 }} disabled={busy || !emailOk || password.length < 6} onClick={() => run(() => auth.signInEmail(email, password))}>
            Войти
          </button>
          <button className="btn ghost" style={{ flex: 1 }} disabled={busy || !emailOk || password.length < 6} onClick={() => run(() => auth.signUpEmail(email, password), 'Готово. Подтвердите почту по ссылке из письма.')}>
            Регистрация
          </button>
        </div>

        <div className="row between" style={{ marginTop: 12 }}>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} disabled={busy || !emailOk} onClick={() => run(() => auth.signInMagic(email), 'Отправили ссылку для входа на почту.')}>
            Войти по ссылке (без пароля)
          </button>
          <button style={{ fontSize: 14, color: 'var(--ink-3)' }} disabled={busy || !emailOk} onClick={() => run(() => auth.resetPassword(email), 'Отправили ссылку для сброса пароля.')}>
            Забыли пароль?
          </button>
        </div>

        <div className="divider" />

        {!phoneOpen ? (
          <button className="btn soft" onClick={() => setPhoneOpen(true)}>Войти по номеру телефона</button>
        ) : (
          <div>
            <div className="field">
              <label>Телефон</label>
              <input className="input" type="tel" inputMode="tel" placeholder="+380..." value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {!otpSent ? (
              <button className="btn" disabled={busy || phone.length < 8} onClick={() => run(() => auth.sendPhoneOtp(phone)).then(() => setOtpSent(true))}>
                Получить SMS-код
              </button>
            ) : (
              <>
                <div className="field">
                  <label>Код из SMS</label>
                  <input className="input" type="text" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <button className="btn" disabled={busy || code.length < 4} onClick={() => run(() => auth.verifyPhoneOtp(phone, code))}>
                  Подтвердить и войти
                </button>
              </>
            )}
          </div>
        )}

        {msg && (
          <p style={{ marginTop: 16, fontSize: 14, color: msg.type === 'err' ? 'var(--danger)' : 'var(--primary-strong)' }}>{msg.text}</p>
        )}

        <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 18, textAlign: 'center' }}>
          Google, Apple и вход по телефону работают после настройки провайдеров в Supabase.
        </p>
      </div>
    </div>
  )
}
