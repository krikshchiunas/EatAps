import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react'
import { useStore } from '../store.jsx'
import {
  listMessagesWith, sendChatMessage, subscribeToChat, uploadChatImage,
  markChatRead, deleteChatMessage, listFriendships,
  markMessagesRead, subscribeToReadReceipts, hideMessageLocally,
} from '../lib/supabase.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { setActiveChat } from '../lib/notifications.js'
import { Avatar } from './FriendsScreen.jsx'
import FriendAccount from './FriendAccount.jsx'

// ── helpers ───────────────────────────────────────────────────────────────────
const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch {} }
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function timeShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}
function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yest.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
function previewOf(m) {
  if (m.text) return m.text
  if (m.image_url) return '📷 Фото'
  if (m.meal_ref) return '🍽 ' + (m.meal_ref.name || 'Блюдо')
  return ''
}
// Ссылки в тексте → кликабельные, остальное — как есть.
// split по глобальному regex, а проверка — отдельным НЕ-глобальным (без бага lastIndex).
function renderText(text) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer" className="msg-link" onClick={(e) => e.stopPropagation()}>{p}</a>
      : <span key={i}>{p}</span>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function ChatView({ friend, onClose }) {
  const { user, profile } = useStore()
  const myId = user?.id || ''
  const myName = profile?.name || 'Вы'
  const friendName = friend.name || 'Друг'

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState(null)          // { id, snapshot }
  const [menuMsg, setMenuMsg] = useState(null)      // сообщение для контекст-меню
  const [forwardMsg, setForwardMsg] = useState(null)
  const [toast, setToast] = useState(null)
  const [showJump, setShowJump] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)   // меню действий чата (⋯)

  const listRef = useRef(null)
  const atBottomRef = useRef(true)
  const bootedRef = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const { panelProps, scrimProps, close: handleClose } = useSwipeBack(onClose)
  useScrollLock()

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 1600) }, [])

  const pinBottom = (smooth) => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    if (smooth) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }))
  }
  const nearBottom = () => {
    const el = listRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 90
  }

  // Первый показ — мгновенно у последнего сообщения, ДО отрисовки (без прыжка).
  useLayoutEffect(() => {
    if (bootedRef.current || loading || messages.length === 0) return
    bootedRef.current = true
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [loading, messages])

  // Скрыть BottomNav пока чат открыт (счётчик — FriendAccount тоже добавляет)
  useEffect(() => {
    const el = document.documentElement
    el.dataset.overlayCount = Number(el.dataset.overlayCount || 0) + 1
    el.classList.add('has-overlay')
    return () => {
      const next = Number(el.dataset.overlayCount || 1) - 1
      el.dataset.overlayCount = next
      if (next <= 0) el.classList.remove('has-overlay')
    }
  }, [])

  // Клавиатура (iOS): держим composer над клавиатурой через visualViewport.
  const overlayRef = useRef(null)
  useEffect(() => {
    const vv = window.visualViewport
    const el = overlayRef.current
    if (!vv || !el) return
    const apply = () => {
      el.style.height = vv.height + 'px'
      if (atBottomRef.current) pinBottom(false)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); el.style.height = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Пока открыт этот чат — не показывать пуш о его же сообщениях (они и так видны).
  useEffect(() => {
    setActiveChat(friend.id)
    return () => setActiveChat(null)
  }, [friend.id])

  // Загрузка истории + realtime.
  useEffect(() => {
    markChatRead(friend.id)
    markMessagesRead(friend.id)
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listMessagesWith(myId, friend.id)
        if (cancelled) return
        setMessages(rows)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { flash(e.message || 'Не удалось загрузить'); setLoading(false) }
      }
    })()

    const unsub = subscribeToChat(myId, friend.id, (m) => {
      markChatRead(friend.id)
      // Чат открыт — сразу отмечаем входящее прочитанным (собеседник увидит вилку).
      markMessagesRead(friend.id)
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
      if (atBottomRef.current) requestAnimationFrame(() => pinBottom(true))
      else setShowJump(true)
    })

    // Собеседник прочитал моё сообщение → перекрашиваем вилку.
    const unsubReads = subscribeToReadReceipts(myId, friend.id, (row) => {
      setMessages((cur) => cur.map((x) => (x.id === row.id ? { ...x, read_at: row.read_at } : x)))
    })

    return () => { cancelled = true; unsub(); unsubReads() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, friend.id])

  // Подсветка сообщения на время контекст-меню. Раньше подсветка ставилась
  // жестом и снималась вручную в разных ветках — при некоторых путях (меню
  // открылось, палец ушёл за пределы строки) класс оставался и сообщение
  // «залипало» выделенным. Теперь состояние ведётся ОДНИМ эффектом от menuMsg:
  // открылось — подсветили, закрылось — сняли со всех строк, что бы ни было.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const clearAll = () => {
      root.querySelectorAll('.msg-row.selected').forEach((el) => el.classList.remove('selected'))
      // Снимаем и нативное выделение текста / фокус — на iOS они переживают
      // закрытие шторки и оставляют серый прямоугольник поверх пузыря.
      try { window.getSelection()?.removeAllRanges() } catch {}
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    if (!menuMsg) { clearAll(); return }
    clearAll()
    root.querySelector(`[data-mid="${menuMsg.id}"]`)?.classList.add('selected')
    return clearAll
  }, [menuMsg])

  // Отслеживаем «у низа ли пользователь».
  const onScroll = useCallback(() => {
    const nb = nearBottom()
    atBottomRef.current = nb
    if (nb && showJump) setShowJump(false)
  }, [showJump])

  // Пин при подгрузке картинок (высота меняется).
  const onImgLoad = useCallback(() => { if (atBottomRef.current) pinBottom(false) }, [])

  // Прыжок к оригиналу reply + подсветка.
  const jumpTo = useCallback((id) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`)
    if (!el) { flash('Сообщение недоступно'); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('msg-flash')
    // reflow, чтобы анимация перезапустилась
    void el.offsetWidth
    el.classList.add('msg-flash')
    setTimeout(() => el.classList.remove('msg-flash'), 1500)
  }, [flash])

  // Начать ответ на сообщение.
  const startReply = useCallback((m) => {
    setReply({
      id: m.id,
      snapshot: { name: m.sender === myId ? myName : friendName, text: previewOf(m), image: !!m.image_url },
    })
  }, [myId, myName, friendName])

  // Отправка (оптимистично + upload + insert). reply берётся из состояния.
  const doSend = useCallback(async ({ text, file }) => {
    const r = reply
    setReply(null)
    const tempId = 'temp-' + (crypto.randomUUID?.() || Date.now() + Math.random())
    const localUrl = file ? URL.createObjectURL(file) : null
    const temp = {
      id: tempId, sender: myId, recipient: friend.id,
      text: text || null, image_url: localUrl, meal_ref: null,
      reply_to: r?.id || null, reply_snapshot: r?.snapshot || null, forwarded_name: null,
      created_at: new Date().toISOString(), status: 'sending',
    }
    setMessages((cur) => [...cur, temp])
    atBottomRef.current = true
    requestAnimationFrame(() => pinBottom(true))
    try {
      let imageUrl = null
      if (file) imageUrl = await uploadChatImage(myId, file)
      const res = await sendChatMessage({
        sender: myId, recipient: friend.id, text, imageUrl,
        replyTo: r?.id, replySnapshot: r?.snapshot,
      })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...res.ok, status: 'sent' } : m)))
      if (localUrl) URL.revokeObjectURL(localUrl)
    } catch (e) {
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, status: 'failed', _payload: { text, file } } : m)))
    }
  }, [reply, myId, friend.id])

  const retry = useCallback(async (m) => {
    const p = m._payload || { text: m.text, file: null }
    setMessages((cur) => cur.filter((x) => x.id !== m.id))
    // повторно шлём с теми же данными и (если был) reply-снимком сообщения
    const tempId = 'temp-' + (crypto.randomUUID?.() || Date.now() + Math.random())
    const temp = { ...m, id: tempId, status: 'sending', created_at: new Date().toISOString() }
    setMessages((cur) => [...cur, temp])
    requestAnimationFrame(() => pinBottom(true))
    try {
      let imageUrl = m.image_url && !m.image_url.startsWith('blob:') ? m.image_url : null
      if (p.file) imageUrl = await uploadChatImage(myId, p.file)
      const res = await sendChatMessage({
        sender: myId, recipient: friend.id, text: p.text, imageUrl,
        replyTo: m.reply_to, replySnapshot: m.reply_snapshot,
      })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => cur.map((x) => (x.id === tempId ? { ...res.ok, status: 'sent' } : x)))
    } catch {
      setMessages((cur) => cur.map((x) => (x.id === tempId ? { ...x, status: 'failed', _payload: p } : x)))
    }
  }, [myId, friend.id])

  const doCopy = useCallback(async (m) => {
    try { await navigator.clipboard.writeText(m.text || previewOf(m)); flash('Скопировано') }
    catch { flash('Не удалось скопировать') }
  }, [flash])

  // «Удалить у меня» — прячем локально. Своё неотправленное (temp-) и своё
  // отправленное чистим и в БД: для автора это ожидаемое поведение. Чужое
  // сообщение только скрываем — у собеседника оно остаётся.
  const doDeleteForMe = useCallback(async (m) => {
    setMessages((cur) => cur.filter((x) => x.id !== m.id))
    const isTemp = String(m.id).startsWith('temp-')
    if (isTemp) return
    hideMessageLocally(m.id)
    if (m.sender === myId) await deleteChatMessage(m.id)
  }, [myId])

  // Очистить переписку у себя: прячем локально всё, что сейчас загружено.
  // У собеседника история остаётся — как «удалить у меня» для одного сообщения.
  const clearChatForMe = useCallback(() => {
    const ids = messagesRef.current.map((m) => m.id).filter((id) => !String(id).startsWith('temp-'))
    ids.forEach(hideMessageLocally)
    setMessages([])
    flash('Переписка очищена у вас')
  }, [flash])

  // ── delegated gestures on the list: swipe-left → reply, long-press → menu ──
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    let g = null, lpTimer = null

    const rowOf = (t) => t.closest?.('[data-mid]')
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } }

    const onStart = (e) => {
      const row = rowOf(e.target)
      if (!row) { g = null; return }
      const t = e.touches[0]
      g = { row, bubble: row.querySelector('.msg'), mid: row.dataset.mid, x: t.clientX, y: t.clientY, decided: false, mode: null, moved: false }
      clearLp()
      lpTimer = setTimeout(() => {
        if (g && !g.moved) {
          const m = messagesRef.current.find((x) => String(x.id) === g.mid)
          if (m) { haptic(18); row.classList.remove('swiping', 'will-reply'); if (g.bubble) g.bubble.style.transform = ''; setMenuMsg(m); g = null }
        }
      }, 480)
    }
    const onMove = (e) => {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x, dy = t.clientY - g.y
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Владеем только явным горизонтальным ВЛЕВО. Иначе — скролл / back-жест.
        g.mode = (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.3) ? 'swipe' : 'none'
        g.decided = true
        if (g.mode !== 'swipe') { clearLp(); g = null; return }
        clearLp()
        g.row.classList.add('swiping')
      }
      if (g.mode === 'swipe' && g.bubble) {
        e.preventDefault()
        const off = Math.max(-84, dx * 0.9) // тянем влево с лёгким сопротивлением
        g.bubble.style.transform = `translateX(${off}px)`
        g.row.classList.toggle('will-reply', off <= -56)
      }
    }
    const onEnd = () => {
      clearLp()
      if (!g) return
      const row = g.row, bubble = g.bubble, mid = g.mid, mode = g.mode
      g = null
      if (mode !== 'swipe') return
      const triggered = row.classList.contains('will-reply')
      row.classList.remove('swiping', 'will-reply')
      if (bubble) bubble.style.transform = ''
      if (triggered) {
        haptic(14)
        const m = messagesRef.current.find((x) => String(x.id) === mid)
        if (m) startReply(m)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    const noCtx = (e) => e.preventDefault()
    el.addEventListener('contextmenu', noCtx)
    return () => {
      clearLp()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('contextmenu', noCtx)
    }
  }, [startReply])

  return (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div className="chat-overlay" ref={overlayRef} {...panelProps}>
        <header className="chat-header">
          <button className="chat-back" onClick={handleClose} aria-label="Назад">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button className="chat-peer" onClick={() => setProfileOpen(true)}>
            <span className="chat-peer-ava"><Avatar src={friend.avatar} name={friendName} size={40} /></span>
            <span className="chat-peer-meta">
              <span className="chat-peer-name">{friendName}</span>
              <span className="chat-peer-sub">Открыть профиль</span>
            </span>
          </button>
          <button className="chat-more" onClick={() => setMenuOpen(true)} aria-label="Действия">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
              <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
            </svg>
          </button>
        </header>

        <div className="chat-list" ref={listRef} onScroll={onScroll}>
          {loading ? (
            <div className="chat-state"><span className="chat-spinner" /></div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-emoji">👋</div>
              <p>Сообщений пока нет.<br />Напишите первым!</p>
            </div>
          ) : (
            <MessageList
              messages={messages} myId={myId} friendName={friendName}
              onQuoteTap={jumpTo} onImgLoad={onImgLoad} onRetry={retry}
            />
          )}
        </div>

        {showJump && (
          <button className="chat-jump" onClick={() => { pinBottom(true); setShowJump(false) }} aria-label="Вниз">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}

        <Composer reply={reply} onCancelReply={() => setReply(null)} onSend={doSend} />
      </div>

      {menuMsg && (
        <ContextSheet
          m={menuMsg} mine={menuMsg.sender === myId}
          onClose={() => setMenuMsg(null)}
          onReply={() => startReply(menuMsg)}
          onCopy={() => doCopy(menuMsg)}
          onForward={() => setForwardMsg(menuMsg)}
          onDeleteForMe={() => doDeleteForMe(menuMsg)}
          onRetry={() => retry(menuMsg)}
        />
      )}

      {menuOpen && (
        <ChatMenuSheet
          onClose={() => setMenuOpen(false)}
          onProfile={() => setProfileOpen(true)}
          onClearForMe={clearChatForMe}
        />
      )}

      {forwardMsg && (
        <ForwardSheet
          m={forwardMsg} myId={myId}
          fromName={forwardMsg.sender === myId ? myName : friendName}
          onClose={() => setForwardMsg(null)}
          onDone={(name) => { setForwardMsg(null); flash(name ? `Переслано → ${name}` : 'Переслано') }}
        />
      )}

      {toast && <div className="chat-toast">{toast}</div>}

      {profileOpen && (
        <FriendAccount friend={friend} onClose={() => setProfileOpen(false)} onRemoved={handleClose} />
      )}
    </>
  )
}

// ── message list (memoized — не перерисовывается при вводе текста) ─────────────
const MessageList = memo(function MessageList({ messages, myId, friendName, onQuoteTap, onImgLoad, onRetry }) {
  return messages.map((m, i) => {
    const mine = m.sender === myId
    const prev = messages[i - 1]
    const next = messages[i + 1]
    const showDay = !prev || !isSameDay(prev.created_at, m.created_at)
    const sameAsPrev = prev && prev.sender === m.sender && !showDay
    const sameAsNext = next && next.sender === m.sender && isSameDay(m.created_at, next.created_at)
    return (
      <div key={m.id}>
        {showDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
        <MessageRow
          m={m} mine={mine} tail={!sameAsNext} grouped={sameAsPrev}
          friendName={friendName} onQuoteTap={onQuoteTap} onImgLoad={onImgLoad} onRetry={onRetry}
        />
      </div>
    )
  })
})

// Индикатор доставки/прочтения — вилка. Серая = отправлено, морская синяя =
// собеседник прочитал. Цвет задаётся через currentColor в CSS (.msg-tick.read).
function ForkTick() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
         strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 2.5v6.2" />
      <path d="M11 2.5v6.2" />
      <path d="M15 2.5v6.2" />
      <path d="M5.4 8.7h11.2a1 1 0 0 1 .9 1.4c-.7 1.6-2.1 2.6-3.8 2.8l-1 .1v8a1.6 1.6 0 0 1-3.2 0v-8l-1-.1c-1.7-.2-3.1-1.2-3.8-2.8a1 1 0 0 1 .9-1.4z" />
    </svg>
  )
}

function MessageRow({ m, mine, tail, grouped, onQuoteTap, onImgLoad, onRetry }) {
  const status = m.status // sending | failed | undefined(=sent)
  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`} data-mid={m.id}>
      <span className="msg-reply-hint" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v3" /></svg>
      </span>
      <div className={`msg ${mine ? 'mine' : 'theirs'}${tail ? ' tail' : ''}`}>
        {m.forwarded_name && (
          <div className="msg-forward">Переслано от {m.forwarded_name}</div>
        )}
        {m.reply_snapshot && (
          <button className="msg-quote" onClick={() => m.reply_to && onQuoteTap(m.reply_to)}>
            <span className="msg-quote-name">{m.reply_snapshot.name}</span>
            <span className="msg-quote-text">{m.reply_snapshot.image ? '📷 ' : ''}{m.reply_snapshot.text || 'Фото'}</span>
          </button>
        )}
        {m.meal_ref && (
          <div className="msg-meal">
            <span style={{ fontSize: 20 }}>{m.meal_ref.emoji || '🍽'}</span>
            <div style={{ minWidth: 0 }}>
              <div className="msg-meal-name">{m.meal_ref.name}</div>
              <div className="msg-meal-kcal">{m.meal_ref.kcal} ккал</div>
            </div>
          </div>
        )}
        {m.image_url && (
          <a href={m.image_url} target="_blank" rel="noreferrer" className="msg-img-wrap" onClick={(e) => { if (status) e.preventDefault() }}>
            <img src={m.image_url} alt="" className="msg-img" onLoad={onImgLoad} draggable={false} />
          </a>
        )}
        {m.text && <div className="msg-text">{renderText(m.text)}</div>}
        <div className="msg-meta">
          <span className="msg-time">{timeShort(m.created_at)}</span>
          {mine && status === 'sending' && <span className="msg-tick sending"><ForkTick /></span>}
          {mine && !status && (
            <span className={`msg-tick${m.read_at ? ' read' : ''}`} title={m.read_at ? 'Прочитано' : 'Отправлено'}>
              <ForkTick />
            </span>
          )}
          {mine && status === 'failed' && (
            <button className="msg-fail" onClick={() => onRetry(m)} title="Повторить">! повторить</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── composer (изолированный ввод: печать не трогает список) ────────────────────
function Composer({ reply, onCancelReply, onSend }) {
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)

  const grow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  useEffect(grow, [text])

  const canSend = text.trim().length > 0 || !!photo

  const submit = () => {
    if (!canSend) return
    onSend({ text: text.trim(), file: photo?.file || null })
    setText('')
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto(null)
    requestAnimationFrame(grow)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !COARSE) { e.preventDefault(); submit() }
  }
  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !f.type?.startsWith('image/')) return
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto({ url: URL.createObjectURL(f), file: f })
  }

  return (
    <div className="chat-composer">
      {reply && (
        <div className="chat-replybar">
          <span className="chat-replybar-line" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="chat-replybar-name">Ответ · {reply.snapshot.name}</div>
            <div className="chat-replybar-text">{reply.snapshot.image ? '📷 ' : ''}{reply.snapshot.text || 'Фото'}</div>
          </div>
          <button className="chat-replybar-x" onClick={onCancelReply} aria-label="Отменить">✕</button>
        </div>
      )}
      {photo && (
        <div className="chat-photo-preview">
          <img src={photo.url} alt="" />
          <button onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null) }} aria-label="Убрать фото">✕</button>
        </div>
      )}
      {/* Поле-«пилюля»: кнопки вложений живут ВНУТРИ него — так добавление
          новых (приём пищи, файл, голосовое) не ломает раскладку строки. */}
      <div className="chat-composer-row">
        <div className="chat-inputwrap">
          <div className="chat-tools">
            <button className="chat-tool" onClick={() => fileRef.current?.click()} aria-label="Отправить фото">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="15" rx="3.5" /><circle cx="12" cy="12.5" r="3.4" /><path d="M8 5 9.4 3h5.2L16 5" />
              </svg>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
          <textarea
            ref={taRef}
            className="chat-textarea"
            placeholder="Сообщение…"
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <button className={`chat-send${canSend ? ' on' : ''}`} onClick={submit} disabled={!canSend} aria-label="Отправить">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M3.4 20.4l17.6-8.4a.5.5 0 0 0 0-.9L3.4 3.6a.5.5 0 0 0-.7.6l2.3 6.9c.1.2.3.4.5.4l8.9 1.5-8.9 1.5c-.2 0-.4.2-.5.4l-2.3 6.9a.5.5 0 0 0 .7.6z" /></svg>
        </button>
      </div>
    </div>
  )
}

