// Социальный граф: подписки, блокировки, лента, поиск людей, уведомления.
//
// Почему отдельный модуль, а не продолжение supabase.js: там 800 строк про
// состояние, чат и присутствие. Здесь — новая модель, у которой своя граница:
// всё, что связано с графом «кто кому кто» и с лентой. Дружба остаётся в
// supabase.js, потому что вокруг неё уже построен чат.
//
// Общее правило чтения: наружу никогда не уходит поимённый список
// отреагировавших и никогда — public_id. Поэтому почти всё идёт через RPC, а
// не через select со связанными таблицами.

import { supabase } from './supabase.js'
import { normalizeError } from './authErrors.js'
import { toRelationship, EMPTY_RELATIONSHIP } from './relationship.js'

// «Миграция ещё не прогнана»: функции или таблицы нет. Это не ошибка
// приложения — раздел просто недоступен, и красный текст тут не нужен.
// Тот же приём, что у listPosts в supabase.js.
export function isMissingRelation(error) {
  const code = error?.code
  return code === '42883' || code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
}

const fail = (error) => ({ error: normalizeError(error).message })

// ---------------- Отношение ----------------

// Единственный источник ответа «кто мы друг другу». Все экраны спрашивают
// здесь и нигде больше.
export async function getRelationship(userId) {
  if (!supabase || !userId) return { ...EMPTY_RELATIONSHIP }
  const { data, error } = await supabase.rpc('get_relationship', { p_user_id: userId })
  if (error) {
    if (isMissingRelation(error)) return { ...EMPTY_RELATIONSHIP, unavailable: true }
    throw error
  }
  return toRelationship(Array.isArray(data) ? data[0] : data)
}

// ---------------- Подписки ----------------
// Пишем прямо в таблицу: RLS проверяет и авторство, и блокировки, и
// самоподписку. Оборачивать это в RPC значило бы продублировать проверки,
// которые уже стоят в политике.

export async function follow(myId, targetId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  if (!myId || !targetId || myId === targetId) return { error: 'Нельзя подписаться на себя' }
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: myId, following_id: targetId })
  // Повторное нажатие по уже существующей подписке — не ошибка для человека:
  // состояние ровно то, которого он добивался.
  if (error && error.code !== '23505') return fail(error)
  return { ok: true }
}

export async function unfollow(myId, targetId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', myId)
    .eq('following_id', targetId)
  return error ? fail(error) : { ok: true }
}

// Убрать чужую подписку на себя — без блокировки. Политика follows разрешает
// удаление и объекту подписки, не только подписчику.
export async function removeFollower(myId, followerId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', myId)
  return error ? fail(error) : { ok: true }
}

export async function listFollowers(userId, { limit = 50, offset = 0 } = {}) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.rpc('list_followers', {
    p_user_id: userId, p_limit: limit, p_offset: offset,
  })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

export async function listFollowing(userId, { limit = 50, offset = 0 } = {}) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.rpc('list_following', {
    p_user_id: userId, p_limit: limit, p_offset: offset,
  })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

// ---------------- Блокировки ----------------
// Блокировка сносит подписки и дружбу серверным триггером apply_block —
// клиенту чистить ничего не нужно, и он не должен: половина удалённого лежит
// в строках, которые ему не видны.

export async function block(myId, targetId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { error } = await supabase.from('blocks').insert({ blocker_id: myId, blocked_id: targetId })
  if (error && error.code !== '23505') return fail(error)
  return { ok: true }
}

export async function unblock(myId, targetId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { error } = await supabase.from('blocks')
    .delete().eq('blocker_id', myId).eq('blocked_id', targetId)
  return error ? fail(error) : { ok: true }
}

// ---------------- Профили и поиск ----------------

export async function userProfile(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.rpc('user_profile', { p_user_id: userId })
  if (error) { if (isMissingRelation(error)) return null; throw error }
  return (Array.isArray(data) ? data[0] : data) || null
}

// Карточки нескольких людей одним запросом. Нужна везде, где есть список:
// без неё список из 50 человек означал бы 50 запросов за именами.
export async function userCards(ids) {
  const out = {}
  if (!supabase || !ids?.length) return out
  const unique = [...new Set(ids.filter(Boolean))]
  const { data, error } = await supabase.rpc('user_cards', { p_user_ids: unique })
  if (error) { if (isMissingRelation(error)) return out; throw error }
  for (const r of data || []) out[r.user_id] = r
  return out
}

// Поиск людей. Меньше трёх символов сервер не обслуживает — не отправляем
// такой запрос вообще, чтобы не ходить впустую на каждую букву.
export async function searchUsers(query, { limit = 20 } = {}) {
  const q = (query || '').trim()
  if (!supabase || q.length < 3) return []
  const { data, error } = await supabase.rpc('search_users', { p_query: q, p_limit: limit })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

export async function setUsername(username) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { data, error } = await supabase.rpc('set_username', { p_username: username })
  if (error) {
    if (error.code === '23505') return { error: 'Этот адрес уже занят' }
    if (error.code === '22023') return { error: 'От 3 до 20 символов: латиница, цифры, _' }
    return fail(error)
  }
  return { ok: data }
}

// ---------------- Лента ----------------
// Курсор — пара (created_at, id), а не offset: пока человек листает, сверху
// приезжают новые посты, и offset начал бы показывать дубли.

export async function listFeed({ limit = 20, cursor = null } = {}) {
  if (!supabase) return { posts: [], cursor: null }
  const { data, error } = await supabase.rpc('list_feed', {
    p_limit: limit,
    p_before_at: cursor?.createdAt || null,
    p_before_id: cursor?.id || null,
  })
  if (error) {
    if (isMissingRelation(error)) return { posts: [], cursor: null, unavailable: true }
    throw error
  }
  const posts = data || []
  const last = posts[posts.length - 1]
  return {
    posts,
    // Курсор есть, только если страница пришла полной: иначе следующей нет.
    cursor: posts.length === limit && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

// ---------------- Уведомления ----------------

export async function listNotifications({ limit = 40, before = null } = {}) {
  if (!supabase) return { items: [], unavailable: false }
  const { data, error } = await supabase.rpc('list_notifications', {
    p_limit: limit, p_before: before,
  })
  if (error) {
    if (isMissingRelation(error)) return { items: [], unavailable: true }
    throw error
  }
  return { items: data || [] }
}

export async function unreadNotificationCount() {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('unread_notification_count')
  if (error) { if (isMissingRelation(error)) return 0; throw error }
  return data || 0
}

export async function markNotificationRead(id) {
  if (!supabase || !id) return
  await supabase.rpc('mark_notification_read', { p_id: id })
}

export async function markAllNotificationsRead() {
  if (!supabase) return
  await supabase.rpc('mark_all_notifications_read')
}

// Realtime на уведомления. Источник истины — таблица, а не локальный счётчик:
// пометив прочитанным на телефоне, человек должен увидеть это и на ноутбуке.
export function subscribeToNotifications(myId, onChange) {
  if (!supabase || !myId) return () => {}
  const ch = supabase
    .channel(`notifications:${myId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications',
      filter: `recipient_id=eq.${myId}`,
    }, (payload) => onChange?.(payload))
    .subscribe()
  return () => { try { supabase.removeChannel(ch) } catch {} }
}

// ---------------- Посты ----------------
// Видимость поста задаёт автор. Значение по умолчанию приходит из
// relationship.js, чтобы клиент и база не разошлись в трактовке «по умолчанию».

export async function setPostVisibility(postId, visibility) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const { error } = await supabase.from('posts').update({ visibility }).eq('id', postId)
  return error ? fail(error) : { ok: true }
}
