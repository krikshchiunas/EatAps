// Вкладка «Общение» — переписка и поиск людей.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ
//
// Есть ровно два вопроса: с кем я переписываюсь и кого я ищу. Ленты здесь нет —
// она отдельная вкладка внизу; подписчиков, подписок и событий тоже нет — они
// в моём профиле, вместе со всем остальным про меня.
//
// Сам список переписок живёт в InboxScreen, поиск — в UserSearch. Эта вкладка
// только держит их рядом и владеет тем, что открывается поверх: чат, профиль,
// запросы, новое сообщение. Раньше всё это лежало в одном файле, и «список
// диалогов» соседствовал в нём с обработчиком свайпа между вкладками.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store.jsx'
import { openDirect } from '../lib/messaging.js'
import InboxScreen from './messaging/InboxScreen.jsx'
import ChatScreen from './messaging/ChatScreen.jsx'
import MessageRequestsScreen from './messaging/MessageRequestsScreen.jsx'
import NewMessageScreen from './messaging/NewMessageScreen.jsx'
import ConversationSearch from './messaging/ConversationSearch.jsx'
import UserSearch from './UserSearch.jsx'
import PublicProfile from './PublicProfile.jsx'

const VIEWS = [
  { key: 'chats',  label: 'Переписка' },
  { key: 'search', label: 'Поиск людей' },
]

export default function FriendsScreen({
  onChanged, setTab, openChatWith = null, onChatOpened, requestCount = 0,
}) {
  const { user, supabaseEnabled } = useStore()

  const [view, setView] = useState('chats')
  const [chat, setChat] = useState(null)          // { id, kind, title, ... }
  const [profileUser, setProfileUser] = useState(null)
  const [panel, setPanel] = useState(null)        // 'requests' | 'new' | 'search'
  const [nonce, setNonce] = useState(0)           // мягкая перезагрузка списка
  const screenRef = useRef(null)
  const gestureRef = useRef(null)
  const navigatingRef = useRef(false)
  const chatRef = useRef(chat)
  useEffect(() => { chatRef.current = chat }, [chat])

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
      if (navigatingRef.current || chatRef.current) return
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

  // Открыть личную переписку по id человека: уведомление и профиль знают
  // собеседника, а не диалог. Диалог находится или заводится сервером.
  const openWithUser = useCallback(async (userId, card = null) => {
    const res = await openDirect(userId)
    if (res?.error) { setProfileUser(userId); return }
    setChat({
      id: res.ok,
      kind: 'direct',
      title: card?.display_name || card?.name || card?.username || 'Диалог',
      avatarUrl: card?.avatar_url || card?.avatar || null,
      peerId: userId,
      state: 'accepted',
    })
  }, [])

  // Переход из уведомления о сообщении. App отдаёт адрес: { userId } для
  // личной переписки (диалог находится или создаётся по собеседнику) либо
  // { conversationId } для групповой — у группы собеседника нет.
  useEffect(() => {
    if (!openChatWith) return
    if (openChatWith.conversationId) {
      setChat({
        id: openChatWith.conversationId,
        kind: 'group',
        title: 'Группа',
        peerId: null,
        state: 'accepted',
      })
    } else if (openChatWith.userId) {
      openWithUser(openChatWith.userId)
    }
    onChatOpened?.()
  }, [openChatWith, openWithUser, onChatOpened])

  const swipeStyle = { willChange: 'transform', touchAction: 'pan-y' }

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen" ref={screenRef} style={swipeStyle}>
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Общение</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>
            Войдите в аккаунт (вкладка «Профиль»), чтобы находить людей и общаться.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen" ref={screenRef} style={swipeStyle}>
      <h1 className="h1" style={{ margin: '4px 0 14px' }}>Общение</h1>

      <div className="seg" style={{ marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'chats' && (
        <InboxScreen
          key={nonce}
          requestCount={requestCount}
          onOpenConversation={setChat}
          onOpenRequests={() => setPanel('requests')}
          onOpenNew={() => setPanel('new')}
          onOpenSearch={() => setPanel('search')}
          onChanged={onChanged}
        />
      )}

      {view === 'search' && <UserSearch onOpenProfile={setProfileUser} />}

      {panel === 'requests' && (
        <MessageRequestsScreen
          onClose={() => { setPanel(null); setNonce((n) => n + 1) }}
          onOpenConversation={(c) => { setPanel(null); setChat(c) }}
          onChanged={onChanged}
        />
      )}

      {panel === 'new' && (
        <NewMessageScreen
          onClose={() => setPanel(null)}
          onOpenConversation={(id, peer) => {
            setPanel(null)
            setChat({
              id,
              kind: peer ? 'direct' : 'group',
              title: peer ? (peer.display_name || peer.username) : 'Группа',
              avatarUrl: peer?.avatar_url || null,
              peerId: peer?.user_id || null,
              state: 'accepted',
            })
          }}
        />
      )}

      {panel === 'search' && (
        <ConversationSearch
          onClose={() => setPanel(null)}
          onPick={(m) => {
            setPanel(null)
            setChat({
              id: m.conversation_id,
              kind: m.peer_id ? 'direct' : 'group',
              title: m.title || 'Диалог',
              peerId: m.peer_id || null,
              state: 'accepted',
            })
          }}
        />
      )}

      {profileUser && (
        <PublicProfile
          userId={profileUser}
          onClose={() => { setProfileUser(null); setNonce((n) => n + 1) }}
          onOpenProfile={setProfileUser}
          onOpenChat={(peer) => { setProfileUser(null); openWithUser(peer.id, peer) }}
        />
      )}

      {chat && (
        <ChatScreen
          conversation={chat}
          onClose={() => { setChat(null); onChanged?.(); setNonce((n) => n + 1) }}
          onOpenProfile={setProfileUser}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}
