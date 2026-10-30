// Отношение между двумя пользователями — ЧИСТАЯ часть.
//
// Без импорта supabase.js: тот читает import.meta.env при импорте и падает под
// голым `node --test`. По той же причине отдельно живут pgErrors.js и
// friendView.js. Из зависимостей только словарь подписей — он чистый.
//
// Здесь описано, во что превращается ответ RPC get_relationship: набор булевых
// признаков → одно состояние, по которому экран рисует кнопки. Раньше состояний
// было три (друг / входящая / исходящая), и каждый экран раскладывал их сам.
//
// ОБНОВЛЕНИЕ 2026-08-26. Заявок в друзья больше нет. Дружба стала производной:
// подписаны друг на друга — значит друзья, отписался любой — дружба кончилась
// (миграция 2026-08-26_nickname_identity). Поэтому friend и mutualFollow здесь
// всегда совпадают, а полей про заявки не существует вовсе — не «всегда false»,
// а нет: мёртвое поле рано или поздно кто-нибудь начнёт проверять.

import { t } from './i18n.js'

export const EMPTY_RELATIONSHIP = {
  following: false,
  followedBy: false,
  mutualFollow: false,
  friend: false,
  blocked: false,
  blockedBy: false,
  friendshipId: null,
}

// Строка из get_relationship (snake_case из Postgres) → форма для приложения.
export function toRelationship(row) {
  if (!row) return { ...EMPTY_RELATIONSHIP }
  const following = Boolean(row.following)
  const followedBy = Boolean(row.followed_by)
  // Дружбу считаем из подписок, а не из колонки friend, хотя сервер и отдаёт
  // их одинаковыми. Так клиент не может показать «вы друзья» там, где граф
  // говорит обратное, — даже если материализованная строка разойдётся с ним.
  const mutualFollow = following && followedBy
  return {
    following,
    followedBy,
    mutualFollow,
    friend: mutualFollow,
    blocked: Boolean(row.blocked),
    blockedBy: Boolean(row.blocked_by),
    friendshipId: row.friendship_id || null,
  }
}

// Что показывать на кнопке подписки — единственной кнопке связи, которая
// осталась. Она же управляет дружбой: подписка в ответ делает вас друзьями,
// отписка дружбу расторгает. Поэтому у взаимного состояния своя подпись —
// «Вы друзья», а не «Вы подписаны»: человек должен понимать, что именно
// он сейчас разорвёт.
export function followAction(rel) {
  if (rel.blocked) return { kind: 'unblock', label: t('rel.unblock'), tone: 'danger' }
  if (rel.blockedBy) return null // человек нас заблокировал — кнопки нет вовсе
  if (rel.friend) return { kind: 'unfollow', label: t('rel.friends'), tone: 'quiet' }
  if (rel.following) return { kind: 'unfollow', label: t('rel.following'), tone: 'quiet' }
  if (rel.followedBy) return { kind: 'follow', label: t('rel.followBack'), tone: 'primary' }
  return { kind: 'follow', label: t('rel.follow'), tone: 'primary' }
}

// Можно ли написать личное сообщение. Зеркало серверной политики messages, и
// оно обязано совпадать с ней буквально: переписка — привилегия дружбы, а
// дружба теперь означает взаимную подписку.
export function canMessage(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Видно ли дневник питания. Тот же круг, что и у переписки, — см. friend_state.
export function canViewDiary(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Короткая подпись отношения под именем в списках. Отдельной строки про
// взаимную подписку здесь нет: это и есть дружба, и две подписи для одного
// состояния только путали бы.
export function relationshipLabel(rel) {
  if (rel.blocked) return t('rel.blocked')
  if (rel.friend) return t('rel.friend')
  if (rel.following) return t('rel.following')
  if (rel.followedBy) return t('rel.followedBy')
  return null
}

// Уровни видимости поста — зеркало типа post_visibility в базе.
const level = (value) => ({
  value,
  get label() { return t(`vis.${value}.label`) },
  get hint() { return t(`vis.${value}.hint`) },
})
export const VISIBILITY = [level('public'), level('followers'), level('friends'), level('private')]

export const DEFAULT_VISIBILITY = 'followers'

export function visibilityLabel(value) {
  const v = VISIBILITY.find((x) => x.value === value) || VISIBILITY.find((x) => x.value === DEFAULT_VISIBILITY)
  return v.label
}
