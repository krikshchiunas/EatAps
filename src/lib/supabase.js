import { createClient } from '@supabase/supabase-js'
import { pickSyncable } from './syncModel.js'
import { projectFriendState } from './friendView.js'
import { normalizeError } from './authErrors.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(url && anon)

// Хранилище сессии. Оборачиваем localStorage, потому что в приватном режиме
// iOS Safari и при запрете сторонних данных setItem бросает исключение — без
// обёртки это падение уходит внутрь supabase-js и ломает восстановление
// сессии. Ключи те же самые, поэтому уже существующие сессии продолжают
// читаться; при недоступном localStorage деградируем до памяти (сессия живёт
// до закрытия вкладки, но приложение работает).
const memoryStore = new Map()
const safeStorage = {
  getItem(key) {
    try {
      const v = localStorage.getItem(key)
      if (v !== null) return v
    } catch {}
    return memoryStore.has(key) ? memoryStore.get(key) : null
  },
  setItem(key, value) {
    memoryStore.set(key, value)
    try { localStorage.setItem(key, value) } catch {}
  },
  removeItem(key) {
    memoryStore.delete(key)
    try { localStorage.removeItem(key) } catch {}
  },
}

// Единственный клиент на всё приложение. Модуль импортируется отовсюду, но
// createClient вызывается ровно один раз — второй клиент означал бы два
// независимых auto-refresh-таймера на одну сессию, которые перебивают токены
// друг друга.
//
// storageKey НЕ переопределяем намеренно: смена ключа разлогинила бы всех
// существующих пользователей. Блокировку многовкладочного refresh (navigator
// .locks) supabase-js включает сам, когда API доступен, — это то, что нужно:
// обновляет токен одна вкладка, остальные подхватывают результат.
export const supabase = supabaseEnabled
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: safeStorage,
      },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-client-info': 'eataps-web' } },
    })
  : null

export { pickSyncable }

// ---------------- Состояние приложения (app_state) ----------------
// Читаем строку состояния. revision — версия, на которой основаны все
// последующие правки; её обязательно передавать обратно в saveAppState.
// null означает «строки ещё нет» (новый аккаунт).
export async function pullState(userId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('app_state')
    .select('state, updated_at, revision')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { state: data.state, updatedAt: data.updated_at, revision: Number(data.revision) || 0 }
}

