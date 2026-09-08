// Переписка: диалоги, сообщения, запросы, группы, реакции, вложения.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ПРОДОЛЖЕНИЕ supabase.js
//
// В supabase.js переписка жила рядом с состоянием приложения, подписками и
// присутствием, и её граница была одна — «сообщение адресовано человеку».
// С появлением диалогов граница другая: сообщение принадлежит ДИАЛОГУ, а
// человек — участник. Это иная модель, и держать её в файле на тысячу строк
// вместе с синхронизацией дневника значило бы прятать смену модели.
//
// Присутствие, «печатает…» и загрузка картинок остались в supabase.js: они
// про соединение, а не про переписку, и ими пользуется не только чат.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ВАЖНО ЗНАТЬ
//
// 1. ЛИЧНЫЙ ДИАЛОГ НЕ СОЗДАЁТСЯ ЗАРАНЕЕ. Он появляется в момент открытия
//    переписки (openDirect), но в списке диалогов не показывается, пока в нём
//    нет ни одного сообщения. Иначе «зашёл в профиль, нажал Написать, передумал»
//    оставляло бы пустую строку в чатах у обоих.
//
// 2. ЗАПРОС — ЭТО СОСТОЯНИЕ УЧАСТНИКА, а не отдельная сущность. Один и тот же
//    диалог у одного лежит в чатах, у другого — в запросах, и это нормально.
//
// 3. ОТПРАВКА ИДЕМПОТЕНТНА. clientId придумывается ОДИН раз на сообщение и
//    повторяется при каждой попытке; сервер по нему узнаёт повтор. Без этого
//    «отправил → сеть отвалилась → повторил» давало два одинаковых сообщения
//    ровно на плохой связи, где повтор и нужен.

import { supabase, realtime } from './supabase.js'
import { normalizeError } from './authErrors.js'
import { isMissingRelation } from './social.js'
import { log } from './log.js'
import {
  toConversation, toMessage, toTotals, EMPTY_TOTALS,
  QUICK_REACTIONS, DOUBLE_TAP_REACTION, MUTE_OPTIONS,
} from './conversationModel.js'

// Чистая часть модели переиздаётся отсюда: компоненты берут всё, что связано с
// перепиской, из одного модуля и не выбирают между двумя импортами.
export {
  toConversation, toMessage, QUICK_REACTIONS, DOUBLE_TAP_REACTION, MUTE_OPTIONS,
}
export { isMuted, conversationPreview, badgeText } from './conversationModel.js'

const NO_SERVER = { error: 'Нет подключения к серверу' }

const fail = (error, where = 'messaging') => {
  log.error(where, 'отказ сервера', error)
  return { error: normalizeError(error).message }
}

async function call(fn, args = {}, where = fn) {
  if (!supabase) return NO_SERVER
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (isMissingRelation(error)) return { error: 'Раздел появится после обновления базы' }
    return fail(error, where)
  }
  return { ok: data === null || data === undefined ? true : data }
}

// ── Диалоги ──────────────────────────────────────────────────────────────────

export async function listConversations({
  state = null, archived = false, limit = 40, before = null,
} = {}) {
  if (!supabase) return { items: [], cursor: null, unavailable: false }
  const { data, error } = await supabase.rpc('list_conversations_v2', {
    p_state: state, p_archived: archived, p_limit: limit, p_before: before,
  })
  if (error) {
    if (isMissingRelation(error)) return { items: [], cursor: null, unavailable: true }
    throw error
  }
  const items = (data || []).map(toConversation)
  const last = items[items.length - 1]
  return {
    items,
    // Курсор есть, только если страница пришла полной: иначе следующей нет.
    cursor: items.length === limit && last?.lastAt ? last.lastAt : null,
  }
}

// Открыть личную переписку: найти существующую или завести новую. Возвращает
// id диалога — дальше всё идёт через него, и человек в этот момент уже
// участник, даже если ещё ничего не написал.
export async function openDirect(peerId) {
  const res = await call('direct_conversation', { p_peer: peerId }, 'openDirect')
  return res.error ? res : { ok: res.ok }
}

export async function createGroup({ title, members }) {
  const res = await call('create_group_conversation', {
    p_title: title || null, p_members: members || [],
  }, 'createGroup')
  return res.error ? res : { ok: res.ok }
}

export async function conversationInfo(conversationId) {
  if (!supabase || !conversationId) return null
  const { data, error } = await supabase.rpc('conversation_info', { p_conversation: conversationId })
  if (error) { if (isMissingRelation(error)) return null; throw error }
  return (Array.isArray(data) ? data[0] : data) || null
}

