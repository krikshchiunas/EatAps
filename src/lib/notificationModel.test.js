import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notificationText, notificationTarget, groupNotifications, unreadCount,
} from './notificationModel.js'

test('у каждого типа есть текст', () => {
  for (const t of ['FOLLOW','FRIEND_REQUEST','FRIEND_ACCEPTED','POST_REACTION','POST_COMMENT','MESSAGE']) {
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
  assert.deepEqual(notificationTarget({ type: 'FRIEND_REQUEST' }), { screen: 'requests' })
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
    { type: 'FOLLOW' }, { type: 'FRIEND_REQUEST' }, { type: 'POST_COMMENT' },
    { type: 'MESSAGE' }, { type: 'FRIEND_ACCEPTED' }, { type: 'POST_REACTION' },
  ]
  const g = groupNotifications(list)
  assert.equal(g.requests.length, 1)
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
