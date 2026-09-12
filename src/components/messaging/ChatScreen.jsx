// Экран переписки — личной и групповой.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЖИВЁТ ЗДЕСЬ, А ЧТО ВЫНЕСЕНО
//
// Здесь: загрузка истории, realtime, отправка, жесты по ленте, состояние
// запроса. Отрисовка пузырей — в MessageList, ввод — в MessageComposer, меню
// сообщения — в MessageActions, сведения о диалоге — в ConversationInfo.
// Раньше всё это лежало в одном файле на полторы тысячи строк, и правка
// подписи под пузырём означала открыть файл, в котором заодно живёт вся
// логика подписок и гонок.
//
// ─────────────────────────────────────────────────────────────────────────────
// ГОНКА, КОТОРАЯ ТЕРЯЛА СООБЩЕНИЯ
//
// Подписка создаётся синхронно, а история приезжает асинхронно. Пока история
// вызывала setMessages(rows) — ПЕРЕЗАПИСЬ, — сообщение, пришедшее в промежуток
// между подпиской и ответом, добавлялось в пустой список и через мгновение
// исчезало вместе с ним. Увидеть его снова можно было, только переоткрыв чат.
//
// Поэтому ни один источник не перезаписывает список: история, realtime и
// локальные черновики СЛИВАЮТСЯ mergeMessages по id. Слияние идемпотентно,
// поэтому повторное событие и переподписка после разрыва связи безопасны.
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import {
  listMessages, sendMessage, markRead, subscribeToConversation, createTypingChannel,
  unsendMessage, deleteMessageForMe, setReaction, conversationInfo, conversationMembers,
  acceptRequest, declineRequest, uploadMedia, toMessage, DOUBLE_TAP_REACTION,
} from '../../lib/messaging.js'
import { block } from '../../lib/social.js'
import { watchPresence, fetchLastSeen } from '../../lib/supabase.js'
import { useSwipeBack } from '../../lib/useSwipeBack.js'
import { useScrollLock } from '../../lib/useScrollLock.js'
import { normalizeError } from '../../lib/authErrors.js'
import { setActiveChat } from '../../lib/notifications.js'
import { createDoubleTap } from '../../lib/doubleTap.js'
import { mergeMessages, settleMessage, failMessage, newClientId, isTempId } from '../../lib/chatLog.js'
import { Avatar } from '../Avatar.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import MessageList, { TypingBubble } from './MessageList.jsx'
import MessageComposer from './MessageComposer.jsx'
import MessageActions from './MessageActions.jsx'
import ForwardSheet from './ForwardSheet.jsx'
import ConversationInfo from './ConversationInfo.jsx'
import { MealCardSheet, MealPickerSheet } from './MealSheets.jsx'
import { lastSeenLabel, previewOf } from '../../lib/chatFormat.js'

const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch {} }

// Размер страницы истории. Сорок — примерно два экрана на телефоне:
// достаточно, чтобы прокрутка вверх успела догрузить следующую страницу
// раньше, чем человек упрётся в её начало.
const PAGE = 40