export async function conversationMembers(conversationId) {
  if (!supabase || !conversationId) return []
  const { data, error } = await supabase.rpc('conversation_member_list', { p_conversation: conversationId })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

// ── Сообщения ────────────────────────────────────────────────────────────────

// История — страницами, начиная с конца.
//
// Возвращает { items, cursor }: items в порядке чтения (старые сверху),
// cursor — на более ранние. null означает «дальше в прошлое ничего нет».
export async function listMessages(conversationId, { limit = 40, cursor = null } = {}) {
  if (!supabase || !conversationId) return { items: [], cursor: null }
  const { data, error } = await supabase.rpc('list_conversation_messages', {
    p_conversation: conversationId,
    p_limit: limit,
    p_before_at: cursor?.createdAt || null,
    p_before_id: cursor?.id || null,
  })
  if (error) { if (isMissingRelation(error)) return { items: [], cursor: null, unavailable: true }; throw error }
  const rows = data || []
  const oldest = rows[rows.length - 1]
  return {
    items: [...rows].reverse().map(toMessage),
    cursor: rows.length === limit && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
  }
}

export async function sendMessage({
  conversationId, text, imageUrl, media, mealRef, replyTo, replySnapshot,
  forwardedName, clientId,
}) {
  if (!supabase) return NO_SERVER
  const body = text?.trim() ? text.trim() : null
  if (!body && !imageUrl && !media && !mealRef) return { error: 'Пустое сообщение' }

  const { data, error } = await supabase.rpc('send_conversation_message', {
    p_conversation: conversationId,
    p_text: body,
    p_image_url: imageUrl || null,
    p_media: media || null,
    p_meal_ref: mealRef || null,
    p_reply_to: replyTo || null,
    p_reply_snapshot: replySnapshot || null,
    p_forwarded_name: forwardedName || null,
    p_client_id: clientId || null,
  })
  if (error) return fail(error, 'sendMessage')
  const row = Array.isArray(data) ? data[0] : data
  // reactions приходит из базы как NULL, пока на сообщение никто не
  // реагировал. Спред `{ reactions: {}, ...row }` затирал бы значение по
  // умолчанию этим NULL, и обработчик двойного тапа получал бы null.
  return row ? { ok: toMessage(row) } : { error: 'Сообщение не отправилось' }
}

export function markRead(conversationId) {
  return call('mark_conversation_read', { p_conversation: conversationId }, 'markRead')
}

// Отзыв «у всех». Сообщение остаётся строкой-пометкой: на него могут
// ссылаться ответы, и удаление превратило бы цитату в сироту.
export function unsendMessage(messageId) {
  return call('unsend_message', { p_message: messageId }, 'unsendMessage')
}

// Скрыть у себя. У собеседника сообщение остаётся — в этом вся разница с
// отзывом, и путать их в интерфейсе нельзя.
export function deleteMessageForMe(messageId) {
  return call('delete_message_for_me', { p_message: messageId }, 'deleteMessageForMe')
}

// Реакция. Одна на человека: тот же эмодзи снимает её, другой — заменяет.
// Передать null — снять явно.
export async function setReaction(messageId, emoji) {
  const res = await call('set_message_reaction', { p_message: messageId, p_emoji: emoji }, 'setReaction')
  return res.error ? res : { ok: res.ok || {} }
}

export async function forwardMessage(messageId, conversationIds) {
  const res = await call('forward_message', {
    p_message: messageId, p_conversations: conversationIds || [],
  }, 'forwardMessage')
  return res.error ? res : { ok: res.ok }
}

export function markMediaViewed(messageId) {
  return call('mark_media_viewed', { p_message: messageId }, 'markMediaViewed')
}

// ── Запросы на переписку ─────────────────────────────────────────────────────
// Открытие запроса НЕ означает согласия: человек читает сообщение и решает
// отдельно. Поэтому здесь два явных действия, и ни одно из них не случается
// само по себе от того, что диалог открыли.

export function acceptRequest(conversationId) {
  return call('accept_conversation_request', { p_conversation: conversationId }, 'acceptRequest')
}

export function declineRequest(conversationId) {
  return call('decline_conversation_request', { p_conversation: conversationId }, 'declineRequest')
}

// ── Управление диалогом ──────────────────────────────────────────────────────

export function renameConversation(conversationId, title) {
  return call('rename_conversation', { p_conversation: conversationId, p_title: title }, 'renameConversation')
}

export function addMembers(conversationId, members) {
  return call('add_conversation_members', { p_conversation: conversationId, p_members: members }, 'addMembers')
}

export function removeMember(conversationId, userId) {
  return call('remove_conversation_member', { p_conversation: conversationId, p_user: userId }, 'removeMember')
}

export function setMemberRole(conversationId, userId, role) {
  return call('set_conversation_role', { p_conversation: conversationId, p_user: userId, p_role: role }, 'setMemberRole')
}

export function leaveConversation(conversationId) {
  return call('leave_conversation', { p_conversation: conversationId }, 'leaveConversation')
}

// Заглушить: until = null снимает, until = дата ставит до неё.
export function setConversationMuted(conversationId, until) {
  return call('set_conversation_muted', {
    p_conversation: conversationId,
    p_until: until ? new Date(until).toISOString() : null,
  }, 'setConversationMuted')
}

export function setConversationArchived(conversationId, on) {
  return call('set_conversation_archived', { p_conversation: conversationId, p_on: on }, 'setConversationArchived')
}

// «Удалить переписку» — У СЕБЯ. Чужая история не трогается: она принадлежит
// не нам, и удалять её мы не вправе.
export function clearConversation(conversationId) {
  return call('clear_conversation', { p_conversation: conversationId }, 'clearConversation')
}

// ── Вложения и поиск ─────────────────────────────────────────────────────────

export async function conversationMedia(conversationId, { limit = 60, offset = 0 } = {}) {
  if (!supabase || !conversationId) return []
  const { data, error } = await supabase.rpc('conversation_media', {
    p_conversation: conversationId, p_limit: limit, p_offset: offset,
  })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

export async function searchMessages(query, { conversationId = null, limit = 40 } = {}) {
  const q = (query || '').trim()
  if (!supabase || q.length < 2) return []
  const { data, error } = await supabase.rpc('search_messages', {
    p_query: q, p_conversation: conversationId, p_limit: limit,
  })
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

// ── Счётчики ─────────────────────────────────────────────────────────────────
// Источник истины — сервер, а не сумма локальных счётчиков: бейдж обязан
// совпадать на всех устройствах и переживать перезаход.
export async function unreadTotals() {
  if (!supabase) return { ...EMPTY_TOTALS }
  const { data, error } = await supabase.rpc('unread_totals')
  if (error) { if (isMissingRelation(error)) return { ...EMPTY_TOTALS }; throw error }
  return toTotals(Array.isArray(data) ? data[0] : data)
}

// ── Вложения: загрузка в закрытый бакет ──────────────────────────────────────
// dm-media НЕ публичен, в отличие от chat-images и post-images. Путь строится
// как {conversationId}/{userId}/{имя}: политика хранилища читает первый
// сегмент и пускает только участников диалога, второй — только автора файла.
//
// Ссылку получаем подписанную и недолгую: постоянного публичного URL у
// приватного вложения быть не должно.
const SIGNED_TTL = 3600

export async function uploadMedia({ conversationId, userId, file, kind = 'image', mode = 'keep' }) {
  if (!supabase) return NO_SERVER
  if (!conversationId || !userId || !file) return { error: 'Нечего отправлять' }
  if (file.size > 25 * 1024 * 1024) return { error: 'Файл больше 25 МБ' }

  const ext = (file.name?.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${conversationId}/${userId}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from('dm-media').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) return fail(error, 'uploadMedia')

  return {
    ok: {
      kind,
      path,
      mime: file.type || null,
      size: file.size,
      mode,
    },
  }
}

// Подписанная ссылка на вложение. Живёт час — этого хватает на просмотр, и
// пересылать её как постоянный адрес бессмысленно, что и требуется.
export async function mediaUrl(media) {
  if (!supabase || !media?.path) return null
  const { data, error } = await supabase.storage
    .from('dm-media').createSignedUrl(media.path, SIGNED_TTL)
  if (error) { log.error('mediaUrl', 'подпись не получена', error); return null }
  return data?.signedUrl || null
}

// ── Realtime ─────────────────────────────────────────────────────────────────
// Каналы идут через общий хаб (realtime.js): supabase-js отдаёт один и тот же
// объект канала на одну тему, а повторный .on после subscribe() БРОСАЕТ
// исключение. Два компонента, подписавшиеся на одну тему, раньше роняли
// приложение — не «дублировали события», а именно роняли.

// Все изменения сообщений, где я отправитель или получатель. Для групп этого
// фильтра мало, поэтому ниже есть подписка по диалогу.
export function subscribeToInbox(myId, onChange) {
  if (!supabase || !myId) return () => {}
  const offMember = realtime.subscribe(
    `conv-members:${myId}`,
    (channel, emit) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'conversation_members',
      filter: `user_id=eq.${myId}`,
    }, emit),
    onChange,
  )
  const offIncoming = realtime.subscribe(
    `incoming:${myId}`,
    (channel, emit) => channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `recipient=eq.${myId}`,
    }, emit),
    onChange,
  )
  return () => { offMember(); offIncoming() }
}

