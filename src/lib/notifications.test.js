// Уведомления в окружении, где их нет.
//
// В обычном Safari на iPhone переменной Notification не существует вовсе: Web
// Notifications доступны только приложению, добавленному на главный экран
// (iOS 16.4+). Прямое обращение к Notification.permission бросало
// ReferenceError прямо в useEffect — React размонтировал всё дерево, и человек
// получал белый экран сразу после входа в аккаунт (у гостя без анкеты
// планировщик не запускался, поэтому «до входа» всё выглядело исправным).
//
// Эти тесты держат ровно тот случай: браузер без Notification обязан работать.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Браузер, где Notification нет — так выглядит Safari на iPhone.
function asIPhoneSafari() {
  globalThis.window = {}
  delete globalThis.Notification
}

// Браузер с уведомлениями. В настоящем браузере window.Notification и
// глобальный Notification — один и тот же объект, повторяем это точно.
function asBrowserWithNotifications(permission = 'default') {
  const N = { permission, requestPermission: async () => permission }
  globalThis.Notification = N
  globalThis.window = { Notification: N }
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}

asIPhoneSafari()
const {
  startScheduler, notifyIncomingMessage, notificationsSupported, notificationPermission,
  toggleFriendMuted, isFriendMuted, setActiveChat,
} = await import('./notifications.js')

afterEach(() => { store.clear() })

const PROFILE = { targets: { calories: 2000, protein: 100 } }
const getState = () => ({ profile: PROFILE, days: {} })

test('на iPhone без Notification планировщик не бросает и не запускается', () => {
  asIPhoneSafari()
  let stop
  assert.doesNotThrow(() => { stop = startScheduler(getState) }, 'именно здесь возникал белый экран')
  assert.equal(typeof stop, 'function', 'вызывающий всё равно получает функцию остановки')
  assert.doesNotThrow(() => stop())
})

test('на iPhone без Notification пуш о сообщении не бросает', () => {
  asIPhoneSafari()
  assert.doesNotThrow(() =>
    notifyIncomingMessage({ senderId: 'u2', senderName: 'Аня', unreadCount: 3, messageId: 'm1' }),
  )
})

test('признак поддержки и статус разрешения не бросают без Notification', () => {
  asIPhoneSafari()
  assert.equal(notificationsSupported(), false)
  assert.equal(notificationPermission(), 'unsupported')
})

test('в браузере с уведомлениями планировщик работает и останавливается', () => {
  asBrowserWithNotifications('default')
  const stop = startScheduler(getState)
  assert.equal(typeof stop, 'function')
  stop()
})

test('без выданного разрешения планировщик молчит и ничего не пишет в хранилище', () => {
  asBrowserWithNotifications('denied')
  const stop = startScheduler(getState)
  assert.equal(store.size, 0, 'отметки о показанных уведомлениях не появляются')
  stop()
})

test('пуш о сообщении не отправляется без разрешения', () => {
  asBrowserWithNotifications('denied')
  assert.doesNotThrow(() => notifyIncomingMessage({ senderId: 'u2', unreadCount: 1 }))
})

test('окружение без window (сервер, сборка) тоже переживается', () => {
  delete globalThis.window
  delete globalThis.Notification
  assert.equal(notificationsSupported(), false)
  assert.doesNotThrow(() => startScheduler(getState)())
  assert.doesNotThrow(() => notifyIncomingMessage({ senderId: 'x', unreadCount: 1 }))
})

// Кнопка «Заглушить» на экране друзей раньше меняла только иконку: список
// заглушённых лежал в компоненте и не читался никем. Уведомления от такого
// друга приходили как обычно — то есть интерфейс говорил неправду.
test('заглушённый собеседник не присылает пуш, остальные присылают', () => {
  const shown = []
  function N(title, options) { shown.push({ title, options }) }
  N.permission = 'granted'
  N.requestPermission = async () => 'granted'
  globalThis.Notification = N
  globalThis.window = { Notification: N }
  setActiveChat(null)

  notifyIncomingMessage({ senderId: 'u2', senderName: 'Аня', unreadCount: 1 })
  assert.equal(shown.length, 1, 'обычный собеседник — пуш приходит')

  toggleFriendMuted('u2')
  assert.equal(isFriendMuted('u2'), true)
  notifyIncomingMessage({ senderId: 'u2', senderName: 'Аня', unreadCount: 2 })
  assert.equal(shown.length, 1, 'от заглушённого пуша больше нет')

  notifyIncomingMessage({ senderId: 'u3', senderName: 'Борис', unreadCount: 1 })
  assert.equal(shown.length, 2, 'заглушение точечное, а не глобальное выключение')

  toggleFriendMuted('u2')
  assert.equal(isFriendMuted('u2'), false, 'повторное нажатие снимает заглушение')
  notifyIncomingMessage({ senderId: 'u2', senderName: 'Аня', unreadCount: 3 })
  assert.equal(shown.length, 3)
})
