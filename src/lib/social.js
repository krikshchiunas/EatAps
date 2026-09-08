// Социальный граф: подписки, просьбы, близкие друзья, блокировки,
// ограничения, заглушения, приватность, лента, поиск людей, уведомления.
//
// ─────────────────────────────────────────────────────────────────────────────
// ГРАНИЦА ДАННЫХ
//
// Это ЕДИНСТВЕННОЕ место, откуда приложение обращается к социальной части
// базы. Компоненты не зовут supabase.rpc напрямую — иначе одно и то же
// действие («подписаться») существует в четырёх экранах в четырёх редакциях,
// и три из них однажды отстают от пятой правки.
//
// Общее правило чтения: наружу никогда не уходит поимённый список
// отреагировавших и ничей чужой список близких друзей. Поэтому почти всё идёт
// через RPC, а не через select со связанными таблицами.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ПОЧТИ ВСЁ — RPC, А НЕ ПРЯМЫЕ ЗАПРОСЫ
//
// Подписка на закрытый аккаунт обязана превратиться в просьбу, одобрение
// просьбы — снести её и создать подписку одной транзакцией, блокировка —
// разорвать шесть связей сразу. Ни одно из этих действий нельзя собрать из
// клиентских запросов так, чтобы обрыв связи посередине не оставил человека
// в половинчатом состоянии.

import { supabase, realtime } from './supabase.js'
import { normalizeError } from './authErrors.js'
import { toRelationship, EMPTY_RELATIONSHIP } from './relationship.js'
import { isMissingColumn } from './pgErrors.js'
import { log } from './log.js'
import { setMutedMessageUsers } from './notifications.js'

// «Миграция ещё не прогнана»: функции или таблицы нет. Это не ошибка
// приложения — раздел просто недоступен, и красный текст тут не нужен.
export function isMissingRelation(error) {
  const code = error?.code
  return code === '42883' || code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
}

// Единая точка отказа для всего социального слоя.
//
// Наружу уходит человеческий текст, В КОНСОЛЬ — сырой ответ базы. Раньше здесь
// была только первая половина, и это делало любой отказ неотлаживаемым:
// «Что-то пошло не так» одинаково означало и сработавшее ограничение частоты,
// и непрогнанную миграцию, и упавший триггер.
const fail = (error, where = 'social') => {
  log.error(where, 'отказ сервера', error)
  return { error: normalizeError(error).message }
}

const NO_SERVER = { error: 'Нет подключения к серверу' }

// Вызов RPC, который ничего не возвращает, кроме «получилось / не получилось».
// Обёртка одна на два десятка действий: писать try/catch двадцать раз —
// значит однажды написать его девятнадцать раз.
async function call(fn, args = {}, where = fn) {
  if (!supabase) return NO_SERVER
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (isMissingRelation(error)) {
      return { error: 'Раздел появится после обновления базы' }
    }
    return fail(error, where)
  }
  return { ok: data === null || data === undefined ? true : data }
}

// Чтение списка. Пустой список при непрогнанной миграции — не ложь: раздела
// в базе действительно нет, и показывать по этому поводу ошибку незачем.
async function readList(fn, args = {}) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc(fn, args)
  if (error) { if (isMissingRelation(error)) return []; throw error }
  return data || []
}

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

// Отношения сразу с несколькими людьми — один запрос на весь список.
//
// Раньше список людей спрашивал getRelationship по одному человеку: пятьдесят
// строк означали пятьдесят обращений к базе, отправленных параллельно. Это
// «один круг ожидания вместо N» по времени, но пятьдесят запросов по нагрузке.
export async function relationshipsWith(ids) {
  const out = {}
  if (!supabase || !ids?.length) return out
  const unique = [...new Set(ids.filter(Boolean))]
  const { data, error } = await supabase.rpc('relationships_with', { p_user_ids: unique })
  if (error) {
    // Миграция ещё не прогнана — отношения просто неизвестны. Список людей
    // при этом должен отрисоваться: без кнопки подписки, но с именами.
    if (isMissingRelation(error)) return out
    throw error
  }
  for (const row of data || []) out[row.user_id] = toRelationship(row)
  return out
}

