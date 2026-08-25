import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useStore } from '../store.jsx'
import { listFriendships, listConversations, acceptFriend, removeFriendship } from '../lib/supabase.js'
import { getMutedFriends, toggleFriendMuted, forgetMutedFriend } from '../lib/notifications.js'
import AddFriendSheet from './AddFriendSheet.jsx'
import ChatView from './ChatView.jsx'
import FeedScreen from './FeedScreen.jsx'
import UserSearch from './UserSearch.jsx'
import PeopleList from './PeopleList.jsx'
import PublicProfile from './PublicProfile.jsx'
import NotificationsScreen from './NotificationsScreen.jsx'
import { listFollowers, listFollowing, unreadNotificationCount, subscribeToNotifications } from '../lib/social.js'

// Разделы социального хаба. Лента стоит первой намеренно: раньше экран был
// списком друзей с чатами, и «социальная» часть приложения начиналась и
// заканчивалась перепиской. Теперь первое, что человек видит, — что происходит
// у людей, на которых он подписан.
const VIEWS = [
  { key: 'feed',    label: 'Лента' },
  { key: 'friends', label: 'Друзья' },
  { key: 'people',  label: 'Люди' },
  { key: 'events',  label: 'События' },
]

// ── localStorage helpers ──────────────────────────────────────────────────────
// Список заглушённых живёт в notifications.js: его читает не этот экран, а
// обработчик входящих сообщений. Здесь только закрепление.
const PINNED_KEY = 'eataps:friends:pinned'

const getArr = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
// В приватном режиме iOS Safari setItem бросает — закрепление тогда не
// сохранится между запусками, но экран не упадёт.
const setArr = (key, arr) => { try { localStorage.setItem(key, JSON.stringify(arr)) } catch {} }

function getPinned() { return getArr(PINNED_KEY) }

// Друга удалили — убираем его и из закреплённых. Иначе список копит id людей,
// которых уже нет: они не мешают, но занимают одну из десяти позиций.
function forgetPinned(id) {
  const next = getPinned().filter((x) => x !== id)
  setArr(PINNED_KEY, next)
  return next
}

function togglePin(id) {
  let arr = getPinned()
  if (arr.includes(id)) {
    setArr(PINNED_KEY, arr.filter(x => x !== id))
    return { ok: true }
  }
  if (arr.length >= 10) return { error: 'Максимум 10 закреплённых' }
  setArr(PINNED_KEY, [id, ...arr])
  return { ok: true }
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({ src, name, size = 44 }) {
  if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--primary-weak)', color: 'var(--primary-strong)',
      display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 600, flex: '0 0 auto',
    }}>
      {(name || '?').trim().slice(0, 1).toUpperCase()}
    </div>
  )
}

// ── Friend card dropdown menu ─────────────────────────────────────────────────
// Иконка пункта: те же обводки и толщина, что в контекст-меню чата, чтобы меню
// приложения выглядели одинаково.
function MenuIco({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  )
}

const ICON = {
  pin:   'M12 17v5 M8.5 3h7l-.7 6.2 2.6 3.1a1 1 0 0 1-.8 1.7H6.4a1 1 0 0 1-.8-1.7l2.6-3.1L7.5 3',
  unpin: 'M12 17v5 M8.5 3h7l-.7 6.2 2.6 3.1a1 1 0 0 1-.8 1.7H6.4a1 1 0 0 1-.8-1.7l2.6-3.1L7.5 3 M3 3l18 18',
  mute:  'M11 5 6 9H2v6h4l5 4V5z M23 9l-6 6 M17 9l6 6',
  unmute:'M11 5 6 9H2v6h4l5 4V5z M16 8.5a5 5 0 0 1 0 7 M19 5.5a9 9 0 0 1 0 13',
  remove:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 11h5',
}

