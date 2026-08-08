import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react'
import { useStore } from '../store.jsx'
import {
  listMessagesWith, sendChatMessage, subscribeToChat, uploadChatImage,
  markChatRead, listFriendships,
  markMessagesRead, subscribeToSentUpdates, hideMessageLocally,
  createTypingChannel, watchPresence, fetchLastSeen,
  toggleMessageReaction,
} from '../lib/supabase.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { normalizeError } from '../lib/authErrors.js'
import { setActiveChat } from '../lib/notifications.js'
import { getMealSections, foodsForMeal } from '../lib/meals.js'
import { mealCardFromGroup, normalizeMealCard } from '../lib/mealCard.js'
import { Avatar } from './FriendsScreen.jsx'
import FriendAccount from './FriendAccount.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

// ── helpers ───────────────────────────────────────────────────────────────────
const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch {} }
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Реакция на сообщение — двойной тап/двойной клик по пузырю. Пока одна:
// вторая морковка (второй двойной тап) снимает первую — переключение, а не
// добавление новой реакции поверх старой.
const CARROT = '🥕'
const DOUBLE_TAP_MS = 320

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
// «Был(а) в сети»: свежие отметки — человеческим языком, старые — датой.
// Пол собеседника нам неизвестен, поэтому нейтральное «Был(а)».
function lastSeenLabel(iso) {
  if (!iso) return ''
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'Был(а) только что'
  if (mins < 60) return `Был(а) ${mins} мин назад`
  const today = new Date()
  if (then.toDateString() === today.toDateString()) return `Был(а) в ${timeShort(iso)}`
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (then.toDateString() === yest.toDateString()) return `Был(а) вчера в ${timeShort(iso)}`
  return `Был(а) ${then.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}

function previewOf(m) {
  if (m.text) return m.text
  if (m.image_url) return '📷 Фото'
  if (m.meal_ref) return '🍽 ' + (normalizeMealCard(m.meal_ref)?.label || 'Блюдо')
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
  const [mealPick, setMealPick] = useState(false)   // шторка выбора приёма пищи
  const [mealCard, setMealCard] = useState(null)    // раскрытая карточка еды
  const [confirmClear, setConfirmClear] = useState(false) // подтверждение очистки чата
  const [peerTyping, setPeerTyping] = useState(false)
  const [peerOnline, setPeerOnline] = useState(false)
  const [peerLastSeen, setPeerLastSeen] = useState(null)

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

  // Жёсткий запрет выделения в чате. Одного CSS мало: iOS успевает начать
  // выделение до того, как отработает user-select, и красит подсветку поверх
  // пузырей. Здесь два перехвата — не даём выделению начаться и снимаем его,
  // если оно всё же возникло. Поле ввода из-под запрета исключено.
  useEffect(() => {
    const root = overlayRef.current
    if (!root) return
    const inComposer = (n) => {
      const el = n?.nodeType === 1 ? n : n?.parentElement
      return !!el?.closest?.('.chat-textarea')
    }
    const onSelectStart = (e) => { if (!inComposer(e.target)) e.preventDefault() }
    const onSelectionChange = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || !sel.anchorNode) return
      if (!root.contains(sel.anchorNode)) return
      if (inComposer(sel.anchorNode)) return
      sel.removeAllRanges()
    }
    root.addEventListener('selectstart', onSelectStart)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      root.removeEventListener('selectstart', onSelectStart)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
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
        if (!cancelled) { flash(normalizeError(e).message); setLoading(false) }
      }
    })()

    const unsub = subscribeToChat(myId, friend.id, (eventType, m) => {
      if (eventType === 'INSERT') {
        markChatRead(friend.id)
        // Чат открыт — сразу отмечаем входящее прочитанным (собеседник увидит вилку).
        markMessagesRead(friend.id)
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
        if (atBottomRef.current) requestAnimationFrame(() => pinBottom(true))
        else setShowJump(true)
      } else if (eventType === 'UPDATE') {
        // Друг поставил (или снял) реакцию на своё же сообщение, или это
        // подтверждение моей реакции с другого устройства.
        setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, reactions: m.reactions } : x)))
      }
    })

    // Собеседник прочитал моё сообщение (вилка) или поставил реакцию на него.
    const unsubSent = subscribeToSentUpdates(myId, friend.id, (row) => {
      setMessages((cur) => cur.map((x) => (x.id === row.id ? { ...x, read_at: row.read_at, reactions: row.reactions } : x)))
    })

    return () => { cancelled = true; unsub(); unsubSent() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, friend.id])

  // «Печатает…»: канал живёт весь чат. Гасим индикатор по таймауту — если
  // собеседник свернул вкладку, события просто перестают приходить и «печатает»
  // иначе висело бы вечно.
  // Присутствие собеседника. Ушёл офлайн — подтягиваем «был(а) в сети»,
  // чтобы шапка не схлопывалась в пустоту.
  useEffect(() => {
    let cancelled = false
    const stop = watchPresence(friend.id, (online) => {
      if (cancelled) return
      setPeerOnline(online)
      if (!online) fetchLastSeen(friend.id).then((t) => { if (!cancelled) setPeerLastSeen(t) })
    })
    fetchLastSeen(friend.id).then((t) => { if (!cancelled) setPeerLastSeen(t) })
    return () => { cancelled = true; stop() }
  }, [friend.id])

  const typingRef = useRef({ sendTyping: () => {} })
  // Ссылка ДОЛЖНА быть стабильной. Если пересоздавать её на каждый рендер,
  // Composer пересоздаёт свои колбэки, его cleanup принимает это за уход из
  // чата и шлёт ложное «перестал печатать» — у собеседника индикатор мигал,
  // а лента дёргалась на каждом мигании.
  const sendTyping = useCallback((t) => typingRef.current.sendTyping(t), [])

  useEffect(() => {
    let hideTimer = null   // страховка: собеседник свернул вкладку
    let graceTimer = null  // пауза перед скрытием
    const ch = createTypingChannel(myId, friend.id, (typing) => {
      clearTimeout(graceTimer)
      clearTimeout(hideTimer)
      if (typing) {
        setPeerTyping(true)
        hideTimer = setTimeout(() => setPeerTyping(false), 5000)
      } else {
        // Между словами прилетает false. Без паузы пузырь мигал бы, каждый
        // раз меняя высоту ленты.
        graceTimer = setTimeout(() => setPeerTyping(false), 1200)
      }
    })
    typingRef.current = ch
    return () => {
      clearTimeout(hideTimer); clearTimeout(graceTimer)
      ch.unsubscribe(); setPeerTyping(false)
    }
  }, [myId, friend.id])

  // Прокрутка — только в момент ПОЯВЛЕНИЯ индикатора и только плавная.
  // pinBottom(true) делал мгновенный прыжок И smooth-скролл одновременно —
  // вот это и выглядело как тряска.
  const prevTypingRef = useRef(false)
  useEffect(() => {
    const appeared = peerTyping && !prevTypingRef.current
    prevTypingRef.current = peerTyping
    if (!appeared || !atBottomRef.current) return
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [peerTyping])

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

  // Отправка карточки приёма пищи — оптимистично, как обычное сообщение.
  const sendMeal = useCallback(async (mealRef) => {
    const tempId = 'temp-' + (crypto.randomUUID?.() || Date.now() + Math.random())
    const temp = {
      id: tempId, sender: myId, recipient: friend.id,
      text: null, image_url: null, meal_ref: mealRef,
      reply_to: null, reply_snapshot: null, forwarded_name: null,
      created_at: new Date().toISOString(), status: 'sending',
    }
    setMessages((cur) => [...cur, temp])
    atBottomRef.current = true
    requestAnimationFrame(() => pinBottom(true))
    try {
      const res = await sendChatMessage({ sender: myId, recipient: friend.id, mealRef })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...res.ok, status: undefined } : m)))
    } catch {
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)))
    }
  }, [myId, friend.id])

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
      // meal_ref и forwarded_name обязательно переносим: без них повтор
      // упавшей карточки еды уходил пустым и сервер отклонял его всегда.
      const res = await sendChatMessage({
        sender: myId, recipient: friend.id, text: p.text, imageUrl,
        mealRef: m.meal_ref, forwardedName: m.forwarded_name,
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

  // Переключить реакцию на сообщении. Оптимистично — двойной тап обязан
  // выглядеть мгновенным, ответ сервера прилетит и подтвердит (или откатит,
  // если что-то пошло не так) уже без видимой задержки для человека.
  // Сообщение, ещё не сохранённое на сервере (status 'sending'/'failed'),
  // реагировать не на что — у него ещё нет строки в БД, RPC его не найдёт.
  const toggleReaction = useCallback(async (m) => {
    if (!m || String(m.id).startsWith('temp-')) return
    const mine = (m.reactions || {})[myId] === CARROT
    haptic(mine ? 10 : 16)
    setMessages((cur) => cur.map((x) => {
      if (x.id !== m.id) return x
      const reactions = { ...(x.reactions || {}) }
      if (mine) delete reactions[myId]
      else reactions[myId] = CARROT
      return { ...x, reactions }
    }))
    const res = await toggleMessageReaction(m.id)
    if (res.error) {
      setMessages((cur) => cur.map((x) => {
        if (x.id !== m.id) return x
        const reactions = { ...(x.reactions || {}) }
        if (mine) reactions[myId] = CARROT
        else delete reactions[myId]
        return { ...x, reactions }
      }))
      flash(res.error)
    }
  }, [myId, flash])

  // Ссылка на актуальную toggleReaction для делегированного жеста ниже: тот
  // эффект монтируется один раз ([] deps) и не должен пересоздаваться из-за
  // смены myId/flash — обращается к функции через ref, а не через замыкание.
  const toggleReactionRef = useRef(toggleReaction)
  toggleReactionRef.current = toggleReaction

  // «Удалить у меня» — ТОЛЬКО локальное скрытие, БД не трогаем. Раньше для
  // своих сообщений вызывался deleteChatMessage, и строка исчезала у обоих —
  // это поведение пункта «Удалить у всех», а не того, что написано на кнопке.
  // temp-сообщений в БД нет, для них достаточно убрать из списка.
  const doDeleteForMe = useCallback((m) => {
    setMessages((cur) => cur.filter((x) => x.id !== m.id))
    if (!String(m.id).startsWith('temp-')) hideMessageLocally(m.id)
  }, [])

  // Очистить переписку у себя: прячем локально всё, что сейчас загружено.
  // У собеседника история остаётся — как «удалить у меня» для одного сообщения.
  const clearChatForMe = useCallback(() => {
    const ids = messagesRef.current.map((m) => m.id).filter((id) => !String(id).startsWith('temp-'))
    ids.forEach(hideMessageLocally)
    setMessages([])
    flash('Переписка очищена у вас')
  }, [flash])

  // ── delegated gestures on the list: свайп влево — единственный способ
  // открыть меню действий. Долгое нажатие раньше открывало то же меню по
  // таймеру — убрано полностью: при зажатии сообщения теперь не происходит
  // ровно ничего (ни меню, ни подсветки, ни haptic). contextmenu всё ещё
  // блокируем — это отдельно гасит нативное меню ОС (share sheet на iOS,
  // «сохранить изображение» на Android), которое к нашему жесту отношения
  // не имеет и не отключается вместе с ним.
  //
  // Двойной тап по пузырю (не по свайпу, не по ссылке/кнопке внутри) —
  // реакция 🥕. Обычный одиночный тап по фону сообщения и раньше не делал
  // ничего (mode остаётся null, onEnd выходил сразу) — это ровно та точка,
  // где можно посчитать вторую метку без риска зацепить существующие жесты.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    let g = null
    let lastTap = { mid: null, time: 0 }

    const rowOf = (t) => t.closest?.('[data-mid]')

    const onStart = (e) => {
      const row = rowOf(e.target)
      if (!row) { g = null; return }
      const t = e.touches[0]
      const interactive = !!e.target.closest?.('a, button')
      g = { row, bubble: row.querySelector('.msg'), mid: row.dataset.mid, x: t.clientX, y: t.clientY, decided: false, mode: null, interactive }
    }
    const onMove = (e) => {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x, dy = t.clientY - g.y
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Владеем только явным горизонтальным ВЛЕВО. Иначе — скролл / back-жест.
        g.mode = (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.3) ? 'swipe' : 'none'
        g.decided = true
        if (g.mode !== 'swipe') { g = null; return }
        g.row.classList.add('swiping')
      }
      if (g.mode === 'swipe' && g.bubble) {
        e.preventDefault()
        const off = Math.max(-84, dx * 0.9) // тянем влево с лёгким сопротивлением
        g.bubble.style.transform = `translateX(${off}px)`
        g.row.classList.toggle('will-open-menu', off <= -56)
      }
    }
    const onEnd = () => {
      if (!g) return
      const row = g.row, bubble = g.bubble, mid = g.mid, mode = g.mode, interactive = g.interactive
      g = null

      if (mode === 'swipe') {
        const triggered = row.classList.contains('will-open-menu')
        row.classList.remove('swiping', 'will-open-menu')
        if (bubble) bubble.style.transform = ''
        if (triggered) {
          haptic(14)
          const m = messagesRef.current.find((x) => String(x.id) === mid)
          if (m) setMenuMsg(m)
        }
        return
      }

      // Палец почти не сдвинулся — это тап, а не жест. Ссылки, кнопки внутри
      // пузыря (цитата, карточка еды, «повторить») отрабатывают сами через
      // нативный click, в счёт двойного тапа не идут.
      if (mode === null && !interactive) {
        const now = Date.now()
        if (lastTap.mid === mid && now - lastTap.time < DOUBLE_TAP_MS) {
          lastTap = { mid: null, time: 0 }
          const m = messagesRef.current.find((x) => String(x.id) === mid)
          if (m) toggleReactionRef.current(m)
        } else {
          lastTap = { mid, time: now }
        }
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    const noCtx = (e) => e.preventDefault()
    el.addEventListener('contextmenu', noCtx)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('contextmenu', noCtx)
    }
  }, [])

  return (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div className="chat-overlay" ref={overlayRef} {...panelProps}>
        <header className="chat-header">
          <button className="chat-back" onClick={handleClose} aria-label="Назад">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button className="chat-peer" onClick={() => setProfileOpen(true)}>
            <span className={`chat-peer-ava${peerOnline ? ' online' : ''}`}>
              <Avatar src={friend.avatar} name={friendName} size={40} />
            </span>
            <span className="chat-peer-meta">
              <span className="chat-peer-name">{friendName}</span>
              {/* Приоритет: печатает → в сети → был(а) → запасной вариант */}
              {peerTyping ? (
                <span className="chat-peer-sub typing">печатает…</span>
              ) : peerOnline ? (
                <span className="chat-peer-sub online">в сети</span>
              ) : peerLastSeen ? (
                <span className="chat-peer-sub">{lastSeenLabel(peerLastSeen)}</span>
              ) : (
                <span className="chat-peer-sub">Открыть профиль</span>
              )}
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
            // Заглушку прячем, пока собеседник печатает: иначе экран
            // одновременно говорит «сообщений нет» и «Х печатает».
            peerTyping ? null : (
              <div className="chat-empty">
                <div className="chat-empty-emoji">👋</div>
                <p>Сообщений пока нет.<br />Напишите первым!</p>
              </div>
            )
          ) : (
            <MessageList
              messages={messages} myId={myId} friendName={friendName}
              onQuoteTap={jumpTo} onImgLoad={onImgLoad} onRetry={retry}
              onOpenMeal={setMealCard} onToggleReaction={toggleReaction}
            />
          )}
          {peerTyping && <TypingBubble name={friendName} />}
        </div>

        {showJump && (
          <button className="chat-jump" onClick={() => { pinBottom(true); setShowJump(false) }} aria-label="Вниз">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}

        <Composer
          reply={reply}
          onCancelReply={() => setReply(null)}
          onSend={doSend}
          onPickMeal={() => setMealPick(true)}
          onTyping={sendTyping}
        />
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

      {mealPick && (
        <MealPickerSheet onClose={() => setMealPick(false)} onPick={sendMeal} />
      )}

      {mealCard && (
        <MealCardSheet meal={mealCard} onClose={() => setMealCard(null)} />
      )}

      {menuOpen && (
        <ChatMenuSheet
          onClose={() => setMenuOpen(false)}
          onProfile={() => setProfileOpen(true)}
          onClearForMe={() => setConfirmClear(true)}
        />
      )}

      {/* Без капчи: действие обратимо для собеседника — у него переписка
          остаётся, и это не удаление аккаунта. Хватает «Да / Нет». */}
      {confirmClear && (
        <ConfirmDialog
          text="Вы уверены, что хотите удалить чат?"
          onYes={() => { setConfirmClear(false); clearChatForMe() }}
          onNo={() => setConfirmClear(false)}
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
const MessageList = memo(function MessageList({ messages, myId, friendName, onQuoteTap, onImgLoad, onRetry, onOpenMeal, onToggleReaction }) {
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
          friendName={friendName} onQuoteTap={onQuoteTap} onImgLoad={onImgLoad}
          onRetry={onRetry} onOpenMeal={onOpenMeal} onToggleReaction={onToggleReaction}
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

// «Печатает…» — отдельный пузырь в конце ленты, стилизован под сообщение
// собеседника, чтобы не выбиваться из потока.
function TypingBubble({ name }) {
  return (
    <div className="msg-row theirs typing-row">
      <div className="msg theirs tail typing-bubble">
        <span className="typing-name">{name} печатает</span>
        <span className="typing-dots" aria-hidden><i /><i /><i /></span>
      </div>
    </div>
  )
}

// Карточка приёма пищи внутри пузыря. Формат один — v2; записи старого формата
// поднимаются нормализатором, поэтому отдельной ветки отрисовки больше нет.
function MealRefCard({ meal: raw, onOpen }) {
  const meal = normalizeMealCard(raw)
  if (!meal) return null
  const items = meal.items || []
  const shown = items.slice(0, 3)
  const rest = items.length - shown.length
  // У поднятых старых записей макросов нет — строку БЖУ тогда не рисуем,
  // иначе вместо чисел было бы «null Б».
  const hasMacros = meal.protein != null || meal.fat != null || meal.carbs != null
  // Там же единственный продукт совпадает с заголовком — список из одной
  // строки, дублирующей название, выглядел бы ошибкой.
  const listRedundant = items.length === 1 && items[0].name === meal.label
  return (
    <button className="mealcard" onClick={() => onOpen?.(meal)}>
      <div className="mealcard-head">
        <span className="mealcard-emoji">{meal.emoji || '🍽'}</span>
        <span className="mealcard-title">
          <span className="mealcard-label">{meal.label}</span>
          <span className="mealcard-when">{meal.date ? dayLabel(meal.date + 'T12:00:00') : ''}</span>
        </span>
        <span className="mealcard-kcal">{meal.kcal}<span className="mealcard-kcal-u">ккал</span></span>
      </div>

      {!listRedundant && (
        <ul className="mealcard-items">
          {shown.map((it, i) => (
            <li key={i}>
              <span className="mealcard-item-name">{it.emoji ? it.emoji + ' ' : ''}{it.name}</span>
              {it.grams ? <span className="mealcard-item-g">{it.grams} {it.unit || 'г'}</span> : null}
            </li>
          ))}
          {rest > 0 && <li className="mealcard-more">и ещё {rest}</li>}
        </ul>
      )}

      {hasMacros && (
        <div className="mealcard-macros">
          <span><b>{meal.protein}</b> Б</span>
          <span><b>{meal.fat}</b> Ж</span>
          <span><b>{meal.carbs}</b> У</span>
        </div>
      )}
    </button>
  )
}

function MessageRow({ m, mine, tail, grouped, onQuoteTap, onImgLoad, onRetry, onOpenMeal, onToggleReaction }) {
  const status = m.status // sending | failed | undefined(=sent)

  // Двойной клик — фолбэк для мыши/трекпада (тач-версия жеста живёт в
  // делегированном обработчике на списке, см. ChatView). Ссылки и кнопки
  // внутри пузыря отрабатывают сами, в реакцию не идут.
  const onDoubleClick = (e) => {
    if (e.target.closest?.('a, button')) return
    onToggleReaction?.(m)
  }

  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`} data-mid={m.id}>
      {/* Иконка «⋯» — свайп влево теперь открывает меню действий целиком
          (Ответить/Копировать/Переслать/Удалить у меня), а не сразу отвечает,
          поэтому стрелка ответа заменена на многоточие. */}
      <span className="msg-action-hint" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" />
        </svg>
      </span>
      <div className={`msg ${mine ? 'mine' : 'theirs'}${tail ? ' tail' : ''}`} onDoubleClick={onDoubleClick}>
        {m.forwarded_name && (
          <div className="msg-forward">Переслано от {m.forwarded_name}</div>
        )}
        {m.reply_snapshot && (
          <button className="msg-quote" onClick={() => m.reply_to && onQuoteTap(m.reply_to)}>
            <span className="msg-quote-name">{m.reply_snapshot.name}</span>
            <span className="msg-quote-text">{m.reply_snapshot.image ? '📷 ' : ''}{m.reply_snapshot.text || 'Фото'}</span>
          </button>
        )}
        {m.meal_ref && <MealRefCard meal={m.meal_ref} onOpen={onOpenMeal} />}
        {/* Открытие блокируем, только пока фото не на сервере: при 'sending'
            в href лежит blob:, при 'failed' грузить нечего. Проверка на любой
            truthy status ловила и 'sent' — свежее фото не открывалось до
            перезагрузки чата. */}
        {m.image_url && (
          <a href={m.image_url} target="_blank" rel="noreferrer" className="msg-img-wrap"
             onClick={(e) => { if (status === 'sending' || status === 'failed') e.preventDefault() }}>
            <img src={m.image_url} alt="" className="msg-img" onLoad={onImgLoad} draggable={false} />
          </a>
        )}
        {m.text && <div className="msg-text">{renderText(m.text)}</div>}
        <div className="msg-meta">
          <span className="msg-time">{timeShort(m.created_at)}</span>
          {mine && status === 'sending' && <span className="msg-tick sending"><ForkTick /></span>}
          {/* Доставленным считаем и status: undefined (пришло с сервера), и
              'sent' (только что отправили). Проверка на !status пропускала
              'sent', и вилка не появлялась до перезагрузки чата. */}
          {mine && (!status || status === 'sent') && (
            <span className={`msg-tick${m.read_at ? ' read' : ''}`} title={m.read_at ? 'Прочитано' : 'Отправлено'}>
              <ForkTick />
            </span>
          )}
          {mine && status === 'failed' && (
            <button className="msg-fail" onClick={() => onRetry(m)} title="Повторить">! повторить</button>
          )}
        </div>
        <ReactionBadge reactions={m.reactions} />
      </div>
    </div>
  )
}

