import { useState, useEffect } from 'react'
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react'
import { useStore } from '../store.jsx'
import { web3Enabled } from '../lib/appkit.js'
import { ruAuthError } from '../lib/authErrors.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

export default function AuthSheet({ onClose, mode = 'login', onBeforeAuth, onRegistered }) {
  const { auth, user } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {type:'err'|'ok', text}
  const { sheetStyle, grabberBind, close } = useSheetDrag(onClose)

  const isRegister = mode === 'register'

  // Появилась сессия → вход удался, шторка больше не нужна.
  useEffect(() => {
    if (user) onClose?.()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // beforeAuth — только для потоков с редиректом (OAuth): страница вот-вот
  // умрёт, анкету надо сохранить ДО ухода. Для email-потоков профиль
  // сохраняется после (onRegistered → закрытие шторки), чтобы человек успел
  // прочитать «подтвердите почту», а онбординг не размонтировал шторку.
  const run = async (fn, okText, { beforeAuth = false } = {}) => {
    if (beforeAuth) onBeforeAuth?.()
    setBusy(true)
    setMsg(null)
    try {
      const { error } = (await fn()) || {}
      if (error) setMsg({ type: 'err', text: ruAuthError(error.message) })
      else if (okText) setMsg({ type: 'ok', text: okText })
    } catch (e) {
      setMsg({ type: 'err', text: ruAuthError(e.message) })
    } finally {
      setBusy(false)
    }
  }

  const doLogin = () => run(() => auth.signInEmail(email, password))

  // Supabase при регистрации на занятый email возвращает «успех» с пустыми
  // identities (защита от перебора адресов). Ловим и говорим честно.
  const doRegister = () =>
    run(async () => {
      const res = await auth.signUpEmail(email, password)
      if (!res.error && res.data?.user && res.data.user.identities?.length === 0) {
        return { error: { message: 'User already registered' } }
      }
      if (!res.error) onRegistered?.()
      return res
    }, 'Готово. Подтвердите почту по ссылке из письма — и можно пользоваться приложением.')

  const emailOk = /\S+@\S+\.\S+/.test(email)

  // --- Web3 через Reown AppKit (список кошельков + WalletConnect) ---
  const { open } = useAppKit()
  const { isConnected, caipAddress } = useAppKitAccount()
  const { walletProvider: ethProvider } = useAppKitProvider('eip155')
  const { walletProvider: solProvider } = useAppKitProvider('solana')
  const { disconnect } = useDisconnect()
  const [awaitingWeb3, setAwaitingWeb3] = useState(false)

  const openWeb3 = async () => {
    setMsg(null)
    // Кошелёк мог остаться подключённым с прошлой сессии — тогда вход молча
    // ушёл бы в старый аккаунт. Сначала отключаем, чтобы показать выбор заново.
    if (isConnected) {
      try {
        await disconnect()
      } catch {}
    }
    setAwaitingWeb3(true)
    open() // модалка AppKit со списком кошельков
  }

  // Кошелёк подключился → просим подпись и логинимся в Supabase.
  useEffect(() => {
    if (!awaitingWeb3 || !isConnected || !caipAddress) return
    const ns = caipAddress.split(':')[0] // eip155 | solana
    const chain = ns === 'eip155' ? 'ethereum' : ns === 'solana' ? 'solana' : null
    const provider = ns === 'eip155' ? ethProvider : solProvider
    if (!chain || !provider) return // провайдер ещё не готов — ждём следующий тик
    setAwaitingWeb3(false)
    run(async () => {
      const res = await auth.signInWeb3(chain, provider)
      // Кошелёк подключён к AppKit, но в Supabase логиниться не обязательно повторно —
      // при ошибке/отмене подписи отключаем кошелёк, чтобы можно было начать заново.
      if (res?.error) disconnect().catch(() => {})
      return res
    })
  }, [awaitingWeb3, isConnected, caipAddress, ethProvider, solProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet" style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" {...grabberBind} />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{isRegister ? 'Регистрация в EatAps' : 'Вход в EatAps'}</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          {isRegister
            ? 'Создайте аккаунт — профиль и история сохранятся в облаке и будут доступны на любом устройстве.'
            : 'Войдите, чтобы данные сохранялись в облаке и синхронизировались между устройствами.'}
        </p>

        <div className="stack">
          <button className="btn ghost" disabled={busy} onClick={() => run(() => auth.signInOAuth('google'), null, { beforeAuth: true })}>
            <span style={{ fontWeight: 700 }}>G</span> Продолжить с Google
          </button>
          {web3Enabled && (
            <button className="btn ghost" disabled={busy} onClick={openWeb3}>
              👛 Web3 кошелёк
            </button>
          )}
        </div>

        <div className="row" style={{ alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>или по email</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || !emailOk || password.length < 6) return
            if (isRegister) doRegister()
            else doLogin()
          }}
        >
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="name@mail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input className="input" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className="row gap8">
            <button type={isRegister ? 'button' : 'submit'} className={isRegister ? 'btn ghost' : 'btn'} style={{ flex: 1 }} disabled={busy || !emailOk || password.length < 6} onClick={isRegister ? doLogin : undefined}>
              Войти
            </button>
            <button type={isRegister ? 'submit' : 'button'} className={isRegister ? 'btn' : 'btn ghost'} style={{ flex: 1 }} disabled={busy || !emailOk || password.length < 6} onClick={isRegister ? undefined : doRegister}>
              Регистрация
            </button>
          </div>
        </form>

        <div className="row between" style={{ marginTop: 12 }}>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} disabled={busy || !emailOk} onClick={() => run(() => auth.signInMagic(email), 'Отправили ссылку для входа на почту.')}>
            Войти по ссылке (без пароля)
          </button>
          <button style={{ fontSize: 14, color: 'var(--ink-3)' }} disabled={busy || !emailOk} onClick={() => run(() => auth.resetPassword(email), 'Отправили ссылку для сброса пароля.')}>
            Забыли пароль?
          </button>
        </div>

        {msg && (
          <p style={{ marginTop: 16, fontSize: 14, color: msg.type === 'err' ? 'var(--danger)' : 'var(--primary-strong)' }}>{msg.text}</p>
        )}

        <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 18, textAlign: 'center' }}>
          Продолжая, вы соглашаетесь с обработкой данных (см. Datenschutz в профиле).
        </p>
      </div>
    </div>
  )
}
