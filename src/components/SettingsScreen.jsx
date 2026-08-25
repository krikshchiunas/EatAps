// ─────────────────────────────────────────────────────────────────────────────
// Настройки — список разделов, и ничего кроме.
//
// Это экран «как работает мой аккаунт и приложение». На вопрос «кто я» отвечает
// Profile (UserProfileView): имя, фото, «о себе», списки «не ем»/«люблю»,
// любимое блюдо и дневник живут там и редактируются там же. Сюда они не
// переезжают — иначе Settings снова превратится в то, чем был: смесь профиля,
// анкеты и технических тумблеров.
//
// Сам экран намеренно плоский и скучный: заголовок секции + строки со
// стрелкой. Всё содержательное — в подэкранах (SettingsPanels.jsx), потому что
// два десятка переключателей на первом экране невозможно просматривать.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import LazyBoundary from './LazyBoundary.jsx'
import {
  Group, Row,
  AccountPanel, PrivacyPanel, NotificationsPanel, AppearancePanel, DataPanel, AboutPanel, SupportPanel, PromoPanel,
} from './SettingsPanels.jsx'
import AITonePanel from './AITonePanel.jsx'
import { TONES, DEFAULT_TONE, TONE_PREF } from '../lib/aiPrompt.js'

// AuthSheet тянет тяжёлый Web3-стек — грузим только когда его открывают.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
// Экран тренера нужен меньшинству — не тянем его в стартовый бандл.
const CoachScreen = lazyWithReload(() => import('./CoachScreen.jsx'))

export default function SettingsScreen({ onClose, onOpenFriends }) {
  const { user, supabaseEnabled, theme, prefs, subscription } = useStore()
  const [panel, setPanel] = useState(null) // 'account' | 'privacy' | ...
  const [authOpen, setAuthOpen] = useState(false)
  const close = () => setPanel(null)

  const toneLabel = (TONES[prefs?.[TONE_PREF]] || TONES[DEFAULT_TONE]).label
  const promoValue = subscription?.via === 'promo'
    ? (subscription.tier === 'AI_PLUS' ? 'AI+ активен' : 'AI активен')
    : null
  const themeLabel = theme === 'light' ? 'Светлая' : theme === 'dark' ? 'Тёмная' : 'Как в системе'
  const accountValue = supabaseEnabled
    ? (user ? (user.email || user.phone || 'Вход выполнен') : 'Не выполнен')
    : 'Только на устройстве'

  return (
    <div className="screen">
      <div className="row gap8" style={{ alignItems: 'center', marginBottom: 20 }}>
        <button className="iconbtn" onClick={onClose} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
        <h1 className="h1" style={{ margin: 0, fontSize: 26 }}>Настройки</h1>
      </div>

      <Group title="Аккаунт">
        <Row label="Аккаунт" value={accountValue} onClick={() => setPanel('account')} />
      </Group>

      <Group title="Приватность">
        <Row label="Кто что видит" onClick={() => setPanel('privacy')} />
      </Group>

      <Group title="Уведомления">
        <Row label="Уведомления" onClick={() => setPanel('notifications')} />
      </Group>

      <Group title="AI Assistant">
        <Row label="Тон ассистента" value={toneLabel} onClick={() => setPanel('aiTone')} />
        <Row label="Промокод" value={promoValue} onClick={() => setPanel('promo')} />
      </Group>

      <Group title="Оформление">
        <Row label="Тема" value={themeLabel} onClick={() => setPanel('appearance')} />
      </Group>

      <Group title="Данные">
        <Row label="Выгрузка и сброс" onClick={() => setPanel('data')} />
      </Group>

      <Group title="О приложении">
        <Row label="Тренер и клиенты" onClick={() => setPanel('coach')} />
        <Row label="Поддержка" onClick={() => setPanel('support')} />
        <Row label="Помощь и правовая информация" onClick={() => setPanel('about')} />
      </Group>

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 8px' }}>
        EatAps{supabaseEnabled && user ? ' · данные в облаке' : ' · данные на этом устройстве'}
      </p>

      {panel === 'account' && <AccountPanel onClose={close} onOpenAuth={() => setAuthOpen(true)} />}
      {panel === 'privacy' && <PrivacyPanel onClose={close} onOpenFriends={onOpenFriends} />}
      {panel === 'notifications' && <NotificationsPanel onClose={close} />}
      {panel === 'aiTone' && <AITonePanel onClose={close} />}
      {panel === 'promo' && <PromoPanel onClose={close} />}
      {panel === 'appearance' && <AppearancePanel onClose={close} />}
      {panel === 'data' && <DataPanel onClose={close} />}
      {panel === 'coach' && (
        <LazyBoundary onClose={close}>
          <Suspense fallback={null}>
            <CoachScreen onClose={close} />
          </Suspense>
        </LazyBoundary>
      )}
      {panel === 'support' && <SupportPanel onClose={close} />}
      {panel === 'about' && <AboutPanel onClose={close} />}

      {authOpen && (
        <LazyBoundary onClose={() => setAuthOpen(false)}>
          <Suspense fallback={null}>
            <AuthSheet onClose={() => setAuthOpen(false)} />
          </Suspense>
        </LazyBoundary>
      )}
    </div>
  )
}
