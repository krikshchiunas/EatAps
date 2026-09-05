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

// ─────────────────────────────────────────────────────────────────────────────
// МАТРИЦА ДОСТУПА — по одной проверке на клетку.
//
// Это зеркало серверных правил, и цена расхождения несимметрична: если модель
// строже сервера, человек не увидит своего; если мягче — интерфейс пообещает
// доступ, которого нет, и покажет пустоту вместо содержимого. Поэтому каждая
// клетка проверяется явно, включая очевидные.
// ─────────────────────────────────────────────────────────────────────────────
import { canViewPost } from './relationship.js'

const rel = (over = {}) => toRelationship({
  following: false, followed_by: false, blocked: false, blocked_by: false, ...over,
})

const SELF = null // свои посты видны всегда и до этой функции не доходят
const STRANGER = rel()
const FOLLOWER = rel({ following: true })                        // я подписан на него
const FOLLOWED_BY = rel({ followed_by: true })                   // он подписан на меня
const FRIEND = rel({ following: true, followed_by: true })
const I_BLOCKED = rel({ following: true, followed_by: true, blocked: true })
const THEY_BLOCKED = rel({ following: true, followed_by: true, blocked_by: true })

test('матрица: пост public', () => {
  assert.equal(canViewPost('public', STRANGER), true)
  assert.equal(canViewPost('public', FOLLOWER), true)
  assert.equal(canViewPost('public', FRIEND), true)
  assert.equal(canViewPost('public', I_BLOCKED), false, 'блокировка перекрывает даже public')
  assert.equal(canViewPost('public', THEY_BLOCKED), false)
})

test('матрица: пост для подписчиков', () => {
  assert.equal(canViewPost('followers', STRANGER), false)
  assert.equal(canViewPost('followers', FOLLOWER), true)
  assert.equal(canViewPost('followers', FRIEND), true, 'друг — тоже подписчик')
  // Чужая подписка на меня доступа не даёт: круг определяет автор поста, а не
  // тот, кто на меня подписался.
  assert.equal(canViewPost('followers', FOLLOWED_BY), false)
  assert.equal(canViewPost('followers', I_BLOCKED), false)
  assert.equal(canViewPost('followers', THEY_BLOCKED), false)
})

test('матрица: пост только для друзей', () => {
  assert.equal(canViewPost('friends', STRANGER), false)
  assert.equal(canViewPost('friends', FOLLOWER), false, 'односторонняя подписка — не дружба')
  assert.equal(canViewPost('friends', FOLLOWED_BY), false)
  assert.equal(canViewPost('friends', FRIEND), true)
  assert.equal(canViewPost('friends', I_BLOCKED), false)
  assert.equal(canViewPost('friends', THEY_BLOCKED), false)
})

test('матрица: приватный пост не виден никому, кроме автора', () => {
  for (const r of [STRANGER, FOLLOWER, FOLLOWED_BY, FRIEND]) {
    assert.equal(canViewPost('private', r), false)
  }
})

test('неизвестная видимость трактуется как самая узкая', () => {
  assert.equal(canViewPost('unlisted', FRIEND), false)
  assert.equal(canViewPost(undefined, FRIEND), false)
  assert.equal(canViewPost('public', null), false)
})

// Дневник и переписка — один и тот же круг, и он уже, чем у постов
// «для подписчиков». Проверяем это отдельно: три разных вопроса про доступ
// когда-то отвечались одним признаком, и повторять ту ошибку нельзя.
test('матрица: дневник и переписка — только дружба', () => {
  assert.equal(canViewDiary(FOLLOWER), false)
  assert.equal(canMessage(FOLLOWER), false)
  assert.equal(canViewDiary(FRIEND), true)
  assert.equal(canMessage(FRIEND), true)
  assert.equal(canViewDiary(I_BLOCKED), false)
  assert.equal(canMessage(THEY_BLOCKED), false)
})

test('доступ к посту шире, чем к дневнику: подписчик видит мысли, но не еду', () => {
  assert.equal(canViewPost('followers', FOLLOWER), true)
  assert.equal(canViewDiary(FOLLOWER), false)
})

void SELF
