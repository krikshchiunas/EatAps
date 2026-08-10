import { useState, useEffect, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { SYNC } from '../lib/syncEngine.js'
import { ACTIVITY, GOALS } from '../lib/nutrition.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import { deleteAccount } from '../lib/supabase.js'
import { notificationsSupported, notificationPermission, requestNotificationPermission } from '../lib/notifications.js'
import LazyBoundary from './LazyBoundary.jsx'
import LegalSheet from './LegalSheet.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit). Грузим его
// только когда пользователь открывает вход — ядро приложения остаётся лёгким
// и надёжно работает офлайн. lazyWithReload самолечит сбой загрузки чанка.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))

const THEMES = [
  { key: 'light', label: 'Светлая' },
  { key: 'dark', label: 'Тёмная' },
]

// Человеческие подписи состояния синхронизации. «Ошибка» отдельно от «нет
// сети»: это разные ситуации и разные ожидания у пользователя.
const SYNC_LABEL = {
  [SYNC.IDLE]: 'В облаке',
  [SYNC.SYNCING]: 'Сохраняем…',
  [SYNC.SYNCED]: '☁ Синхронизировано',
  [SYNC.LOCAL]: 'Сохранено на устройстве — отправим при первой возможности',
  [SYNC.OFFLINE]: 'Нет сети — изменения сохранены на устройстве',
  [SYNC.CONFLICT]: 'Сводим изменения с других устройств',
  [SYNC.ERROR]: 'Не удалось синхронизировать',
}
const SYNC_ALARM = new Set([SYNC.ERROR])

// Настройки и личные данные. Раньше это и был экран «Профиль»: человек нажимал
// «Профиль» и попадал в синхронизацию, рост и вес. Теперь профиль — витрина
// (ProfileScreen / UserProfileView), а всё техническое живёт здесь, под
// шестерёнкой. Содержимое не менялось: те же карточки, те же необратимые
// действия с теми же подтверждениями.
export default function SettingsScreen({ onClose }) {
  const store = useStore()
  const { profile, resolvedTheme, setTheme, resetAll, supabaseEnabled, user, syncStatus, signOut, stopSync, retrySync, offline } = store
  const t = profile.targets
  const [authOpen, setAuthOpen] = useState(false)
  const [myProfileOpen, setMyProfileOpen] = useState(false)
  const [legal, setLegal] = useState(null) // null | 'impressum' | 'privacy'
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // null | 'reset' | 'delete' | 'signout-global'
  const [signingOut, setSigningOut] = useState(false)
  const [signOutNote, setSignOutNote] = useState(null)

  // Выход с этого устройства — обычное, обратимое действие: остальные телефоны
  // и вкладки продолжают работать. Глобальный выход спрашивает подтверждение,
  // потому что он затрагивает устройства, которых сейчас нет перед глазами.
  const doSignOut = async (scope) => {
    setSigningOut(true)
    setSignOutNote(null)
    const res = await signOut({ scope })
    setSigningOut(false)
    if (res?.pendingChanges) {
      setSignOutNote('Часть изменений не успела уйти в облако — они сохранены на этом устройстве и отправятся при следующем входе.')
    } else if (res?.error) {
      setSignOutNote(res.error.message)
    }
  }
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle | sending | sent | error

  const sendFeedback = async () => {
    const text = feedbackText.trim()
    if (!text) return
    setFeedbackStatus('sending')
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!r.ok) throw new Error()
      setFeedbackStatus('sent')
      setFeedbackText('')
      setTimeout(() => { setFeedbackStatus('idle'); setFeedbackOpen(false) }, 2000)
    } catch {
      setFeedbackStatus('error')
      setTimeout(() => setFeedbackStatus('idle'), 3000)
    }
  }

  const reset = () => setConfirm('reset')

  // DSGVO: право на переносимость — выгрузка всех своих данных в JSON.
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
  }

  // DSGVO: право на удаление — стираем данные из облака, аккаунт и локально.
  const delAccount = async () => {
    setBusy(true)
    setSignOutNote(null)
    // Сначала глушим синхронизацию: отложенное сохранение, сработавшее уже
    // после удаления, попыталось бы заново создать только что стёртую строку.
    stopSync()
    const res = await deleteAccount(user?.id)
    // Аккаунта больше нет — выходим сразу на всех устройствах, иначе на
    // соседнем телефоне остался бы работающий интерфейс без данных.
    // discard: досылать нечего и некуда.
    await signOut({ scope: 'global', discard: true })
    setBusy(false)
    if (res?.error && !res.partial) {
      setSignOutNote('Данные на этом устройстве удалены, но стереть их в облаке не получилось. Попробуйте ещё раз, когда появится связь.')
    } else if (res?.partial) {
      setSignOutNote('Данные из облака удалены. Сам вход (аккаунт) удалите через поддержку, если требуется.')
    }
  }

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Профиль</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Настройки</h1>
        </div>
        {onClose && (
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
        )}
      </div>

      {supabaseEnabled && (
        <div className="card" style={{ marginBottom: 14 }}>
          {user ? (
            <>
              <div className="row gap12" style={{ marginBottom: 14 }}>
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--primary-weak)', display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--primary-strong)', flex: '0 0 auto', fontWeight: 600 }}>
                    {(profile.name || user.email || user.phone || '?').trim().slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name || user.email || user.phone}</div>
                  <div style={{ fontSize: 13, color: SYNC_ALARM.has(syncStatus) ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {SYNC_LABEL[syncStatus] || 'В облаке'}
                  </div>
                  {(syncStatus === SYNC.ERROR || (offline && syncStatus !== SYNC.SYNCING)) && (
                    <button style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 2 }} onClick={retrySync}>
                      Повторить синхронизацию
                    </button>
                  )}
                </div>
              </div>
              <button className="btn" onClick={() => setMyProfileOpen(true)}>Мой профиль</button>
            </>
          ) : (
            <>
              <div className="h2" style={{ fontSize: 17, marginBottom: 6 }}>Аккаунт</div>
              <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>Войдите — данные будут в облаке и синхронизируются между устройствами.</p>
              <button className="btn" onClick={() => setAuthOpen(true)}>Войти или зарегистрироваться</button>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="row gap16" style={{ marginBottom: 18 }}>
          <div style={{ width: 60, height: 60, borderRadius: 20, background: 'var(--primary-weak)', display: 'grid', placeItems: 'center', fontSize: 26 }}>
            {profile.sex === 'male' ? '♂' : '♀'}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 650 }}>{GOALS[profile.goal].label}</div>
            <div className="muted" style={{ fontSize: 14 }}>{ACTIVITY[profile.activity].label}</div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <KV k="Возраст" v={`${profile.age}`} />
          <KV k="Рост" v={`${profile.height} см`} />
          <KV k="Вес" v={`${profile.weight} кг`} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Оформление</div>
        <div className="seg">
          {THEMES.map((th) => (
            <button key={th.key} className={resolvedTheme === th.key ? 'on' : ''} onClick={() => setTheme(th.key)}>{th.label}</button>
          ))}
        </div>
      </div>

      <NotificationsCard />


      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Обратная связь</div>
        {!feedbackOpen ? (
          <button className="btn ghost" onClick={() => setFeedbackOpen(true)}>Дать совет по сайту</button>
        ) : (
          <>
            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder="Напишите, что лагает, что добавить или что улучшить…"
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--ink-1)', fontSize: 14, fontFamily: 'inherit', marginBottom: 10, outline: 'none' }}
              autoFocus
            />
            <div className="row gap12">
              <button className="btn" style={{ flex: 1 }} disabled={feedbackStatus === 'sending' || !feedbackText.trim()} onClick={sendFeedback}>
                {feedbackStatus === 'sending' ? 'Отправка…' : feedbackStatus === 'sent' ? 'Отправлено ✓' : feedbackStatus === 'error' ? 'Ошибка, попробуй снова' : 'Отправить'}
              </button>
              <button className="btn ghost" onClick={() => { setFeedbackOpen(false); setFeedbackText(''); setFeedbackStatus('idle') }}>Отмена</button>
            </div>
          </>
        )}
      </div>

      {supabaseEnabled && user && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Сеансы</div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Аккаунт можно держать открытым на нескольких устройствах сразу. Обычный выход
            закрывает сеанс только здесь.
          </p>
          <button className="btn ghost" disabled={signingOut} onClick={() => doSignOut('local')}>
            {signingOut ? 'Выходим…' : 'Выйти на этом устройстве'}
          </button>
          <button
            className="btn ghost"
            style={{ marginTop: 10, color: 'var(--danger)', borderColor: 'var(--border-strong)' }}
            disabled={signingOut}
            onClick={() => setConfirm('signout-global')}
          >
            Выйти на всех устройствах
          </button>
          {signOutNote && (
            <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{signOutNote}</p>
          )}
        </div>
      )}

      <button className="btn ghost" style={{ marginTop: 12, color: 'var(--danger)', borderColor: 'var(--border-strong)' }} onClick={reset}>
        Сбросить профиль и данные
      </button>

      {supabaseEnabled && user && (
        <button className="btn ghost" style={{ marginTop: 14, color: 'var(--danger)', borderColor: 'var(--border-strong)' }} disabled={busy} onClick={() => setConfirm('delete')}>
          {busy ? 'Удаление…' : 'Удалить аккаунт и данные из облака'}
        </button>
      )}

      {/* captcha — необратимые действия: защита от случайного тапа. */}
      {confirm === 'reset' && (
        <ConfirmDialog
          captcha
          text="Вы уверены, что хотите удалить нашу историю?"
          onYes={() => { setConfirm(null); resetAll() }}
          onNo={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          captcha
          text="Вы уверены, что хотите удалить EatAps и больше не знать, что едят ваши друзья?"
          onYes={() => { setConfirm(null); delAccount() }}
          onNo={() => setConfirm(null)}
        />
      )}
      {confirm === 'signout-global' && (
        <ConfirmDialog
          text="Закрыть сеанс на всех устройствах? Придётся войти заново везде, где вы пользуетесь EatAps."
          onYes={() => { setConfirm(null); doSignOut('global') }}
          onNo={() => setConfirm(null)}
        />
      )}

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
        <button style={{ color: 'var(--ink-3)' }} onClick={() => setLegal('impressum')}>Impressum</button>
        <span style={{ color: 'var(--ink-3)', margin: '0 8px' }}>·</span>
        <button style={{ color: 'var(--ink-3)' }} onClick={() => setLegal('privacy')}>Datenschutz</button>
      </div>
      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
        EatAps{supabaseEnabled && user ? ' · данные в облаке' : ' · данные на этом устройстве'}
      </p>

      {authOpen && (
        <LazyBoundary onClose={() => setAuthOpen(false)}>
          <Suspense fallback={null}>
            <AuthSheet onClose={() => setAuthOpen(false)} />
          </Suspense>
        </LazyBoundary>
      )}
      {myProfileOpen && (
        <LazyBoundary onClose={() => setMyProfileOpen(false)}>
          <Suspense fallback={null}>
            <MyProfileSheet onClose={() => setMyProfileOpen(false)} />
          </Suspense>
        </LazyBoundary>
      )}
      {legal && <LegalSheet initial={legal} onClose={() => setLegal(null)} />}
    </div>
  )
}

function KV({ k, v }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 680 }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{k}</div>
    </div>
  )
}

function NotificationsCard() {
  const [perm, setPerm] = useState(() => notificationPermission())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // На возвращение из настроек браузера — переопросить статус разрешения.
    const onFocus = () => setPerm(notificationPermission())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  if (!notificationsSupported()) return null

  const enable = async () => {
    setBusy(true)
    const result = await requestNotificationPermission()
    setPerm(result)
    setBusy(false)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 6 }}>Уведомления</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Напоминание в 15:00, предупреждение о недоборе в 18:00 и пуш о новых сообщениях от друзей.
      </p>
      {perm === 'granted' ? (
        <div style={{ fontSize: 14, color: 'var(--good)', fontWeight: 600 }}>✓ Включены</div>
      ) : perm === 'denied' ? (
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          Разрешение отклонено. Включи вручную в настройках браузера.
        </div>
      ) : (
        <button className="btn" disabled={busy} onClick={enable}>
          {busy ? 'Запрашиваем…' : 'Включить уведомления'}
        </button>
      )}
    </div>
  )
}