// ── context sheet (long-press) ────────────────────────────────────────────────
// Пункты описаны декларативно: чтобы добавить новый (реакции, «удалить у всех»,
// закрепить…), достаточно дописать объект в массив — рендер и закрытие общие.
// `show` получает контекст { m, mine } и решает, показывать ли пункт.
const CTX_ACTIONS = [
  {
    key: 'reply',
    label: 'Ответить',
    icon: 'M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 5 5v3',
    run: (h) => h.onReply(),
  },
  {
    key: 'copy',
    label: 'Копировать',
    icon: 'M9 9h11v11H9z M5 15V4h11',
    show: ({ m }) => !!m.text,
    run: (h) => h.onCopy(),
  },
  {
    key: 'forward',
    label: 'Переслать',
    icon: 'M15 5l7 7-7 7 M22 12H4a2 2 0 0 0-2 2v3',
    run: (h) => h.onForward(),
  },
  {
    key: 'retry',
    label: 'Повторить отправку',
    icon: 'M21 12a9 9 0 1 1-3-6.7 M21 4v4h-4',
    show: ({ m, mine }) => mine && m.status === 'failed',
    run: (h) => h.onRetry(),
  },
  {
    key: 'delete-me',
    label: 'Удалить у меня',
    icon: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    danger: true,
    run: (h) => h.onDeleteForMe(),
  },
]

