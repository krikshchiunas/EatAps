// ─────────────────────────────────────────────────────────────────────────────
// Собственный профиль — публичная витрина, а не настройки.
//
// Экран отвечает на те же четыре вопроса, что и профиль друга: кто это, что он
// думает, что он ест, что рассказал о себе. Рисует его тот же UserProfileView,
// поэтому «как меня видит друг» — это буквально этот экран, а не догадка.
//
// Здесь же живут подписчики, подписки и события: всё, что относится ко МНЕ,
// собрано в одном месте. Раньше подписчики лежали в социальном хабе рядом с
// чужими списками, а «События» — во вкладке «Друзья», где о друзьях речи как
// раз и не идёт: на меня подписались, на мою мысль ответили, мне написали.
//
// Настройки (синхронизация, рост/вес, тема, уведомления, сеансы, удаление
// аккаунта) никуда не делись — они под шестерёнкой, в SettingsScreen.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useStore } from '../store.jsx'
import {
  userProfile, listFollowers, listFollowing, listMutuals, removeFollower,
  unreadNotificationCount, subscribeToNotifications, subscribeToFollowRequests,
  followRequestCount,
} from '../lib/social.js'
import FollowRequestsScreen from './social/FollowRequestsScreen.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import LazyBoundary from './LazyBoundary.jsx'
import PushScreen from './PushScreen.jsx'
import SettingsScreen from './SettingsScreen.jsx'
import UserProfileView from './UserProfileView.jsx'
import ProfileCounts from './ProfileCounts.jsx'
import PeopleList from './PeopleList.jsx'
import PublicProfile from './PublicProfile.jsx'
import NotificationsScreen from './NotificationsScreen.jsx'

// Ленивая загрузка: AuthSheet тянет тяжёлый Web3-стек (AppKit), MyProfileSheet
// — редактор с обработкой фото, ChallengesScreen открывает меньшинство. Ядро
// приложения остаётся лёгким.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))
const MyProfileSheet = lazyWithReload(() => import('./MyProfileSheet.jsx'))
const ChallengesScreen = lazyWithReload(() => import('./ChallengesScreen.jsx'))

const LIST_TITLE = {
  followers: 'Подписчики',
  following: 'Подписки',
  friends: 'Взаимные',
}

const LIST_EMPTY = {
  followers: 'На вас пока никто не подписан',
  following: 'Вы пока ни на кого не подписаны',
  friends: 'Здесь те, с кем вы подписаны друг на друга',
}

// «События» — это и уведомления, и челленджи. Соревнование с друзьями — тоже
// событие, а не постоянный раздел, и искать его человек шёл в единственное
// место, где о событиях вообще идёт речь.
const EVENT_TABS = [
  { key: 'feed',       label: 'Уведомления' },
  { key: 'requests',   label: 'Запросы' },
  { key: 'challenges', label: 'Челленджи' },
]

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.01c.27.63.87 1.04 1.55 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  )
}

