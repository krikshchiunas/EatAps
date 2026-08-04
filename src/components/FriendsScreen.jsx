import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { listFriendships, listConversations, acceptFriend, removeFriendship } from '../lib/supabase.js'
import AddFriendSheet from './AddFriendSheet.jsx'
import ChatView from './ChatView.jsx'

// ── localStorage helpers ──────────────────────────────────────────────────────
const PINNED_KEY = 'eataps:friends:pinned'
const MUTED_KEY  = 'eataps:friends:muted'

const getArr = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
const setArr = (key, arr) => localStorage.setItem(key, JSON.stringify(arr))

function getPinned() { return getArr(PINNED_KEY) }
function getMuted()  { return getArr(MUTED_KEY) }

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

function toggleMute(id) {
  const arr = getMuted()
  setArr(MUTED_KEY, arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id])
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
function FriendMenu({ friend, isPinned, isMuted, onPin, onMute, onRemove, onClose, menuErr }) {
  const ref = useRef(null)
  useEffect(() => {
    const handle = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [])

  return (
    <div ref={ref} className="friend-menu" onClick={e => e.stopPropagation()}>
      <button onClick={onPin}>{isPinned ? 'Открепить' : 'Закрепить'}</button>
      <button onClick={onMute}>{isMuted ? 'Включить уведомления' : 'Заглушить'}</button>
      <button onClick={onRemove} style={{ color: 'var(--danger)' }}>Удалить из друзей</button>
      {menuErr && <div style={{ fontSize: 12, color: 'var(--danger)', padding: '4px 12px 8px' }}>{menuErr}</div>}
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
  const [menuErr, setMenuErr] = useState(null)
  const [pinned, setPinned] = useState(getPinned)
  const [muted, setMuted] = useState(getMuted)
  const [dragX, setDragX] = useState(0)
  const transEnabledRef = useRef(false)
  const navigatingRef = useRef(false)
  const screenRef = useRef(null)
  const chatFriendRef = useRef(chatFriend)
  useEffect(() => { chatFriendRef.current = chatFriend }, [chatFriend])

  useEffect(() => {
    const el = screenRef.current
    if (!el || !setTab) return
    let sx = null, sy = null, decided = false, horiz = false

    const navigate = (toTab) => {
      if (navigatingRef.current) return
      navigatingRef.current = true
      const W = window.innerWidth
      const dir = toTab === 'day' ? 1 : -1
      transEnabledRef.current = true
      setDragX(dir > 0 ? W : -W)
      setTimeout(() => {
        transEnabledRef.current = false
        setDragX(0)
        setTab(toTab)
        navigatingRef.current = false
      }, 230)
    }

    const onTS = (e) => {
      if (navigatingRef.current || chatFriendRef.current) return
      sx = e.touches[0].clientX; sy = e.touches[0].clientY
      decided = false; horiz = false
    }
    const onTM = (e) => {
      if (sx === null) return
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy
      if (!decided && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
        decided = true; horiz = Math.abs(dx) > Math.abs(dy) * 1.3
      }
      if (horiz) { e.preventDefault(); setDragX(e.touches[0].clientX - sx) }
    }
    const onTE = (e) => {
      if (sx === null || !horiz) { sx = null; return }
      const dx = e.changedTouches[0].clientX - sx
      sx = null; horiz = false; decided = false
      if (dx > 100) navigate('day')
      else if (dx < -100) navigate('profile')
      else { transEnabledRef.current = true; setDragX(0); setTimeout(() => { transEnabledRef.current = false }, 280) }
    }
    el.addEventListener('touchstart', onTS, { passive: true })
    el.addEventListener('touchmove', onTM, { passive: false })
    el.addEventListener('touchend', onTE, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTS)
      el.removeEventListener('touchmove', onTM)
      el.removeEventListener('touchend', onTE)
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
    toggleMute(id); setMuted(getMuted()); setOpenMenu(null)
  }

  const handleRemove = async (rowId) => {
    setOpenMenu(null); setBusy(true)
    await removeFriendship(rowId)
    setBusy(false); reload()
  }

  const swipeStyle = {
    transform: `translateX(${dragX}px)`,
    transition: transEnabledRef.current ? 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' : 'none',
    willChange: 'transform',
  }

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
      <div className="row between" style={{ alignItems: 'center', margin: '0 0 16px' }}>
        <h1 className="h1" style={{ margin: '4px 0 0' }}>Друзья</h1>
        <button className="btn" style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 14 }} onClick={() => setAddOpen(true)}>
          ＋ Добавить
        </button>
      </div>

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
              className="iconbtn"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                width: 34, height: 34, background: 'transparent', border: 'none',
              }}
              onClick={(e) => { e.stopPropagation(); setMenuErr(null); setOpenMenu(isMenuOpen ? null : f.id) }}
              aria-label="Действия"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>

            {/* Dropdown меню */}
            {isMenuOpen && (
              <FriendMenu
                friend={f}
                isPinned={isPinned}
                isMuted={isMuted}
                menuErr={menuErr}
                onPin={() => handlePin(f.id)}
                onMute={() => handleMute(f.id)}
                onRemove={() => handleRemove(f.rowId)}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        )
      })}

      {addOpen && <AddFriendSheet onClose={() => setAddOpen(false)} onSent={reload} />}

      {chatFriend && (
        <ChatView
          friend={chatFriend}
          onClose={() => { setChatFriend(null); onChatClosed?.() }}
        />
      )}
    </div>
  )
}
