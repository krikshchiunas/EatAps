import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notificationText, notificationTarget, groupNotifications, unreadCount,
} from './notificationModel.js'

test('у каждого типа есть текст', () => {
  for (const t of ['FOLLOW','FRIEND_ACCEPTED','POST_REACTION','POST_COMMENT','MESSAGE']) {
    const s = notificationText({ type: t, metadata: {} })
    assert.ok(s && s.length > 0, `нет текста для ${t}`)
  }
})

test('реакция попадает в текст, если она есть', () => {
  assert.match(notificationText({ type: 'POST_REACTION', metadata: { reaction: '🥕' } }), /🥕/)
  assert.doesNotMatch(notificationText({ type: 'POST_REACTION', metadata: {} }), /undefined/)
})

test('неизвестный тип не роняет рендер', () => {
  assert.equal(typeof notificationText({ type: 'ЧТО_ТО_НОВОЕ' }), 'string')
  assert.equal(notificationTarget({ type: 'ЧТО_ТО_НОВОЕ' }), null)
})

// Требование: из уведомления попадаем прямо к объекту.
test('каждое событие ведёт к своему объекту', () => {
  assert.deepEqual(notificationTarget({ type: 'FOLLOW', actor_id: 'u1' }),
    { screen: 'profile', userId: 'u1' })
  assert.deepEqual(notificationTarget({ type: 'FRIEND_ACCEPTED', actor_id: 'u3' }),
    { screen: 'profile', userId: 'u3' })
  assert.deepEqual(notificationTarget({ type: 'POST_REACTION', entity_id: 'p1' }),
    { screen: 'post', postId: 'p1' })
})

test('комментарий ведёт к посту, а не к самому комментарию', () => {
  const t = notificationTarget({ type: 'POST_COMMENT', entity_id: 'c1', metadata: { post_id: 'p1' } })
  assert.equal(t.screen, 'post')
  assert.equal(t.postId, 'p1', 'открывается пост')
  assert.equal(t.commentId, 'c1', 'реплика подсвечивается')
})

test('сообщение ведёт в диалог, а не к отдельной реплике', () => {
  const t = notificationTarget({ type: 'MESSAGE', entity_id: 'u2', actor_id: 'u2', metadata: { message_id: 'm9' } })
  assert.deepEqual(t, { screen: 'chat', userId: 'u2' })
})

test('группировка раскладывает по разделам и не теряет строк', () => {
  const list = [
    { type: 'FOLLOW' }, { type: 'POST_COMMENT' },
    { type: 'MESSAGE' }, { type: 'FRIEND_ACCEPTED' }, { type: 'POST_REACTION' },
  ]
  const g = groupNotifications(list)
  assert.equal(g.social.length, 2)
  assert.equal(g.posts.length, 2)
  assert.equal(g.messages.length, 1)
  assert.equal(Object.values(g).flat().length, list.length)
})

test('группировка переживает пустой и неизвестный вход', () => {
  assert.equal(Object.values(groupNotifications(null)).flat().length, 0)
  assert.equal(Object.values(groupNotifications([{ type: 'НЕТ_ТАКОГО' }])).flat().length, 0)
})

test('счётчик непрочитанных считает по read_at', () => {
  assert.equal(unreadCount([{ read_at: null }, { read_at: '2026-01-01' }, {}]), 2)
  assert.equal(unreadCount([]), 0)
  assert.equal(unreadCount(null), 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// Новые типы социальной системы 2026-09-09
// ─────────────────────────────────────────────────────────────────────────────
import {
  notificationActions, groupByTime, bucketOf, NOTIFICATION_GROUPS,
} from './notificationModel.js'

test('у каждого нового типа есть текст и он попадает в группу', () => {
  const types = [
    'FOLLOW_REQUEST', 'FOLLOW_ACCEPTED',
    'MESSAGE_REQUEST', 'MESSAGE_REACTION', 'GROUP_INVITE',
  ]
  for (const t of types) {
    const s = notificationText({ type: t, metadata: {} })
    assert.ok(s && s !== 'новое событие', `нет текста для ${t}`)
    assert.ok(NOTIFICATION_GROUPS.some((g) => g.types.includes(t)),
      `${t} не попадает ни в одну группу и исчезнет из фильтров`)
  }
})

// Просьба о подписке — единственное событие с решением прямо в списке:
// заставлять человека идти в профиль ради «Принять» незачем.
test('просьба о подписке несёт кнопки решения', () => {
  const a = notificationActions({ type: 'FOLLOW_REQUEST' })
  assert.deepEqual(a.map((x) => x.key), ['accept', 'decline'])
  assert.deepEqual(notificationActions({ type: 'FOLLOW' }).map((x) => x.key), ['follow'])
  assert.deepEqual(notificationActions({ type: 'POST_COMMENT' }), [])
  assert.deepEqual(notificationActions(null), [])
})

test('событие переписки ведёт в диалог: личный по человеку, групповой по id', () => {
  assert.deepEqual(
    notificationTarget({ type: 'MESSAGE_REQUEST', entity_type: 'message', entity_id: 'u2', actor_id: 'u2' }),
    { screen: 'chat', userId: 'u2' })
  assert.deepEqual(
    notificationTarget({ type: 'MESSAGE', entity_type: 'conversation', entity_id: 'c7', actor_id: 'u2' }),
    { screen: 'chat', conversationId: 'c7' })
  assert.deepEqual(
    notificationTarget({ type: 'FOLLOW_REQUEST', actor_id: 'u5' }),
    { screen: 'profile', userId: 'u5' })
})

test('разбивка по давности: сегодня / неделя / раньше', () => {
  const now = Date.parse('2026-09-09T12:00:00Z')
  assert.equal(bucketOf('2026-09-09T09:00:00Z', now), 'today')
  assert.equal(bucketOf('2026-09-06T09:00:00Z', now), 'week')
  assert.equal(bucketOf('2026-08-01T09:00:00Z', now), 'earlier')
  assert.equal(bucketOf(null, now), 'earlier', 'без даты — в самый низ, а не в «сегодня»')

  const g = groupByTime([
    { created_at: '2026-09-09T09:00:00Z' },
    { created_at: '2026-09-06T09:00:00Z' },
    { created_at: '2026-08-01T09:00:00Z' },
  ], now)
  assert.equal(g.today.length, 1)
  assert.equal(g.week.length, 1)
  assert.equal(g.earlier.length, 1)
  assert.equal(Object.values(groupByTime(null, now)).flat().length, 0)
})
