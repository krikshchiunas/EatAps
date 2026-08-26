// ─────────────────────────────────────────────────────────────────────────────
// Собственный профиль — публичная витрина, а не настройки.
//
// Экран отвечает на те же четыре вопроса, что и профиль друга: кто это, что он
// любит и не любит, что он ест, чем делится. Рисует его тот же UserProfileView,
// поэтому «как меня видит друг» — это буквально этот экран, а не догадка.
//
// Здесь же живут подписчики и подписки: они переехали из социального хаба, где
// лежали рядом с чужими списками. Списки про МЕНЯ должны быть там же, где
// остальное про меня, — иначе «мои подписки» приходится искать во вкладке
// «Друзья», что и происходило.
//
// Настройки (синхронизация, рост/вес, тема, уведомления, сеансы, удаление
// аккаунта) никуда не делись — они под шестерёнкой, в SettingsScreen.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { userProfile, listFollowers, listFollowing } from '../lib/social.js'
import { listFriends } from '../lib/supabase.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import LazyBoundary from './LazyBoundary.jsx'
import PushScreen from './PushScreen.jsx'
import SettingsScreen from './SettingsScreen.jsx'
import UserProfileView from './UserProfileView.jsx'
import ProfileCounts from './ProfileCounts.jsx'
import PeopleList from './PeopleList.jsx'
import PublicProfile from './PublicProfile.jsx'

// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit), MyProfileSheet
// — редактор с обработкой фото. Ядро приложения остаётся лёгким.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))

const LIST_TITLE = {
  followers: 'Подписчики',
  following: 'Подписки',
  friends: 'Друзья',
}

const LIST_EMPTY = {
  followers: 'На вас пока никто не подписан',
  following: 'Вы пока ни на кого не подписаны',
  friends: 'Друзья появляются, когда вы подписаны друг на друга',
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.01c.27.63.87 1.04 1.55 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  )
}

export default function ProfileScreen({ setTab }) {
  const { profile, days, dayOf, customFoods, user, supabaseEnabled } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [card, setCard] = useState(null)
  const [list, setList] = useState(null)      // null | 'followers' | 'following' | 'friends'
  const [people, setPeople] = useState(null)
  const [openProfile, setOpenProfile] = useState(null)

  const uid = user?.id

  // Ник и все четыре счётчика приезжают одним запросом. Отдельной системы
  // подсчёта друзей больше нет: две цифры об одном и том же рано или поздно
  // разойдутся, а user_profile считает их по тому же графу, что и сервер.
  const loadCard = useCallback(async () => {
    if (!uid) { setCard(null); return }
    try { setCard(await userProfile(uid)) } catch { setCard(null) }
  }, [uid])

  useEffect(() => { loadCard() }, [loadCard])

  // Список грузим только когда его открыли: на профиле их три, и тянуть все
  // три ради счётчиков, которые уже пришли в карточке, незачем.
  useEffect(() => {
    if (!list || !uid) { setPeople(null); return }
    let alive = true
    ;(async () => {
      try {
        const rows =
          list === 'followers' ? await listFollowers(uid) :
          list === 'following' ? await listFollowing(uid) :
          // Друзья приходят в форме чата ({ id, name, avatar }), а PeopleList
          // ждёт карточку профиля. Переводим здесь, а не заводим второй RPC.
          (await listFriends(uid)).map((f) => ({
            user_id: f.id, username: f.username, display_name: f.name, avatar_url: f.avatar,
          }))
        if (alive) setPeople(rows)
      } catch { if (alive) setPeople([]) }
    })()
    return () => { alive = false }
  }, [list, uid])

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
        username={card?.username || null}
        dayOf={dayOf}
        days={days}
        customFoods={customFoods}
        counts={uid ? <ProfileCounts card={card} onPick={setList} showThoughts={false} /> : null}
        onEditProfile={() => setEditOpen(true)}
        signInPrompt={signInPrompt}
      />

      {list && (
        <PushScreen onClose={() => setList(null)}>
          {(close) => (
            <div className="screen">
              <div className="row between" style={{ alignItems: 'center', marginBottom: 16 }}>
                <h1 className="h1" style={{ margin: 0, fontSize: 22 }}>{LIST_TITLE[list]}</h1>
                <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
              </div>
              {people === null
                ? <p className="muted" style={{ fontSize: 14 }}>Загружаем…</p>
                : <PeopleList people={people} myId={uid} onOpen={setOpenProfile} empty={LIST_EMPTY[list]} />}
            </div>
          )}
        </PushScreen>
      )}

      {openProfile && (
        <PublicProfile
          userId={openProfile}
          onClose={() => { setOpenProfile(null); loadCard() }}
          onOpenProfile={setOpenProfile}
        />
      )}

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
            {/* Ник мог смениться — перечитываем карточку, иначе под именем
                останется старый. */}
            <MyProfileSheet onClose={() => { setEditOpen(false); loadCard() }} />
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
