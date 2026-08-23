// Тесты разбора команд и кнопок модерации. Сеть и база не нужны: проверяем
// формат callback_data, список администраторов и сборку отчёта — то, где
// ошибка означала бы «бан ушёл не тому» или «бан может выдать посторонний».
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TG_ADMIN_CHAT_IDS = '111,222'
const { isAdmin, BAN_OPTIONS, banMenuKeyboard, banButtonKeyboard, formatReport } = await import('./_tg.js')

const UUID = '3f1c2b7a-9d4e-4c8b-8f1a-2b3c4d5e6f70'

test('банить может только администратор из списка', () => {
  assert.equal(isAdmin(111), true)
  assert.equal(isAdmin('222'), true, 'id из телеграма может прийти строкой')
  assert.equal(isAdmin(999), false, 'посторонний не должен получать права')
  assert.equal(isAdmin(undefined), false)
  assert.equal(isAdmin(null), false)
})

test('сроки бана: ровно те, что обещаны пользователю', () => {
  assert.deepEqual(BAN_OPTIONS.map((o) => o.label), ['24 часа', '7 дней', '30 дней', 'Навсегда'])
  assert.equal(BAN_OPTIONS.find((o) => o.code === '1d').minutes, 1440)
  assert.equal(BAN_OPTIONS.find((o) => o.code === '7d').minutes, 10080)
  assert.equal(BAN_OPTIONS.find((o) => o.code === '30d').minutes, 43200)
  assert.equal(BAN_OPTIONS.find((o) => o.code === 'inf').minutes, 0, '0 = навсегда')
})

test('callback_data укладывается в лимит телеграма (64 байта)', () => {
  const all = [
    ...banMenuKeyboard(UUID).inline_keyboard.flat(),
    ...banButtonKeyboard(UUID).inline_keyboard.flat(),
  ]
  assert.ok(all.length > 0)
  for (const btn of all) {
    const bytes = Buffer.byteLength(btn.callback_data, 'utf8')
    assert.ok(bytes <= 64, `«${btn.callback_data}» = ${bytes} байт, лимит 64`)
  }
})

test('разбор callback возвращает исходный UUID без потерь', () => {
  const btn = banMenuKeyboard(UUID).inline_keyboard[0][0]
  const [kind, code, userId] = btn.callback_data.split(':')
  assert.equal(kind, 'b')
  assert.equal(code, '1d')
  assert.equal(userId, UUID, 'UUID не должен обрезаться — иначе бан уйдёт не тому')
})

test('меню бана содержит все сроки и отмену', () => {
  const kb = banMenuKeyboard(UUID).inline_keyboard
  assert.equal(kb[0].length, 4, 'четыре срока в один ряд')
  assert.ok(kb[1][0].callback_data.startsWith('x:'), 'вторым рядом — отмена')
})

test('в отчёте всегда есть ник и ID автора', () => {
  const r = formatReport({ kind: 'support', publicId: 'AA000042', name: 'Денис', userId: UUID, text: 'не работает вход' })
  assert.ok(r.includes('AA000042'))
  assert.ok(r.includes('Денис'))
  assert.ok(r.includes(UUID))
  assert.ok(r.includes('не работает вход'))
  assert.ok(r.includes('Обращение в поддержку'))
})

test('отчёт без имени не ломается и помечает пропуск', () => {
  const r = formatReport({ kind: 'coach_application', publicId: null, name: null, userId: UUID, text: 'хочу быть тренером' })
  assert.ok(r.includes('без имени'))
  assert.ok(r.includes('—'), 'отсутствующий публичный ID показывается прочерком')
  assert.ok(r.includes('Заявка на роль тренера'))
})

test('разметка из текста пользователя не превращается в оформление', () => {
  // parse_mode не задаётся нигде, поэтому такой текст должен уехать как есть.
  const evil = '*жирный* _курсив_ [ссылка](http://зло) `код`'
  const r = formatReport({ kind: 'support', publicId: 'AA1', name: 'X', userId: UUID, text: evil })
  assert.ok(r.includes(evil), 'текст не должен экранироваться или обрезаться')
})
