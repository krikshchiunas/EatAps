import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  messageGoesToRequests, relationshipState, STATE, isLocked, canViewContent,
  toRelationship, EMPTY_RELATIONSHIP, followAction,
  canMessage, canViewDiary, relationshipLabel, visibilityLabel, canViewPost,
  VISIBILITY, DIARY_AUDIENCES, MESSAGE_POLICY,
} from './relationship.js'

test('пустой ответ RPC не роняет модель', () => {
  assert.deepEqual(toRelationship(null), EMPTY_RELATIONSHIP)
  assert.deepEqual(toRelationship(undefined), EMPTY_RELATIONSHIP)
})

test('snake_case из Postgres раскладывается в camelCase', () => {
  const rel = toRelationship({
    following: true, followed_by: false, target_is_private: true,
    request_sent: true, is_close_friend: true, muted_posts: true,
    can_view_content: false, message_permission: 'request',
  })
  assert.equal(rel.following, true)
  assert.equal(rel.followedBy, false)
  assert.equal(rel.targetIsPrivate, true)
  assert.equal(rel.requestSent, true)
  assert.equal(rel.isCloseFriend, true)
  assert.equal(rel.mutedPosts, true)
  assert.equal(rel.canViewContent, false)
  assert.equal(rel.messagePermission, 'request')
})

// ─────────────────────────────────────────────────────────────────────────────
// СОСТОЯНИЕ: по одной проверке на каждое, включая приоритет между ними
// ─────────────────────────────────────────────────────────────────────────────

test('состояние: все восемь исходов', () => {
  assert.equal(relationshipState(toRelationship({ is_self: true })), STATE.SELF)
  assert.equal(relationshipState(toRelationship({ blocked: true })), STATE.BLOCKED_BY_ME)
  assert.equal(relationshipState(toRelationship({ blocked_by: true })), STATE.BLOCKED_ME)
  assert.equal(relationshipState(toRelationship({ request_sent: true })), STATE.REQUEST_SENT)
  assert.equal(relationshipState(toRelationship({ following: true, followed_by: true })), STATE.MUTUAL)
  assert.equal(relationshipState(toRelationship({ following: true })), STATE.FOLLOWING)
  assert.equal(relationshipState(toRelationship({ followed_by: true })), STATE.FOLLOWED_BY)
  assert.equal(relationshipState(toRelationship({})), STATE.NONE)
})

test('состояние: блокировка сильнее подписки, просьба сильнее подписки', () => {
  const blockedButFollowing = toRelationship({ following: true, followed_by: true, blocked: true })
  assert.equal(relationshipState(blockedButFollowing), STATE.BLOCKED_BY_ME)

  const blockedMe = toRelationship({ following: true, blocked_by: true })
  assert.equal(relationshipState(blockedMe), STATE.BLOCKED_ME)

  // Просьба и подписка одновременно — состояние переходное (аккаунт был
  // закрыт и стал открытым). Кнопка обязана показывать просьбу: иначе
  // отменить её человеку будет нечем.
  const both = toRelationship({ following: true, request_sent: true })
  assert.equal(relationshipState(both), STATE.REQUEST_SENT)
})

// ─────────────────────────────────────────────────────────────────────────────
// КНОПКА
// ─────────────────────────────────────────────────────────────────────────────

test('кнопка: подписка на открытый аккаунт', () => {
  const a = followAction(toRelationship({}))
  assert.equal(a.kind, 'follow')
  assert.equal(a.label, 'Подписаться')
})

test('кнопка: подписка в ответ', () => {
  const a = followAction(toRelationship({ followed_by: true }))
  assert.equal(a.kind, 'follow')
  assert.equal(a.label, 'Подписаться в ответ')
})

test('кнопка: отправленная просьба отменяется, а не повторяется', () => {
  const a = followAction(toRelationship({ request_sent: true, target_is_private: true }))
  assert.equal(a.kind, 'cancelRequest')
  assert.equal(a.label, 'Запрошено')
})

