import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { listFriends, listConversations } from '../lib/supabase.js'
import { getMutedFriends, toggleFriendMuted, forgetMutedFriend } from '../lib/notifications.js'
import ChatView from './ChatView.jsx'
import UserSearch from './UserSearch.jsx'
import PublicProfile from './PublicProfile.jsx'
import { unfollow } from '../lib/social.js'
import ConfirmDialog from './ConfirmDialog.jsx'

// Разделы вкладки.
//
// Ленты здесь НЕТ намеренно: она переехала в нижнюю навигацию отдельной
// вкладкой. Держать её ещё и тут значило бы иметь один и тот же экран в двух
// местах с двумя независимыми состояниями прокрутки и загрузки.
//
// Подписчики, подписки и «События» тоже уехали — в мой профиль, к остальному
// про меня: на меня подписались, на мою мысль ответили, мне написали. Здесь
// остались ровно два вопроса: с кем я уже общаюсь и кого я ищу. Вкладки
// «＋ По ID» нет с тех пор, как исчезли публичные коды: людей находят по нику
// в «Поиске».
const VIEWS = [
  { key: 'friends', label: 'Друзья' },
  { key: 'search',  label: 'Поиск' },
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
      background: 'var(--mint-soft)', color: 'var(--on-mint)',
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
export default function FriendsScreen({ unreadCounts = {}, onChatClosed, setTab, openChatWith = null, onChatOpened }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [friends, setFriends] = useState([])
  const [convs, setConvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [chatFriend, setChatFriend] = useState(null)
  const [openMenu, setOpenMenu] = useState(null) // friend.id with open menu
  const [dropUp, setDropUp] = useState(false)    // раскрывать меню вверх
  const [menuErr, setMenuErr] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [view, setView] = useState('friends')
  const [profileUser, setProfileUser] = useState(null)
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

  // Два запроса — две независимые судьбы.
  //
  // Раньше здесь стоял Promise.all с глухим `catch { /* ignore */ }`: любая
  // ошибка ЛЮБОГО из двух запросов означала, что setFriends не вызывался вовсе,
  // и экран показывал «Пока никого нет». То есть сбой выборки сообщений (она
  // нужна только для порядка сортировки) стирал весь список друзей, а причина
  // не доходила ни до человека, ни до консоли. «Друзья пропали» и «не
  // загрузилось» выглядели одинаково — а это разные вещи, и лечатся они
  // по-разному.
  const reload = async () => {
    setLoading(true)
    setLoadErr(null)
    const [f, c] = await Promise.allSettled([listFriends(myId), listConversations(myId)])
    if (f.status === 'fulfilled') setFriends(f.value)
    else {
      console.error('Не удалось загрузить друзей:', f.reason)
      setLoadErr(f.reason?.message || 'Не удалось загрузить список друзей')
    }
    // Диалоги нужны только чтобы поднять наверх тех, с кем недавно переписка.
    // Их сбой — это потеря порядка, а не потеря друзей: список остаётся.
    if (c.status === 'fulfilled') setConvs(c.value)
    else console.error('Не удалось загрузить диалоги:', c.reason)
    setLoading(false)
  }

  useEffect(() => { if (myId) reload(); else setLoading(false) }, [myId])

  // Уведомление о сообщении открывают в «Профиле», а чат живёт здесь — поэтому
  // вкладка открывает диалог сама, как только приехал список друзей. Второго
  // чата в профиле не заводим: экран переписки в приложении один.
  useEffect(() => {
    if (!openChatWith || loading) return
    const f = friends.find((x) => x.id === openChatWith)
    if (f) setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, username: f.username })
    else setProfileUser(openChatWith) // уже не друг — открываем профиль
    onChatOpened?.()
  }, [openChatWith, loading, friends])

  const lastById = useMemo(() => new Map(convs.map(c => [c.id, c.last])), [convs])

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@+/, '')
    // Ищем и по имени, и по нику: в списке видно имя, но помнят люди обычно
    // ник — по нему же человека находили в поиске.
    let arr = q
      ? friends.filter((f) =>
          (f.name || '').toLowerCase().includes(q) || (f.username || '').includes(q))
      : friends
    return [...arr].sort((a, b) => {
      const aPin = pinned.indexOf(a.id), bPin = pinned.indexOf(b.id)
      if (aPin !== -1 && bPin !== -1) return aPin - bPin
      if (aPin !== -1) return -1
      if (bPin !== -1) return 1
      const ta = lastById.has(a.id) ? Date.parse(lastById.get(a.id).created_at) : 0
      const tb = lastById.has(b.id) ? Date.parse(lastById.get(b.id).created_at) : 0
      return tb - ta
    })
  }, [friends, query, pinned, lastById])

  const handlePin = (id) => {
    const res = togglePin(id)
    if (res.error) { setMenuErr(res.error); return }
    setPinned(getPinned()); setOpenMenu(null); setMenuErr(null)
  }

  const handleMute = (id) => {
    setMuted(toggleFriendMuted(id)); setOpenMenu(null)
  }

  // «Удалить из друзей» = отписаться. Дружба — производная от взаимной
  // подписки, отдельной строки, которую можно было бы удалить, у клиента нет.
  //
  // Спрашиваем подтверждение. Действие необратимо в том смысле, который здесь
  // важнее технического: вернуть дружбу односторонним нажатием нельзя — нужно
  // подписаться заново И ДОЖДАТЬСЯ, пока человек подпишется в ответ. Вместе с
  // дружбой уходят переписка и доступ к дневнику. Раньше это происходило от
  // одного касания пункта меню, соседнего с безобидным «Заглушить».
  const handleRemove = async (friend) => {
    setOpenMenu(null)
    setConfirmRemove(null)
    const res = await unfollow(myId, friend.id)
    if (res?.error) { setLoadErr(res.error); return }
    setPinned(forgetPinned(friend.id))
    setMuted(forgetMutedFriend(friend.id))
    reload()
  }

  const swipeStyle = { willChange: 'transform', touchAction: 'pan-y' }

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen" ref={screenRef} style={swipeStyle}>
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Друзья</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Войдите в аккаунт (вкладка «Профиль»), чтобы находить людей и общаться.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen" ref={screenRef} style={swipeStyle} onClick={() => openMenu && setOpenMenu(null)}>
      {/* В шапке нет кнопок. «＋ По ID» ушла вместе с публичными кодами —
          людей находят по нику во вкладке «Поиск», а 🏁 переехала в «События»
          в профиле. */}
      <h1 className="h1" style={{ margin: '4px 0 14px' }}>Общение</h1>

      <div className="seg" style={{ marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'search' && <UserSearch onOpenProfile={setProfileUser} />}

      {view === 'friends' && (<>
      {/* Фильтр по своему списку — не путать со вкладкой «Поиск», которая
          ищет людей по всей базе. */}
      <div className="field" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Фильтр по имени или нику…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ height: 46, fontSize: 15 }}
        />
      </div>

      {/* Список друзей */}
      {loading ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : loadErr ? (
        /* Честная ошибка вместо «пока никого нет»: список друзей не пуст — он
           не загрузился, и это разные сообщения. */
        <div className="card">
          <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--danger)' }}>{loadErr}</p>
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={reload}>Повторить</button>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
            {query
              ? 'Никого не нашли.'
              : 'Пока никого нет. Найдите человека по нику во вкладке «Поиск» и подпишитесь — как только он подпишется в ответ, вы станете друзьями.'}
          </p>
        </div>
      ) : sorted.map((f) => {
        const isPinned = pinned.includes(f.id)
        const isMuted  = muted.includes(f.id)
        const unread   = unreadCounts[f.id] || 0
        const isMenuOpen = openMenu === f.id

        return (
          <div key={f.id} style={{ position: 'relative', marginBottom: 8 }}>
            <button
              className="card"
              style={{ padding: '12px 48px 12px 14px', width: '100%', textAlign: 'left' }}
              onClick={() => setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, username: f.username })}
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
                    background: 'var(--danger)', color: 'var(--on-danger)',
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
                onRemove={() => { setOpenMenu(null); setConfirmRemove(f) }}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        )
      })}

      </>)}

      {profileUser && (
        <PublicProfile
          userId={profileUser}
          onClose={() => { setProfileUser(null); reload() }}
          onOpenProfile={setProfileUser}
          onOpenChat={(peer) => {
            // Профиль отдаёт уже загруженные имя и аватар — второй запрос за
            // ними не нужен, и чат открывается даже для друга, которого нет в
            // текущем списке (он мог появиться только что).
            setProfileUser(null)
            setChatFriend(peer)
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          text={`Удалить ${confirmRemove.name || 'этого человека'} из друзей? Вы отпишетесь, переписка и дневник питания станут недоступны. Чтобы вернуть дружбу, придётся подписаться заново и дождаться ответной подписки.`}
          onYes={() => handleRemove(confirmRemove)}
          onNo={() => setConfirmRemove(null)}
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