// Реакция на сообщение — маленький бейдж с морковкой у нижнего угла пузыря.
// Появление и исчезновение анимированы CSS-transition (плавный «поп»), а не
// keyframes на маунт: React не умеет анимировать удаление узла из DOM сам по
// себе, поэтому бейдж остаётся смонтированным ещё 260мс после того, как
// реакция снята — ровно на время transition, — и только потом пропадает
// по-настоящему. Отсюда mounted (то, что реально в DOM) отдельно от show
// (то, что видно) — на mounted=true, show=false элемент есть, но прозрачный
// и сжатый, и именно это состояние проигрывает анимацию исчезновения.
function ReactionBadge({ reactions }) {
  const count = reactions ? Object.keys(reactions).length : 0
  const active = count > 0
  const [mounted, setMounted] = useState(active)
  const [show, setShow] = useState(active && REDUCED_MOTION)
  const unmountTimer = useRef(null)
  const frames = useRef([])

  useEffect(() => {
    clearTimeout(unmountTimer.current)
    frames.current.forEach(cancelAnimationFrame)
    frames.current = []

    if (REDUCED_MOTION) {
      setMounted(active)
      setShow(active)
      return
    }

    if (active) {
      setMounted(true)
      // Два кадра: сначала элемент должен попасть в DOM со стартовыми
      // стилями (scale 0, opacity 0), и только потом получить класс .show —
      // иначе браузер применит конечное состояние сразу, без перехода.
      const f1 = requestAnimationFrame(() => {
        const f2 = requestAnimationFrame(() => setShow(true))
        frames.current.push(f2)
      })
      frames.current.push(f1)
    } else {
      setShow(false)
      unmountTimer.current = setTimeout(() => setMounted(false), 260)
    }

    return () => {
      clearTimeout(unmountTimer.current)
      frames.current.forEach(cancelAnimationFrame)
    }
  }, [active])

  if (!mounted) return null
  return (
    <span className={`msg-reaction${show ? ' show' : ''}`} aria-hidden>
      {CARROT}
      {count > 1 && <b>{count}</b>}
    </span>
  )
}

