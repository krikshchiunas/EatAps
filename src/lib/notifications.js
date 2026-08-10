// Локальные уведомления через Web Notifications API + Service Worker.
// Работают когда PWA установлена (Android всегда, iOS 16.4+ standalone).
// Расписание проверяется раз в минуту пока приложение открыто — если
// пользователь не заходил в 15:00, уведомление сработает при следующем открытии.

import { keyOf } from './date.js'
import { sumDay } from './nutrition.js'

// Юморные напоминания про обед. Показываются в 15:00, одно случайное на день.
export const LUNCH_MESSAGES = [
  'Ну что, чем сегодня заправлял организм?',
  'EatAps подозревает, что ты что-то вкусное съел. Подтверди наши подозрения.',
  'Не делай вид, что ты ничего не ел. Мы видели эти крошки.',
  'Твой желудок уже всё знает. Осталось рассказать EatAps.',
  'Твоя еда не должна просто исчезать в неизвестности.',
  'Организм получил обновление. Теперь обнови EatAps.',
  'Не оставляй свою еду без цифрового следа. Она старалась.',
  'Твой желудок просит занести данные. Он тоже хочет внимания.',
  'Что сегодня загрузил в себя? Нам нужна статистика.',
  'Пора раскрыть тайну сегодняшней тарелки.',
  'Не заставляй EatAps строить теории заговора о твоём обеде.',
  'Организм получил топливо. Теперь дай ему отчёт.',
  'Еда сама себя не запишет. К сожалению, технологии ещё не настолько наглые.',
  'Ну что, шеф, показывай меню сегодняшнего дня.',
  'Твоя еда уже закончила свой путь. Осталось оставить автограф в EatAps.',
  'Давай без секретов. Что сегодня отправилось в твой организм?',
  'Твой холодильник хранит тайны. Мы предлагаем добровольное признание.',
  'Еда была замечена. Теперь требуется официальная регистрация.',
  'Не потеряй важные данные между первым укусом и последним кусочком.',
  'Пора обновить историю питания. Твоя тарелка ждёт славы.',
]

const NUTRIENT_LABEL = {
  calories: 'калорий',
  protein: 'белка',
  fat: 'жиров',
  carbs: 'углеводов',
}

const LS = {
  lunch: 'eataps:notif:lunch',   // дата последнего показа обеденного пуша
  deficit: 'eataps:notif:deficit', // дата последнего пуша про недобор
}

// В приватном режиме iOS Safari (и при запрете сторонних данных) setItem
// бросает исключение. Планировщик ниже работает по таймеру раз в минуту, то
// есть необёрнутая запись означала бы ошибку каждую минуту. Отметка «сегодня
// уже показывали» тогда просто не сохраняется — уведомление может повториться,
// но приложение не ломается.
function readMark(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeMark(key, value) {
  try { localStorage.setItem(key, value) } catch {}
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission
}

// Спрашиваем разрешение у пользователя. Возвращает финальный статус.
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return 'denied'
  }
}

// Показываем уведомление через SW (надёжнее — работает даже когда вкладка не в фокусе).
async function show(title, body, tag, icon) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const options = {
    body,
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: false,
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, options)
      return
    }
  } catch {}
  try {
    new Notification(title, options)
  } catch {}
}

function pickLunch() {
  return LUNCH_MESSAGES[Math.floor(Math.random() * LUNCH_MESSAGES.length)]
}

// Проверить, надо ли сейчас показывать напоминание. Вызывается по таймеру.
// Показываем один раз в день, окно 15:00–17:59 (чтобы поймать пользователя,
// который зашёл позже 15:00).
function maybeShowLunch() {
  const now = new Date()
  const hour = now.getHours()
  if (hour < 15 || hour >= 18) return
  const today = keyOf(now)
  if (readMark(LS.lunch) === today) return
  show('EatAps', pickLunch(), 'eataps-lunch')
  writeMark(LS.lunch, today)
}

// Проверить сильный недобор (>35%) вечером. Окно 18:00–22:59.
// Показываем один раз в день. Профиль и день передаются актуальные из стора.
function maybeShowDeficit(profile, day) {
  if (!profile || !profile.targets) return
  const now = new Date()
  const hour = now.getHours()
  if (hour < 18 || hour >= 23) return
  const today = keyOf(now)
  if (readMark(LS.deficit) === today) return

  const meals = day?.meals || []
  const totals = sumDay(meals)
  const t = profile.targets

  const eaten = {
    calories: totals.kcal,
    protein: totals.protein,
    fat: totals.fat,
    carbs: totals.carbs,
  }

  const deficits = []
  for (const key of ['calories', 'protein', 'fat', 'carbs']) {
    const target = Number(t[key]) || 0
    if (target <= 0) continue
    const missing = (target - (eaten[key] || 0)) / target
    if (missing > 0.35) deficits.push(NUTRIENT_LABEL[key])
  }
  if (!deficits.length) return

  const body = `Сегодня сильно не хватает: ${deficits.join(', ')}. Ужин ещё впереди — успеешь.`
  show('Ты сильно недобираешь!', body, 'eataps-deficit')
  writeMark(LS.deficit, today)
}

