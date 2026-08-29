// ─────────────────────────────────────────────────────────────────────────────
// Подэкраны настроек: Аккаунт, Приватность, Уведомления, Оформление, Данные,
// О приложении.
//
// Общий принцип этих экранов — не показывать того, чего в приложении нет.
// Переключатель, который визуально меняется, но ничего не выключает, вреднее
// пустого места: человек считает, что настроил, и перестаёт проверять. Поэтому
// здесь нет тумблеров приватности (бэкенд знает ровно одну модель доступа —
// принятая дружба), нет блокировки пользователей (её не существует) и нет
// выбора языка (локализации в проекте нет вовсе).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store.jsx'
import { SYNC } from '../lib/syncEngine.js'
import { ACTIVITY, GOALS } from '../lib/nutrition.js'
import { deleteAccount, listFriendships } from '../lib/supabase.js'
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

// Версию подставляет сборка из package.json (см. vite.config.js). Фолбэк —
// на случай запуска в среде без define (например, тестовый рендер).
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const SYNC_LABEL = {
  [SYNC.IDLE]: 'В облаке',
  [SYNC.SYNCING]: 'Сохраняем…',
  [SYNC.SYNCED]: '☁ Синхронизировано',
  [SYNC.LOCAL]: 'Сохранено на устройстве — отправим при первой возможности',
  [SYNC.OFFLINE]: 'Нет сети — изменения сохранены на устройстве',
  [SYNC.CONFLICT]: 'Сводим изменения с других устройств',
  [SYNC.ERROR]: 'Не удалось синхронизировать',
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
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
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
    <Panel title="Промокод" onClose={onClose}>
      {active && (
        <Group note="Промокод действует, пока не закончится подписка Stripe того же или более высокого уровня — тогда он просто перестанет быть нужен.">
          <div className="set-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ minWidth: 0 }}>
              {planByTier(subscription.tier)?.name || subscription.tier} по коду {subscription.promoCode}
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                до {new Date(subscription.promoUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </span>
          </div>
        </Group>
      )}

      <Group note="Введите код полностью, регистр не важен.">
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
      setNote('Часть изменений не успела уйти в облако — они сохранены на этом устройстве и отправятся при следующем входе.')
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
      setNote('Данные на этом устройстве удалены, но стереть их в облаке не получилось. Попробуйте ещё раз, когда появится связь.')
    } else if (res?.partial) {
      setNote('Данные из облака удалены. Сам вход (аккаунт) удалите через поддержку, если требуется.')
    }
  }

  const changePassword = async () => {
    if (pw.length < 6) { setPwErr('Минимум 6 символов'); return }
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
  const login = user?.email || user?.phone || (providers[0] ? `вход через ${providers[0]}` : '—')

  return (
    <Panel title="Аккаунт" onClose={onClose}>
      {!supabaseEnabled ? (
        <Group note="Приложение работает без аккаунта: данные хранятся только на этом устройстве.">
          <Row label="Облако не подключено" chevron={false} />
        </Group>
      ) : !user ? (
        <Group note="Без входа данные остаются только на этом устройстве и не видны друзьям.">
          <Row label="Войти или зарегистрироваться" onClick={onOpenAuth} />
        </Group>
      ) : (
        <>
          <Group title="Вход">
            <Row label="Аккаунт" value={login} chevron={false} />
            {hasPassword && (
              <Row label="Сменить пароль" onClick={() => setPwOpen((o) => !o)} />
            )}
          </Group>

          {pwOpen && hasPassword && (
            <div className="card" style={{ marginTop: -12, marginBottom: 22 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Новый пароль</label>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setPwErr(null) }}
                  placeholder="Минимум 6 символов"
                />
              </div>
              {pwErr && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{pwErr}</p>}
              <button className="btn" disabled={pwState === 'saving' || !pw} onClick={changePassword}>
                {pwState === 'saving' ? 'Сохраняем…' : pwState === 'done' ? 'Пароль изменён ✓' : 'Сохранить пароль'}
              </button>
            </div>
          )}

          <Group title="Синхронизация" note="Аккаунт можно держать открытым на нескольких устройствах сразу.">
            <div className="set-row" style={{ alignItems: 'flex-start' }}>
              <Avatar src={profile?.avatar} name={profile?.name || login} size={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile?.name || login}
                </div>
                <div style={{ fontSize: 13, color: syncStatus === SYNC.ERROR ? 'var(--danger)' : 'var(--ink-3)' }}>
                  {SYNC_LABEL[syncStatus] || 'В облаке'}
                </div>
                {(syncStatus === SYNC.ERROR || (offline && syncStatus !== SYNC.SYNCING)) && (
                  <button style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 2 }} onClick={retrySync}>
                    Повторить синхронизацию
                  </button>
                )}
              </div>
            </div>
          </Group>

          <Group title="Данные для расчёта нормы" note="Видны только вам — друзьям они не передаются. Меняются в разделе «Мои данные и норма».">
            <Row label="Цель" value={GOALS[profile?.goal]?.label || '—'} chevron={false} />
            <Row label="Активность" value={ACTIVITY[profile?.activity]?.label || '—'} chevron={false} />
            <Row label="Возраст" value={profile?.age ? `${profile.age}` : '—'} chevron={false} />
            <Row label="Рост" value={profile?.height ? `${profile.height} см` : '—'} chevron={false} />
            <Row label="Вес" value={profile?.weight ? `${profile.weight} кг` : '—'} chevron={false} />
          </Group>

          <Group title="Сеансы">
            <Row label={busy ? 'Выходим…' : 'Выйти на этом устройстве'} disabled={busy} onClick={() => doSignOut('local')} chevron={false} />
            <Row label="Выйти на всех устройствах" disabled={busy} onClick={() => setConfirm('signout-global')} chevron={false} />
          </Group>

          <Group note="Удаление стирает профиль, дневник, мысли и ответы — и в облаке, и на этом устройстве. Отменить нельзя.">
            <Row label={busy ? 'Удаление…' : 'Удалить аккаунт'} danger disabled={busy} onClick={() => setConfirm('delete')} chevron={false} />
          </Group>

          {note && <p className="set-note" style={{ color: 'var(--ink-2)' }}>{note}</p>}
        </>
      )}

      {confirm === 'signout-global' && (
        <ConfirmDialog
          text="Закрыть сеанс на всех устройствах? Придётся войти заново везде, где вы пользуетесь EatAps."
          onYes={() => { setConfirm(null); doSignOut('global') }}
          onNo={() => setConfirm(null)}
        />
      )}
      {/* captcha — необратимое действие: защита от случайного тапа. */}
      {confirm === 'delete' && (
        <ConfirmDialog
          captcha
          text="Вы уверены, что хотите удалить EatAps и больше не знать, что едят ваши друзья?"
          yesLabel="Удалить"
          noLabel="Отмена"
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
    listFriendships(user.id)
      .then((l) => { if (!cancelled) setFriendsCount(l.friends.length) })
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
    <Panel title="Приватность" onClose={onClose}>
      <Group
        title="Кто видит ваш профиль"
        note="Другой модели доступа в EatAps нет: посторонний не может открыть ваш профиль, даже зная ссылку или ваш ID — по ID можно только отправить заявку."
      >
        <Row label="Принятые друзья" value={friendsCount != null ? `${friendsCount}` : (supabaseEnabled && user ? '…' : '0')} chevron={false} />
        {onOpenFriends && <Row label="Управлять списком друзей" onClick={onOpenFriends} />}
      </Group>

      <Group title="Что видит друг">
        <Item ok>Имя, фото и «о себе»</Item>
        <Item ok>Списки «не ем» и «люблю»</Item>
        <Item ok>Любимый ресторан и блюдо</Item>
        <Item ok>Дневник питания и норму калорий</Item>
        <Item ok>Мысли, реакции и ответы</Item>
      </Group>

      <Group title="Что не видит никто, кроме вас" note="Это ограничение стоит в базе, а не в интерфейсе: сервер просто не отдаёт эти поля.">
        <Item>Вес, рост, возраст и пол</Item>
        <Item>Цель и уровень активности</Item>
        <Item>Настроение, самочувствие и заметки дня</Item>
        <Item>Свои продукты, история поиска и настройки</Item>
      </Group>

      <p className="set-note">
        Чтобы закрыть доступ, удалите человека из друзей — вместе с дружбой пропадает и видимость.
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
  // в проекте нет, а listFriendships уже отдаёт имя и фото.
  useEffect(() => {
    if (!user?.id || muted.length === 0) return
    let cancelled = false
    listFriendships(user.id)
      .then((l) => {
        if (cancelled) return
        const map = {}
        for (const f of l.friends) map[f.id] = f
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
      <Panel title="Уведомления" onClose={onClose}>
        <Group note="Браузер не поддерживает уведомления. На iPhone они работают, если добавить EatAps на главный экран (iOS 16.4+).">
          <Row label="Недоступны на этом устройстве" chevron={false} />
        </Group>
      </Panel>
    )
  }

  return (
    <Panel title="Уведомления" onClose={onClose}>
      <Group
        title="Разрешение"
        note={
          perm === 'denied'
            ? 'Разрешение отклонено. Включить обратно можно только в настройках браузера — приложение спросить повторно не может.'
            : granted
              ? 'Уведомления приходят, пока EatAps открыт или добавлен на главный экран.'
              : 'Без разрешения браузера ни одно уведомление не придёт.'
        }
      >
        {granted ? (
          <Row label="Уведомления разрешены" value="✓" chevron={false} />
        ) : (
          <Row
            label={busy ? 'Запрашиваем…' : perm === 'denied' ? 'Отклонены в браузере' : 'Разрешить уведомления'}
            disabled={busy || perm === 'denied'}
            onClick={perm === 'denied' ? undefined : enable}
            chevron={false}
          />
        )}
      </Group>

      <Group title="Что присылать">
        <SwitchRow
          label="Напоминание про обед"
          hint="Один раз в день, между 15:00 и 18:00"
          checked={on('notifLunch')}
          disabled={!granted}
          onChange={(v) => setPref('notifLunch', v)}
        />
        <SwitchRow
          label="Предупреждение о недоборе"
          hint="Вечером, если сильно не хватает калорий или белка"
          checked={on('notifDeficit')}
          disabled={!granted}
          onChange={(v) => setPref('notifDeficit', v)}
        />
        <SwitchRow
          label="Сообщения от друзей"
          hint="Пуш о новом сообщении в чате"
          checked={on('notifMessages')}
          disabled={!granted}
          onChange={(v) => setPref('notifMessages', v)}
        />
      </Group>
      <p className="set-note" style={{ marginTop: -14, marginBottom: 22 }}>
        Это все уведомления, которые есть в EatAps. Заявки в друзья, реакции и
        ответы пока не присылаются — переключателей для них здесь нет намеренно.
      </p>

      {muted.length > 0 && (
        <Group title="Заглушённые" note="От этих людей не приходят пуши о сообщениях. На то, что они видят в вашем профиле, это не влияет.">
          {muted.map((id) => (
            <div key={id} className="set-row">
              <Avatar src={mutedBriefs[id]?.avatar} name={mutedBriefs[id]?.name} size={30} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mutedBriefs[id]?.name || 'Пользователь'}
              </span>
              <button
                style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--primary)', fontWeight: 600, flex: '0 0 auto' }}
                onClick={() => setMuted(toggleFriendMuted(id))}
              >
                Включить
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
    { key: 'system', label: 'Как в системе', value: null },
    { key: 'light', label: 'Светлая', value: 'light' },
    { key: 'dark', label: 'Тёмная', value: 'dark' },
  ]

  return (
    <Panel title="Оформление" onClose={onClose}>
      <Group title="Тема" note="Тема — настройка устройства: на другом телефоне она может быть своей.">
        {THEMES.map((t) => (
          <Row
            key={t.key}
            label={t.label}
            value={current === t.key ? '✓' : null}
            onClick={() => setTheme(t.value)}
            chevron={false}
          />
        ))}
      </Group>

      <Group title="Язык" note="EatAps пока существует только на русском. Как появятся другие языки, выбор будет здесь.">
        <Row label="Русский" chevron={false} />
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
    <Panel title="Данные" onClose={onClose}>
      <Group
        title="Выгрузка"
        note="Файл JSON: профиль, дневник питания за все дни, свои продукты и настройки. Переписка и мысли в него не входят — они хранятся отдельно."
      >
        <Row label={done ? 'Файл сохранён ✓' : 'Скачать мои данные'} onClick={exportData} chevron={false} />
      </Group>

      <Group
        note="Стирает профиль и весь дневник на всех ваших устройствах. Аккаунт и друзья остаются. Отменить нельзя."
      >
        <Row label="Сбросить профиль и данные" danger onClick={() => setConfirm(true)} chevron={false} />
      </Group>

      {confirm && (
        <ConfirmDialog
          captcha
          text="Вы уверены, что хотите удалить нашу историю?"
          yesLabel="Сбросить"
          noLabel="Отмена"
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
    const t = setInterval(() => {
      if (new Date(nextAt) <= new Date()) setNextAt(null)
      else tick((n) => n + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [nextAt])

  if (!signedIn) {
    return (
      <p className="set-note" style={{ marginTop: 0 }}>
        Чтобы написать, войдите в аккаунт — так мы сможем ответить именно вам.
      </p>
    )
  }

  const waitLeft = nextAt ? Math.max(0, new Date(nextAt) - Date.now()) : 0
  const waiting = waitLeft > 0
  const mins = Math.floor(waitLeft / 60000)
  const secs = Math.floor((waitLeft % 60000) / 1000)

  const send = async () => {
    const body = text.trim()
    if (body.length < 10) { setError('Опишите вопрос подробнее — хотя бы несколько слов'); return }
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
        setError(data.error || 'Не удалось отправить')
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
      setError('Нет связи с сервером')
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
        {status === 'sending' ? 'Отправка…'
          : status === 'sent' ? 'Отправлено ✓'
          : waiting ? `Можно через ${mins}:${String(secs).padStart(2, '0')}`
          : cta}
      </button>
      {error && <p className="set-note" style={{ color: 'var(--danger)', marginBottom: 0 }}>{error}</p>}
      {!error && !waiting && (
        <p className="set-note" style={{ marginBottom: 0 }}>
          Одно обращение в час. К сообщению прикладываются ваш ник и ID — иначе мы не поймём, кому отвечать.
        </p>
      )}
    </div>
  )
}

export function SupportPanel({ onClose }) {
  const [tab, setTab] = useState('support') // support | coach

  return (
    <Panel title="Поддержка" onClose={onClose}>
      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={tab === 'support' ? 'on' : ''} onClick={() => setTab('support')}>Вопрос</button>
        <button className={tab === 'coach' ? 'on' : ''} onClick={() => setTab('coach')}>Стать тренером</button>
      </div>

      {tab === 'support' ? (
        <SupportForm
          kind="support"
          placeholder="Что случилось? Опишите как можно подробнее…"
          cta="Отправить в поддержку"
        />
      ) : (
        <>
          <p className="set-note" style={{ marginTop: 0 }}>
            Тренер и нутрициолог могут по приглашению клиента смотреть его дневник и
            оставлять комментарии к дням. Расскажите о себе: образование, опыт, ссылки.
            Заявку рассматривает человек, ответ придёт в поддержку.
          </p>
          <SupportForm
            kind="coach_application"
            placeholder="Кто вы, чем занимаетесь, какой опыт и где вас можно проверить…"
            cta="Отправить заявку"
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
        label={done ? 'Подсказки вернутся' : 'Показать подсказки заново'}
        value={`${seen} из ${TIPS.length}`}
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
    <Panel title="О приложении" onClose={onClose}>
      <Group title="Помощь">
        <Row label={open ? 'Свернуть форму' : 'Написать разработчику'} onClick={() => setOpen((o) => !o)} chevron={!open} />
      </Group>

      {open && (
        <div className="card" style={{ marginTop: -12, marginBottom: 22 }}>
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что лагает, что добавить или что улучшить…"
            rows={4}
            style={{ resize: 'vertical', minHeight: 92, paddingTop: 12, lineHeight: 1.45, marginBottom: 10 }}
            autoFocus
          />
          <button className="btn" disabled={status === 'sending' || !text.trim()} onClick={send}>
            {status === 'sending' ? 'Отправка…' : status === 'sent' ? 'Отправлено ✓' : status === 'error' ? 'Ошибка, попробуйте снова' : 'Отправить'}
          </button>
        </div>
      )}

      <Group title="Подсказки">
        <TipsRow />
      </Group>

      <Group title="Правовая информация">
        <Row label="Политика конфиденциальности" onClick={() => setLegal('privacy')} />
        <Row label="Условия использования" onClick={() => setLegal('agb')} />
        <Row label="Impressum" onClick={() => setLegal('impressum')} />
      </Group>

      <Group title="Приложение">
        <Row label="EatAps" value={`v${APP_VERSION}`} chevron={false} />
      </Group>

      <p className="set-note">
        Дневник питания, который работает офлайн и синхронизируется между
        устройствами. Не медицинское изделие и не замена совету врача.
      </p>

      {legal && <LegalSheet initial={legal} onClose={() => setLegal(null)} />}
    </Panel>
  )
}
