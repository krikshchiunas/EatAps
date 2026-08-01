import { createAppKit } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { mainnet, solana } from '@reown/appkit/networks'

// Публичный Project ID из cloud.reown.com (можно переопределить через env на Vercel).
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'eb7dd99e7a1daaa7e368cd42b91c9ba7'

export const web3Enabled = Boolean(projectId)

// Инициализируем один раз при импорте модуля. Модалка со списком кошельков
// (MetaMask, Phantom, Coinbase, Rabby… + WalletConnect QR) и подключение
// Ethereum/Solana берёт на себя AppKit.
if (web3Enabled) {
  try {
    createAppKit({
      adapters: [new EthersAdapter(), new SolanaAdapter()],
      networks: [mainnet, solana],
      projectId,
      metadata: {
        name: 'EatAps',
        description: 'EatAps — трекер питания',
        url: 'https://eataps.vercel.app',
        icons: ['https://eataps.vercel.app/icon.svg'],
      },
      features: { analytics: false, email: false, socials: [] },
    })
  } catch (e) {
    console.error('AppKit init failed', e)
  }
}