// ── composer (изолированный ввод: печать не трогает список) ────────────────────
function Composer({ reply, onCancelReply, onSend, onPickMeal, onTyping }) {
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)

  // Троттлим «печатает»: шлём не чаще раза в 2с, гасим через 2.5с тишины.
  // Иначе на каждый символ уходил бы бродкаст.
  const typingRef = useRef({ lastSent: 0, stopTimer: null, active: false })
  const pingTyping = useCallback(() => {
    const t = typingRef.current
    const now = Date.now()
    if (!t.active || now - t.lastSent > 2000) {
      t.active = true
      t.lastSent = now
      onTyping?.(true)
    }
    clearTimeout(t.stopTimer)
    t.stopTimer = setTimeout(() => { t.active = false; onTyping?.(false) }, 2500)
  }, [onTyping])

  const stopTyping = useCallback(() => {
    const t = typingRef.current
    clearTimeout(t.stopTimer)
    if (t.active) { t.active = false; onTyping?.(false) }
  }, [onTyping])

  // Гасим ТОЛЬКО при реальном размонтировании. Зависимость от stopTyping
  // заставляла cleanup срабатывать на каждый рендер и слать ложное
  // «перестал печатать» — из-за этого лента тряслась.
  const stopRef = useRef(stopTyping)
  stopRef.current = stopTyping
  useEffect(() => () => stopRef.current(), [])

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
    stopTyping()
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
            <button className="chat-tool" onClick={onPickMeal} aria-label="Отправить приём пищи">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3v7.2a2.2 2.2 0 0 0 4.4 0V3" /><path d="M7.2 10.4V21" />
                <path d="M16.5 3c-1.4 1.6-2 3.6-2 5.6 0 1.7.7 3 2 3.4V21" />
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
            onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) pingTyping(); else stopTyping() }}
            onKeyDown={onKey}
            onBlur={stopTyping}
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