// Запись состояния через compare-and-swap. Прямой upsert в таблицу закрыт на
// уровне прав (см. migrations/2026-08-06_account_sync.sql) — это единственный
// путь записи, поэтому «слепая» перезапись чужих правок невозможна в принципе.
//
// Возвращает { revision, updatedAt, state, conflict }. conflict = true значит:
// с момента чтения кто-то (другое устройство, другая вкладка) уже записал.
// Ничего не перезаписано; в state лежит актуальная серверная версия — слить и
// повторить должен вызывающий.
export async function saveAppState(state, baseRevision) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('save_app_state', {
    p_state: pickSyncable(state),
    p_base_revision: baseRevision > 0 ? baseRevision : null,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('save_app_state returned no row')
  return {
    revision: Number(row.out_revision) || 0,
    updatedAt: row.out_updated_at || null,
    state: row.out_state || null,
    conflict: Boolean(row.out_conflict),
  }
}

// Realtime на СВОЮ строку состояния: правка с другого устройства приезжает
// сюда. Канал именован по user id без Date.now() — имя стабильное, поэтому
// повторная подписка не плодит дубликаты, а StrictMode/Fast Refresh не
// оставляют висящих каналов.
export function subscribeToAppState(userId, onChange) {
  if (!supabase || !userId) return () => {}
  const channel = supabase
    .channel(`app_state:${userId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_state', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new
        if (!row || row.user_id !== userId) return
        onChange({
          revision: Number(row.revision) || 0,
          updatedAt: row.updated_at || null,
          // Крупные состояния realtime обрезает (лимит размера записи). Тогда
          // state приедет пустым — подписчик обязан дочитать строку сам.
          state: payload.errors?.length ? null : (row.state ?? null),
        })
      },
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ---------------- Подписки Stripe ----------------
// Читаем строку подписки текущего пользователя. RLS пускает только к своей.
export async function pullSubscription(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return data || null
}

// Realtime-подписка на изменения нашей строки — фронт мгновенно узнаёт, когда
// вебхук записал новый статус после оплаты/отмены.
export function subscribeToSubscription(userId, onChange) {
  if (!supabase || !userId) return () => {}
  const channel = supabase
    .channel(`sub:${userId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` },
      (payload) => onChange(payload.new || null),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------------- Публичные ID (AA000001) ----------------
const PUBLIC_ID_RE = /^[A-Z]{2}\d{6}$/i

// Получить читаемый публичный ID текущего пользователя.
//
// Через RPC, а не прямым select: ensure_public_id заодно чинит пропуск. Раньше
// сбой триггера при регистрации означал, что человека навсегда нельзя добавить
// в друзья, и заметить это было нечем — ID просто не показывался.
// Фолбэк на прямое чтение — для проектов, где миграция ещё не прогнана.
export async function getMyPublicId(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.rpc('ensure_public_id')
  if (!error) return data || null
  const legacy = await supabase.from('profiles').select('public_id').eq('user_id', userId).maybeSingle()
  return legacy.data?.public_id || null
}

// Найти UUID по публичному ID через RPC (обходит RLS).
async function resolvePublicId(publicId) {
  const { data } = await supabase.rpc('find_user_by_public_id', { p_public_id: publicId.toUpperCase() })
  return data || null
}

// ---------------- Друзья ----------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Отправить запрос в друзья по ID. Принимает как публичный ID (AA000001), так и UUID.
// Если встречный запрос уже есть — принимает его.
// Возвращает { ok } или { error } (сообщение по-русски).
export async function sendFriendRequest({ myId, myName, targetId }) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const raw = (targetId || '').trim()

  let t
  if (PUBLIC_ID_RE.test(raw)) {
    t = await resolvePublicId(raw)
    if (!t) return { error: 'Пользователь с таким ID не найден' }
  } else if (UUID_RE.test(raw)) {
    t = raw.toLowerCase()
  } else {
    return { error: 'Неверный формат ID (ожидается AA000001)' }
  }

  if (t === myId) return { error: 'Это ваш собственный ID' }

  const { data: existing, error: e1 } = await supabase
    .from('friendships')
    .select('id, requester, addressee, status')
    .or(`and(requester.eq.${myId},addressee.eq.${t}),and(requester.eq.${t},addressee.eq.${myId})`)
  if (e1) return { error: normalizeError(e1).message }

  const row = existing?.[0]
  if (row) {
    if (row.status === 'accepted') return { error: 'Вы уже друзья' }
    if (row.requester === myId) return { error: 'Запрос уже отправлен' }
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', row.id)
    if (error) return { error: normalizeError(error).message }
    return { ok: 'Теперь вы друзья' }
  }

  const { error } = await supabase
    .from('friendships')
    .insert({ requester: myId, addressee: t, requester_name: myName || null })
  if (error) {
    if (error.code === '23503') return { error: 'Пользователь с таким ID не найден' }
    return { error: normalizeError(error).message }
  }
  return { ok: 'Запрос отправлен' }
}

// Списки: friends (принятые), incoming (входящие), outgoing (исходящие).
export async function listFriendships(myId) {
  if (!supabase) return { friends: [], incoming: [], outgoing: [] }
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester, addressee, status, requester_name, created_at')
    .or(`requester.eq.${myId},addressee.eq.${myId}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const friends = [], incoming = [], outgoing = []
  for (const r of data || []) {
    const other = r.requester === myId ? r.addressee : r.requester
    if (r.status === 'accepted') friends.push({ rowId: r.id, id: other })
    else if (r.addressee === myId) incoming.push({ rowId: r.id, id: r.requester, name: r.requester_name })
    else outgoing.push({ rowId: r.id, id: other })
  }

  // Имя и фото принятых друзей — одним запросом.
  if (friends.length) {
    const briefs = await fetchFriendBriefs(friends.map((f) => f.id))
    for (const f of friends) {
      f.name = briefs[f.id]?.name
      f.avatar = briefs[f.id]?.avatar
    }
  }
  return { friends, incoming, outgoing }
}

// Имя и фото по списку ID. RPC friend_briefs отдаёт только эти два поля и
// только для принятых друзей; прямое чтение чужого app_state закрыто политикой.
// Фолбэк — для проектов без миграции friend_privacy.
async function fetchFriendBriefs(ids) {
  const out = {}
  if (!supabase || !ids?.length) return out

  const { data, error } = await supabase.rpc('friend_briefs', { p_user_ids: ids })
  if (!error) {
    for (const r of data || []) out[r.user_id] = { name: r.name || null, avatar: r.avatar || null }
    return out
  }

  const legacy = await supabase
    .from('app_state')
    .select('user_id, fname:state->profile->>name, favatar:state->profile->>avatar')
    .in('user_id', ids)
  for (const r of legacy.data || []) out[r.user_id] = { name: r.fname || null, avatar: r.favatar || null }
  return out
}

export async function acceptFriend(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', rowId)
  return error ? { error: normalizeError(error).message } : { ok: true }
}

export async function removeFriendship(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('friendships').delete().eq('id', rowId)
  return error ? { error: normalizeError(error).message } : { ok: true }
}

// Прочитать состояние друга — только видимую часть (профиль без телесных
// показателей, дни, составные блюда). Отдаёт RPC friend_state, авторизация —
// проверка принятой дружбы внутри неё. projectFriendState — второй слой:
// лишнее не попадёт в приложение, даже если функция вернёт больше.
export async function pullFriendState(friendId) {
  if (!supabase || !friendId) return null

  const { data, error } = await supabase.rpc('friend_state', { p_user_id: friendId })
  if (!error) {
    if (!data) return null // нет строки либо дружба не принята
    return { state: projectFriendState(data), updatedAt: null }
  }

  // Миграция friend_privacy ещё не прогнана — читаем по старой политике,
  // но наружу всё равно отдаём только разрешённые поля.
  const legacy = await pullState(friendId)
  return legacy ? { ...legacy, state: projectFriendState(legacy.state) } : null
}

// Быстрый лукап имени и аватара по id — используется при пуше о новом сообщении.
export async function fetchUserBrief(userId) {
  if (!supabase || !userId) return null
  const briefs = await fetchFriendBriefs([userId])
  return briefs[userId] || null
}

// ---------------- Чат ----------------
// Сжать фото до ~1280px по длинной стороне, JPEG q=0.8 — быстро уходит по сети.
async function compressImageFile(file, maxSize = 1280, quality = 0.8) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Это не изображение')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Не удалось прочитать фото'))
      i.src = url
    })
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    return await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('Пустой блоб')), 'image/jpeg', quality))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function uploadChatImage(userId, file) {
  if (!supabase) throw new Error('Нет подключения')
  const blob = await compressImageFile(file)
  const id = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
  const path = `${userId}/${id}.jpg`
  const { error } = await supabase.storage.from('chat-images').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return supabase.storage.from('chat-images').getPublicUrl(path).data.publicUrl
}