function FriendMenu({ isPinned, isMuted, onPin, onMute, onRemove, onClose, menuErr, dropUp }) {
  const ref = useRef(null)
  useEffect(() => {
    const handle = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [])

  return (
    <div
      ref={ref}
      className={`friend-menu${dropUp ? ' up' : ''}`}
      role="menu"
      onClick={e => e.stopPropagation()}
    >
      <button role="menuitem" onClick={onPin}>
        <MenuIco d={isPinned ? ICON.unpin : ICON.pin} />
        {isPinned ? 'Открепить' : 'Закрепить'}
      </button>
      <button role="menuitem" onClick={onMute}>
        <MenuIco d={isMuted ? ICON.unmute : ICON.mute} />
        {isMuted ? 'Включить уведомления' : 'Заглушить'}
      </button>
      <button role="menuitem" className="danger" onClick={onRemove}>
        <MenuIco d={ICON.remove} />
        Удалить из друзей
      </button>
      {menuErr && <div className="friend-menu-err">{menuErr}</div>}
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FriendsScreen({ unreadCounts = {}, onChatClosed, setTab }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [lists, setLists] = useState({ friends: [], incoming: [], outgoing: [] })
  const [convs, setConvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [chatFriend, setChatFriend] = useState(null)
  const [openMenu, setOpenMenu] = useState(null) // friend.id with open menu
  const [dropUp, setDropUp] = useState(false)    // раскрывать меню вверх
  const [menuErr, setMenuErr] = useState(null)
  const [view, setView] = useState('feed')
  const [profileUser, setProfileUser] = useState(null)
  const [peopleTab, setPeopleTab] = useState('search') // search | followers | following
  const [myPeople, setMyPeople] = useState(null)
  const [unreadEvents, setUnreadEvents] = useState(0)
  const [pinned, setPinned] = useState(getPinned)
  const [muted, setMuted] = useState(getMutedFriends)
  const screenRef = useRef(null)
  const gestureRef = useRef(null)
  const navigatingRef = useRef(false)
  const chatFriendRef = useRef(chatFriend)
  useEffect(() => { chatFriendRef.current = chatFriend }, [chatFriend])

  // Свайп между вкладками: экран приклеен к пальцу (прямой DOM, без re-render),
  // directional lock (после захвата — только по X), переключение вкладки только
  // ПОСЛЕ доводки. Свайп вправо → День, влево → Профиль.
  useEffect(() => {
    const el = screenRef.current
    if (!el || !setTab) return
    const EASING = 'cubic-bezier(0.32,0.72,0,1)'
    let anim = null
    const cancel = () => { try { anim?.cancel() } catch {} anim = null }
    const paint = (x) => { el.style.transform = `translate3d(${x}px,0,0)` }

    const commit = (toTab, from) => {
      navigatingRef.current = true
      const W = window.innerWidth
      const target = (toTab === 'day' ? 1 : -1) * W
      cancel()
      anim = el.animate([{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }], { duration: 240, easing: EASING, fill: 'forwards' })
      anim.onfinish = () => setTab(toTab) // размонтирует экран → новая вкладка
    }
    const springBack = (from, vel) => {
      cancel()
      const dur = Math.max(180, Math.min(360, Math.abs(from) / Math.max(0.9, Math.abs(vel))))
      anim = el.animate([{ transform: `translate3d(${from}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: dur, easing: EASING, fill: 'forwards' })
      anim.onfinish = () => { el.style.transform = 'translate3d(0,0,0)'; cancel() }
    }

    const onTS = (e) => {
      if (navigatingRef.current || chatFriendRef.current) return
      const t = e.touches[0]
      cancel()
      gestureRef.current = { x: t.clientX, y: t.clientY, decided: false, horiz: false, lastX: t.clientX, lastT: e.timeStamp, vel: 0, cur: 0 }
    }
    const onTM = (e) => {
      const g = gestureRef.current
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x, dy = t.clientY - g.y
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        g.horiz = Math.abs(dx) > Math.abs(dy) * 1.3
        g.decided = true
        if (!g.horiz) { gestureRef.current = null; return } // вертикаль → скролл
      }
      // Захвачено как горизонталь: дальше только X, вертикаль игнорируем.
      e.preventDefault()
      const dt = e.timeStamp - g.lastT
      if (dt > 0) g.vel = (t.clientX - g.lastX) / dt
      g.lastX = t.clientX; g.lastT = e.timeStamp
      g.cur = dx
      paint(dx)
    }
    const onTE = () => {
      const g = gestureRef.current
      gestureRef.current = null
      if (!g || !g.horiz) return
      const dx = g.cur, v = g.vel
      if (v > 0.35 || dx > 90) commit('day', dx)
      else if (v < -0.35 || dx < -90) commit('profile', dx)
      else springBack(dx, v)
    }

    el.addEventListener('touchstart', onTS, { passive: true })
    el.addEventListener('touchmove', onTM, { passive: false })
    el.addEventListener('touchend', onTE, { passive: true })
    el.addEventListener('touchcancel', onTE, { passive: true })
    return () => {
      cancel()
      el.removeEventListener('touchstart', onTS)
      el.removeEventListener('touchmove', onTM)
      el.removeEventListener('touchend', onTE)
      el.removeEventListener('touchcancel', onTE)
    }
  }, [setTab])

  const reload = async () => {
    try {
      setLoading(true)
      const [l, c] = await Promise.all([listFriendships(myId), listConversations(myId)])
      setLists(l)
      setConvs(c)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { if (myId) reload(); else setLoading(false) }, [myId])

  // Счётчик непрочитанных событий — с сервера, а не из localStorage: он должен
  // совпадать на всех устройствах и переживать перезаход.
  const refreshEvents = useCallback(async () => {
    if (!myId) return
    try { setUnreadEvents(await unreadNotificationCount()) } catch { /* раздел недоступен */ }
  }, [myId])

  useEffect(() => {
    if (!myId) return
    refreshEvents()
    return subscribeToNotifications(myId, refreshEvents)
  }, [myId, refreshEvents])

  useEffect(() => {
    if (view !== 'people' || peopleTab === 'search') return
    let alive = true
    ;(async () => {
      try {
        const list = peopleTab === 'followers' ? await listFollowers(myId) : await listFollowing(myId)
        if (alive) setMyPeople(list)
      } catch { if (alive) setMyPeople([]) }
    })()
    return () => { alive = false }
  }, [view, peopleTab, myId])

  const act = async (fn) => { setBusy(true); await fn(); setBusy(false); reload() }

  const lastById = useMemo(() => new Map(convs.map(c => [c.id, c.last])), [convs])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    let arr = q ? lists.friends.filter(f => (f.name || '').toLowerCase().includes(q)) : lists.friends
    return [...arr].sort((a, b) => {
      const aPin = pinned.indexOf(a.id), bPin = pinned.indexOf(b.id)
      if (aPin !== -1 && bPin !== -1) return aPin - bPin
      if (aPin !== -1) return -1
      if (bPin !== -1) return 1
      const ta = lastById.has(a.id) ? Date.parse(lastById.get(a.id).created_at) : 0
      const tb = lastById.has(b.id) ? Date.parse(lastById.get(b.id).created_at) : 0
      return tb - ta
    })
  }, [lists.friends, query, pinned, lastById])

  const handlePin = (id) => {
    const res = togglePin(id)
    if (res.error) { setMenuErr(res.error); return }
    setPinned(getPinned()); setOpenMenu(null); setMenuErr(null)
  }

  const handleMute = (id) => {
    setMuted(toggleFriendMuted(id)); setOpenMenu(null)
  }

  const handleRemove = async (rowId, friendId) => {
    setOpenMenu(null); setBusy(true)
    await removeFriendship(rowId)
    setPinned(forgetPinned(friendId))
    setMuted(forgetMutedFriend(friendId))
    setBusy(false); reload()
  }

  const swipeStyle = { willChange: 'transform', touchAction: 'pan-y' }

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen" ref={screenRef} style={swipeStyle}>
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Друзья</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Войдите в аккаунт (вкладка «Профиль»), чтобы добавлять друзей.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen" ref={screenRef} style={swipeStyle} onClick={() => openMenu && setOpenMenu(null)}>
      <div className="row between" style={{ alignItems: 'center', margin: '0 0 14px' }}>
        <h1 className="h1" style={{ margin: '4px 0 0' }}>Общение</h1>
        <button className="btn" style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 14 }} onClick={() => setAddOpen(true)}>
          ＋ По ID
        </button>
      </div>

      <div className="seg" style={{ marginBottom: 16, overflowX: 'auto' }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={view === v.key ? 'on' : ''}
            onClick={() => setView(v.key)}
            style={{ position: 'relative', whiteSpace: 'nowrap' }}
          >
            {v.label}
            {v.key === 'events' && unreadEvents > 0 && (
              <span style={{
                marginLeft: 6, minWidth: 18, height: 18, borderRadius: 999,
                background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
              }}>
                {unreadEvents > 99 ? '99+' : unreadEvents}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === 'feed' && <FeedScreen onOpenProfile={setProfileUser} />}

      {view === 'events' && (
        <NotificationsScreen
          onChanged={refreshEvents}
          onNavigate={(t) => {
            if (t.screen === 'profile') setProfileUser(t.userId)
            else if (t.screen === 'requests') setView('friends')
            // Реакции и ответы приходят только на СВОИ мысли, поэтому пост
            // всегда лежит в собственном профиле — туда и открываем, а не в
            // ленту, где его пришлось бы искать прокруткой.
            else if (t.screen === 'post') setProfileUser(myId)
            else if (t.screen === 'chat') {
              const f = lists.friends.find((x) => x.id === t.userId)
              if (f) setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, rowId: f.rowId })
              else setProfileUser(t.userId)
            }
          }}
        />
      )}

      {view === 'people' && (
        <div>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={peopleTab === 'search' ? 'on' : ''} onClick={() => setPeopleTab('search')}>Поиск</button>
            <button className={peopleTab === 'followers' ? 'on' : ''} onClick={() => setPeopleTab('followers')}>Подписчики</button>
            <button className={peopleTab === 'following' ? 'on' : ''} onClick={() => setPeopleTab('following')}>Подписки</button>
          </div>
          {peopleTab === 'search'
            ? <UserSearch onOpenProfile={setProfileUser} />
            : <PeopleList
                people={myPeople || []}
                myId={myId}
                onOpen={setProfileUser}
                empty={peopleTab === 'followers' ? 'На вас пока никто не подписан' : 'Вы пока ни на кого не подписаны'}
              />}
        </div>
      )}

      {view === 'friends' && (<>
      {/* Поиск */}
      <div className="field" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Поиск по нику…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ height: 46, fontSize: 15 }}
        />
      </div>

      {/* Входящие заявки */}
      {lists.incoming.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Заявки · {lists.incoming.length}
          </div>
          {lists.incoming.map((r) => (
            <div key={r.rowId} className="card" style={{ marginBottom: 8, padding: '10px 14px' }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <div className="row gap12" style={{ alignItems: 'center', minWidth: 0 }}>
                  <Avatar name={r.name} />
                  <div style={{ fontWeight: 600 }}>{r.name || 'Пользователь'}</div>
                </div>
                <div className="row gap8" style={{ flex: '0 0 auto' }}>
                  <button className="btn" style={{ width: 'auto', height: 36, padding: '0 14px', fontSize: 13 }} disabled={busy} onClick={() => act(() => acceptFriend(r.rowId))}>Принять</button>
                  <button className="btn ghost" style={{ width: 'auto', height: 36, padding: '0 14px', fontSize: 13 }} disabled={busy} onClick={() => act(() => removeFriendship(r.rowId))}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Список друзей */}
      {loading ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : sorted.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>
            {query ? 'Никого не нашли.' : 'Пока никого нет. Нажмите «＋ Добавить» и вставьте ID друга.'}
          </p>
        </div>
      ) : sorted.map((f) => {
        const isPinned = pinned.includes(f.id)
        const isMuted  = muted.includes(f.id)
        const unread   = unreadCounts[f.id] || 0
        const isMenuOpen = openMenu === f.id

        return (
          <div key={f.rowId} style={{ position: 'relative', marginBottom: 8 }}>
            <button
              className="card"
              style={{ padding: '12px 48px 12px 14px', width: '100%', textAlign: 'left' }}
              onClick={() => setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, rowId: f.rowId })}
            >
              <div className="row gap12" style={{ alignItems: 'center' }}>
                <Avatar src={f.avatar} name={f.name} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row gap8" style={{ alignItems: 'center' }}>
                    {isPinned && (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="var(--primary)" style={{ flex: '0 0 auto', opacity: 0.8 }}>
                        <path d="M17 4v7l2 3H5l2-3V4h10zm-5 16a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2zm0-18h1V1h-2v1h1z"/>
                      </svg>
                    )}
                    <span style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name || 'Друг'}
                    </span>
                    {isMuted && (
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
                        <path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/>
                      </svg>
                    )}
                  </div>
                </div>
                {unread > 0 && (
                  <span style={{
                    minWidth: 22, height: 22, borderRadius: 999,
                    background: 'var(--danger)', color: '#fff',
                    fontSize: 12, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px', flex: '0 0 auto',
                  }}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </div>
            </button>

            {/* ⋯ кнопка */}
            <button
              className={`friend-more${isMenuOpen ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setMenuErr(null)
                // Если до низа экрана меньше его высоты — раскрываем вверх,
                // иначе у последних друзей в списке меню уезжало за край.
                const r = e.currentTarget.getBoundingClientRect()
                setDropUp(window.innerHeight - r.bottom < 210)
                setOpenMenu(isMenuOpen ? null : f.id)
              }}
              aria-label="Действия"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>

            {/* Dropdown меню */}
            {isMenuOpen && (
              <FriendMenu
                isPinned={isPinned}
                isMuted={isMuted}
                menuErr={menuErr}
                dropUp={dropUp}
                onPin={() => handlePin(f.id)}
                onMute={() => handleMute(f.id)}
                onRemove={() => handleRemove(f.rowId, f.id)}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        )
      })}

      </>)}

      {addOpen && <AddFriendSheet onClose={() => setAddOpen(false)} onSent={reload} />}

      {profileUser && (
        <PublicProfile
          userId={profileUser}
          onClose={() => { setProfileUser(null); reload() }}
          onOpenProfile={setProfileUser}
          onOpenChat={(uid) => {
            const f = lists.friends.find((x) => x.id === uid)
            if (f) { setProfileUser(null); setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, rowId: f.rowId }) }
          }}
        />
      )}

      {chatFriend && (
        <ChatView
          friend={chatFriend}
          onClose={() => { setChatFriend(null); onChatClosed?.() }}
        />
      )}
    </div>
  )
}