// ---------------- Подписки и просьбы ----------------
// Подписка на ОТКРЫТЫЙ аккаунт создаётся сразу; на ЗАКРЫТЫЙ — превращается в
// просьбу. Решает это сервер, а не кнопка: клиент не должен знать правило,
// иначе оно окажется записанным в двух местах.
//
// Возвращаем то, что произошло на самом деле ('following' | 'requested'),
// чтобы экран мог поправить оптимистичное состояние, если он угадал не то.

export async function follow(targetId) {
  if (!targetId) return { error: 'Неизвестный пользователь' }
  const res = await call('follow_user', { p_target: targetId }, 'follow')
  if (res.error) return res
  if (res.ok === 'blocked') return { error: 'С этим человеком нельзя связаться' }
  return { ok: res.ok }
}

export function unfollow(targetId) {
  return call('unfollow_user', { p_target: targetId }, 'unfollow')
}

// Отмена своей просьбы — то же действие, что отписка: сервер снимает и
// подписку, и просьбу. Отдельное имя оставлено ради читаемости вызывающего
// кода, где «Отменить запрос» и «Отписаться» — разные кнопки.
export function cancelFollowRequest(targetId) {
  return call('unfollow_user', { p_target: targetId }, 'cancelFollowRequest')
}

export function acceptFollowRequest(requesterId) {
  return call('accept_follow_request', { p_requester: requesterId }, 'acceptFollowRequest')
}

export function declineFollowRequest(requesterId) {
  return call('decline_follow_request', { p_requester: requesterId }, 'declineFollowRequest')
}

// Убрать чужую подписку на себя — без блокировки и без уведомления.
export function removeFollower(followerId) {
  return call('remove_follower', { p_follower: followerId }, 'removeFollower')
}

export function listFollowRequests({ limit = 30, offset = 0 } = {}) {
  return readList('list_follow_requests', { p_limit: limit, p_offset: offset })
}

export async function followRequestCount() {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('follow_request_count')
  if (error) { if (isMissingRelation(error)) return 0; throw error }
  return data || 0
}

export function listFollowers(userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return Promise.resolve([])
  return readList('list_followers', { p_user_id: userId, p_limit: limit, p_offset: offset })
}

export function listFollowing(userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return Promise.resolve([])
  return readList('list_following', { p_user_id: userId, p_limit: limit, p_offset: offset })
}

// Взаимные подписки — «Друзья» в интерфейсе. Отдельной таблицы под этим нет и
// быть не должно: дружба ВЫЧИСЛЯЕТСЯ из подписок, и второй источник правды
// про неё однажды уже разошёлся с первым.
export function listMutuals(userId, { limit = 100, offset = 0 } = {}) {
  if (!userId) return Promise.resolve([])
  return readList('list_friends', { p_user_id: userId, p_limit: limit, p_offset: offset })
}

// ---------------- Блокировка, ограничение, заглушение ----------------

export function block(targetId) {
  return call('block_user', { p_user: targetId }, 'block')
}

export function unblock(targetId) {
  return call('unblock_user', { p_user: targetId }, 'unblock')
}

// Ограничение — не блокировка. Человек ничего не узнаёт: его сообщения
// уходят в «Запросы», присутствие от него скрыто, а подписка и доступ к
// записям остаются как были.
export function setRestricted(targetId, on) {
  return call('set_restricted', { p_user: targetId, p_on: on }, 'setRestricted')
}

// Заглушение НИ НА ЧТО не влияет, кроме того, что показывают мне: подписка
// цела, сообщения доходят, права не меняются.
//
// После записи обновляем КЭШ заглушённых. Решение «показывать ли пуш»
// принимается синхронно, в обработчике входящего сообщения, — ходить за
// списком в базу в этот момент уже поздно. Обновляем здесь, в единственной
// точке, где заглушения меняются: иначе человек заглушил бы собеседника и
// продолжал получать от него уведомления до перезагрузки приложения.
export async function setMute(targetId, { posts = false, messages = false } = {}) {
  const res = await call('set_user_mute', { p_user: targetId, p_posts: posts, p_messages: messages }, 'setMute')
  if (!res.error) await refreshMuteCache()
  return res
}