// ---------------- Непрочитанные сообщения ----------------
// Время последнего прочтения чата с каждым другом — localStorage.
const CHAT_READ_KEY = 'eataps:chat:read'

function getChatReadMap() {
  try { return JSON.parse(localStorage.getItem(CHAT_READ_KEY) || '{}') } catch { return {} }
}

export function markChatRead(friendId) {
  const map = getChatReadMap()
  map[friendId] = new Date().toISOString()
  localStorage.setItem(CHAT_READ_KEY, JSON.stringify(map))
}

// ── «Удалить у меня» ──────────────────────────────────────────────────────────
// Сообщение остаётся в БД (у собеседника оно на месте), но скрыто на этом
// устройстве. Храним список id локально; при загрузке истории фильтруем.
// Отдельно от «удалить у всех» (DELETE в БД) — то придёт позже.
const CHAT_HIDDEN_KEY = 'eataps:chatHidden'

export function getHiddenMessageIds() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAT_HIDDEN_KEY) || '[]')) } catch { return new Set() }
}

export function hideMessageLocally(id) {
  const set = getHiddenMessageIds()
  set.add(String(id))
  // Держим список ограниченным, чтобы localStorage не разрастался бесконечно.
  const arr = [...set].slice(-2000)
  try { localStorage.setItem(CHAT_HIDDEN_KEY, JSON.stringify(arr)) } catch {}
}

