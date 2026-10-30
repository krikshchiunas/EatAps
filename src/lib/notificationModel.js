// Уведомления — ЧИСТАЯ часть: во что превращается строка из list_notifications.
// Из зависимостей только словарь — он тоже проверяется под голым `node --test`.
import { t } from './i18n.js'

const group = (key, types) => ({ key, types, get label() { return t(`notif.group.${key}`) } })

// Группы «Заявки» больше нет: заявок в друзья не существует — дружба
// возникает из взаимной подписки, и оба события уже лежат в «Людях».
export const NOTIFICATION_GROUPS = [
  group('social',   ['FOLLOW', 'FRIEND_ACCEPTED']),
  group('posts',    ['POST_REACTION', 'POST_COMMENT']),
  group('messages', ['MESSAGE']),
]

// Текст события. Имя актора подставляется вызывающим кодом отдельно, чтобы
// его можно было отрисовать ссылкой на профиль, а не строкой.
export function notificationText(n) {
  switch (n.type) {
    case 'FOLLOW':          return t('notif.follow')
    // Приходит тому, кто подписался первым: второй подписался в ответ, и
    // подписка стала дружбой.
    case 'FRIEND_ACCEPTED': return t('notif.friendAccepted')
    case 'POST_REACTION':
      return n.metadata?.reaction
        ? t('notif.reactedWith', { reaction: n.metadata.reaction })
        : t('notif.reacted')
    case 'POST_COMMENT':    return t('notif.comment')
    case 'MESSAGE':         return t('notif.message')
    default:                return t('notif.other')
  }
}

// Куда ведёт нажатие. Требование простое: из уведомления человек попадает
// прямо к объекту события, а не на экран, с которого его ещё надо искать.
export function notificationTarget(n) {
  switch (n.type) {
    case 'FOLLOW':
    case 'FRIEND_ACCEPTED':
      return { screen: 'profile', userId: n.actor_id }
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
