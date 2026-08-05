import { useStore } from '../store.jsx'
import { isActive } from '../lib/subscription.js'
import AIPlansScreen from './AIPlansScreen.jsx'
import AIHomeScreen from './AIHomeScreen.jsx'

// Роутер вкладки AI: подписка активна → домашний экран, иначе — экран покупки.
// Тир и статус тянутся из store, куда их кладёт вебхук через Supabase Realtime,
// так что переход FREE → AI/AI+ происходит без ручного обновления страницы.
export default function AITab() {
  const { subscription } = useStore()
  return isActive(subscription) ? <AIHomeScreen /> : <AIPlansScreen />
}
