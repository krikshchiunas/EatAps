import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(url && anon)

export const supabase = supabaseEnabled
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

const SYNC_KEYS = ['profile', 'theme', 'days', 'customFoods', 'customIngredients', 'recents', 'prefs']

export function pickSyncable(state) {
  const out = {}
  for (const k of SYNC_KEYS) out[k] = state[k]
  return out
}

// Pull the user's saved state blob from Supabase. Returns { state, updatedAt } or null.
export async function pullState(userId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('app_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { state: data.state, updatedAt: data.updated_at }
}

// Push the state blob (upsert). Returns the new updated_at.
export async function pushState(userId, state) {
  if (!supabase) return null
  const payload = { user_id: userId, state: pickSyncable(state), updated_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from('app_state')
    .upsert(payload, { onConflict: 'user_id' })
    .select('updated_at')
    .single()
  if (error) throw error
  return data.updated_at
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
    .channel(`sub:${userId}:${Date.now()}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` },
      (payload) => onChange(payload.new || null),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------------- Публичные ID (AA000001) ----------------
const PUBLIC_ID_RE = /^[A-Z]{2}\d{6}$/i

// Получить читаемый публичный ID текущего пользователя (из таблицы profiles).
export async function getMyPublicId(userId) {
  if (!supabase || !userId) return null
  const { data } = await supabase.from('profiles').select('public_id').eq('user_id', userId).maybeSingle()
  return data?.public_id || null
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
  if (e1) return { error: e1.message }

  const row = existing?.[0]
  if (row) {
    if (row.status === 'accepted') return { error: 'Вы уже друзья' }
    if (row.requester === myId) return { error: 'Запрос уже отправлен' }
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', row.id)
    if (error) return { error: error.message }
    return { ok: 'Теперь вы друзья' }
  }

  const { error } = await supabase
    .from('friendships')
    .insert({ requester: myId, addressee: t, requester_name: myName || null })
  if (error) {
    if (error.code === '23503') return { error: 'Пользователь с таким ID не найден' }
    return { error: error.message }
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

  // Имя и фото принятых друзей — одним запросом (только нужные поля из JSON).
  if (friends.length) {
    const { data: rows } = await supabase
      .from('app_state')
      .select('user_id, fname:state->profile->>name, favatar:state->profile->>avatar')
      .in('user_id', friends.map((f) => f.id))
    const byId = {}
    for (const r of rows || []) byId[r.user_id] = r
    for (const f of friends) {
      f.name = byId[f.id]?.fname
      f.avatar = byId[f.id]?.favatar
    }
  }
  return { friends, incoming, outgoing }
}

export async function acceptFriend(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', rowId)
  return error ? { error: error.message } : { ok: true }
}

export async function removeFriendship(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('friendships').delete().eq('id', rowId)
  return error ? { error: error.message } : { ok: true }
}

// Прочитать состояние друга (дни/приёмы/профиль). RLS пускает только к принятым.
export async function pullFriendState(friendId) {
  return pullState(friendId)
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

const MSG_COLS = 'id, sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, created_at'

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
  if (error) return { error: error.message }
  return { ok: data }
}

export async function deleteChatMessage(id) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('messages').delete().eq('id', id)
  return error ? { error: error.message } : { ok: true }
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
  return data || []
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
export async function deleteAccount() {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { data: { user } = {} } = await supabase.auth.getUser()
  const uid = user?.id
  if (uid) {
    await supabase.from('friendships').delete().or(`requester.eq.${uid},addressee.eq.${uid}`)
    await supabase.from('app_state').delete().eq('user_id', uid)
  }
  const { error } = await supabase.rpc('delete_current_user')
  if (error) return { error: error.message, partial: true } // данные стёрты, аккаунт остался
  return { ok: true }
}