// Возвращает { [senderId]: count } — только сообщения моложе 30 дней.
export async function fetchUnreadCounts(myId) {
  if (!supabase || !myId) return {}
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await supabase
    .from('messages')
    .select('id, sender, created_at')
    .eq('recipient', myId)
    .gt('created_at', cutoff)
  if (!data) return {}
  const readMap = getChatReadMap()
  const counts = {}
  for (const m of data) {
    const lastRead = readMap[m.sender] || null
    if (!lastRead || m.created_at > lastRead) {
      counts[m.sender] = (counts[m.sender] || 0) + 1
    }
  }
  return counts
}

// Realtime-подписка на ВСЕ входящие сообщения (для бейджа в BottomNav).
export function subscribeToIncoming(myId, onNew) {
  if (!supabase || !myId) return () => {}
  const channel = supabase
    .channel(`incoming:${myId}:${Date.now()}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient=eq.${myId}` },
      onNew,
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

const MSG_COLS = 'id, sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, created_at, read_at'

// Отметить прочитанными все входящие от собеседника (серверная функция —
// одним запросом, без гонок). Локальная метка остаётся для офлайн-бейджа.
export async function markMessagesRead(senderId) {
  if (!supabase || !senderId) return
  try { await supabase.rpc('mark_messages_read', { p_sender: senderId }) } catch {}
}

// Подписка на прочтение МОИХ сообщений собеседником: ловим UPDATE, где
// sender = я. Нужен replica identity full на messages (см. schema.sql).
export function subscribeToReadReceipts(myId, friendId, onRead) {
  if (!supabase || !myId) return () => {}
  const channel = supabase
    .channel(`reads:${myId}:${friendId}:${Date.now()}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender=eq.${myId}` },
      (payload) => {
        const row = payload.new
        if (row?.recipient === friendId && row.read_at) onRead(row)
      },
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export async function sendChatMessage({ sender, recipient, text, imageUrl, mealRef, replyTo, replySnapshot, forwardedName }) {
  if (!supabase) return { error: 'Нет подключения' }
  const payload = {
    sender,
    recipient,
    text: text?.trim() ? text.trim() : null,
    image_url: imageUrl || null,
    meal_ref: mealRef || null,
    reply_to: replyTo || null,
    reply_snapshot: replySnapshot || null,
    forwarded_name: forwardedName || null,
  }
  if (!payload.text && !payload.image_url && !payload.meal_ref) return { error: 'Пустое сообщение' }
  const { data, error } = await supabase.from('messages').insert(payload).select(MSG_COLS).single()
  if (error) return { error: normalizeError(error).message }
  return { ok: data }
}

export async function deleteChatMessage(id) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('messages').delete().eq('id', id)
  return error ? { error: normalizeError(error).message } : { ok: true }
}

export async function listMessagesWith(myId, friendId, limit = 300) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('messages')
    .select(MSG_COLS)
    .or(`and(sender.eq.${myId},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${myId})`)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  // Скрытые «у меня» не показываем — в БД они остаются для собеседника.
  const hidden = getHiddenMessageIds()
  return (data || []).filter((m) => !hidden.has(String(m.id)))
}

// ── Присутствие (онлайн/офлайн) ───────────────────────────────────────────────
// У каждого пользователя свой канал presence:user:{id}. Хозяин канала себя
// в нём «трекает», наблюдатели просто подключаются и читают состояние. Так
// присутствие видно только тем, кто спросил, а не всем сразу — в отличие от
// одного общего канала на всё приложение.

export function startPresence(myId) {
  if (!supabase || !myId) return () => {}
  const channel = supabase.channel(`presence:user:${myId}`, {
    config: { presence: { key: myId } },
  })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel.track({ at: Date.now() }).catch(() => {})
  })
  return () => supabase.removeChannel(channel)
}

export function watchPresence(userId, onChange) {
  if (!supabase || !userId) return () => {}
  const channel = supabase.channel(`presence:user:${userId}`)
  const read = () => {
    const metas = channel.presenceState?.()?.[userId]
    onChange(Array.isArray(metas) && metas.length > 0)
  }
  channel
    .on('presence', { event: 'sync' }, read)
    .on('presence', { event: 'join' }, read)
    .on('presence', { event: 'leave' }, read)
    .subscribe((status) => { if (status === 'SUBSCRIBED') read() })
  return () => supabase.removeChannel(channel)
}

