import { useState } from 'react'
import { useStore } from '../store.jsx'
import { normalizeError, ERR } from '../lib/authErrors.js'

// Экран смены пароля после перехода по ссылке из письма (событие
// PASSWORD_RECOVERY).
//
// Это отдельный режим приложения, а не шторка поверх дневника. Supabase выдаёт
// по ссылке полноценную сессию, и если считать её обычным входом, то ссылка из
// письма превращается в постоянный доступ к аккаунту: закрыл форму — и ты внутри,
// пароль не сменён. Поэтому пока пароль не обновлён, данные аккаунта не
// грузятся, а «Отмена» завершает сессию на этом устройстве.
export default function ResetPasswordSheet() {
  const { auth, completeRecovery, cancelRecovery, user } = useStore()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)   // нормализованная ошибка
  const [done, setDone] = useState(false)

  const tooShort = pw1.length > 0 && pw1.length < 6
  const mismatch = pw2.length > 0 && pw1 !== pw2
  const valid = pw1.length >= 6 && pw1 === pw2

  const save = async (e) => {
    e.preventDefault()
    if (!valid || busy) return   // защита от двойного нажатия и Enter
    setBusy(true)
    setErr(null)
    try {
      const { error } = await auth.updatePassword(pw1)
      if (error) setErr(normalizeError(error))
      else setDone(true)
    } catch (e2) {
      setErr(normalizeError(e2))
    } finally {
      setBusy(false)   // ни при каком исходе не остаёмся в вечной загрузке
    }
  }

  // Ссылка протухла или уже использована: сменить пароль этой сессией нельзя,
  // единственный осмысленный выход — запросить новую и войти заново.
  const linkDead = err?.category === ERR.AUTH || err?.category === ERR.SESSION

  return (
    <div className="app">
      <div className="recovery-screen">
        <div className="card">
          <div className="eyebrow">EatAps</div>
          <h1 className="h2" style={{ margin: '6px 0 10px' }}>
            {done ? 'Пароль обновлён' : 'Новый пароль'}
          </h1>

          {done ? (
            <>
              <p className="muted" style={{ fontSize: 15, marginBottom: 18 }}>
                Готово. Вы вошли в аккаунт{user?.email ? ` ${user.email}` : ''} на этом устройстве.
                Другие устройства продолжают работать как раньше.
              </p>
              <button className="btn" onClick={completeRecovery}>Перейти в приложение</button>
            </>
          ) : linkDead ? (
            <>
              <p style={{ fontSize: 15, color: 'var(--danger)', marginBottom: 8 }}>{err.message}</p>
              <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
                Ссылки для смены пароля одноразовые и живут около часа. Запросите новую
                на экране входа.
              </p>
              <button className="btn" onClick={cancelRecovery}>Вернуться ко входу</button>
            </>
          ) : (
            <form onSubmit={save}>
              <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
                Придумайте новый пароль{user?.email ? ` для ${user.email}` : ''}. Минимум 6 символов.
              </p>

              <div className="field">
                <label htmlFor="rp-pw1">Новый пароль</label>
                <input
                  id="rp-pw1" className="input" type="password" autoComplete="new-password"
                  placeholder="••••••••" value={pw1} disabled={busy}
                  onChange={(e) => setPw1(e.target.value)} autoFocus
                />
                {tooShort && <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6 }}>Ещё {6 - pw1.length} символ(а)</p>}
              </div>

              <div className="field">
                <label htmlFor="rp-pw2">Ещё раз</label>
                <input
                  id="rp-pw2" className="input" type="password" autoComplete="new-password"
                  placeholder="••••••••" value={pw2} disabled={busy}
                  onChange={(e) => setPw2(e.target.value)}
                />
                {mismatch && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 6 }}>Пароли не совпадают</p>}
              </div>

              {err && !linkDead && (
                <p style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 10 }}>{err.message}</p>
              )}

              <button type="submit" className="btn" disabled={!valid || busy}>
                {busy ? 'Сохраняем…' : 'Сохранить пароль'}
              </button>
              <button type="button" className="btn ghost" style={{ marginTop: 10 }} disabled={busy} onClick={cancelRecovery}>
                Отмена
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