// Мгновенная отписка от одного касания — самая частая случайная потеря связи
// в интерфейсах такого рода. Нажатие обязано открывать меню.
test('кнопка: «Вы подписаны» открывает меню, а не отписывает сразу', () => {
  assert.equal(followAction(toRelationship({ following: true })).kind, 'menu')
  assert.equal(followAction(toRelationship({ following: true, followed_by: true })).kind, 'menu')
  assert.equal(followAction(toRelationship({ following: true, followed_by: true })).label, 'Вы друзья')
})

test('кнопка: блокировка', () => {
  assert.equal(followAction(toRelationship({ blocked: true })).kind, 'unblock')
  assert.equal(followAction(toRelationship({ blocked_by: true })), null,
    'тот, кто заблокировал нас, не показывает кнопок')
  assert.equal(followAction(toRelationship({ is_self: true })), null,
    'на себя не подписываются')
})

// ─────────────────────────────────────────────────────────────────────────────
// ЗАКРЫТЫЙ АККАУНТ
// ─────────────────────────────────────────────────────────────────────────────

test('закрытый аккаунт без подписки заперт', () => {
  const locked = toRelationship({ target_is_private: true, can_view_content: false })
  assert.equal(isLocked(locked), true)
  assert.equal(canViewContent(locked), false)
})

test('одобренный подписчик закрытого аккаунта видит содержимое', () => {
  const open = toRelationship({ target_is_private: true, following: true, can_view_content: true })
  assert.equal(isLocked(open), false)
  assert.equal(canViewContent(open), true)
})

test('открытый аккаунт замка не показывает', () => {
  assert.equal(isLocked(toRelationship({ can_view_content: true })), false)
  assert.equal(isLocked(toRelationship({ is_self: true, target_is_private: true })), false,
    'свой закрытый аккаунт от себя не запирается')
})

// Просьба сама по себе НЕ даёт доступа — это главный инвариант закрытого
// аккаунта. Пока владелец не нажал «Принять», человек не подписчик.
test('отправленная просьба не открывает содержимое', () => {
  const requested = toRelationship({
    target_is_private: true, request_sent: true, can_view_content: false,
  })
  assert.equal(requested.following, false, 'просьба — не подписка')
  assert.equal(canViewContent(requested), false)
  assert.equal(canViewPost('followers', requested), false)
  assert.equal(canViewPost('public', requested), false, 'у закрытого аккаунта закрыт и public')
})

// ─────────────────────────────────────────────────────────────────────────────
// ПРАВА: только чтение серверного ответа
// ─────────────────────────────────────────────────────────────────────────────

test('взаимная подписка сама по себе не открывает ни переписки, ни дневника', () => {
  const mutual = toRelationship({
    following: true, followed_by: true,
    message_permission: 'denied', can_view_diary: false,
  })
  assert.equal(mutual.mutualFollow, true)
  assert.equal(canMessage(mutual), false, 'подписка не выписывает право писать')
  assert.equal(canViewDiary(mutual), false, 'дневник закрыт настройкой владельца')
})

test('право писать берётся у сервера, а не выводится из подписок', () => {
  const stranger = toRelationship({ message_permission: 'request', conversation: 'pending' })
  assert.equal(stranger.mutualFollow, false)
  assert.equal(canMessage(stranger), true)
  assert.equal(messageGoesToRequests(stranger), true, 'первое сообщение уходит в «Запросы»')

  const accepted = toRelationship({ message_permission: 'direct', conversation: 'accepted' })
  assert.equal(messageGoesToRequests(accepted), false)

  const denied = toRelationship({ message_permission: 'denied', conversation: 'declined' })
  assert.equal(canMessage(denied), false)
  assert.equal(messageGoesToRequests(denied), false, 'запрещённое сообщение никуда не уходит')
})