export default function ChatScreen({ conversation, onClose, onOpenProfile, onChanged }) {
  const { user, profile } = useStore()
  const myId = user?.id || ''
  const myName = profile?.name || 'Вы'

  const convId = conversation.id
  // Диалог могли открыть, зная только его id: из уведомления о группе или из
  // поиска по сообщениям. Тогда всё остальное — тип, название, собеседник,
  // число участников — приходит с сервера, а переданное вызывающим служит
  // лишь первым кадром, чтобы шапка не была пустой.
  //
  // Раньше `kind`, `peerId` и `membersCount` брались только из пропа, и
  // групповой чат, открытый из уведомления, показывал в шапке « участников»
  // с пустым числом, а личный, открытый из поиска, — «Диалог» вместо имени.
  const [info, setInfo] = useState(null)
  const kind = info?.kind || conversation.kind || 'direct'
  const isGroup = kind === 'group'
  const peerId = info?.peer_id ?? conversation.peerId ?? null
  const membersCount = info?.members_count ?? conversation.membersCount ?? 0
  const [title, setTitle] = useState(conversation.title || (conversation.kind === 'group' ? 'Группа' : 'Диалог'))
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatarUrl || null)
  const [state, setState] = useState(conversation.state || 'accepted')

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [olderCursor, setOlderCursor] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [reply, setReply] = useState(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [forwardMsg, setForwardMsg] = useState(null)
  const [toast, setToast] = useState(null)
  const [showJump, setShowJump] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [mealPick, setMealPick] = useState(false)
  const [mealCard, setMealCard] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [typingWho, setTypingWho] = useState(null)
  const [peerOnline, setPeerOnline] = useState(false)
  const [peerLastSeen, setPeerLastSeen] = useState(null)
  const [people, setPeople] = useState({})

  const listRef = useRef(null)
  const retryLoadRef = useRef(() => {})
  const atBottomRef = useRef(true)
  const bootedRef = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const { panelProps, scrimProps, close: handleClose } = useSwipeBack(onClose)
  useScrollLock()

  // Локальные превью отправляемых вложений. Освободить URL сразу после
  // отправки можно только при успехе: у неудачного сообщения этот самый blob
  // и стоит в превью, и досрочный revoke оставил бы битую картинку.
  const blobUrlsRef = useRef(new Set())
  const takeBlobUrl = useCallback((file) => {
    const url = URL.createObjectURL(file)
    blobUrlsRef.current.add(url)
    return url
  }, [])
  const releaseBlobUrl = useCallback((url) => {
    if (!url || !blobUrlsRef.current.delete(url)) return
    URL.revokeObjectURL(url)
  }, [])
  useEffect(() => {
    const urls = blobUrlsRef.current
    return () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear() }
  }, [])

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

  // Скрыть нижнюю навигацию, пока чат открыт. Счётчик, а не флаг: поверх чата
  // может открыться профиль, и класс должен сняться только с последним.
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
     
  }, [])

  // Жёсткий запрет выделения в ленте. Одного CSS мало: iOS успевает начать
  // выделение до того, как отработает user-select, и красит подсветку поверх
  // пузырей. Поле ввода из-под запрета исключено.
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

  // Пока открыт этот диалог — не показывать пуш о его же сообщениях.
  useEffect(() => {
    setActiveChat({ conversationId: convId, peerId })
    return () => setActiveChat({})
  }, [convId, peerId])

  // Карточки участников: в группе без них пузыри безымянны. Один запрос на
  // диалог, а не по запросу на каждое сообщение.
  useEffect(() => {
    if (!isGroup) return
    let alive = true
    conversationMembers(convId)
      .then((rows) => {
        if (!alive) return
        const map = {}
        for (const r of rows) map[r.user_id] = r
        setPeople(map)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [convId, isGroup])

  // Актуальные сведения о диалоге. Ответ перезаписывает то, что угадал
  // вызывающий: он мог не знать ни типа диалога, ни имени собеседника.
  useEffect(() => {
    let alive = true
    conversationInfo(convId)
      .then((i) => {
        if (!alive || !i) return
        setInfo(i)
        setState(i.my_state || 'accepted')
        setTitle(i.kind === 'group'
          ? (i.title || 'Группа')
          : (i.peer_name || i.peer_username || 'Диалог'))
        setAvatarUrl(i.kind === 'group' ? i.avatar_url : i.peer_avatar)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [convId])

  // Загрузка истории + realtime.
  useEffect(() => {
    markRead(convId)
    let cancelled = false

    // Сброс при СМЕНЕ диалога обязателен именно теперь, когда история не
    // перезаписывает список, а сливается с ним: открыть другой чат можно и без
    // размонтирования, и без сброса переписки двоих слились бы в одну ленту.
    // Идёт СИНХРОННО, до подписки и до первого await, поэтому событие,
    // пришедшее следом, попадает уже в чистый список и не теряется.
    setMessages([])
    setOlderCursor(null)
    setLoading(true)
    setLoadErr(null)
    setShowJump(false)
    atBottomRef.current = true
    bootedRef.current = false

    const load = async () => {
      try {
        const { items, cursor, unavailable } = await listMessages(convId, { limit: PAGE })
        if (cancelled) return
        // «Раздела нет в базе» — не «сообщений пока нет». Заглушка «Напишите
        // первым» здесь уверяла бы, что переписки не существует.
        if (unavailable) {
          setLoadErr('Переписка пока недоступна — база ещё не обновлена')
          setLoading(false)
          return
        }
        setMessages((cur) => mergeMessages(cur, items))
        setOlderCursor(cursor)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        // Пустой экран и «сообщений нет» — разные вещи. Сбой загрузки не
        // должен показывать заглушку «Напишите первым».
        setLoadErr(normalizeError(e).message)
        setLoading(false)
      }
    }
    load()
    retryLoadRef.current = () => { setLoading(true); setLoadErr(null); load() }

    const unsub = subscribeToConversation(convId, (eventType, m) => {
      if (!m) return
      if (eventType === 'INSERT') {
        if (m.sender !== myId) markRead(convId)
        // toMessage обязателен: из postgres_changes строка приходит сырой, и
        // reactions в ней null, пока никто не реагировал. Слитый в список
        // null затирал бы {} у уже осевшего сообщения.
        setMessages((cur) => mergeMessages(cur, [toMessage(m)]))
        if (atBottomRef.current) requestAnimationFrame(() => pinBottom(true))
        else setShowJump(true)
        onChanged?.()
      } else if (eventType === 'UPDATE') {
        // Реакция, прочтение или отзыв — приезжает одной и той же строкой.
        setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, ...toMessage(m) } : x)))
      }
    })

    return () => { cancelled = true; unsub() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, myId])

  // Догрузка более ранних сообщений при прокрутке к началу.
  //
  // Высоту сохраняем вручную: вставка страницы сверху сдвигает содержимое, и
  // без поправки лента прыгает у человека под пальцем ровно в тот момент,
  // когда он читает.
  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return
    setLoadingOlder(true)
    const el = listRef.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const { items, cursor } = await listMessages(convId, { limit: PAGE, cursor: olderCursor })
      setMessages((cur) => mergeMessages(items, cur))
      setOlderCursor(cursor)
      requestAnimationFrame(() => {
        const node = listRef.current
        if (node) node.scrollTop = node.scrollHeight - before
      })
    } catch (e) {
      flash(normalizeError(e).message)
    } finally {
      setLoadingOlder(false)
    }
  }, [olderCursor, loadingOlder, convId, flash])

  // Присутствие собеседника. Только в личном диалоге: «в сети» у группы из
  // двадцати человек ничего не значит.
  useEffect(() => {
    if (!peerId) return
    let cancelled = false
    const stop = watchPresence(peerId, (online) => {
      if (cancelled) return
      setPeerOnline(online)
      if (!online) fetchLastSeen(peerId).then((t) => { if (!cancelled) setPeerLastSeen(t) })
    })
    fetchLastSeen(peerId).then((t) => { if (!cancelled) setPeerLastSeen(t) })
    return () => { cancelled = true; stop() }
  }, [peerId])

  // «Печатает…». Ссылка ДОЛЖНА быть стабильной: пересоздание на каждый рендер
  // заставляло composer пересоздавать колбэки, его cleanup принимал это за
  // уход из чата и слал ложное «перестал печатать» — индикатор мигал, а лента
  // дёргалась на каждом мигании.
  const typingRef = useRef({ sendTyping: () => {} })
  const sendTyping = useCallback((t) => typingRef.current.sendTyping(t, myName), [myName])

  // Карточки участников читаем ЧЕРЕЗ REF, а не из замыкания: иначе загрузка
  // состава группы попадала бы в зависимости эффекта, канал пересоздавался бы
  // в этот момент, и индикатор «печатает» сбрасывался на ровном месте.
  const peopleRef = useRef(people)
  peopleRef.current = people

  useEffect(() => {
    let hideTimer = null   // страховка: собеседник свернул вкладку
    let graceTimer = null  // пауза перед скрытием
    const ch = createTypingChannel(convId, myId, (typing, from, name) => {
      clearTimeout(graceTimer)
      clearTimeout(hideTimer)
      if (typing) {
        setTypingWho(name || peopleRef.current[from]?.display_name || 'Собеседник')
        hideTimer = setTimeout(() => setTypingWho(null), 5000)
      } else {
        // Между словами прилетает false. Без паузы пузырь мигал бы, каждый
        // раз меняя высоту ленты.
        graceTimer = setTimeout(() => setTypingWho(null), 1200)
      }
    })
    typingRef.current = ch
    return () => {
      clearTimeout(hideTimer); clearTimeout(graceTimer)
      ch.unsubscribe(); setTypingWho(null)
    }
  }, [convId, myId])

  // Прокрутка — только в момент ПОЯВЛЕНИЯ индикатора и только плавная.
  const prevTypingRef = useRef(false)
  useEffect(() => {
    const appeared = Boolean(typingWho) && !prevTypingRef.current
    prevTypingRef.current = Boolean(typingWho)
    if (!appeared || !atBottomRef.current) return
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [typingWho])

  // Подсветка сообщения на время меню. Состояние ведётся ОДНИМ эффектом от
  // menuMsg: открылось — подсветили, закрылось — сняли со всех строк, что бы
  // ни случилось между. Раньше подсветка ставилась жестом и снималась вручную
  // в разных ветках, и на некоторых путях сообщение «залипало» выделенным.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const clearAll = () => {
      root.querySelectorAll('.msg-row.selected').forEach((el) => el.classList.remove('selected'))
      try { window.getSelection()?.removeAllRanges() } catch {}
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    if (!menuMsg) { clearAll(); return }
    clearAll()
    root.querySelector(`[data-mid="${menuMsg.id}"]`)?.classList.add('selected')
    return clearAll
  }, [menuMsg])

  const onScroll = useCallback(() => {
    const nb = nearBottom()
    atBottomRef.current = nb
    if (nb && showJump) setShowJump(false)
    // Порог с запасом: страница должна начать грузиться до того, как человек
    // упрётся в пустоту, иначе прокрутка останавливается и ждёт сеть.
    const el = listRef.current
    if (el && el.scrollTop < 320) loadOlder()
  }, [showJump, loadOlder])

  const onImgLoad = useCallback(() => { if (atBottomRef.current) pinBottom(false) }, [])

  // Прыжок к оригиналу ответа + подсветка.
  const jumpTo = useCallback((id) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`)
    if (!el) { flash('Сообщение не загружено — прокрутите выше'); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('msg-flash')
    void el.offsetWidth // reflow, чтобы анимация перезапустилась
    el.classList.add('msg-flash')
    setTimeout(() => el.classList.remove('msg-flash'), 1500)
  }, [flash])

  const startReply = useCallback((m) => {
    const who = m.sender === myId ? myName
      : (people[m.sender]?.display_name || people[m.sender]?.username || title)
    setReply({ id: m.id, snapshot: { name: who, text: previewOf(m), image: !!(m.image_url || m.media) } })
  }, [myId, myName, people, title])

  // Отправка: оптимистично + загрузка вложения + RPC.
  const doSend = useCallback(async ({ text, file, kind = 'image', mode = 'keep' }) => {
    const r = reply
    setReply(null)
    const tempId = 'temp-' + newClientId()
    // Ключ идемпотентности придумывается ОДИН раз на сообщение и живёт на нём.
    // Повтор уходит с ТЕМ ЖЕ ключом — сервер вернёт уже сохранённую строку
    // вместо второго сообщения.
    const clientId = newClientId()
    const localUrl = file ? takeBlobUrl(file) : null
    const temp = {
      id: tempId, conversation_id: convId, sender: myId, recipient: peerId,
      text: text || null,
      image_url: null,
      media: file ? { kind, localUrl, mode } : null,
      meal_ref: null,
      reply_to: r?.id || null, reply_snapshot: r?.snapshot || null, forwarded_name: null,
      created_at: new Date().toISOString(), status: 'sending', _clientId: clientId,
    }
    setMessages((cur) => mergeMessages(cur, [temp]))
    atBottomRef.current = true
    requestAnimationFrame(() => pinBottom(true))
    try {
      const imageUrl = null
      let media = null
      if (file) {
        // ВСЕ вложения переписки уходят в ЗАКРЫТЫЙ dm-media — включая обычные
        // фото. Раньше для них делалось исключение ради старой истории, но
        // цена исключения была в том, что фото личной переписки лежало в
        // публичном бакете и открывалось по прямой ссылке кому угодно.
        // Старая история читается по-прежнему (chat-images остался на чтение,
        // см. MessageList), а новое приватно с первой секунды.
        const up = await uploadMedia({ conversationId: convId, userId: myId, file, kind, mode })
        if (up.error) throw new Error(up.error)
        media = up.ok
      }
      const res = await sendMessage({
        conversationId: convId, text, imageUrl, media,
        replyTo: r?.id, replySnapshot: r?.snapshot, clientId,
      })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => settleMessage(cur, tempId, res.ok))
      releaseBlobUrl(localUrl)
      onChanged?.()
    } catch (e) {
      setMessages((cur) => failMessage(cur, tempId, { text, file, kind, mode, clientId }))
      flash(e.message || 'Сообщение не отправилось')
    }
  }, [reply, myId, convId, peerId, takeBlobUrl, releaseBlobUrl, flash, onChanged])

  const sendMeal = useCallback(async (mealRef) => {
    const tempId = 'temp-' + newClientId()
    const clientId = newClientId()
    const temp = {
      id: tempId, conversation_id: convId, sender: myId, recipient: peerId,
      text: null, image_url: null, media: null, meal_ref: mealRef,
      reply_to: null, reply_snapshot: null, forwarded_name: null,
      created_at: new Date().toISOString(), status: 'sending', _clientId: clientId,
    }
    setMessages((cur) => mergeMessages(cur, [temp]))
    atBottomRef.current = true
    requestAnimationFrame(() => pinBottom(true))
    try {
      const res = await sendMessage({ conversationId: convId, mealRef, clientId })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => settleMessage(cur, tempId, res.ok))
    } catch {
      setMessages((cur) => failMessage(cur, tempId, { mealRef, clientId }))
    }
  }, [myId, convId, peerId])

  const retry = useCallback(async (m) => {
    const p = m._payload || { text: m.text, file: null }
    // Ключ берём СТАРЫЙ — тот, с которым уходила первая попытка. Именно это
    // делает повтор безопасным: если первая попытка на самом деле дошла и
    // потерялся только ответ, сервер вернёт ту же строку, а не создаст вторую.
    const clientId = m._clientId || p.clientId || newClientId()
    setMessages((cur) => cur.map((x) => (
      x.id === m.id ? { ...x, status: 'sending', _clientId: clientId } : x
    )))
    try {
      const imageUrl = m.image_url && !m.image_url.startsWith('blob:') ? m.image_url : null
      let media = m.media && m.media.path ? m.media : null
      if (p.file) {
        const up = await uploadMedia({
          conversationId: convId, userId: myId, file: p.file,
          kind: p.kind || 'image', mode: p.mode || 'keep',
        })
        if (up.error) throw new Error(up.error)
        media = up.ok
      }
      const res = await sendMessage({
        conversationId: convId, text: p.text, imageUrl, media,
        mealRef: m.meal_ref || p.mealRef, forwardedName: m.forwarded_name,
        replyTo: m.reply_to, replySnapshot: m.reply_snapshot, clientId,
      })
      if (res.error) throw new Error(res.error)
      setMessages((cur) => settleMessage(cur, m.id, res.ok))
    } catch {
      setMessages((cur) => failMessage(cur, m.id, { ...p, clientId }))
    }
  }, [myId, convId])

  const doCopy = useCallback(async (m) => {
    try { await navigator.clipboard.writeText(m.text || previewOf(m)); flash('Скопировано') }
    catch { flash('Не удалось скопировать') }
  }, [flash])

  // Реакция. Оптимистично — двойной тап обязан выглядеть мгновенным.
  // Сообщение, ещё не сохранённое на сервере, реагировать не на что: строки в
  // базе у него нет, и RPC его не найдёт.
  const react = useCallback(async (m, emoji) => {
    if (!m || isTempId(m.id)) return
    const prev = (m.reactions || {})[myId] || null
    const next = emoji === null || prev === emoji ? null : emoji
    haptic(next ? 16 : 10)
    setMessages((cur) => cur.map((x) => {
      if (x.id !== m.id) return x
      const reactions = { ...(x.reactions || {}) }
      if (next) reactions[myId] = next; else delete reactions[myId]
      return { ...x, reactions }
    }))
    const res = await setReaction(m.id, next)
    if (res.error) {
      setMessages((cur) => cur.map((x) => {
        if (x.id !== m.id) return x
        const reactions = { ...(x.reactions || {}) }
        if (prev) reactions[myId] = prev; else delete reactions[myId]
        return { ...x, reactions }
      }))
      flash(res.error)
    }
  }, [myId, flash])

  // Ссылка на актуальную react для делегированного жеста: тот эффект
  // монтируется один раз и не должен пересоздаваться из-за смены myId.
  const reactRef = useRef(react)
  reactRef.current = react

  // Отзыв «у всех»: сообщение остаётся пометкой, потому что на него могут
  // ссылаться ответы — удалённая строка превратила бы цитату в сироту.
  const doUnsend = useCallback(async (m) => {
    if (isTempId(m.id)) { setMessages((cur) => cur.filter((x) => x.id !== m.id)); return }
    setMessages((cur) => cur.map((x) => (
      x.id === m.id ? { ...x, unsent_at: new Date().toISOString(), text: null, image_url: null, media: null, meal_ref: null, reactions: {} } : x
    )))
    const res = await unsendMessage(m.id)
    if (res?.error) { flash(res.error); retryLoadRef.current() }
  }, [flash])

  // «Удалить у себя» — сообщение исчезает только у меня. У собеседника
  // остаётся: это принципиально другое действие, чем отзыв.
  const doDeleteForMe = useCallback(async (m) => {
    setMessages((cur) => cur.filter((x) => x.id !== m.id))
    if (isTempId(m.id)) return
    const res = await deleteMessageForMe(m.id)
    if (res?.error) { flash(res.error); retryLoadRef.current() }
  }, [flash])

  // Свайп влево по пузырю открывает меню действий; двойной тап ставит
  // «сердце». Оба жеста считает ОДИН делегированный обработчик на списке:
  // собственный onDoubleClick на пузыре означал бы два независимых пути к
  // одному действию, и на телефоне они срабатывали оба, гася друг друга.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    let g = null
    // Счёт меток и глушитель синтезированного dblclick — в doubleTap.js.
    const taps = createDoubleTap()
    const rowOf = (t) => t.closest?.('[data-mid]')
    const doReact = (mid) => {
      const m = messagesRef.current.find((x) => String(x.id) === mid)
      if (m && !m.unsent_at) reactRef.current(m, DOUBLE_TAP_REACTION)
    }

    const onStart = (e) => {
      const row = rowOf(e.target)
      if (!row) { g = null; return }
      const t = e.touches[0]
      const interactive = !!e.target.closest?.('a, button')
      g = { row, bubble: row.querySelector('.msg'), mid: row.dataset.mid, x: t.clientX, y: t.clientY, drift: 0, decided: false, mode: null, interactive }
    }
    const onMove = (e) => {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x, dy = t.clientY - g.y
      // Максимальный отход от точки касания за весь жест — по нему onEnd
      // отличает тап от скролла. Именно максимальный, а не последний: палец,
      // уехавший на пол-экрана и вернувшийся к началу, тапом не был.
      g.drift = Math.max(g.drift, Math.hypot(dx, dy))
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Владеем только явным горизонтальным ВЛЕВО. Иначе — скролл / back-жест.
        g.mode = (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.3) ? 'swipe' : 'none'
        g.decided = true
        if (g.mode !== 'swipe') return
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
      const row = g.row, bubble = g.bubble, mid = g.mid, mode = g.mode, interactive = g.interactive, drift = g.drift
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

      // Палец почти не сдвинулся — это тап, а не жест. Ссылки и кнопки внутри
      // пузыря отрабатывают сами и в счёт двойного тапа не идут.
      if (taps.touchEnd({ id: mid, drift, interactive })) doReact(mid)
    }

    // Мышь и трекпад. С тача сюда прилетает синтезированное событие — его
    // гасит взведённый выше глушитель, иначе реакция снялась бы сразу после
    // того, как её поставил жест.
    const onDblClick = (e) => {
      const row = rowOf(e.target)
      if (!row) return
      const interactive = !!e.target.closest?.('a, button')
      if (taps.dblClick({ id: row.dataset.mid, interactive })) doReact(row.dataset.mid)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    el.addEventListener('dblclick', onDblClick)
    const noCtx = (e) => e.preventDefault()
    el.addEventListener('contextmenu', noCtx)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('contextmenu', noCtx)
    }
  }, [])

  const isRequest = state === 'pending'
  const isDeclined = state === 'declined'

  const decide = async (what) => {
    const res = what === 'accept' ? await acceptRequest(convId)
      : what === 'decline' ? await declineRequest(convId)
      : await block(peerId)
    if (res?.error) { flash(res.error); return }
    onChanged?.()
    if (what === 'accept') setState('accepted')
    else handleClose()
  }

  return (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div className="chat-overlay" ref={overlayRef} {...panelProps}>
        <header className="chat-header">
          <button className="chat-back" onClick={handleClose} aria-label="Назад">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button
            className="chat-peer"
            onClick={() => (peerId ? onOpenProfile?.(peerId) : setInfoOpen(true))}
            aria-label={peerId ? 'Открыть профиль' : 'Сведения о группе'}
          >
            <span className={`chat-peer-ava${peerOnline ? ' online' : ''}`}>
              <Avatar src={avatarUrl} name={title} size={40} />
            </span>
            <span className="chat-peer-meta">
              <span className="chat-peer-name">{title}</span>
              {/* Приоритет: печатает → в сети → был(а) → запасной вариант */}
              {typingWho ? (
                <span className="chat-peer-sub typing">{isGroup ? `${typingWho} печатает…` : 'печатает…'}</span>
              ) : isGroup ? (
                <span className="chat-peer-sub">
                  {membersCount > 0 ? `${membersCount} участников` : 'Сведения о группе'}
                </span>
              ) : peerOnline ? (
                <span className="chat-peer-sub online">в сети</span>
              ) : peerLastSeen ? (
                <span className="chat-peer-sub">{lastSeenLabel(peerLastSeen)}</span>
              ) : (
                <span className="chat-peer-sub">Открыть профиль</span>
              )}
            </span>
          </button>
          <button className="chat-more" onClick={() => setInfoOpen(true)} aria-label="Сведения о диалоге">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.4" />
            </svg>
          </button>
        </header>

        <div className="chat-list" ref={listRef} onScroll={onScroll}>
          {loadingOlder && (
            <div className="chat-older"><span className="chat-spinner small" /></div>
          )}

          {loading ? (
            <div className="chat-state"><span className="chat-spinner" /></div>
          ) : loadErr ? (
            /* Сбой загрузки — НЕ «сообщений нет». Заглушка «Напишите первым»
               здесь уверенно сообщала бы, что переписки не существует, когда
               мы просто не дозвонились. */
            <div className="chat-empty">
              <div className="chat-empty-emoji">📡</div>
              <p style={{ color: 'var(--danger)' }}>{loadErr}</p>
              <button
                className="btn ghost"
                style={{ width: 'auto', padding: '0 20px', marginTop: 12 }}
                onClick={() => retryLoadRef.current()}
              >
                Повторить
              </button>
            </div>
          ) : messages.length === 0 ? (
            typingWho ? null : (
              <div className="chat-empty">
                <div className="chat-empty-emoji">👋</div>
                <p>Сообщений пока нет.<br />Напишите первым!</p>
              </div>
            )
          ) : (
            <MessageList
              messages={messages} myId={myId} isGroup={isGroup} peopleById={people}
              onQuoteTap={jumpTo} onImgLoad={onImgLoad} onRetry={retry}
              onOpenMeal={setMealCard} onOpenMedia={setViewer}
            />
          )}
          {typingWho && <TypingBubble name={typingWho} />}
        </div>

        {showJump && (
          <button className="chat-jump" onClick={() => { pinBottom(true); setShowJump(false) }} aria-label="Вниз">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}

        {/* Запрос. Кнопки стоят НАД полем ввода, а не вместо него: человек
            может ответить, не принимая решения, — и ответ сам считается
            согласием, потому что писать в диалог, который не хочешь, никто не
            станет. */}
        {isRequest && (
          <div className="chat-request">
            <p className="chat-request-note">
              {peerId
                ? 'Этот человек хочет вам написать. Ответ автоматически разрешит переписку.'
                : 'Вас добавили в эту группу. Ответ автоматически примет приглашение.'}
            </p>
            <div className="row gap8">
              <button className="btn" style={{ flex: 1 }} onClick={() => decide('accept')}>Разрешить</button>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDecline(true)}>Удалить</button>
            </div>
          </div>
        )}

        <MessageComposer
          reply={reply}
          onCancelReply={() => setReply(null)}
          onSend={doSend}
          onPickMeal={() => setMealPick(true)}
          onTyping={sendTyping}
          disabled={isDeclined}
          disabledNote="Вы запретили этому человеку писать. Разрешить снова можно в его профиле."
        />
      </div>

      {menuMsg && (
        <MessageActions
          m={menuMsg}
          mine={menuMsg.sender === myId}
          myId={myId}
          canReact={!isTempId(menuMsg.id)}
          onClose={() => setMenuMsg(null)}
          onReply={() => startReply(menuMsg)}
          onCopy={() => doCopy(menuMsg)}
          onForward={() => setForwardMsg(menuMsg)}
          onReact={(e) => react(menuMsg, e)}
          onUnsend={() => doUnsend(menuMsg)}
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

      {infoOpen && (
        <ConversationInfo
          conversationId={convId}
          onClose={() => setInfoOpen(false)}
          onOpenProfile={onOpenProfile}
          onLeft={() => { setInfoOpen(false); handleClose(); onChanged?.() }}
          onJumpToMessage={(m) => jumpTo(m.id)}
        />
      )}

      {confirmDecline && (
        <ConfirmDialog
          text="Запретить писать? Переписка закроется, но подписки и доступ к вашим записям не изменятся. Это не блокировка."
          yesLabel="Запретить"
          noLabel="Отмена"
          onYes={() => { setConfirmDecline(false); decide('decline') }}
          onNo={() => setConfirmDecline(false)}
        />
      )}

      {forwardMsg && (
        <ForwardSheet
          messageId={forwardMsg.id}
          exceptId={convId}
          onClose={() => setForwardMsg(null)}
          onDone={(n) => { setForwardMsg(null); flash(n > 1 ? `Переслано в ${n} диалога` : 'Переслано') }}
        />
      )}

      {viewer && (
        <div
          onClick={() => setViewer(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.92)',
            display: 'grid', placeItems: 'center', padding: 16,
          }}
          role="dialog"
          aria-label="Просмотр вложения"
        >
          {viewer.kind === 'video'
            ? <video src={viewer.url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
            : <img src={viewer.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
        </div>
      )}

      {toast && <div className="chat-toast">{toast}</div>}
    </>
  )
}
