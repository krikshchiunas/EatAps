import { useState } from 'react'
import AIPlansScreen from './AIPlansScreen.jsx'
import AIHomeScreen from './AIHomeScreen.jsx'

// Роутер вкладки AI.
//
// Ассистент доступен ВСЕМ, включая бесплатный тариф: у FREE свой месячный
// бюджет токенов (см. aiBudget.js). Раньше здесь стоял платный шлагбаум, и
// человек покупал подписку вслепую — теперь он сначала пробует, а экран
// тарифов открывается по кнопке и когда бесплатный объём кончился.
export default function AITab() {
  const [plans, setPlans] = useState(false)
  return plans
    ? <AIPlansScreen onClose={() => setPlans(false)} />
    : <AIHomeScreen onUpgrade={() => setPlans(true)} />
}