// Ограниченный (restrict) человек не должен ничего заметить: с его стороны
// право писать остаётся, меняется лишь то, куда попадает сообщение.
test('ограничение переводит переписку в «Запросы», не запрещая её', () => {
  const restricted = toRelationship({
    following: true, followed_by: true,
    message_permission: 'request', conversation: 'pending',
  })
  assert.equal(canMessage(restricted), true)
  assert.equal(messageGoesToRequests(restricted), true)
})

// База до 2026-09-09 новых полей не отдаёт: приложение обязано работать и на
// ней, иначе порядок выкладки становится критичным.
test('на старой базе право писать считается по прежнему правилу', () => {
  const mutual = toRelationship({ following: true, followed_by: true })
  assert.equal(canMessage(mutual), true)
  assert.equal(canViewDiary(mutual), true)
  assert.equal(mutual.canViewContent, true)
  const oneWay = toRelationship({ following: true })
  assert.equal(canMessage(oneWay), false)
})

test('старая база: булев can_message превращается в трёхзначное право', () => {
  assert.equal(toRelationship({ can_message: true, conversation: 'accepted' }).messagePermission, 'direct')
  assert.equal(toRelationship({ can_message: true, conversation: 'pending' }).messagePermission, 'request')
  assert.equal(toRelationship({ can_message: false }).messagePermission, 'denied')
})

test('подписка односторонняя: A→B не делает B→A', () => {
  const aSeesB = toRelationship({ following: true, followed_by: false })
  assert.equal(aSeesB.mutualFollow, false)
  const bSeesA = toRelationship({ following: false, followed_by: true })
  assert.equal(bSeesA.following, false)
  assert.equal(followAction(bSeesA).label, 'Подписаться в ответ')
})

test('подпись отношения отдаёт приоритет более сильной связи', () => {
  assert.equal(relationshipLabel(toRelationship({ following: true, followed_by: true })), 'Взаимная подписка')
  assert.equal(relationshipLabel(toRelationship({ following: true })), 'Вы подписаны')
  assert.equal(relationshipLabel(toRelationship({ followed_by: true })), 'Подписан на вас')
  assert.equal(relationshipLabel(toRelationship({ request_sent: true })), 'Запрос отправлен')
  assert.equal(relationshipLabel(toRelationship({ request_received: true })), 'Просится в подписчики')
  assert.equal(relationshipLabel(toRelationship({ blocked: true })), 'Заблокирован')
  assert.equal(relationshipLabel(toRelationship({})), null)
})

test('неизвестный уровень видимости не роняет подпись', () => {
  assert.equal(visibilityLabel('public'), 'Всем')
  assert.equal(visibilityLabel('close_friends'), 'Близким друзьям')
  assert.equal(visibilityLabel('чепуха'), 'Подписчикам')
})

// ─────────────────────────────────────────────────────────────────────────────
// МАТРИЦА ДОСТУПА — по одной проверке на клетку.
//
// Это зеркало серверных правил, и цена расхождения несимметрична: если модель
// строже сервера, человек не увидит своего; если мягче — интерфейс пообещает
// доступ, которого нет, и покажет пустоту вместо содержимого.
// ─────────────────────────────────────────────────────────────────────────────

const rel = (over = {}) => toRelationship({
  following: false, followed_by: false, blocked: false, blocked_by: false,
  can_view_content: true, ...over,
})

const STRANGER = rel()
const FOLLOWER = rel({ following: true })            // я подписан на него
const FOLLOWED_BY = rel({ followed_by: true })       // он подписан на меня
const FRIEND = rel({ following: true, followed_by: true })
const CLOSE = rel({ following: true, followed_by: true, is_close_friend: true })
const CLOSE_NOT_FOLLOWING = rel({ is_close_friend: true })
const I_BLOCKED = rel({ following: true, followed_by: true, blocked: true, can_view_content: false })
const THEY_BLOCKED = rel({ following: true, followed_by: true, blocked_by: true, can_view_content: false })

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

