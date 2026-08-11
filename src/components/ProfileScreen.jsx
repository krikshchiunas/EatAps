// ─────────────────────────────────────────────────────────────────────────────
// Собственный профиль — публичная витрина, а не настройки.
//
// Экран отвечает на те же четыре вопроса, что и профиль друга: кто это, что он
// любит и не любит, что он ест, чем делится. Рисует его тот же UserProfileView,
// поэтому «как меня видит друг» — это буквально этот экран, а не догадка.
//
// Настройки (синхронизация, рост/вес, тема, уведомления, сеансы, удаление
// аккаунта) никуда не делись — они под шестерёнкой, в SettingsScreen.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { listFriendships, getMyPublicId } from '../lib/supabase.js'
import { formatPublicId } from '../lib/publicId.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import LazyBoundary from './LazyBoundary.jsx'
import PushScreen from './PushScreen.jsx'
import SettingsScreen from './SettingsScreen.jsx'
import UserProfileView from './UserProfileView.jsx'

// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit), MyProfileSheet
// — редактор с обработкой фото. Ядро приложения остаётся лёгким.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.01c.27.63.87 1.04 1.55 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  )
}

export default function ProfileScreen({ setTab }) {
  const { profile, dayOf, customFoods, user, supabaseEnabled } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [friendsCount, setFriendsCount] = useState(null)
  const [publicId, setPublicId] = useState(null)

  const uid = user?.id
  // Счёт друзей — из того же источника, что и экран «Друзья». Отдельной
  // системы подсчёта не заводим: две цифры о друзьях рано или поздно разойдутся.
  useEffect(() => {
    if (!uid) { setFriendsCount(null); return }
    let cancelled = false
    listFriendships(uid)
      .then((l) => { if (!cancelled) setFriendsCount(l.friends.length) })
      .catch(() => { if (!cancelled) setFriendsCount(null) })
    return () => { cancelled = true }
  }, [uid])

  useEffect(() => {
    if (!uid) { setPublicId(null); return }
    let cancelled = false
    getMyPublicId(uid).then((id) => { if (!cancelled) setPublicId(id) })
    return () => { cancelled = true }
  }, [uid])

  // Вход раньше жил первой карточкой на этом экране. Витрина его вытеснила,
  // поэтому приглашение остаётся здесь же, во вкладке «Я»: гость не должен
  // искать вход внутри настроек.
  const signInPrompt = supabaseEnabled && !user ? (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
        Войдите — профиль станет виден друзьям, а данные будут в облаке.
      </p>
      <button className="btn" onClick={() => setAuthOpen(true)}>Войти или зарегистрироваться</button>
    </div>
  ) : null

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Профиль</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Это вы</h1>
        </div>
        <button className="iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Настройки" style={{ flex: '0 0 auto' }}>
          <GearIcon />
        </button>
      </div>

      <UserProfileView
        isOwnProfile
        userId={uid || null}
        profile={profile || {}}
        publicId={publicId ? formatPublicId(publicId) : null}
        dayOf={dayOf}
        customFoods={customFoods}
        friendsCount={friendsCount}
        onOpenFriends={setTab ? () => setTab('friends') : null}
        onEditProfile={() => setEditOpen(true)}
        signInPrompt={signInPrompt}
      />

      {settingsOpen && (
        <PushScreen onClose={() => setSettingsOpen(false)}>
          {(close) => (
            <SettingsScreen
              onClose={close}
              onOpenFriends={setTab ? () => { close(); setTab('friends') } : null}
            />
          )}
        </PushScreen>
      )}

      {editOpen && (
        <LazyBoundary onClose={() => setEditOpen(false)}>
          <Suspense fallback={null}>
            <MyProfileSheet onClose={() => setEditOpen(false)} />
          </Suspense>
        </LazyBoundary>
      )}

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
