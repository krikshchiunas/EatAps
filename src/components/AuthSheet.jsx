import { useState, useEffect, useRef, Component } from 'react'
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react'
import { useStore } from '../store.jsx'
import { web3Enabled } from '../lib/appkit.js'
import { normalizeError } from '../lib/authErrors.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

// ── Web3-кнопка вынесена в отдельный компонент ────────────────────────────────
// AppKit-хуки (useAppKit, useAppKitAccount…) бросают исключение, если
// createAppKit не был вызван (т.е. VITE_WALLETCONNECT_PROJECT_ID не задан).
// Чтобы это не ронило весь AuthSheet через LazyBoundary, хуки живут ТОЛЬКО
// здесь — и рендерится компонент тоже только при web3Enabled === true.
class Web3ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

function Web3Button({ busy, run, auth }) {
  const { open } = useAppKit()
  const { isConnected, caipAddress } = useAppKitAccount()
  const { walletProvider: ethProvider } = useAppKitProvider('eip155')
  const { walletProvider: solProvider } = useAppKitProvider('solana')
  const { disconnect } = useDisconnect()
  const [awaitingWeb3, setAwaitingWeb3] = useState(false)

  const openWeb3 = async () => {
    if (isConnected) { try { await disconnect() } catch {} }
    setAwaitingWeb3(true)
    open()
  }

  useEffect(() => {
    if (!awaitingWeb3 || !isConnected || !caipAddress) return
    const ns = caipAddress.split(':')[0]
    const chain = ns === 'eip155' ? 'ethereum' : ns === 'solana' ? 'solana' : null
    const provider = ns === 'eip155' ? ethProvider : solProvider
    if (!chain || !provider) return
    setAwaitingWeb3(false)
    run(async () => {
      const res = await auth.signInWeb3(chain, provider)
      if (res?.error) disconnect().catch(() => {})
      return res
    })
  }, [awaitingWeb3, isConnected, caipAddress, ethProvider, solProvider]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button className="btn ghost" disabled={busy} onClick={openWeb3}>
      👛 Web3 кошелёк
    </button>
  )
}

export default function AuthSheet({ onClose, mode = 'login', onBeforeAuth, onRegistered }) {
  const { auth, user, beginSignIn, endSignIn, announceSignIn } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {type:'err'|'ok', text}
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  // Ссылка, а не состояние: защита от повторной отправки должна сработать в том
  // же тике, что и клик. setBusy применяется только к следующему рендеру, и
  // двойной тап по кнопке успевал отправить два запроса регистрации.
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const isRegister = mode === 'register'

  // Сессия появилась → рассказываем соседним вкладкам и закрываем форму.
  // Именно здесь, а не в run(): магическая ссылка и письмо сброса пароля
  // завершаются успешно, но сессии не создают — объявлять там было бы враньём.
  useEffect(() => {
    if (!user) return
    announceSignIn()
    onClose?.()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, okText, { beforeAuth = false } = {}) => {
    if (inFlight.current) return
    inFlight.current = true
    if (beforeAuth) onBeforeAuth?.()
    setBusy(true)
    setMsg(null)
    beginSignIn()
    let failure = null
    try {
      const { error } = (await fn()) || {}
      failure = error || null
      if (!error && okText && alive.current) setMsg({ type: 'ok', text: okText })
      else if (error && alive.current) setMsg({ type: 'err', text: normalizeError(error).message })
    } catch (e) {
      failure = e
      // Компонент мог размонтироваться, пока запрос летел — setState на
      // размонтированном узле здесь не нужен.
      if (alive.current) setMsg({ type: 'err', text: normalizeError(e).message })
    } finally {
      inFlight.current = false
      endSignIn(failure)
      if (alive.current) setBusy(false)
    }
  }

  const doLogin = () => run(() => auth.signInEmail(email.trim(), password))

  const doRegister = () =>
    run(async () => {
      const res = await auth.signUpEmail(email.trim(), password)
      if (!res.error && res.data?.user && res.data.user.identities?.length === 0) {
        return { error: { message: 'User already registered' } }
      }
      if (!res.error) onRegistered?.()
      return res
    }, 'Готово. Подтвердите почту по ссылке из письма — и можно пользоваться приложением.')

  const emailOk = /\S+@\S+\.\S+/.test(email.trim())

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
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
            <Web3ErrorBoundary>
              <Web3Button busy={busy} run={run} auth={auth} />
            </Web3ErrorBoundary>
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
