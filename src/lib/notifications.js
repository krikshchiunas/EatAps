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

// ── Что именно человек разрешил показывать ───────────────────────────────────
// Зеркало настроек из prefs. Модульная переменная, как activeConversation ниже:
// решение «показывать или нет» принимается здесь, значит и знание о настройках
// должно жить здесь, а не растекаться по вызывающим.
//
// Типов пять — по числу того, что приложение действительно умеет доставлять:
// обед, недобор, сообщение, событие подписки и реакция на запись. Тумблера
// для того, чего нет, здесь не будет: переключатель, который ничего не
// выключает, хуже его отсутствия.
const notifPrefs = {
  lunch: true, deficit: true, messages: true, follows: true, reactions: true,
}

export function setNotificationPrefs(prefs) {
  // Значение по умолчанию — «включено»: у людей, которые ничего не настраивали,
  // поведение обязано остаться прежним.
  notifPrefs.lunch = prefs?.notifLunch !== false
  notifPrefs.deficit = prefs?.notifDeficit !== false
  notifPrefs.messages = prefs?.notifMessages !== false
  notifPrefs.follows = prefs?.notifFollows !== false
  notifPrefs.reactions = prefs?.notifReactions !== false
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
  if (!notifPrefs.lunch) return
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
  if (!notifPrefs.deficit) return
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

// Открытый прямо сейчас диалог. ChatScreen проставляет его id при открытии и
// сбрасывает при выходе: пуш о сообщении, которое человек видит на экране, —
// это шум. Держим и id диалога, и id собеседника: событие о личном сообщении
// приходит по человеку, о групповом — по диалогу.
let activeConversationId = null
let activePeerId = null

export function setActiveChat({ conversationId = null, peerId = null } = {}) {
  activeConversationId = conversationId || null
  activePeerId = peerId || null
}

// ── Заглушённые собеседники ──────────────────────────────────────────────────
//
// ИСТОЧНИК ИСТИНЫ — СЕРВЕР (таблица user_mutes). Раньше список лежал в
// localStorage, и это была вторая, независимая система: заглушив человека на
// телефоне, на ноутбуке вы продолжали получать от него уведомления, а сервер о
// заглушении не знал вовсе и слал события в колокольчик.
//
// Здесь остаётся КЭШ этого списка: решение «показывать пуш» принимается
// синхронно, в обработчике входящего сообщения, и ходить за ним в базу в этот
// момент нельзя. Кэш переживает перезапуск через localStorage — иначе первые
// секунды после старта приложение звенело бы от заглушённых.
const MUTED_KEY = 'eataps:mutes:messages'

let mutedSet = new Set(readMutedCache())

function readMutedCache() {
  try { return JSON.parse(localStorage.getItem(MUTED_KEY) || '[]') } catch { return [] }
}

// Обновление кэша с сервера. Зовётся приложением при входе и при изменении
// списка заглушённых.
export function setMutedMessageUsers(ids) {
  mutedSet = new Set((ids || []).filter(Boolean))
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedSet])) } catch {}
  return [...mutedSet]
}

export function getMutedMessageUsers() {
  return [...mutedSet]
}

export function isUserMuted(userId) {
  return Boolean(userId) && mutedSet.has(userId)
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
export function notifyIncomingMessage({ senderId, senderName, senderAvatar, unreadCount, messageId, conversationId = null, groupTitle = null }) {
  // Та же ловушка, что и в планировщике: на iPhone вне установленного
  // приложения Notification не существует, и прямое обращение роняет обработчик
  // входящего сообщения.
  if (notificationPermission() !== 'granted') return
  if (!notifPrefs.messages) return
  if (senderId && senderId === activePeerId) return
  if (conversationId && conversationId === activeConversationId) return
  if (isUserMuted(senderId)) return
  const n = Math.max(1, Number(unreadCount) || 1)
  const name = (senderName && senderName.trim()) || 'Пользователь'
  const word = pluralize(n, 'сообщение', 'сообщения', 'сообщений')
  // В группе важнее, КУДА написали: «Аня в „Беговой клуб“» отличает три
  // группы друг от друга, а просто «Аня» — нет.
  const body = groupTitle
    ? `${name} в «${groupTitle}»: ${n} ${word}`
    : `${name} отправил вам ${n} ${word}`
  const key = conversationId || senderId || messageId || Date.now()
  show('EatAps', body, `eataps-chat-${key}`, senderAvatar || null)
}

// Пуш о социальном событии: подписка, просьба, реакция, ответ.
//
// Раньше их не было вовсе — уведомление появлялось только в колокольчике
// внутри приложения. Тип события решает, каким переключателем он управляется:
// «подписки» и «реакции» — разные вещи, и человек должен иметь возможность
// выключить одно, не выключая другое.
const SOCIAL_TEXT = {
  FOLLOW:          (name) => `${name} подписался на вас`,
  FOLLOW_REQUEST:  (name) => `${name} просится к вам в подписчики`,
  FOLLOW_ACCEPTED: (name) => `${name} одобрил вашу заявку`,
  FRIEND_ACCEPTED: (name) => `${name} подписался в ответ`,
  POST_REACTION:   (name) => `${name} отреагировал на вашу мысль`,
  POST_COMMENT:    (name) => `${name} ответил на вашу мысль`,
  MESSAGE_REACTION:(name) => `${name} отреагировал на ваше сообщение`,
}

const SOCIAL_PREF = {
  FOLLOW: 'follows', FOLLOW_REQUEST: 'follows', FOLLOW_ACCEPTED: 'follows',
  FRIEND_ACCEPTED: 'follows',
  POST_REACTION: 'reactions', POST_COMMENT: 'reactions', MESSAGE_REACTION: 'reactions',
}

export function notifySocialEvent({ type, actorId, actorName, actorAvatar }) {
  if (notificationPermission() !== 'granted') return
  const pref = SOCIAL_PREF[type]
  if (!pref || !notifPrefs[pref]) return
  if (isUserMuted(actorId)) return
  const make = SOCIAL_TEXT[type]
  if (!make) return
  const name = (actorName && actorName.trim()) || 'Кто-то'
  // Один тег на тип и человека: три подписки подряд не должны выстроиться в
  // три плашки — обновляется одна.
  show('EatAps', make(name), `eataps-social-${type}-${actorId || 'x'}`, actorAvatar || null)
}