// Список заглушённых сообщений → кэш в notifications.js. Отдельной функцией,
// потому что его же зовёт приложение при входе.
export async function refreshMuteCache() {
  try {
    const rows = await listRelation('muted')
    setMutedMessageUsers(rows.filter((r) => r.mute_messages).map((r) => r.user_id))
  } catch {
    // Не приехал — оставляем прежний кэш: он честнее пустого, при котором
    // заглушённые снова начали бы звенеть.
  }
}

// ---------------- Близкие друзья и поимённый доступ ----------------

export function setCloseFriend(targetId, on) {
  return call('set_close_friend', { p_user: targetId, p_on: on }, 'setCloseFriend')
}

export function setDiaryAccess(targetId, on) {
  return call('set_diary_access', { p_user: targetId, p_on: on }, 'setDiaryAccess')
}

// Списки «моих» отношений: близкие друзья, заблокированные, ограниченные,
// заглушённые, поимённый доступ к дневнику. Один RPC на все пять — карточка
// человека в них одинаковая, и пять почти одинаковых функций разошлись бы в
// мелочах ровно так, как уже разошлись пять копий строки человека в вёрстке.
export const RELATION_KINDS = ['close_friends', 'blocked', 'restricted', 'muted', 'diary_access']

export function listRelation(kind, { limit = 100, offset = 0 } = {}) {
  if (!RELATION_KINDS.includes(kind)) return Promise.resolve([])
  return readList('list_relation', { p_kind: kind, p_limit: limit, p_offset: offset })
}

// ---------------- Настройки приватности ----------------

// Все настройки одним запросом: шесть переключателей на экране не должны
// стоить шести обращений к базе.
// Возвращает { settings } либо { unavailable: true }. Различать обязательно:
// «настройки ещё грузятся» и «раздела в базе нет» выглядели одинаково —
// вечным «Загрузка…», из которого человеку некуда деться.
export async function getPrivacy() {
  if (!supabase) return { unavailable: true }
  const { data, error } = await supabase.rpc('my_privacy')
  if (error) {
    if (isMissingRelation(error)) return { unavailable: true }
    throw error
  }
  return { settings: (Array.isArray(data) ? data[0] : data) || null }
}

export function setAccountPrivacy(isPrivate) {
  return call('set_account_privacy', { p_private: isPrivate }, 'setAccountPrivacy')
}

export function setMessagePolicy({ following, followers, others }) {
  return call('set_message_policy', {
    p_following: following, p_followers: followers, p_others: others,
  }, 'setMessagePolicy')
}

export function setGroupInvites(value) {
  return call('set_group_invites', { p_value: value }, 'setGroupInvites')
}

export function setActivityVisibility(on) {
  return call('set_activity_visibility', { p_on: on }, 'setActivityVisibility')
}

export function setReadReceipts(on) {
  return call('set_read_receipts', { p_on: on }, 'setReadReceipts')
}

export async function getDiaryVisibility() {
  if (!supabase) return 'followers'
  const { data, error } = await supabase.rpc('my_diary_visibility')
  if (error) { if (isMissingRelation(error)) return null; throw error }
  return data || 'followers'
}

