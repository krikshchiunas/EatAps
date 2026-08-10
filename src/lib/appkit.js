import { createAppKit } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { mainnet, solana } from '@reown/appkit/networks'

import { WALLETCONNECT_PROJECT_ID as projectId, web3Enabled } from './web3Config.js'

// Реэкспорт для совместимости: признак включённости спрашивают у web3Config.js,
// который ничего тяжёлого не тянет.
export { web3Enabled }

// Инициализируем один раз при импорте модуля. Модалка со списком кошельков
// (MetaMask, Phantom, Coinbase, Rabby… + WalletConnect QR) и подключение
// Ethereum/Solana берёт на себя AppKit.
// Домен берём из текущего адреса — так метаданные всегда совпадают с сайтом
// и ничего не надо править при смене домена.
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://eataps.vercel.app'

if (web3Enabled) {
  try {
    createAppKit({
      adapters: [new EthersAdapter(), new SolanaAdapter()],
      networks: [mainnet, solana],
      projectId,
      metadata: {
        name: 'EatAps',
        description: 'EatAps — трекер питания',
        url: origin,
        icons: [`${origin}/icon-512.png`],
      },
      features: { analytics: false, email: false, socials: [] },
    })
  } catch (e) {
    console.error('AppKit init failed', e)
  }
}
