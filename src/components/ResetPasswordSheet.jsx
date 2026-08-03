import { useState } from 'react'
import { useStore } from '../store.jsx'
import { ruAuthError } from '../lib/authErrors.js'

// Пользователь пришёл по ссылке «сброс пароля» (событие PASSWORD_RECOVERY):
// Supabase уже залогинил его временной сессией — здесь задаём новый пароль.
export default function ResetPasswordSheet({ onClose }) {
  const { auth } = useStore()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [done, setDone] = useState(false)

  const valid = pw1.length >= 6 && pw1 === pw2

  const save = async (e) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const { error } = await auth.updatePassword(pw1)
      if (error) setMsg({ type: 'err', text: ruAuthError(error.message) })
      else setDone(true)
    } catch (err) {
      setMsg({ type: 'err', text: ruAuthError(err.message) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <h2 className="h2" style={{ marginBottom: 8 }}>Новый пароль</h2>

        {done ? (
          <>
            <p className="muted" style={{ fontSize: 15, margin: '6px 0 18px' }}>
              Пароль обновлён — вы вошли в аккаунт.
            </p>
            <button className="btn" onClick={onClose}>Продолжить</button>
          </>
        ) : (
          <form onSubmit={save}>
            <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
              Придумайте новый пароль для входа в EatAps.
            </p>
            <div className="field">
              <label>Новый пароль (минимум 6 символов)</label>
              <input className="input" type="password" autoComplete="new-password" placeholder="••••••••" value={pw1} onChange={(e) => setPw1(e.target.value)} />
            </div>
            <div className="field">
              <label>Ещё раз</label>
              <input className="input" type="password" autoComplete="new-password" placeholder="••••••••" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            {pw2 && pw1 !== pw2 && (
              <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>Пароли не совпадают</p>
            )}
            {msg && (
              <p style={{ fontSize: 14, color: msg.type === 'err' ? 'var(--danger)' : 'var(--primary-strong)', marginBottom: 10 }}>{msg.text}</p>
            )}
            <button type="submit" className="btn" disabled={!valid || busy} style={{ marginTop: 6 }}>
              {busy ? 'Сохранение…' : 'Сохранить пароль'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