export function setDiaryVisibility(value) {
  return call('set_diary_visibility', { p_value: value }, 'setDiaryVisibility')
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

// Поиск людей — по нику И по отображаемому имени. Имя вернулось в условие
// намеренно: оно неуникально и потому не годится как АДРЕС, но человек ищет
// «Аня», а не «anya_k», и раньше не находил ничего.
//
// Меньше двух символов сервер не обслуживает — не отправляем такой запрос
// вообще, чтобы не ходить впустую на каждую букву.
export const MIN_SEARCH = 2

export async function searchUsers(query, { limit = 20 } = {}) {
  const q = (query || '').trim()
  if (!supabase || q.length < MIN_SEARCH) return []
  return readList('search_users', { p_query: q, p_limit: limit })
}

// Смена ника. Уникальность проверяет база, а не клиент: между проверкой
// «свободен ли» и записью всегда есть промежуток, в который его может занять
// кто-то другой. Поэтому единственный надёжный ответ — тот, что вернул INSERT.
export async function setUsername(username) {
  if (!supabase) return NO_SERVER
  const { data, error } = await supabase.rpc('set_username', { p_username: username })
  if (error) {
    if (error.code === '23505') return { error: 'Этот ник уже занят' }
    if (error.code === '22023') return { error: 'От 3 до 20 символов: латиница, цифры, _' }
    // 54000 приходит из ограничения частоты: ник — единственный адрес человека,
    // и менять его чаще раза в сутки нельзя (см. set_username в миграции
    // 2026-09-05).
    if (error.code === '54000') return { error: 'Ник можно менять не чаще раза в сутки' }
    return fail(error, 'setUsername')
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
//
// Подписчиков несколько — бейдж в нижней навигации, блок «События» в профиле
// и сам экран уведомлений, — и все они смотрят на одну тему. Общий хаб в
// realtime.js существует именно поэтому: второй подписчик на ту же тему
// раньше ронял приложение исключением
//   cannot add `postgres_changes` callbacks for realtime:… after `subscribe()`
export function subscribeToNotifications(myId, onChange) {
  if (!supabase || !myId) return () => {}
  return realtime.subscribe(
    `notifications:${myId}`,
    (channel, emit) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications',
      filter: `recipient_id=eq.${myId}`,
    }, emit),
    onChange,
  )
}

// Realtime на просьбы о подписке: бейдж «Запросы» должен загораться сразу, а
// не при следующем открытии приложения.
export function subscribeToFollowRequests(myId, onChange) {
  if (!supabase || !myId) return () => {}
  return realtime.subscribe(
    `follow-requests:${myId}`,
    (channel, emit) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'follow_requests',
      filter: `target_id=eq.${myId}`,
    }, emit),
    onChange,
  )
}

// ---------------- Посты ----------------
// Видимость поста задаёт автор. Значение по умолчанию приходит из
// relationship.js, чтобы клиент и база не разошлись в трактовке «по умолчанию».
//
// База без миграции социального графа колонки visibility не знает. Тогда
// менять нечего: пост и так живёт по прежнему правилу, а человек об этом не
// просил — он просто правил текст. Красная ошибка здесь была бы про то, чего
// пользователь не делал и не может починить.
export async function setPostVisibility(postId, visibility) {
  if (!supabase) return NO_SERVER
  const { error } = await supabase.from('posts').update({ visibility }).eq('id', postId)
  if (error && isMissingColumn(error)) return { ok: true, unsupported: true }
  return error ? fail(error, 'setPostVisibility') : { ok: true }
}

// ---------------- Жалобы ----------------
// Отдельной системы модерации не заводим: у проекта уже есть support_messages
// и bans, и вторая, конкурирующая, означала бы два места, куда смотреть.
// Жалоба — это структурированное сообщение в ту же поддержку.
export const REPORT_REASONS = [
  { key: 'spam',          label: 'Спам' },
  { key: 'harassment',    label: 'Оскорбления или травля' },
  { key: 'inappropriate', label: 'Неприемлемый контент' },
  { key: 'other',         label: 'Другое' },
]

export async function reportContent({ kind, targetId, reason, note = '' }) {
  if (!supabase) return NO_SERVER

  // Отправляем в ту же поддержку, что и обычное обращение: у неё уже есть
  // проверка входа, бан и ограничение частоты. Заводить рядом вторую систему
  // модерации значило бы иметь два места, куда смотреть владельцу.
  const text = [
    `[ЖАЛОБА] ${kind}: ${targetId}`,
    `Причина: ${REPORT_REASONS.find((r) => r.key === reason)?.label || reason}`,
    note ? `Комментарий: ${note.slice(0, 500)}` : null,
  ].filter(Boolean).join('\n')

  try {
    const { data: sess } = await supabase.auth.getSession()
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess?.session?.access_token || ''}`,
      },
      body: JSON.stringify({ text, kind: 'support' }),
    })
    const data = await res.json().catch(() => ({}))
    // 429 — не поломка: человек уже писал в этот час. Текст сервера честнее
    // придуманного здесь, поэтому показываем именно его.
    if (!res.ok) return { error: data.error || 'Не удалось отправить жалобу' }
    return { ok: true }
  } catch (e) {
    log.error('reportContent', 'жалоба не ушла', e)
    return { error: 'Нет связи с сервером' }
  }
}
