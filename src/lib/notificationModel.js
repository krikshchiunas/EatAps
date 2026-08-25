// Уведомления — ЧИСТАЯ часть: во что превращается строка из list_notifications.
// Без зависимостей, чтобы проверяться под голым `node --test`.

export const NOTIFICATION_GROUPS = [
  { key: 'requests', label: 'Заявки',   types: ['FRIEND_REQUEST'] },
  { key: 'social',   label: 'Люди',     types: ['FOLLOW', 'FRIEND_ACCEPTED'] },
  { key: 'posts',    label: 'Мысли',    types: ['POST_REACTION', 'POST_COMMENT'] },
  { key: 'messages', label: 'Сообщения', types: ['MESSAGE'] },
]

// Текст события. Имя актора подставляется вызывающим кодом отдельно, чтобы
// его можно было отрисовать ссылкой на профиль, а не строкой.
export function notificationText(n) {
  switch (n.type) {
    case 'FOLLOW':          return 'подписался на вас'
    case 'FRIEND_REQUEST':  return 'хочет добавить вас в друзья'
    case 'FRIEND_ACCEPTED': return 'теперь ваш друг'
    case 'POST_REACTION':   return `отреагировал${n.metadata?.reaction ? ' ' + n.metadata.reaction : ''} на вашу мысль`
    case 'POST_COMMENT':    return 'ответил на вашу мысль'
    case 'MESSAGE':         return 'написал вам'
    default:                return 'новое событие'
  }
}

// Куда ведёт нажатие. Требование простое: из уведомления человек попадает
// прямо к объекту события, а не на экран, с которого его ещё надо искать.
export function notificationTarget(n) {
  switch (n.type) {
    case 'FOLLOW':
    case 'FRIEND_ACCEPTED':
      return { screen: 'profile', userId: n.actor_id }
    case 'FRIEND_REQUEST':
      return { screen: 'requests' }
    case 'POST_REACTION':
      return { screen: 'post', postId: n.entity_id }
    case 'POST_COMMENT':
      // entity_id — id комментария; сам пост лежит в metadata, потому что к
      // ветке ответов нужно открыть именно пост и подсветить реплику.
      return { screen: 'post', postId: n.metadata?.post_id, commentId: n.entity_id }
    case 'MESSAGE':
      // entity_id для MESSAGE — собеседник, а не сообщение: одна строка на
      // диалог, и вести она должна в диалог.
      return { screen: 'chat', userId: n.entity_id || n.actor_id }
    default:
      return null
  }
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
