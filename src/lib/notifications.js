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
async function show(title, body, tag) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const options = {
    body,
    icon: '/icon-192.png',
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
  if (localStorage.getItem(LS.lunch) === today) return
  show('EatAps', pickLunch(), 'eataps-lunch')
  localStorage.setItem(LS.lunch, today)
}

// Проверить сильный недобор (>35%) вечером. Окно 18:00–22:59.
// Показываем один раз в день. Профиль и день передаются актуальные из стора.
function maybeShowDeficit(profile, day) {
  if (!profile || !profile.targets) return
  const now = new Date()
  const hour = now.getHours()
  if (hour < 18 || hour >= 23) return
  const today = keyOf(now)
  if (localStorage.getItem(LS.deficit) === today) return

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
  localStorage.setItem(LS.deficit, today)
}

// Запустить фоновый планировщик. Возвращает функцию остановки.
// Пока приложение открыто, каждую минуту проверяет, не пора ли пушнуть.
export function startScheduler(getState) {
  const tick = () => {
    if (Notification.permission !== 'granted') return
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

// Показать уведомление о новом сообщении. Уникальный tag на каждое сообщение —
// чтобы новые не затирали старые в шторке уведомлений.
export function notifyIncomingMessage({ senderId, senderName, text, messageId }) {
  if (Notification.permission !== 'granted') return
  if (senderId && senderId === activeChatUserId) return
  const body = text?.trim()
    ? text.length > 120 ? text.slice(0, 117) + '…' : text
    : '📷 Фото'
  const tag = messageId ? `eataps-chat-${messageId}` : `eataps-chat-${Date.now()}`
  show(senderName || 'Новое сообщение', body, tag)
}