// Запустить фоновый планировщик. Возвращает функцию остановки.
// Пока приложение открыто, каждую минуту проверяет, не пора ли пушнуть.
export function startScheduler(getState) {
  // В обычном Safari на iPhone переменной Notification не существует вовсе —
  // API доступен только в приложении, добавленном на главный экран (iOS 16.4+).
  // Обращение к Notification.permission напрямую бросало ReferenceError прямо
  // в useEffect, React размонтировал всё дерево, и человек видел белый экран.
  // Планировщик запускается только там, где уведомления в принципе есть.
  if (!notificationsSupported()) return () => {}

  const tick = () => {
    if (notificationPermission() !== 'granted') return
    const { profile, days } = getState() || {}
    const today = keyOf()
    const day = days?.[today]
    maybeShowLunch()
    maybeShowDeficit(profile, day)
  }
  tick() // сразу проверяем при старте, а не ждём минуту
  const id = setInterval(tick, 60_000)
  return () => clearInterval(id)
}

// Активный чат — ChatView.jsx проставляет id собеседника, когда открывает чат,
// и сбрасывает при выходе. Мы подавляем пуш только если пришло сообщение от
// того, с кем сейчас открыт диалог (тогда оно и так видно на экране).
let activeChatUserId = null
export function setActiveChat(userId) { activeChatUserId = userId || null }

// ── Заглушённые собеседники ──────────────────────────────────────────────────
// Список живёт здесь, а не на экране друзей: читать его должен тот, кто решает
// показывать пуш. Раньше он лежал в FriendsScreen и не читался вообще — кнопка
// «Заглушить» меняла только иконку, а уведомления приходили как обычно.
const MUTED_KEY = 'eataps:friends:muted'

export function getMutedFriends() {
  try { return JSON.parse(localStorage.getItem(MUTED_KEY) || '[]') } catch { return [] }
}

export function isFriendMuted(userId) {
  return !!userId && getMutedFriends().includes(userId)
}

function writeMuted(next) {
  try { localStorage.setItem(MUTED_KEY, JSON.stringify(next)) } catch {}
  return next
}

// Переключить и вернуть новый список — вызывающему не нужно перечитывать.
export function toggleFriendMuted(userId) {
  const arr = getMutedFriends()
  return writeMuted(arr.includes(userId) ? arr.filter((x) => x !== userId) : [...arr, userId])
}

// Друга удалили — забываем и его заглушение, иначе список копит id людей,
// которых давно нет, и растёт без предела.
export function forgetMutedFriend(userId) {
  return writeMuted(getMutedFriends().filter((x) => x !== userId))
}

// Русская плюрализация: 1 сообщение, 2 сообщения, 5 сообщений.
function pluralize(n, one, few, many) {
  const n100 = n % 100
  if (n100 >= 11 && n100 <= 14) return many
  const n10 = n % 10
  if (n10 === 1) return one
  if (n10 >= 2 && n10 <= 4) return few
  return many
}

// Пуш о новых сообщениях. Один тег на отправителя — при новом сообщении
// уведомление обновляется, счётчик растёт, а не появляется отдельная плашка.
// Заголовок всегда «EatAps», в теле — имя и число, иконка — аватарка отправителя.
export function notifyIncomingMessage({ senderId, senderName, senderAvatar, unreadCount, messageId }) {
  // Та же ловушка, что и в планировщике: на iPhone вне установленного
  // приложения Notification не существует, и прямое обращение роняет обработчик
  // входящего сообщения.
  if (notificationPermission() !== 'granted') return
  if (senderId && senderId === activeChatUserId) return
  if (isFriendMuted(senderId)) return
  const n = Math.max(1, Number(unreadCount) || 1)
  const name = (senderName && senderName.trim()) || 'Пользователь'
  const word = pluralize(n, 'сообщение', 'сообщения', 'сообщений')
  const body = `${name} отправил вам ${n} ${word}`
  const tag = senderId ? `eataps-chat-${senderId}` : `eataps-chat-${messageId || Date.now()}`
  show('EatAps', body, tag, senderAvatar || null)
}
