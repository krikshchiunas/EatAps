import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toConversation, toMessage, isMuted, conversationPreview, toTotals,
  EMPTY_TOTALS, badgeText, QUICK_REACTIONS, DOUBLE_TAP_REACTION, MUTE_OPTIONS,
} from './conversationModel.js'

const ME = 'me-1'

test('пустой ответ не роняет модель', () => {
  assert.equal(toConversation(null), null)
  assert.equal(toMessage(undefined), null)
  assert.deepEqual(toTotals(null), EMPTY_TOTALS)
  assert.equal(isMuted(null), false)
})

// Имя диалога у группы и у личной переписки берётся из РАЗНЫХ полей. Пока
// выбор делал каждый экран сам, в списке показывалось одно, а в шапке чата
// другое.
test('имя диалога: у группы название, у личного — собеседник', () => {
  const group = toConversation({ id: 'c1', kind: 'group', title: 'Беговой клуб', members_count: 4 })
  assert.equal(group.title, 'Беговой клуб')
  assert.equal(group.peerId, null)
  assert.equal(group.membersCount, 4)

  const direct = toConversation({
    id: 'c2', kind: 'direct', peer_id: 'u2',
    peer_name: 'Аня', peer_username: 'anya', peer_avatar: 'a.jpg', peer_private: true,
  })
  assert.equal(direct.title, 'Аня')
  assert.equal(direct.avatarUrl, 'a.jpg')
  assert.equal(direct.peerId, 'u2')
  assert.equal(direct.peerPrivate, true)
})

test('без имени личный диалог подписывается ником', () => {
  const c = toConversation({ id: 'c3', kind: 'direct', peer_username: 'anya' })
  assert.equal(c.title, 'anya')
})

test('диалог без сообщений не выдумывает последнее', () => {
  const c = toConversation({ id: 'c4', kind: 'group', title: 'Пусто' })
  assert.equal(c.last, null)
  assert.equal(c.unread, 0)
  assert.equal(c.state, 'accepted', 'состояние по умолчанию — обычный чат')
})

// reactions приходит из базы как NULL, пока никто не реагировал. Спред
// `{ reactions: {}, ...row }` затирал бы значение по умолчанию этим NULL, и
// обработчик двойного тапа получал бы null вместо объекта.
test('сообщение всегда несёт объект реакций', () => {
  assert.deepEqual(toMessage({ id: 'm1', reactions: null }).reactions, {})
  assert.deepEqual(toMessage({ id: 'm2' }).reactions, {})
  assert.deepEqual(toMessage({ id: 'm3', reactions: { u1: '❤️' } }).reactions, { u1: '❤️' })
})

test('отозванное сообщение помечено явно', () => {
  assert.equal(toMessage({ id: 'm4', unsent_at: '2026-09-09T10:00:00Z' }).unsent, true)
  assert.equal(toMessage({ id: 'm5' }).unsent, false)
})

// Заглушение хранится МОМЕНТОМ окончания, а не флагом: «на 8 часов» иначе
// потребовало бы отдельного будильника, который однажды забудут завести.
test('заглушение истекает само', () => {
  const future = new Date(Date.now() + 3600_000).toISOString()
  const past = new Date(Date.now() - 3600_000).toISOString()
  assert.equal(isMuted({ mutedUntil: future }), true)
  assert.equal(isMuted({ mutedUntil: past }), false)
  assert.equal(isMuted({ mutedUntil: null }), false)
})

test('«навсегда» — это дата за пределами обозримого будущего', () => {
  const forever = MUTE_OPTIONS.find((o) => o.key === 'forever')
  assert.ok(forever.ms > 10 * 365 * 86400_000, 'иначе «навсегда» однажды истечёт')
  assert.equal(isMuted({ mutedUntil: new Date(Date.now() + forever.ms).toISOString() }), true)
})

// ─────────────────────────────────────────────────────────────────────────────
// Предпросмотр в списке — три вещи, которые он обязан различать
// ─────────────────────────────────────────────────────────────────────────────