export default function ProfileScreen({ setTab, onOpenChat }) {
  const { profile, days, dayOf, customFoods, user, supabaseEnabled } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [card, setCard] = useState(null)
  const [list, setList] = useState(null)      // null | 'followers' | 'following' | 'friends'
  const [people, setPeople] = useState(null)
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [openProfile, setOpenProfile] = useState(null)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [eventTab, setEventTab] = useState('feed')
  const [unreadEvents, setUnreadEvents] = useState(0)
  const [followRequests, setFollowRequests] = useState(0)
  const [focusTab, setFocusTab] = useState(null)

  const uid = user?.id

  // Ник и все четыре счётчика приезжают одним запросом. Отдельной системы
  // подсчёта друзей больше нет: две цифры об одном и том же рано или поздно
  // разойдутся, а user_profile считает их по тому же графу, что и сервер.
  const loadCard = useCallback(async () => {
    if (!uid) { setCard(null); return }
    try { setCard(await userProfile(uid)) } catch { setCard(null) }
  }, [uid])

  useEffect(() => { loadCard() }, [loadCard])

  // Счётчик непрочитанных событий — с сервера, а не из localStorage: он должен
  // совпадать на всех устройствах и переживать перезаход. Та же самая функция
  // питает бейдж в нижней навигации — второй системы уведомлений нет.
  const refreshEvents = useCallback(async () => {
    if (!uid) { setUnreadEvents(0); setFollowRequests(0); return }
    try { setUnreadEvents(await unreadNotificationCount()) } catch { /* раздел недоступен */ }
    try { setFollowRequests(await followRequestCount()) } catch { /* раздел недоступен */ }
  }, [uid])

  useEffect(() => {
    if (!uid) { setUnreadEvents(0); setFollowRequests(0); return }
    refreshEvents()
    // Два потока событий, а не один: просьба о подписке лежит в отдельной
    // таблице и в notifications приезжает отдельной строкой, но снятие
    // просьбы (одобрили с другого устройства) видно только по follow_requests.
    const offNotif = subscribeToNotifications(uid, refreshEvents)
    const offReq = subscribeToFollowRequests(uid, refreshEvents)
    return () => { offNotif(); offReq() }
  }, [uid, refreshEvents])

  // Список грузим только когда его открыли: на профиле их три, и тянуть все
  // три ради счётчиков, которые уже пришли в карточке, незачем.
  useEffect(() => {
    if (!list || !uid) { setPeople(null); setPeopleLoading(false); return }
    let alive = true
    setPeopleLoading(true)
    ;(async () => {
      try {
        const rows =
          list === 'followers' ? await listFollowers(uid) :
          list === 'following' ? await listFollowing(uid) :
          await listMutuals(uid)
        if (alive) setPeople(rows)
      } catch {
        if (alive) setPeople([])
      } finally {
        if (alive) setPeopleLoading(false)
      }
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

  // Подписчики, подписки и события — один блок «про меня» над вкладками
  // профиля. Бейдж на «Событиях» — те же непрочитанные, что считает сервер.
  const profileLinks = uid ? (
    <>
      <ProfileCounts card={card} onPick={setList} showThoughts={false} />
      <button
        className="card"
        style={{ width: '100%', textAlign: 'left', padding: '13px 14px', marginBottom: 16 }}
        onClick={() => setEventsOpen(true)}
      >
        <div className="row between" style={{ alignItems: 'center' }}>
          <span className="row gap8" style={{ alignItems: 'center', fontSize: 15, fontWeight: 600 }}>
            События
            {(unreadEvents + followRequests) > 0 && (
              <span style={{
                minWidth: 20, height: 20, borderRadius: 999,
                background: 'var(--danger)', color: 'var(--on-danger)', fontSize: 11.5, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px',
              }}>
                {unreadEvents + followRequests > 99 ? '99+' : unreadEvents + followRequests}
              </span>
            )}
          </span>
          <span className="muted" style={{ fontSize: 18, lineHeight: 1 }}>›</span>
        </div>
      </button>
    </>
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
        counts={profileLinks}
        onEditProfile={() => setEditOpen(true)}
        signInPrompt={signInPrompt}
        focusTab={focusTab}
        onFocusHandled={() => setFocusTab(null)}
      />

      {list && (
        <PushScreen onClose={() => setList(null)}>
          {(close) => (
            <div className="screen">
              <div className="row between" style={{ alignItems: 'center', marginBottom: 16 }}>
                <h1 className="h1" style={{ margin: 0, fontSize: 22 }}>{LIST_TITLE[list]}</h1>
                <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
              </div>
              <PeopleList
                people={people || []}
                loading={peopleLoading}
                myId={uid}
                onOpen={setOpenProfile}
                empty={LIST_EMPTY[list]}
                searchable
                context={list === 'followers' ? 'followers' : 'profile'}
                onRefresh={loadCard}
                /* Убрать можно только СВОЕГО подписчика: в остальных списках
                   такой кнопки нет — там нечего убирать. */
                actions={list === 'followers'
                  ? (p) => (
                    <button
                      className="btn ghost"
                      style={{ width: 'auto', height: 32, padding: '0 12px', fontSize: 13, flex: '0 0 auto', color: 'var(--ink-3)' }}
                      onClick={() => setConfirmRemove(p)}
                    >
                      Убрать
                    </button>
                  )
                  : null}
              />
            </div>
          )}
        </PushScreen>
      )}

      {eventsOpen && (
        <PushScreen onClose={() => setEventsOpen(false)}>
          {(close) => (
            <div className="screen">
              <div className="row between" style={{ alignItems: 'center', marginBottom: 16 }}>
                <h1 className="h1" style={{ margin: 0, fontSize: 22 }}>События</h1>
                <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
              </div>

              <div className="seg" style={{ marginBottom: 14 }}>
                {EVENT_TABS.map((t) => (
                  <button key={t.key} className={eventTab === t.key ? 'on' : ''} onClick={() => setEventTab(t.key)}>
                    {t.label}
                    {t.key === 'requests' && followRequests > 0 && (
                      <span style={{
                        marginLeft: 6, minWidth: 18, height: 18, borderRadius: 999,
                        background: 'var(--danger)', color: 'var(--on-danger)',
                        fontSize: 11, fontWeight: 700, padding: '0 5px',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {followRequests > 99 ? '99+' : followRequests}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {eventTab === 'feed' && (
                <NotificationsScreen
                  onChanged={refreshEvents}
                  onNavigate={(t) => {
                    if (t.screen === 'profile') { close(); setOpenProfile(t.userId) }
                    // Реакции и ответы приходят только на СВОИ мысли, поэтому
                    // пост всегда лежит в этом же профиле: закрываем события и
                    // открываем вкладку «Мысли», а не ищем его в ленте.
                    else if (t.screen === 'post') { close(); setFocusTab('thoughts') }
                    // Переписка живёт во вкладке «Общение» — туда и ведём, с
                    // открытым диалогом. Второго чата в профиле не заводим.
                    //
                    // Личное событие адресовано СОБЕСЕДНИКОМ, групповое —
                    // диалогом: у группы собеседника нет, и открывать её по
                    // id человека было бы нечем.
                    else if (t.screen === 'chat') {
                      close()
                      if (onOpenChat) onOpenChat({ userId: t.userId, conversationId: t.conversationId })
                      else if (t.userId) setOpenProfile(t.userId)
                    }
                  }}
                />
              )}

              {eventTab === 'requests' && (
                <FollowRequestsScreen
                  onOpenProfile={(id) => { close(); setOpenProfile(id) }}
                  onChanged={() => { refreshEvents(); loadCard() }}
                />
              )}

              {eventTab === 'challenges' && (
                <LazyBoundary onClose={() => setEventTab('feed')}>
                  <Suspense fallback={<p className="muted" style={{ fontSize: 14 }}>Загружаем…</p>}>
                    <ChallengesScreen />
                  </Suspense>
                </LazyBoundary>
              )}
            </div>
          )}
        </PushScreen>
      )}

      {openProfile && (
        <PublicProfile
          userId={openProfile}
          onClose={() => { setOpenProfile(null); loadCard() }}
          onOpenProfile={setOpenProfile}
          onOpenChat={onOpenChat ? (peer) => { setOpenProfile(null); onOpenChat(peer.id) } : null}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          text={`Убрать ${confirmRemove.display_name || confirmRemove.username || 'этого человека'} из подписчиков? Он перестанет видеть ваши записи для подписчиков. Уведомления об этом он не получит и сможет подписаться снова.`}
          onYes={async () => {
            const person = confirmRemove
            setConfirmRemove(null)
            const res = await removeFollower(person.user_id)
            if (res?.error) return
            setPeople((prev) => (prev || []).filter((p) => p.user_id !== person.user_id))
            loadCard() // счётчик подписчиков уменьшился
          }}
          onNo={() => setConfirmRemove(null)}
        />
      )}

      {settingsOpen && (
        <PushScreen onClose={() => setSettingsOpen(false)}>
          {(close) => (
            <SettingsScreen
              onClose={close}
              onOpenProfile={(id) => { close(); setOpenProfile(id) }}
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
