import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toRelationship, EMPTY_RELATIONSHIP, followAction, friendAction,
  canMessage, canViewDiary, relationshipLabel, visibilityLabel,
} from './relationship.js'

test('пустой ответ RPC не роняет модель', () => {
  assert.deepEqual(toRelationship(null), EMPTY_RELATIONSHIP)
  assert.deepEqual(toRelationship(undefined), EMPTY_RELATIONSHIP)
})

test('snake_case из Postgres раскладывается в camelCase', () => {
  const rel = toRelationship({
    following: true, followed_by: false, mutual_follow: false, friend: false,
    incoming_friend_request: true, outgoing_friend_request: false,
    blocked: false, blocked_by: false, friendship_id: 'abc',
  })
  assert.equal(rel.following, true)
  assert.equal(rel.followedBy, false)
  assert.equal(rel.incomingFriendRequest, true)
  assert.equal(rel.friendshipId, 'abc')
})

// Главный инвариант новой модели.
test('FOLLOW и FRIENDSHIP независимы', () => {
  const onlyFollow = toRelationship({ following: true })
  assert.equal(onlyFollow.following, true)
  assert.equal(onlyFollow.friend, false)
  assert.equal(followAction(onlyFollow).kind, 'unfollow')
  assert.equal(friendAction(onlyFollow).kind, 'addFriend')

  const onlyFriend = toRelationship({ friend: true })
  assert.equal(onlyFriend.following, false)
  assert.equal(followAction(onlyFriend).kind, 'follow')
  assert.equal(friendAction(onlyFriend).kind, 'removeFriend')
})

test('подписка односторонняя: A→B не делает B→A', () => {
  const aSeesB = toRelationship({ following: true, followed_by: false })
  assert.equal(aSeesB.mutualFollow, false)
  const bSeesA = toRelationship({ following: false, followed_by: true })
  assert.equal(bSeesA.following, false)
  assert.equal(followAction(bSeesA).label, 'Подписаться в ответ')
})

test('взаимная подписка НЕ даёт ни личку, ни дневник', () => {
  const mutual = toRelationship({ following: true, followed_by: true, mutual_follow: true })
  assert.equal(canMessage(mutual), false, 'переписка осталась привилегией дружбы')
  assert.equal(canViewDiary(mutual), false, 'дневник питания остался у дружбы')
})

test('дружба даёт и личку, и дневник', () => {
  const friend = toRelationship({ friend: true })
  assert.equal(canMessage(friend), true)
  assert.equal(canViewDiary(friend), true)
})

test('блокировка перекрывает всё', () => {
  const blocked = toRelationship({ friend: true, following: true, blocked: true })
  assert.equal(canMessage(blocked), false)
  assert.equal(canViewDiary(blocked), false)
  assert.equal(friendAction(blocked), null)
  assert.equal(followAction(blocked).kind, 'unblock')
})

test('тот, кто заблокировал нас, не показывает кнопок', () => {
  const by = toRelationship({ blocked_by: true })
  assert.equal(followAction(by), null)
  assert.equal(friendAction(by), null)
  assert.equal(canMessage(by), false)
})

test('заявки в друзья различают направление', () => {
  assert.equal(friendAction(toRelationship({ incoming_friend_request: true })).kind, 'acceptFriend')
  assert.equal(friendAction(toRelationship({ outgoing_friend_request: true })).kind, 'cancelFriend')
})

test('подпись отношения отдаёт приоритет более сильной связи', () => {
  assert.equal(relationshipLabel(toRelationship({ friend: true, mutual_follow: true })), 'Друг')
  assert.equal(relationshipLabel(toRelationship({ mutual_follow: true, following: true, followed_by: true })),
    'Вы подписаны друг на друга')
  assert.equal(relationshipLabel(toRelationship({})), null)
})

test('неизвестный уровень видимости не роняет подпись', () => {
  assert.equal(visibilityLabel('public'), 'Всем')
  assert.equal(visibilityLabel('чепуха'), 'Подписчикам')
})