// События одного диалога: новые сообщения, реакции, отзыв. Фильтр по
// conversation_id ловит и групповые сообщения, у которых получателя нет.
export function subscribeToConversation(conversationId, onEvent) {
  if (!supabase || !conversationId) return () => {}
  return realtime.subscribe(
    `conv:${conversationId}`,
    (channel, emit) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, emit),
    (payload) => onEvent(payload.eventType, payload.new || payload.old),
  )
}

// «Печатает…» — broadcast, а не запись в базу: события эфемерные, и хранить
// их постоянно незачем. Имя канала одинаковое у всех участников диалога.
export function createTypingChannel(conversationId, myId, onTyping) {
  if (!supabase || !conversationId || !myId) {
    return { sendTyping: () => {}, unsubscribe: () => {} }
  }
  const name = `typing:conv:${conversationId}`
  const off = realtime.subscribe(
    name,
    (channel, emit) => channel.on('broadcast', { event: 'typing' }, emit),
    ({ payload }) => {
      if (payload?.from && payload.from !== myId) {
        onTyping(payload.typing !== false, payload.from, payload.name || null)
      }
    },
  )
  const sendTyping = (typing, name_) => {
    realtime.send(name, {
      type: 'broadcast', event: 'typing',
      payload: { from: myId, typing, name: name_ || null },
    })
  }
  return { sendTyping, unsubscribe: off }
}
