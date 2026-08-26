import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toRelationship, EMPTY_RELATIONSHIP, followAction,
  canMessage, canViewDiary, relationshipLabel, visibilityLabel,
} from './relationship.js'

test('пустой ответ RPC не роняет модель', () => {
  assert.deepEqual(toRelationship(null), EMPTY_RELATIONSHIP)
  assert.deepEqual(toRelationship(undefined), EMPTY_RELATIONSHIP)
})

test('snake_case из Postgres раскладывается в camelCase', () => {
  const rel = toRelationship({
    following: true, followed_by: false, mutual_follow: false, friend: false,
    blocked: false, blocked_by: false, friendship_id: 'abc',
  })
  assert.equal(rel.following, true)
  assert.equal(rel.followedBy, false)
  assert.equal(rel.friendshipId, 'abc')
})

// Главный инвариант новой модели: дружба — это ровно взаимная подписка.
test('дружба = взаимная подписка, и ничего кроме', () => {
  const onlyFollow = toRelationship({ following: true })
  assert.equal(onlyFollow.friend, false, 'односторонняя подписка — не дружба')
  assert.equal(followAction(onlyFollow).kind, 'unfollow')

  const mutual = toRelationship({ following: true, followed_by: true })
  assert.equal(mutual.friend, true)
  assert.equal(mutual.mutualFollow, true)
})

// Колонка friend из get_relationship не должна перебивать граф: если сервер
// почему-то отдал дружбу без взаимной подписки, клиент ей не верит.
test('friend без взаимной подписки не признаётся', () => {
  const inconsistent = toRelationship({ friend: true, following: true, followed_by: false })
  assert.equal(inconsistent.friend, false)
  assert.equal(canMessage(inconsistent), false)
  assert.equal(canViewDiary(inconsistent), false)
})

test('подписка односторонняя: A→B не делает B→A', () => {
  const aSeesB = toRelationship({ following: true, followed_by: false })
  assert.equal(aSeesB.mutualFollow, false)
  const bSeesA = toRelationship({ following: false, followed_by: true })
  assert.equal(bSeesA.following, false)
  assert.equal(followAction(bSeesA).label, 'Подписаться в ответ')
})

test('взаимная подписка даёт и личку, и дневник', () => {
  const friend = toRelationship({ following: true, followed_by: true })
  assert.equal(canMessage(friend), true)
  assert.equal(canViewDiary(friend), true)
})

test('кнопка объясняет, что именно разорвёт отписка', () => {
  assert.equal(followAction(toRelationship({ following: true, followed_by: true })).label, 'Вы друзья')
  assert.equal(followAction(toRelationship({ following: true })).label, 'Вы подписаны')
})

test('блокировка перекрывает всё', () => {
  const blocked = toRelationship({ following: true, followed_by: true, blocked: true })
  assert.equal(canMessage(blocked), false)
  assert.equal(canViewDiary(blocked), false)
  assert.equal(followAction(blocked).kind, 'unblock')
})

test('тот, кто заблокировал нас, не показывает кнопок', () => {
  const by = toRelationship({ blocked_by: true })
  assert.equal(followAction(by), null)
  assert.equal(canMessage(by), false)
})

test('подпись отношения отдаёт приоритет более сильной связи', () => {
  assert.equal(relationshipLabel(toRelationship({ following: true, followed_by: true })), 'Друг')
  assert.equal(relationshipLabel(toRelationship({ following: true })), 'Вы подписаны')
  assert.equal(relationshipLabel(toRelationship({ followed_by: true })), 'Подписан на вас')
  assert.equal(relationshipLabel(toRelationship({})), null)
})

test('неизвестный уровень видимости не роняет подпись', () => {
  assert.equal(visibilityLabel('public'), 'Всем')
  assert.equal(visibilityLabel('чепуха'), 'Подписчикам')
})
