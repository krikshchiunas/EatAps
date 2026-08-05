import { useState, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { ACTIVITY, GOALS } from '../lib/nutrition.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import { deleteAccount } from '../lib/supabase.js'
import LazyBoundary from './LazyBoundary.jsx'
import LegalSheet from './LegalSheet.jsx'
// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit). Грузим его
// только когда пользователь открывает вход — ядро приложения остаётся лёгким
// и надёжно работает офлайн. lazyWithReload самолечит сбой загрузки чанка.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))

const THEMES = [
  { key: 'light', label: 'Светлая' },
  { key: 'dark', label: 'Тёмная' },
]

const SYNC_LABEL = { idle: '', syncing: 'Синхронизация…', synced: 'Синхронизировано', error: 'Ошибка синхронизации' }

export default function ProfileScreen() {
  const store = useStore()
  const { profile, theme, setTheme, resetAll, supabaseEnabled, user, syncStatus, auth } = store
  const t = profile.targets
  const [authOpen, setAuthOpen] = useState(false)
  const [myProfileOpen, setMyProfileOpen] = useState(false)
  const [legal, setLegal] = useState(null) // null | 'impressum' | 'privacy'
  const [busy, setBusy] = useState(false)
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

  const reset = () => {
    if (confirm('Сбросить профиль и все данные? Это действие нельзя отменить.')) resetAll()
  }

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
    if (!confirm('Удалить аккаунт и все данные из облака? Это необратимо.')) return
    setBusy(true)
    const res = await deleteAccount()
    try {
      await auth.signOut()
    } catch {}
    setBusy(false)
    if (res?.error && !res.partial) {
      alert('Локальные данные удалены. Онлайн-часть удалить не удалось: ' + res.error)
    } else if (res?.partial) {
      alert('Данные из облака удалены. Сам вход (аккаунт) удалите в поддержке, если требуется.')
    }
    resetAll()
  }

  return (
    <div className="screen">
      <div className="eyebrow">Профиль</div>
      <h1 className="h1" style={{ margin: '4px 0 20px' }}>Ваши данные</h1>

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
                  <div style={{ fontSize: 13, color: syncStatus === 'error' ? 'var(--danger)' : 'var(--ink-3)' }}>
                    {syncStatus === 'synced' ? '☁ ' : ''}{SYNC_LABEL[syncStatus] || 'В облаке'}
                  </div>
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
            <button key={th.key} className={theme === th.key ? 'on' : ''} onClick={() => setTheme(th.key)}>{th.label}</button>
          ))}
        </div>
      </div>

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

      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 6 }}>Приватность и данные</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Вы можете выгрузить все свои данные или удалить их (DSGVO).</p>
        <button className="btn ghost" onClick={exportData}>Скачать мои данные (JSON)</button>
        {supabaseEnabled && user && (
          <button className="btn ghost" style={{ marginTop: 10, color: 'var(--danger)', borderColor: 'var(--border-strong)' }} disabled={busy} onClick={delAccount}>
            {busy ? 'Удаление…' : 'Удалить аккаунт и данные из облака'}
          </button>
        )}
      </div>

      {supabaseEnabled && user && (
        <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => auth.signOut()}>Выйти из аккаунта</button>
      )}

      <button className="btn ghost" style={{ marginTop: 12, color: 'var(--danger)', borderColor: 'var(--border-strong)' }} onClick={reset}>
        Сбросить профиль и данные
      </button>

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