// ── меню чата (⋯ в хедере) ────────────────────────────────────────────────────
// Тоже декларативное — место под «Поиск», «Отключить уведомления», настройки
// группы. Пока только то, что реально работает.
const CHAT_ACTIONS = [
  {
    key: 'profile',
    label: 'Профиль друга',
    icon: 'M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z M4.5 20.5a7.5 7.5 0 0 1 15 0',
    run: (h) => h.onProfile(),
  },
  {
    key: 'clear',
    label: 'Очистить переписку у меня',
    icon: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    danger: true,
    run: (h) => h.onClearForMe(),
  },
]

function ChatMenuSheet({ onClose, ...handlers }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 80 }}>
      <div className="sheet ctx-sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {CHAT_ACTIONS.map((a) => (
          <button
            key={a.key}
            className={`ctx-item${a.danger ? ' danger' : ''}`}
            onClick={() => { a.run(handlers); close() }}
          >
            <Ico d={a.icon} /> {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ContextSheet({ m, mine, onClose, ...handlers }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const ctx = { m, mine }
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 80 }}>
      <div className="sheet ctx-sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="ctx-preview">{previewOf(m)}</div>
        {CTX_ACTIONS.filter((a) => !a.show || a.show(ctx)).map((a) => (
          <button
            key={a.key}
            className={`ctx-item${a.danger ? ' danger' : ''}`}
            onClick={() => { a.run(handlers); close() }}
          >
            <Ico d={a.icon} /> {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
function Ico({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  )
}

// ── forward picker ────────────────────────────────────────────────────────────
function ForwardSheet({ m, myId, fromName, onClose, onDone }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    listFriendships(myId).then((r) => { if (!cancelled) { setFriends(r.friends || []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [myId])

  const forward = async (f) => {
    if (busy) return
    setBusy(true)
    const res = await sendChatMessage({
      sender: myId, recipient: f.id,
      text: m.text, imageUrl: m.image_url && !String(m.image_url).startsWith('blob:') ? m.image_url : null,
      mealRef: m.meal_ref, forwardedName: fromName,
    })
    setBusy(false)
    if (res.error) return
    onDone(f.name || 'другу')
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 90 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="h2" style={{ fontSize: 18 }}>Переслать</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>
        {loading ? (
          <p className="muted" style={{ fontSize: 14, padding: '10px 0' }}>Загрузка…</p>
        ) : friends.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, padding: '10px 0' }}>Нет друзей для пересылки.</p>
        ) : (
          friends.map((f) => (
            <button key={f.id} className="fwd-row" disabled={busy} onClick={() => forward(f)}>
              <Avatar src={f.avatar} name={f.name} size={42} />
              <span className="fwd-name">{f.name || 'Друг'}</span>
              <span className="fwd-send">Отправить</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
