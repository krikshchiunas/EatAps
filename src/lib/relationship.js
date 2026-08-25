// Отношение между двумя пользователями — ЧИСТАЯ часть.
//
// Без зависимостей и без импорта supabase.js: тот читает import.meta.env при
// импорте и падает под голым `node --test`. По той же причине отдельно живут
// pgErrors.js и friendView.js.
//
// Здесь описано, во что превращается ответ RPC get_relationship: набор из семи
// булевых признаков → одно состояние, по которому экран рисует кнопки. Раньше
// состояний было три (друг / входящая / исходящая), и каждый экран раскладывал
// их сам. С подписками и блокировками их стало больше, и разложить их
// одинаково в пяти местах уже не выйдет.

export const EMPTY_RELATIONSHIP = {
  following: false,
  followedBy: false,
  mutualFollow: false,
  friend: false,
  incomingFriendRequest: false,
  outgoingFriendRequest: false,
  blocked: false,
  blockedBy: false,
  friendshipId: null,
}

// Строка из get_relationship (snake_case из Postgres) → форма для приложения.
export function toRelationship(row) {
  if (!row) return { ...EMPTY_RELATIONSHIP }
  return {
    following: Boolean(row.following),
    followedBy: Boolean(row.followed_by),
    mutualFollow: Boolean(row.mutual_follow),
    friend: Boolean(row.friend),
    incomingFriendRequest: Boolean(row.incoming_friend_request),
    outgoingFriendRequest: Boolean(row.outgoing_friend_request),
    blocked: Boolean(row.blocked),
    blockedBy: Boolean(row.blocked_by),
    friendshipId: row.friendship_id || null,
  }
}

// Что показывать на кнопке подписки. Отдельно от дружбы — в этом весь смысл
// новой модели: подписка и дружба больше не одно и то же действие.
export function followAction(rel) {
  if (rel.blocked) return { kind: 'unblock', label: 'Разблокировать', tone: 'danger' }
  if (rel.blockedBy) return null // человек нас заблокировал — кнопки нет вовсе
  if (rel.following) return { kind: 'unfollow', label: 'Вы подписаны', tone: 'quiet' }
  if (rel.followedBy) return { kind: 'follow', label: 'Подписаться в ответ', tone: 'primary' }
  return { kind: 'follow', label: 'Подписаться', tone: 'primary' }
}

// Что показывать на кнопке дружбы.
export function friendAction(rel) {
  if (rel.blocked || rel.blockedBy) return null
  if (rel.friend) return { kind: 'removeFriend', label: 'Вы друзья', tone: 'quiet' }
  if (rel.incomingFriendRequest) return { kind: 'acceptFriend', label: 'Принять заявку', tone: 'primary' }
  if (rel.outgoingFriendRequest) return { kind: 'cancelFriend', label: 'Заявка отправлена', tone: 'quiet' }
  return { kind: 'addFriend', label: 'Добавить в друзья', tone: 'secondary' }
}

// Можно ли написать личное сообщение. Право переписки НАМЕРЕННО осталось у
// дружбы: миграция социального графа его не расширяла, и зеркало серверной
// политики messages должно совпадать с ней буквально. Если однажды личку
// откроют взаимным подписчикам, поменять нужно оба места сразу.
export function canMessage(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Видно ли дневник питания. Тоже только друзьям — подписка сюда не даёт
// доступа, см. friend_state в миграции.
export function canViewDiary(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Короткая подпись отношения под именем в списках.
export function relationshipLabel(rel) {
  if (rel.blocked) return 'Заблокирован'
  if (rel.friend) return 'Друг'
  if (rel.mutualFollow) return 'Вы подписаны друг на друга'
  if (rel.following) return 'Вы подписаны'
  if (rel.followedBy) return 'Подписан на вас'
  return null
}

// Уровни видимости поста — зеркало типа post_visibility в базе.
export const VISIBILITY = [
  { value: 'public',    label: 'Всем',          hint: 'Любой пользователь EatAps' },
  { value: 'followers', label: 'Подписчикам',   hint: 'Подписчики и друзья' },
  { value: 'friends',   label: 'Только друзьям', hint: 'Принятые друзья' },
  { value: 'private',   label: 'Только мне',    hint: 'Никто, кроме вас' },
]

export const DEFAULT_VISIBILITY = 'followers'

export function visibilityLabel(value) {
  return VISIBILITY.find((v) => v.value === value)?.label || 'Подписчикам'
}
