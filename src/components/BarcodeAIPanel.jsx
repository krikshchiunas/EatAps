import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store.jsx'
import { t } from '../lib/i18n.js'
import { planByTier, TIER } from '../lib/subscription.js'
import { BARCODE_AI_PREF, barcodeAIAvailable } from '../lib/barcodeAI.js'
import { Panel, Group, Row, SwitchRow } from './SettingsPanels.jsx'
import PushScreen from './PushScreen.jsx'
import AIPlansScreen from './AIPlansScreen.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// Настройки → Штрихкод → Помощь ИИ.
//
// Переключатель есть у всех — чтобы было видно, что функция существует, — но
// включается только на Carrot Premium и с аккаунтом. Без тарифа он неактивен,
// а под ним — путь к тарифам, а не тупик.
//
// Настройка — в prefs, поэтому едет на все устройства. Если тариф кончился,
// включённая настройка остаётся, но ничего не делает (barcodeAIOn): после
// продления всё заработает само, без похода сюда.
// ─────────────────────────────────────────────────────────────────────────────

export function barcodeAIValue({ prefs, subscription }) {
  if (!barcodeAIAvailable(subscription)) return planByTier(TIER.AI_PREMIUM)?.name || 'Premium'
  return prefs?.[BARCODE_AI_PREF] === true ? t('barcodeAI.on') : t('barcodeAI.off')
}

export default function BarcodeAIPanel({ onClose }) {
  const { prefs, setPref, subscription, user, supabaseEnabled } = useStore()
  const [plans, setPlans] = useState(false)
  const available = barcodeAIAvailable(subscription)
  const signedIn = !!user
  const on = prefs?.[BARCODE_AI_PREF] === true
  const premiumName = planByTier(TIER.AI_PREMIUM)?.name || 'Premium'

  let note = t('barcodeAI.note')
  if (!supabaseEnabled || !signedIn) note = t('barcodeAI.needAccount')
  else if (!available) note = t('barcodeAI.needPremium', { plan: premiumName })

  return (
    <Panel title={t('barcodeAI.title')} onClose={onClose}>
      <Group note={note}>
        <SwitchRow
          label={t('barcodeAI.switch')}
          hint={t('barcodeAI.hint')}
          checked={on && available && signedIn}
          disabled={!available || !signedIn}
          onChange={(v) => setPref(BARCODE_AI_PREF, v)}
        />
      </Group>

      {signedIn && !available && (
        <Group>
          <Row label={t('barcodeAI.seePlans', { plan: premiumName })} onClick={() => setPlans(true)} />
        </Group>
      )}

      <Group title={t('barcodeAI.howTitle')} note={t('barcodeAI.privacy')}>
        <div className="set-row" style={{ display: 'block', lineHeight: 1.5, fontSize: 14 }}>
          <p style={{ margin: '0 0 6px' }}>{t('barcodeAI.how1')}</p>
          <p style={{ margin: '0 0 6px' }}>{t('barcodeAI.how2')}</p>
          <p style={{ margin: 0 }}>{t('barcodeAI.how3')}</p>
        </div>
      </Group>

      {plans && typeof document !== 'undefined' && createPortal(
        <PushScreen onClose={() => setPlans(false)}>
          {(close) => <AIPlansScreen onClose={close} />}
        </PushScreen>,
        document.body,
      )}
    </Panel>
  )
}