// ── подробный просмотр карточки еды (тап по карточке в сообщении) ─────────────
function MealCardSheet({ meal: raw, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const meal = normalizeMealCard(raw)
  const items = meal.items || []
  const macros = [
    { key: 'protein', label: 'Белки', v: meal.protein },
    { key: 'fat', label: 'Жиры', v: meal.fat },
    { key: 'carbs', label: 'Углеводы', v: meal.carbs },
  ]
  const hasMacros = macros.some((m) => m.v != null)
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 88 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />

        <div className="mealsheet-head">
          <span className="mealsheet-emoji">{meal.emoji || '🍽'}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mealsheet-title">{meal.label}</div>
            <div className="mealsheet-when">{meal.date ? dayLabel(meal.date + 'T12:00:00') : ''}</div>
          </div>
          <div className="mealsheet-kcal">
            <b>{meal.kcal}</b><span>ккал</span>
          </div>
        </div>

        {hasMacros && (
          <div className="mealsheet-macros">
            {macros.map((m) => (
              <div key={m.key} className="mealsheet-macro">
                <div className="mealsheet-macro-v">{m.v ?? 0}<span>г</span></div>
                <div className="mealsheet-macro-l">{m.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* У поднятых старых записей состав — это сам заголовок; секцию прячем. */}
        {!(items.length === 1 && items[0].name === meal.label) && (
        <>
        <div className="mealsheet-listlabel">Состав</div>
        <ul className="mealsheet-list">
          {items.map((it, i) => (
            <li key={i}>
              <span className="mealsheet-item-name">{it.emoji ? it.emoji + ' ' : ''}{it.name}</span>
              <span className="mealsheet-item-right">
                {it.grams ? <span className="mealsheet-item-g">{it.grams} {it.unit || 'г'}</span> : null}
                <span className="mealsheet-item-k">{it.kcal} ккал</span>
              </span>
            </li>
          ))}
        </ul>
        </>
        )}
      </div>
    </div>
  )
}

// ── выбор приёма пищи для отправки ────────────────────────────────────────────
// Показываем дни с записями (сегодня и назад), внутри — группы по типам приёма.
// Отправляем группу целиком: тогда в карточке осмыслен «список продуктов».
function MealPickerSheet({ onClose, onPick }) {
  const { days } = useStore()
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  // Дни с едой, свежие сверху, максимум неделя — дальше пролистывать неудобно.
  const dayKeys = Object.keys(days || {})
    .filter((k) => (days[k]?.meals || []).length > 0)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 7)

  // Секции берём из meals.js, а не группируем по legacy-полю type: иначе
  // пользовательские приёмы («Второй завтрак», «После тренировки») и «Без
  // категории» просто не появились бы в списке и их нельзя было бы отправить.
  const groupsOf = (key) => {
    const day = days[key]
    return getMealSections(day)
      .map((s) => ({ section: s, items: foodsForMeal(day, s.id) }))
      .filter((g) => g.items.length > 0)
  }

  const pick = (key, group) => {
    onPick(mealCardFromGroup({ section: group.section, date: key, meals: group.items }))
    close()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 85 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 18 }}>Отправить приём пищи</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        {dayKeys.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, padding: '10px 0 16px' }}>
            Пока нечего отправить — сначала запишите приём пищи в дневник.
          </p>
        ) : (
          <div className="mealpick-scroll">
            {dayKeys.map((key) => (
              <div key={key} className="mealpick-day">
                <div className="mealpick-daylabel">{dayLabel(key + 'T12:00:00')}</div>
                {groupsOf(key).map((g) => (
                  <button key={g.section.id} className="mealpick-row" onClick={() => pick(key, g)}>
                    <span className="mealpick-emoji">{g.section.emoji}</span>
                    <span className="mealpick-meta">
                      <span className="mealpick-name">{g.section.label}</span>
                      <span className="mealpick-sub">
                        {g.items.map((m) => m.name).join(', ')}
                      </span>
                    </span>
                    <span className="mealpick-kcal">
                      {Math.round(g.items.reduce((s, m) => s + (+m.kcal || 0), 0))}
                      <span className="mealpick-kcal-u"> ккал</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

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
  // Открывается по долгому нажатию — обычные 340 мс тут читаются как лаг.
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose, { openMs: 190 })
  const ctx = { m, mine }
  const items = CTX_ACTIONS.filter((a) => !a.show || a.show(ctx))
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 80 }}>
      <div className="sheet ctx-sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="ctx-preview">{previewOf(m)}</div>
        {items.map((a, i) => (
          <button
            key={a.key}
            className={`ctx-item${a.danger ? ' danger' : ''}`}
            // Небольшая лесенка: пункты «всплывают» следом за шторкой.
            style={{ '--i': i }}
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
