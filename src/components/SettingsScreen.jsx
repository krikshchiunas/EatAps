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
  AccountPanel, PrivacyPanel, NotificationsPanel, AppearancePanel, LanguagePanel, DataPanel, AboutPanel, SupportPanel, PromoPanel,
} from './SettingsPanels.jsx'
import AITonePanel from './AITonePanel.jsx'
import BodyPanel from './BodyPanel.jsx'
import { profileTargets } from '../lib/body.js'
import { TONES, DEFAULT_TONE, TONE_PREF } from '../lib/aiPrompt.js'
import { planByTier } from '../lib/subscription.js'
import { t, langInfo } from '../lib/i18n.js'

// AuthSheet тянет тяжёлый Web3-стек — грузим только когда его открывают.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
// Экран тренера нужен меньшинству — не тянем его в стартовый бандл.
const CoachScreen = lazyWithReload(() => import('./CoachScreen.jsx'))

export default function SettingsScreen({ onClose, onOpenFriends }) {
  const { user, supabaseEnabled, theme, prefs, subscription, profile } = useStore()
  const [panel, setPanel] = useState(null) // 'account' | 'privacy' | ...
  const [authOpen, setAuthOpen] = useState(false)
  const close = () => setPanel(null)

  const toneLabel = (TONES[prefs?.[TONE_PREF]] || TONES[DEFAULT_TONE]).label
  const promoValue = subscription?.via === 'promo'
    ? t('settings.promoActive', { plan: planByTier(subscription.tier)?.name || subscription.tier })
    : null
  const themeLabel = t(`settings.theme.${theme === 'light' || theme === 'dark' ? theme : 'system'}`)
  const liveTargets = profileTargets(profile)
  const bodyValue = liveTargets?.calories ? t('units.kcalN', { n: liveTargets.calories }) : null
  const accountValue = supabaseEnabled
    ? (user ? (user.email || user.phone || t('settings.signedIn')) : t('settings.notSignedIn'))
    : t('settings.deviceOnly')

  return (
    <div className="screen">
      <div className="row gap8" style={{ alignItems: 'center', marginBottom: 20 }}>
        <button className="iconbtn" onClick={onClose} aria-label={t('common.back')} style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
        <h1 className="h1" style={{ margin: 0, fontSize: 26 }}>{t('settings.title')}</h1>
      </div>

      <Group title={t('settings.grp.account')}>
        <Row label={t('settings.row.account')} value={accountValue} onClick={() => setPanel('account')} />
      </Group>

      <Group title={t('settings.grp.norm')}>
        <Row label={t('settings.row.body')} value={bodyValue} onClick={() => setPanel('body')} />
      </Group>

      <Group title={t('settings.grp.privacy')}>
        <Row label={t('settings.row.privacy')} onClick={() => setPanel('privacy')} />
      </Group>

      <Group title={t('settings.grp.notifications')}>
        <Row label={t('settings.row.notifications')} onClick={() => setPanel('notifications')} />
      </Group>

      <Group title="Carrot 🥕">
        <Row label={t('settings.row.tone')} value={toneLabel} onClick={() => setPanel('aiTone')} />
        <Row label={t('settings.row.promo')} value={promoValue} onClick={() => setPanel('promo')} />
      </Group>

      <Group title={t('settings.grp.appearance')}>
        <Row label={t('settings.row.theme')} value={themeLabel} onClick={() => setPanel('appearance')} />
        <Row label={t('lang.title')} value={langInfo().name} onClick={() => setPanel('language')} />
      </Group>

      <Group title={t('settings.grp.data')}>
        <Row label={t('settings.row.data')} onClick={() => setPanel('data')} />
      </Group>

      <Group title={t('settings.grp.about')}>
        <Row label={t('settings.row.coach')} onClick={() => setPanel('coach')} />
        <Row label={t('settings.row.support')} onClick={() => setPanel('support')} />
        <Row label={t('settings.row.about')} onClick={() => setPanel('about')} />
      </Group>

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 8px' }}>
        EatAps · {supabaseEnabled && user ? t('settings.footerCloud') : t('settings.footerDevice')}
      </p>

      {panel === 'account' && <AccountPanel onClose={close} onOpenAuth={() => setAuthOpen(true)} />}
      {panel === 'body' && <BodyPanel onClose={close} />}
      {panel === 'privacy' && <PrivacyPanel onClose={close} onOpenFriends={onOpenFriends} />}
      {panel === 'notifications' && <NotificationsPanel onClose={close} />}
      {panel === 'aiTone' && <AITonePanel onClose={close} />}
      {panel === 'promo' && <PromoPanel onClose={close} />}
      {panel === 'appearance' && <AppearancePanel onClose={close} />}
      {panel === 'language' && <LanguagePanel onClose={close} />}
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
