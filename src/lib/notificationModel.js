// Уведомления — ЧИСТАЯ часть: во что превращается строка из list_notifications.
// Без зависимостей, чтобы проверяться под голым `node --test`.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ТЕКСТ СОБИРАЕТСЯ ЗДЕСЬ, А НЕ ХРАНИТСЯ В БАЗЕ
//
// В строке уведомления лежит только структура: кто (actor_id), что произошло
// (type), с чем (entity_type, entity_id) и подробности (metadata). Готового
// текста там нет.
//
// Это не экономия места. Текст, записанный в базу при создании события,
// нельзя ни исправить, ни перевести, ни изменить по контексту читателя —
// «Аня подписалась на вас» останется в этой формулировке навсегда, включая
// опечатку и включая тот случай, когда Аня успела сменить имя. Структура
// переживает и переименование, и смену формулировки, и появление второго
// языка; строка — нет.

export const NOTIFICATION_GROUPS = [
  {
    key: 'social',
    label: 'Люди',
    types: ['FOLLOW', 'FOLLOW_REQUEST', 'FOLLOW_ACCEPTED', 'FRIEND_ACCEPTED', 'FRIEND_REQUEST'],
  },
  { key: 'posts', label: 'Мысли', types: ['POST_REACTION', 'POST_COMMENT'] },
  {
    key: 'messages',
    label: 'Сообщения',
    types: ['MESSAGE', 'MESSAGE_REQUEST', 'MESSAGE_REACTION', 'GROUP_INVITE'],
  },
]

// Текст события. Имя актора подставляется вызывающим кодом отдельно, чтобы
// его можно было отрисовать ссылкой на профиль, а не строкой.
export function notificationText(n) {
  switch (n?.type) {
    case 'FOLLOW':           return 'подписался на вас'
    case 'FOLLOW_REQUEST':   return 'просится к вам в подписчики'
    case 'FOLLOW_ACCEPTED':  return 'одобрил вашу заявку — теперь вы подписаны'
    // Приходит тому, кто подписался первым: второй подписался в ответ.
    case 'FRIEND_ACCEPTED':  return 'подписался в ответ — теперь вы друзья'
    case 'FRIEND_REQUEST':   return 'хочет добавиться в друзья'
    case 'POST_REACTION':    return `отреагировал${n.metadata?.reaction ? ' ' + n.metadata.reaction : ''} на вашу мысль`
    case 'POST_COMMENT':     return 'ответил на вашу мысль'
    case 'MESSAGE':          return 'написал вам'
    case 'MESSAGE_REQUEST':  return 'хочет вам написать'
    case 'MESSAGE_REACTION': return `отреагировал${n.metadata?.reaction ? ' ' + n.metadata.reaction : ''} на ваше сообщение`
    case 'GROUP_INVITE':     return 'добавил вас в групповой чат'
    default:                 return 'новое событие'
  }
}

// События, у которых прямо в строке списка есть кнопки решения. Просьба о
// подписке — единственная в своём роде: её нельзя «просто открыть», по ней
// надо ответить, и заставлять человека ради этого идти в профиль незачем.
export function notificationActions(n) {
  if (n?.type === 'FOLLOW_REQUEST') {
    return [
      { key: 'accept', label: 'Принять', tone: 'primary' },
      { key: 'decline', label: 'Удалить', tone: 'quiet' },
    ]
  }
  if (n?.type === 'FOLLOW') {
    // «Подписаться в ответ» рисуется обычной кнопкой связи: её состояние
    // зависит от отношения, а не от события, и вычислять его здесь нечем.
    return [{ key: 'follow', label: 'Подписаться в ответ', tone: 'primary' }]
  }
  return []
}

// Куда ведёт нажатие. Требование простое: из уведомления человек попадает
// прямо к объекту события, а не на экран, с которого его ещё надо искать.
export function notificationTarget(n) {
  switch (n?.type) {
    case 'FOLLOW':
    case 'FOLLOW_REQUEST':
    case 'FOLLOW_ACCEPTED':
    case 'FRIEND_ACCEPTED':
    case 'FRIEND_REQUEST':
      return { screen: 'profile', userId: n.actor_id }
    case 'POST_REACTION':
      return { screen: 'post', postId: n.entity_id }
    case 'POST_COMMENT':
      // entity_id — id комментария; сам пост лежит в metadata, потому что к
      // ветке ответов нужно открыть именно пост и подсветить реплику.
      return { screen: 'post', postId: n.metadata?.post_id, commentId: n.entity_id }
    case 'MESSAGE':
    case 'MESSAGE_REQUEST':
    case 'MESSAGE_REACTION':
    case 'GROUP_INVITE':
      // entity_type различает две адресации: у личного диалога ключ — это
      // собеседник (одна строка на диалог, и вести она должна в диалог), у
      // группы — сам диалог, потому что собеседника там нет.
      return n.entity_type === 'conversation'
        ? { screen: 'chat', conversationId: n.entity_id }
        : { screen: 'chat', userId: n.entity_id || n.actor_id }
    default:
      return null
  }
}

// Разделение по времени: «Сегодня», «На неделе», «Раньше». Группировка по
// давности — единственная, которая не требует от человека выбирать фильтр:
// свежее всегда сверху и всегда отделено от старого.
export const TIME_BUCKETS = [
  { key: 'today',    label: 'Сегодня' },
  { key: 'week',     label: 'На этой неделе' },
  { key: 'earlier',  label: 'Раньше' },
]

export function bucketOf(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return 'earlier'
  const age = now - t
  if (age < 86400_000) return 'today'
  if (age < 7 * 86400_000) return 'week'
  return 'earlier'
}

// Раскладка по времени с сохранением порядка внутри каждого отрезка.
export function groupByTime(list, now = Date.now()) {
  const out = { today: [], week: [], earlier: [] }
  for (const n of list || []) out[bucketOf(n?.created_at, now)].push(n)
  return out
}

export function groupNotifications(list) {
  const out = {}
  for (const g of NOTIFICATION_GROUPS) out[g.key] = []
  for (const n of list || []) {
    const g = NOTIFICATION_GROUPS.find((x) => x.types.includes(n.type))
    if (g) out[g.key].push(n)
  }
  return out
}

export function unreadCount(list) {
  return (list || []).filter((n) => !n.read_at).length
}