// Отметка «был(а) в сети». Тихо ничего не делает, если миграция ещё не
// прогнана — статус тогда просто не показывается.
export async function touchLastSeen() {
  if (!supabase) return
  try { await supabase.rpc('touch_last_seen') } catch {}
}

// Отметка живёт в таблице presence (миграция 2026-08-06). Раньше она лежала в
// app_state, но heartbeat раз в минуту трогал строку состояния и по Realtime
// рассылал бы весь блоб на все устройства. Фолбэк на старую колонку оставлен
// для проектов, где миграция ещё не прогнана.
export async function fetchLastSeen(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.rpc('get_last_seen', { p_user_id: userId })
  if (!error) return data || null
  const legacy = await supabase
    .from('app_state').select('last_seen').eq('user_id', userId).maybeSingle()
  return legacy.data?.last_seen || null
}

// ── Индикатор «печатает…» ─────────────────────────────────────────────────────
// Broadcast-канал (не postgres_changes): события эфемерные, в БД их писать
// незачем. Имя канала одинаковое с обеих сторон — сортируем пару id, иначе
// собеседники окажутся в разных каналах и не услышат друг друга.
export function createTypingChannel(myId, friendId, onTyping) {
  if (!supabase || !myId || !friendId) return { sendTyping: () => {}, unsubscribe: () => {} }
  const pair = [myId, friendId].sort().join('_')
  const channel = supabase
    .channel(`typing:${pair}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.from === friendId) onTyping(payload.typing !== false)
    })
    .subscribe()

  const sendTyping = (typing) => {
    try { channel.send({ type: 'broadcast', event: 'typing', payload: { from: myId, typing } }) } catch {}
  }
  return { sendTyping, unsubscribe: () => supabase.removeChannel(channel) }
}

// Realtime-подписка на новые входящие сообщения от конкретного друга.
export function subscribeToChat(myId, friendId, onMessage) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`chat:${myId}:${friendId}:${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient=eq.${myId}` },
      (payload) => {
        if (payload.new?.sender === friendId) onMessage(payload.new)
      },
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Последнее сообщение в каждом диалоге — для списка чатов.
export async function listConversations(myId, limit = 200) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender, recipient, text, image_url, created_at')
    .or(`sender.eq.${myId},recipient.eq.${myId}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const byPartner = new Map()
  for (const m of data || []) {
    const partner = m.sender === myId ? m.recipient : m.sender
    if (!byPartner.has(partner)) byPartner.set(partner, m)
  }
  return Array.from(byPartner, ([id, last]) => ({ id, last }))
}

// DSGVO «право на удаление»: стираем данные из облака и удаляем сам аккаунт.
// Данные удаляем всегда (RLS: свои); аккаунт — через RPC delete_current_user
// (SECURITY DEFINER, см. schema.sql). Если RPC нет — возвращаем partial.
export async function deleteAccount(userId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  // uid приходит из уже загруженной сессии — лишний сетевой getUser() здесь
  // только добавлял точку отказа. Подстраховываемся локальным чтением сессии.
  let uid = userId
  if (!uid) {
    const { data } = await supabase.auth.getSession()
    uid = data?.session?.user?.id
  }
  if (uid) {
    await supabase.from('friendships').delete().or(`requester.eq.${uid},addressee.eq.${uid}`)
    await supabase.from('app_state').delete().eq('user_id', uid)
  }
  const { error } = await supabase.rpc('delete_current_user')
  if (error) return { error: normalizeError(error).message, partial: true } // данные стёрты, аккаунт остался
  return { ok: true }
}

// Снять ВСЕ realtime-каналы. Вызывается при выходе и при смене пользователя:
// канал, оставшийся от прошлого аккаунта, доставлял бы чужие события в новую
// сессию (и держал бы сокет открытым).
export function removeAllRealtimeChannels() {
  if (!supabase) return
  try {
    for (const ch of supabase.getChannels()) supabase.removeChannel(ch)
  } catch {}
}
