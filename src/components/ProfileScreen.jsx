import { useState, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { ACTIVITY, GOALS } from '../lib/nutrition.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import LazyBoundary from './LazyBoundary.jsx'
// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit). Грузим его
// только когда пользователь открывает вход — ядро приложения остаётся лёгким
// и надёжно работает офлайн. lazyWithReload самолечит сбой загрузки чанка.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))

const THEMES = [
  { key: 'system', label: 'Система' },
  { key: 'light', label: 'Светлая' },
  { key: 'dark', label: 'Тёмная' },
]

const SYNC_LABEL = { idle: '', syncing: 'Синхронизация…', synced: 'Синхронизировано', error: 'Ошибка синхронизации' }

export default function ProfileScreen() {
  const { profile, theme, setTheme, resetAll, supabaseEnabled, user, syncStatus, auth } = useStore()
  const t = profile.targets
  const [authOpen, setAuthOpen] = useState(false)
  const [myProfileOpen, setMyProfileOpen] = useState(false)

  const reset = () => {
    if (confirm('Сбросить профиль и все данные? Это действие нельзя отменить.')) resetAll()
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
        <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Дневная норма</div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <KV k="Калории" v={`${t.calories}`} />
          <KV k="Белки" v={`${t.protein} г`} />
          <KV k="Углеводы" v={`${t.carbs} г`} />
          <KV k="Жиры" v={`${t.fat} г`} />
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

      {supabaseEnabled && user && (
        <button className="btn ghost" style={{ marginTop: 20 }} onClick={() => auth.signOut()}>Выйти из аккаунта</button>
      )}

      <button className="btn ghost" style={{ marginTop: 12, color: 'var(--danger)', borderColor: 'var(--border-strong)' }} onClick={reset}>
        Сбросить профиль и данные
      </button>
      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', marginTop: 16 }}>
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
