// ─────────────────────────────────────────────────────────────────────────────
// Подэкраны настроек: Аккаунт, Приватность, Уведомления, Оформление, Язык,
// Данные, О приложении.
//
// Общий принцип этих экранов — не показывать того, чего в приложении нет.
// Переключатель, который визуально меняется, но ничего не выключает, вреднее
// пустого места: человек считает, что настроил, и перестаёт проверять. Поэтому
// здесь нет тумблеров приватности (бэкенд знает ровно одну модель доступа —
// принятая дружба) и нет блокировки пользователей (её не существует).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store.jsx'
import { SYNC } from '../lib/syncEngine.js'
import { ACTIVITY, GOALS } from '../lib/nutrition.js'
import { deleteAccount, listFriends } from '../lib/supabase.js'
import {
  notificationsSupported, notificationPermission, requestNotificationPermission,
  getMutedFriends, toggleFriendMuted,
} from '../lib/notifications.js'
import { normalizeError } from '../lib/authErrors.js'
import { TOUR_PREF, TIPS, resetTips, seenCount } from '../lib/tour.js'
import PushScreen from './PushScreen.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import PromoRedeemForm from './PromoRedeemForm.jsx'
import LegalSheet from './LegalSheet.jsx'
import { Avatar } from './FriendsScreen.jsx'
import { planByTier } from '../lib/subscription.js'
import { t, fmtDate, fmtTime } from '../lib/i18n.js'
import LanguageList from './LanguageList.jsx'

// Версию подставляет сборка из package.json (см. vite.config.js). Фолбэк —
// на случай запуска в среде без define (например, тестовый рендер).
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const SYNC_KEY = {
  [SYNC.IDLE]: 'settings.sync.idle',
  [SYNC.SYNCING]: 'settings.sync.syncing',
  [SYNC.SYNCED]: 'settings.sync.synced',
  [SYNC.LOCAL]: 'settings.sync.local',
  [SYNC.OFFLINE]: 'settings.sync.offline',
  [SYNC.CONFLICT]: 'settings.sync.conflict',
  [SYNC.ERROR]: 'settings.sync.error',
}

