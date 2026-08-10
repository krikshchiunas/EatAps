import { useState, useEffect } from 'react'
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react'
// Импорт ради побочного эффекта: модуль вызывает createAppKit при загрузке,
// а без этого вызова хуки ниже бросают исключение.
import '../lib/appkit.js'

// ── Кнопка входа через кошелёк ────────────────────────────────────────────────
// Вынесена в отдельный файл, чтобы @reown/appkit со всеми адаптерами уехал в
// собственный чанк. Раньше эти хуки импортировались прямо в AuthSheet, и форма
// входа весила 2.7 МБ: почта и Google не показывались, пока не догрузится и не
// распарсится весь Web3-стек, которым большинство никогда не пользуется.
// Теперь форма рисуется сразу, а кошельки подъезжают рядом.
//
// AppKit-хуки бросают исключение, если createAppKit не отработал (нет
// VITE_WALLETCONNECT_PROJECT_ID). Поэтому они живут ТОЛЬКО здесь, а сам
// компонент рендерится под Web3ErrorBoundary и только при web3Enabled.
export default function Web3Button({ busy, run, auth }) {
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
