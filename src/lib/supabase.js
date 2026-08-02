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

// ---------------- Друзья ----------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Отправить запрос в друзья по ID. Если встречный запрос уже есть — принимает его.
// Возвращает { ok } или { error } (сообщение по-русски).
export async function sendFriendRequest({ myId, myName, targetId }) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const t = (targetId || '').trim().toLowerCase()
  if (!UUID_RE.test(t)) return { error: 'Неверный ID' }
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

  // Имена принятых друзей — одним запросом, только имя из JSON (не весь блоб).
  if (friends.length) {
    const { data: rows } = await supabase
      .from('app_state')
      .select('user_id, fname:state->profile->>name')
      .in('user_id', friends.map((f) => f.id))
    const nameById = {}
    for (const r of rows || []) nameById[r.user_id] = r.fname
    for (const f of friends) f.name = nameById[f.id]
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