// ── Общие кирпичики списка ────────────────────────────────────────────────────
export function Chevron() {
  return (
    <svg className="set-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function Group({ title, children, note }) {
  return (
    <div className="set-group">
      {title && <div className="set-title">{title}</div>}
      <div className="set-list">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </div>
  )
}

export function Row({ label, value, onClick, danger, disabled, chevron = true }) {
  return (
    <button className={`set-row${danger ? ' danger' : ''}`} onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      {value != null && <span className="set-val">{value}</span>}
      {onClick && !disabled && chevron && <Chevron />}
    </button>
  )
}

export function SwitchRow({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="set-row" style={{ alignItems: hint ? 'flex-start' : 'center' }}>
      <span style={{ minWidth: 0 }}>
        {label}
        {hint && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.4 }}>{hint}</span>}
      </span>
      <button
        className={`set-switch${checked ? ' on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={hint ? { marginTop: 2 } : undefined}
      >
        <span className="knob" />
      </button>
    </div>
  )
}

// Панель подраздела. Портал в body обязателен: у .push-screen есть
// will-change: transform, а это делает его containing block для position:fixed
// потомков — вложенная панель без портала считала бы координаты от родителя и
// уезжала вместе с его скроллом.
export function Panel({ title, onClose, children }) {
  return createPortal(
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 18 }}>
            <button className="iconbtn" onClick={close} aria-label={t('common.back')} style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>{title}</h1>
          </div>
          {children}
        </div>
      )}
    </PushScreen>,
    document.body,
  )
}

// ── Промокод ─────────────────────────────────────────────────────────────────
// Отдельный вход, не только через платный экран: код могли выдать человеку,
// который никогда не открывал тарифы, — «Активировать код» в Настройках
// найти проще, чем идти через AI → «нет доступа» → тарифы.
export function PromoPanel({ onClose }) {
  const { subscription } = useStore()
  const active = subscription?.via === 'promo'

  return (
    <Panel title={t('settings.promo.title')} onClose={onClose}>
      {active && (
        <Group note={t('settings.promo.activeNote')}>
          <div className="set-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ minWidth: 0 }}>
              {t('settings.promo.byCode', { plan: planByTier(subscription.tier)?.name || subscription.tier, code: subscription.promoCode })}
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                {t('settings.promo.until', { date: fmtDate(subscription.promoUntil, { day: 'numeric', month: 'long', year: 'numeric' }) })}
              </span>
            </span>
          </div>
        </Group>
      )}

      <Group note={t('settings.promo.enterNote')}>
        <div style={{ padding: '4px 2px' }}>
          <PromoRedeemForm label={null} />
        </div>
      </Group>
    </Panel>
  )
}

// ── Аккаунт ───────────────────────────────────────────────────────────────────
export function AccountPanel({ onClose, onOpenAuth }) {
  const {
    profile, user, supabaseEnabled, syncStatus, retrySync, offline,
    signOut, stopSync, auth,
  } = useStore()

  const [confirm, setConfirm] = useState(null) // null | 'signout-global' | 'delete'
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [pwState, setPwState] = useState('idle') // idle | saving | done | error
  const [pwErr, setPwErr] = useState(null)

  // Выход с этого устройства — обычное обратимое действие. Глобальный выход
  // спрашивает подтверждение: он затрагивает телефоны, которых сейчас нет
  // перед глазами.
  const doSignOut = async (scope) => {
    setBusy(true)
    setNote(null)
    const res = await signOut({ scope })
    setBusy(false)
    if (res?.pendingChanges) {
      setNote(t('settings.account.pendingOut'))
    } else if (res?.error) {
      setNote(res.error.message)
    }
  }

  // Удаление аккаунта: тот же порядок, что и был. Сначала глушим синхронизацию,
  // иначе отложенное сохранение заново создаст только что стёртую строку.
  const delAccount = async () => {
    setBusy(true)
    setNote(null)
    stopSync()
    const res = await deleteAccount(user?.id)
    await signOut({ scope: 'global', discard: true })
    setBusy(false)
    if (res?.error && !res.partial) {
      setNote(t('settings.account.cloudDeleteFailed'))
    } else if (res?.partial) {
      setNote(t('settings.account.partialDelete'))
    }
  }

  const changePassword = async () => {
    if (pw.length < 6) { setPwErr(t('settings.account.pwMin')); return }
    setPwState('saving')
    setPwErr(null)
    try {
      const res = await auth.updatePassword(pw)
      if (res?.error) throw res.error
      setPwState('done')
      setPw('')
      setTimeout(() => { setPwState('idle'); setPwOpen(false) }, 1800)
    } catch (e) {
      setPwState('error')
      setPwErr(normalizeError(e).message)
    }
  }

  // Пароль есть только у входа по email. У Google, Apple и кошелька его нет —
  // форма смены пароля там не имеет смысла и не показывается.
  const providers = user?.app_metadata?.providers || (user?.app_metadata?.provider ? [user.app_metadata.provider] : [])
  const hasPassword = providers.includes('email')
  const login = user?.email || user?.phone || (providers[0] ? t('settings.account.via', { provider: providers[0] }) : '—')

  return (
    <Panel title={t('settings.account.title')} onClose={onClose}>
      {!supabaseEnabled ? (
        <Group note={t('settings.account.noCloudNote')}>
          <Row label={t('settings.account.noCloud')} chevron={false} />
        </Group>
      ) : !user ? (
        <Group note={t('settings.account.guestNote')}>
          <Row label={t('settings.signInOrUp')} onClick={onOpenAuth} />
        </Group>
      ) : (
        <>
          <Group title={t('settings.account.login')}>
            <Row label={t('settings.account.title')} value={login} chevron={false} />
            {hasPassword && (
              <Row label={t('settings.account.changePw')} onClick={() => setPwOpen((o) => !o)} />
            )}
          </Group>

          {pwOpen && hasPassword && (
            <div className="card" style={{ marginTop: -12, marginBottom: 22 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t('settings.account.newPw')}</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setPwErr(null) }}
                  placeholder={t('settings.account.pwMin')}
                />
              </div>
              {pwErr && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{pwErr}</p>}
              <button className="btn" disabled={pwState === 'saving' || !pw} onClick={changePassword}>
                {pwState === 'saving' ? t('common.saving') : pwState === 'done' ? t('settings.account.pwChanged') : t('settings.account.savePw')}
              </button>
            </div>
          )}

          <Group title={t('settings.account.sync')} note={t('settings.account.syncNote')}>
            <div className="set-row" style={{ alignItems: 'flex-start' }}>
              <Avatar src={profile?.avatar} name={profile?.name || login} size={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile?.name || login}
                </div>
                <div style={{ fontSize: 13, color: syncStatus === SYNC.ERROR ? 'var(--danger)' : 'var(--ink-3)' }}>
                  {t(SYNC_KEY[syncStatus] || SYNC_KEY[SYNC.IDLE])}
                </div>
                {(syncStatus === SYNC.ERROR || (offline && syncStatus !== SYNC.SYNCING)) && (
                  <button style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 2 }} onClick={retrySync}>
                    {t('settings.account.retrySync')}
                  </button>
                )}
              </div>
            </div>
          </Group>

          <Group title={t('settings.account.normData')} note={t('settings.account.normDataNote')}>
            <Row label={t('body.goal')} value={GOALS[profile?.goal]?.label || '—'} chevron={false} />
            <Row label={t('body.activity')} value={ACTIVITY[profile?.activity]?.label || '—'} chevron={false} />
            <Row label={t('body.age')} value={profile?.age ? `${profile.age}` : '—'} chevron={false} />
            <Row label={t('body.height')} value={profile?.height ? t('units.cmN', { n: profile.height }) : '—'} chevron={false} />
            <Row label={t('body.weight')} value={profile?.weight ? t('units.kgN', { n: profile.weight }) : '—'} chevron={false} />
          </Group>

          <Group title={t('settings.account.sessions')}>
            <Row label={busy ? t('settings.account.signingOut') : t('settings.account.signOutHere')} disabled={busy} onClick={() => doSignOut('local')} chevron={false} />
            <Row label={t('settings.account.signOutAll')} disabled={busy} onClick={() => setConfirm('signout-global')} chevron={false} />
          </Group>

          <Group note={t('settings.account.deleteNote')}>
            <Row label={busy ? t('settings.account.deleting') : t('settings.account.delete')} danger disabled={busy} onClick={() => setConfirm('delete')} chevron={false} />
          </Group>

          {note && <p className="set-note" style={{ color: 'var(--ink-2)' }}>{note}</p>}
        </>
      )}

      {confirm === 'signout-global' && (
        <ConfirmDialog
          text={t('settings.account.confirmSignOutAll')}
          onYes={() => { setConfirm(null); doSignOut('global') }}
          onNo={() => setConfirm(null)}
        />
      )}
      {/* captcha — необратимое действие: защита от случайного тапа. */}
      {confirm === 'delete' && (
        <ConfirmDialog
          captcha
          text={t('settings.account.confirmDelete')}
          yesLabel={t('common.delete')}
          noLabel={t('common.cancel')}
          onYes={() => { setConfirm(null); delAccount() }}
          onNo={() => setConfirm(null)}
        />
      )}
    </Panel>
  )
}

// ── Приватность ───────────────────────────────────────────────────────────────
// Здесь нет ни одного переключателя, и это не упущение. В базе ровно одна
// модель доступа: строку состояния читает только принятый друг, и отдаёт её
// RPC friend_state с фиксированным списком полей. Публичного профиля,
// подписчиков и раздельной видимости дневника не существует — тумблер
// «кто видит дневник» был бы декорацией поверх неизменного правила.
//
// Поэтому экран делает единственное, что здесь честно и полезно: показывает,
// что именно уходит другу, а что не уходит никогда. Список совпадает с
// friendView.js и friend_state — если однажды разойдётся, это баг.
export function PrivacyPanel({ onClose, onOpenFriends }) {
  const { user, supabaseEnabled } = useStore()
  const [friendsCount, setFriendsCount] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    listFriends(user.id)
      .then((l) => { if (!cancelled) setFriendsCount(l.length) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

  const Item = ({ children, ok }) => (
    <div className="set-row" style={{ alignItems: 'flex-start', fontSize: 14.5 }}>
      <span style={{ flex: '0 0 auto', color: ok ? 'var(--good)' : 'var(--ink-3)' }}>{ok ? '✓' : '—'}</span>
      <span>{children}</span>
    </div>
  )

  return (
    <Panel title={t('settings.privacy.title')} onClose={onClose}>
      <Group
        title={t('settings.privacy.whoSees')}
        note={t('settings.privacy.whoSeesNote')}
      >
        <Row label={t('settings.privacy.friends')} value={friendsCount != null ? `${friendsCount}` : (supabaseEnabled && user ? '…' : '0')} chevron={false} />
        {onOpenFriends && <Row label={t('settings.privacy.manage')} onClick={onOpenFriends} />}
      </Group>

      <Group title={t('settings.privacy.friendSees')}>
        <Item ok>{t('settings.privacy.seeName')}</Item>
        <Item ok>{t('settings.privacy.seeLists')}</Item>
        <Item ok>{t('settings.privacy.seeFav')}</Item>
        <Item ok>{t('settings.privacy.seeDiary')}</Item>
        <Item ok>{t('settings.privacy.seeThoughts')}</Item>
      </Group>

      <Group title={t('settings.privacy.hidden')} note={t('settings.privacy.hiddenNote')}>
        <Item>{t('settings.privacy.hideBody')}</Item>
        <Item>{t('settings.privacy.hideGoal')}</Item>
        <Item>{t('settings.privacy.hideMood')}</Item>
        <Item>{t('settings.privacy.hideOwn')}</Item>
      </Group>

      <p className="set-note">
        {t('settings.privacy.revoke')}
      </p>
    </Panel>
  )
}

// ── Уведомления ───────────────────────────────────────────────────────────────
export function NotificationsPanel({ onClose }) {
  const { prefs, setPref, user } = useStore()
  const [perm, setPerm] = useState(() => notificationPermission())
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(getMutedFriends)
  const [mutedBriefs, setMutedBriefs] = useState({})

  useEffect(() => {
    // Возврат из настроек браузера — переспросить статус разрешения.
    const onFocus = () => setPerm(notificationPermission())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Имена заглушённых берём из списка друзей — отдельного запроса для этого
  // в проекте нет, а list_friends уже отдаёт имя и фото.
  useEffect(() => {
    if (!user?.id || muted.length === 0) return
    let cancelled = false
    listFriends(user.id)
      .then((l) => {
        if (cancelled) return
        const map = {}
        for (const f of l) map[f.id] = f
        setMutedBriefs(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user?.id, muted.length])

  const enable = async () => {
    setBusy(true)
    setPerm(await requestNotificationPermission())
    setBusy(false)
  }

  const granted = perm === 'granted'
  const on = (key) => prefs?.[key] !== false

  if (!notificationsSupported()) {
    return (
      <Panel title={t('settings.notif.title')} onClose={onClose}>
        <Group note={t('settings.notif.unsupportedNote')}>
          <Row label={t('settings.notif.unsupported')} chevron={false} />
        </Group>
      </Panel>
    )
  }

  return (
    <Panel title={t('settings.notif.title')} onClose={onClose}>
      <Group
        title={t('settings.notif.permission')}
        note={
          perm === 'denied'
            ? t('settings.notif.deniedNote')
            : granted
              ? t('settings.notif.grantedNote')
              : t('settings.notif.askNote')
        }
      >
        {granted ? (
          <Row label={t('settings.notif.granted')} value="✓" chevron={false} />
        ) : (
          <Row
            label={busy ? t('settings.notif.requesting') : perm === 'denied' ? t('settings.notif.denied') : t('settings.notif.allow')}
            disabled={busy || perm === 'denied'}
            onClick={perm === 'denied' ? undefined : enable}
            chevron={false}
          />
        )}
      </Group>

      <Group title={t('settings.notif.what')}>
        <SwitchRow
          label={t('settings.notif.lunch')}
          hint={t('settings.notif.lunchHint', { from: fmtTime(new Date(2000, 0, 1, 15)), to: fmtTime(new Date(2000, 0, 1, 18)) })}
          checked={on('notifLunch')}
          disabled={!granted}
          onChange={(v) => setPref('notifLunch', v)}
        />
        <SwitchRow
          label={t('settings.notif.deficit')}
          hint={t('settings.notif.deficitHint')}
          checked={on('notifDeficit')}
          disabled={!granted}
          onChange={(v) => setPref('notifDeficit', v)}
        />
        <SwitchRow
          label={t('settings.notif.messages')}
          hint={t('settings.notif.messagesHint')}
          checked={on('notifMessages')}
          disabled={!granted}
          onChange={(v) => setPref('notifMessages', v)}
        />
      </Group>
      <p className="set-note" style={{ marginTop: -14, marginBottom: 22 }}>
        {t('settings.notif.allNote')}
      </p>

      {muted.length > 0 && (
        <Group title={t('settings.notif.muted')} note={t('settings.notif.mutedNote')}>
          {muted.map((id) => (
            <div key={id} className="set-row">
              <Avatar src={mutedBriefs[id]?.avatar} name={mutedBriefs[id]?.name} size={30} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mutedBriefs[id]?.name || t('common.user')}
              </span>
              <button
                style={{ marginInlineStart: 'auto', fontSize: 14, color: 'var(--primary)', fontWeight: 600, flex: '0 0 auto' }}
                onClick={() => setMuted(toggleFriendMuted(id))}
              >
                {t('settings.notif.unmute')}
              </button>
            </div>
          ))}
        </Group>
      )}
    </Panel>
  )
}

// ── Оформление ────────────────────────────────────────────────────────────────
export function AppearancePanel({ onClose }) {
  // theme === null означает «следовать системе» — так это и хранится в
  // состоянии с самого начала (см. store.jsx). Своего хранилища не заводим.
  const { theme, setTheme } = useStore()
  const current = theme === 'light' || theme === 'dark' ? theme : 'system'

  const THEMES = [
    { key: 'system', value: null },
    { key: 'light', value: 'light' },
    { key: 'dark', value: 'dark' },
  ]

  return (
    <Panel title={t('settings.appearance.title')} onClose={onClose}>
      <Group title={t('settings.row.theme')} note={t('settings.appearance.themeNote')}>
        {THEMES.map((th) => (
          <Row
            key={th.key}
            label={t(`settings.theme.${th.key}`)}
            value={current === th.key ? '✓' : null}
            onClick={() => setTheme(th.value)}
            chevron={false}
          />
        ))}
      </Group>
    </Panel>
  )
}

// ── Язык ──────────────────────────────────────────────────────────────────────
// Как и тема, язык — настройка устройства: хранится в localStorage, а не в
// синхронизируемом состоянии (см. lib/i18n.js).
export function LanguagePanel({ onClose }) {
  return (
    <Panel title={t('lang.title')} onClose={onClose}>
      <Group note={t('lang.note')}>
        <LanguageList />
      </Group>
    </Panel>
  )
}

// ── Данные ────────────────────────────────────────────────────────────────────
export function DataPanel({ onClose }) {
  const store = useStore()
  const { resetAll } = store
  const [confirm, setConfirm] = useState(false)
  const [done, setDone] = useState(false)

  // DSGVO: право на переносимость. Выгрузка ровно того, что лежит на этом
  // устройстве в состоянии приложения. Чат и мысли живут в отдельных таблицах
  // и в файл не попадают — об этом сказано под кнопкой, а не умолчано.
  const exportData = () => {
    const dump = {
      profile: store.profile,
      theme: store.theme,
      days: store.days,
      customFoods: store.customFoods,
      customIngredients: store.customIngredients,
      recents: store.recents,
      prefs: store.prefs,
      subscription: store.subscription,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'eataps-data.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDone(true)
    setTimeout(() => setDone(false), 2500)
  }

  return (
    <Panel title={t('settings.data.title')} onClose={onClose}>
      <Group
        title={t('settings.data.export')}
        note={t('settings.data.exportNote')}
      >
        <Row label={done ? t('settings.data.saved') : t('settings.data.download')} onClick={exportData} chevron={false} />
      </Group>

      <Group
        note={t('settings.data.resetNote')}
      >
        <Row label={t('settings.data.reset')} danger onClick={() => setConfirm(true)} chevron={false} />
      </Group>

      {confirm && (
        <ConfirmDialog
          captcha
          text={t('settings.data.confirmReset')}
          yesLabel={t('settings.data.resetYes')}
          noLabel={t('common.cancel')}
          onYes={() => { setConfirm(false); resetAll() }}
          onNo={() => setConfirm(false)}
        />
      )}
    </Panel>
  )
}

// ── Поддержка и заявка на роль тренера ────────────────────────────────────────
// Отличается от анонимной «обратной связи» ниже тем, что требует входа: чтобы
// разбирать обращение и при необходимости заблокировать нарушителя, нужно
// знать, кто написал. Ограничение «раз в час» — серверное; здесь мы лишь
// показываем оставшееся время, чтобы человек не писал письмо впустую.
function SupportForm({ kind, placeholder, cta }) {
  const { session, signedIn } = useStore()
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent
  const [error, setError] = useState(null)
  const [nextAt, setNextAt] = useState(null) // когда снова можно писать
  const [, tick] = useState(0)

  // Пока действует ограничение, раз в секунду перерисовываем таймер.
  useEffect(() => {
    if (!nextAt) return
    const timer = setInterval(() => {
      if (new Date(nextAt) <= new Date()) setNextAt(null)
      else tick((n) => n + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [nextAt])

  if (!signedIn) {
    return (
      <p className="set-note" style={{ marginTop: 0 }}>
        {t('settings.support.signIn')}
      </p>
    )
  }

  const waitLeft = nextAt ? Math.max(0, new Date(nextAt) - Date.now()) : 0
  const waiting = waitLeft > 0
  const mins = Math.floor(waitLeft / 60000)
  const secs = Math.floor((waitLeft % 60000) / 1000)

  const send = async () => {
    const body = text.trim()
    if (body.length < 10) { setError(t('settings.support.tooShort')); return }
    setStatus('sending')
    setError(null)
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ text: body, kind }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setStatus('idle')
        setError(data.error || t('settings.support.sendFailed'))
        // Сервер сам сообщает, когда можно снова — не гадаем на клиенте.
        if (data.nextAllowedAt) setNextAt(data.nextAllowedAt)
        return
      }
      setStatus('sent')
      setText('')
      // Следующее обращение — через час: показываем это сразу, не дожидаясь отказа.
      setNextAt(new Date(Date.now() + 3600_000).toISOString())
      setTimeout(() => setStatus('idle'), 2500)
    } catch {
      setStatus('idle')
      setError(t('net.noServer'))
    }
  }

  return (
    <div className="card" style={{ marginTop: -12, marginBottom: 22 }}>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={4}
        maxLength={2000}
        disabled={waiting}
        style={{ resize: 'vertical', minHeight: 92, paddingTop: 12, lineHeight: 1.45, marginBottom: 10 }}
      />
      <button className="btn" disabled={status === 'sending' || waiting || text.trim().length < 10} onClick={send}>
        {status === 'sending' ? t('settings.support.sending')
          : status === 'sent' ? t('settings.support.sent')
          : waiting ? t('settings.support.waitUntil', { time: `${mins}:${String(secs).padStart(2, '0')}` })
          : cta}
      </button>
      {error && <p className="set-note" style={{ color: 'var(--danger)', marginBottom: 0 }}>{error}</p>}
      {!error && !waiting && (
        <p className="set-note" style={{ marginBottom: 0 }}>
          {t('settings.support.rateNote')}
        </p>
      )}
    </div>
  )
}

export function SupportPanel({ onClose }) {
  const [tab, setTab] = useState('support') // support | coach

  return (
    <Panel title={t('settings.support.title')} onClose={onClose}>
      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={tab === 'support' ? 'on' : ''} onClick={() => setTab('support')}>{t('settings.support.tabQuestion')}</button>
        <button className={tab === 'coach' ? 'on' : ''} onClick={() => setTab('coach')}>{t('settings.support.tabCoach')}</button>
      </div>

      {tab === 'support' ? (
        <SupportForm
          kind="support"
          placeholder={t('settings.support.questionPh')}
          cta={t('settings.support.questionCta')}
        />
      ) : (
        <>
          <p className="set-note" style={{ marginTop: 0 }}>
            {t('settings.support.coachIntro')}
          </p>
          <SupportForm
            kind="coach_application"
            placeholder={t('settings.support.coachPh')}
            cta={t('settings.support.coachCta')}
          />
        </>
      )}
    </Panel>
  )
}

// Возврат обучающих подсказок. Без этой строки подсказка, закрытая по ошибке
// (или уже забытая), исчезала бы навсегда — а жесты у нас невидимые.
function TipsRow() {
  const { prefs, setPref } = useStore()
  const seen = seenCount(prefs)
  const [done, setDone] = useState(false)

  const reset = () => {
    setPref(TOUR_PREF, resetTips())
    setDone(true)
    setTimeout(() => setDone(false), 2200)
  }

  return (
    <>
      <Row
        label={done ? t('settings.tips.willReturn') : t('settings.tips.showAgain')}
        value={t('settings.tips.seenOf', { n: seen, total: TIPS.length })}
        onClick={reset}
        disabled={seen === 0}
        chevron={false}
      />
    </>
  )
}

// ── О приложении ──────────────────────────────────────────────────────────────
export function AboutPanel({ onClose }) {
  const [legal, setLegal] = useState(null) // null | 'impressum' | 'privacy' | 'agb'
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error

  // Существующий канал связи — форма обратной связи в /api/feedback. Другого
  // способа связаться в проекте нет, и придумывать несуществующий адрес
  // поддержки здесь нельзя.
  const send = async () => {
    const body = text.trim()
    if (!body) return
    setStatus('sending')
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      })
      if (!r.ok) throw new Error()
      setStatus('sent')
      setText('')
      setTimeout(() => { setStatus('idle'); setOpen(false) }, 2000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <Panel title={t('settings.about.title')} onClose={onClose}>
      <Group title={t('settings.about.help')}>
        <Row label={open ? t('settings.about.collapse') : t('settings.about.writeDev')} onClick={() => setOpen((o) => !o)} chevron={!open} />
      </Group>

      {open && (
        <div className="card" style={{ marginTop: -12, marginBottom: 22 }}>
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('settings.about.feedbackPh')}
            rows={4}
            style={{ resize: 'vertical', minHeight: 92, paddingTop: 12, lineHeight: 1.45, marginBottom: 10 }}
            autoFocus
          />
          <button className="btn" disabled={status === 'sending' || !text.trim()} onClick={send}>
            {status === 'sending' ? t('settings.support.sending') : status === 'sent' ? t('settings.support.sent') : status === 'error' ? t('settings.about.error') : t('common.send')}
          </button>
        </div>
      )}

      <Group title={t('settings.about.tips')}>
        <TipsRow />
      </Group>

      <Group title={t('settings.about.legal')}>
        <Row label={t('settings.about.privacy')} onClick={() => setLegal('privacy')} />
        <Row label={t('settings.about.terms')} onClick={() => setLegal('agb')} />
        <Row label="Impressum" onClick={() => setLegal('impressum')} />
      </Group>

      <Group title={t('settings.about.app')}>
        <Row label="EatAps" value={`v${APP_VERSION}`} chevron={false} />
      </Group>

      <p className="set-note">
        {t('settings.about.blurb')}
      </p>

      {legal && <LegalSheet initial={legal} onClose={() => setLegal(null)} />}
    </Panel>
  )
}