test('матрица: пост только друзьям (взаимная подписка)', () => {
  assert.equal(canViewPost('friends', STRANGER), false)
  assert.equal(canViewPost('friends', FOLLOWER), false, 'односторонняя подписка — не дружба')
  assert.equal(canViewPost('friends', FOLLOWED_BY), false)
  assert.equal(canViewPost('friends', FRIEND), true)
  assert.equal(canViewPost('friends', I_BLOCKED), false)
  assert.equal(canViewPost('friends', THEY_BLOCKED), false)
})

// Близкие друзья — НЕЗАВИСИМЫЙ круг, а не подмножество подписчиков. Автор
// ведёт список руками, и подписка для него не требуется ни в одну сторону.
test('матрица: пост близким друзьям', () => {
  assert.equal(canViewPost('close_friends', STRANGER), false)
  assert.equal(canViewPost('close_friends', FOLLOWER), false, 'подписка не делает близким другом')
  assert.equal(canViewPost('close_friends', FRIEND), false, 'взаимная подписка тоже не делает')
  assert.equal(canViewPost('close_friends', CLOSE), true)
  assert.equal(canViewPost('close_friends', CLOSE_NOT_FOLLOWING), true,
    'близкому другу подписка не нужна — список ведёт автор')
  assert.equal(canViewPost('close_friends', I_BLOCKED), false)
})

test('матрица: близкий друг не получает автоматически посты для подписчиков', () => {
  assert.equal(canViewPost('followers', CLOSE_NOT_FOLLOWING), false)
  assert.equal(canViewPost('friends', CLOSE_NOT_FOLLOWING), false)
})

test('матрица: приватный пост не виден никому, кроме автора', () => {
  for (const r of [STRANGER, FOLLOWER, FOLLOWED_BY, FRIEND, CLOSE]) {
    assert.equal(canViewPost('private', r), false)
  }
})

test('матрица: закрытый аккаунт перекрывает видимость записи', () => {
  const lockedPublic = rel({ target_is_private: true, can_view_content: false })
  assert.equal(canViewPost('public', lockedPublic), false)
  const approved = rel({ target_is_private: true, following: true, can_view_content: true })
  assert.equal(canViewPost('public', approved), true)
  assert.equal(canViewPost('followers', approved), true)
})

test('неизвестная видимость трактуется как самая узкая', () => {
  assert.equal(canViewPost('unlisted', FRIEND), false)
  assert.equal(canViewPost(undefined, FRIEND), false)
  assert.equal(canViewPost('public', null), false)
})

test('дневник, переписка и посты — три РАЗНЫХ вопроса', () => {
  // Подписчик видит мысли для подписчиков, но дневник — только если владелец
  // включил такой круг. Одним признаком эти три вопроса когда-то отвечались
  // разом, и повторять ту ошибку нельзя.
  const followerNoDiary = rel({ following: true, can_view_diary: false, message_permission: 'request' })
  assert.equal(canViewPost('followers', followerNoDiary), true)
  assert.equal(canViewDiary(followerNoDiary), false)
  assert.equal(canMessage(followerNoDiary), true)

  const strangerWithDiary = rel({ can_view_diary: true, message_permission: 'denied' })
  assert.equal(canViewPost('followers', strangerWithDiary), false)
  assert.equal(canViewDiary(strangerWithDiary), true, 'поимённый доступ подписки не требует')
  assert.equal(canMessage(strangerWithDiary), false)
})

// Списки значений — зеркала CHECK-ограничений в базе. Расхождение проявилось
// бы как «настройка сохраняется, но сервер отвечает 22023».
test('списки значений совпадают с серверными ограничениями', () => {
  assert.deepEqual(VISIBILITY.map((v) => v.value),
    ['public', 'followers', 'friends', 'close_friends', 'private'])
  assert.deepEqual(DIARY_AUDIENCES.map((v) => v.key),
    ['public', 'followers', 'mutuals', 'close_friends', 'selected', 'private'])
  assert.deepEqual(MESSAGE_POLICY.map((v) => v.value), ['direct', 'request', 'none'])
})