const conv = (over = {}, last = {}) => toConversation({
  id: 'c', kind: 'direct', peer_id: 'u2', peer_name: 'Аня',
  last_id: 'm1', last_sender: 'u2', last_at: '2026-09-09T10:00:00Z',
  ...over, ...last,
})

test('предпросмотр: своё сообщение подписано «Вы»', () => {
  assert.equal(conversationPreview(conv({ last_sender: ME, last_text: 'ок' }), ME), 'Вы: ок')
  assert.equal(conversationPreview(conv({ last_text: 'ок' }), ME), 'ок')
})

// В группе отправителей много, и без имени строка «Привет» ничего не говорит
// о том, кто это написал.
test('предпросмотр: в группе видно, кто написал', () => {
  const g = conv({ kind: 'group', title: 'Клуб', last_sender: 'u3', last_sender_name: 'Борис', last_text: 'бегу' })
  assert.equal(conversationPreview(g, ME), 'Борис: бегу')
  const mine = conv({ kind: 'group', title: 'Клуб', last_sender: ME, last_sender_name: 'Я', last_text: 'ок' })
  assert.equal(conversationPreview(mine, ME), 'Вы: ок')
})

test('предпросмотр: род вложения назван словами', () => {
  assert.match(conversationPreview(conv({ last_image: 'a.jpg' }), ME), /Фото/)
  assert.match(conversationPreview(conv({ last_media: { kind: 'video' } }), ME), /Видео/)
  assert.match(conversationPreview(conv({ last_media: { kind: 'audio' } }), ME), /Голосовое/)
  assert.match(conversationPreview(conv({ last_meal: true }), ME), /Приём пищи/)
})

// Без этого в списке остаётся текст сообщения, которого у собеседника уже нет.
test('предпросмотр: отозванное сообщение не показывает текст', () => {
  const c = conv({ last_text: 'секрет', last_unsent: true })
  assert.equal(conversationPreview(c, ME), 'Сообщение удалено')
  assert.doesNotMatch(conversationPreview(c, ME), /секрет/)
})

test('предпросмотр: пустой диалог различает группу и личный', () => {
  assert.equal(conversationPreview(toConversation({ id: 'c', kind: 'group' }), ME), 'Группа создана')
  assert.equal(conversationPreview(toConversation({ id: 'c', kind: 'direct' }), ME), 'Нет сообщений')
})

// ─────────────────────────────────────────────────────────────────────────────
// Счётчики
// ─────────────────────────────────────────────────────────────────────────────

test('счётчики раскладываются из ответа сервера', () => {
  assert.deepEqual(
    toTotals({ messages: 3, message_requests: 1, follow_requests: 2, notifications: 7 }),
    { messages: 3, messageRequests: 1, followRequests: 2, notifications: 7 })
  assert.deepEqual(toTotals({}), EMPTY_TOTALS, 'отсутствующие поля — нули, а не undefined')
})

test('бейдж молчит на нуле и не растягивается на трёхзначных числах', () => {
  assert.equal(badgeText(0), null)
  assert.equal(badgeText(null), null)
  assert.equal(badgeText(-1), null)
  assert.equal(badgeText(7), '7')
  assert.equal(badgeText(99), '99')
  assert.equal(badgeText(127), '99+')
})

// Список реакций — зеркало проверки в set_message_reaction. Расхождение
// проявилось бы как «реакция ставится и тут же исчезает»: сервер отвечает
// 22023, а оптимистичное состояние уже нарисовано.
test('реакция двойного тапа входит в список быстрых', () => {
  assert.ok(QUICK_REACTIONS.includes(DOUBLE_TAP_REACTION))
  assert.equal(new Set(QUICK_REACTIONS).size, QUICK_REACTIONS.length, 'дублей в списке нет')
  assert.ok(QUICK_REACTIONS.includes('🥕'), 'морковка — «палец вверх» EatAps, её узнают')
})
