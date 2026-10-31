// ─────────────────────────────────────────────────────────────────────────────
// Обучающие подсказки к скрытым жестам.
//
// Проблема, которую это решает: часть возможностей приложения не видна вовсе.
// Свайп между днями, свайп строки продукта влево/вправо, долгое нажатие для
// копирования — обо всём этом можно только догадаться. Люди не догадываются.
//
// Правила, чтобы подсказки не стали навязчивыми:
//   • одна подсказка за раз и не чаще, чем раз в сессию приложения;
//   • подсказка исчезает навсегда, как только человек сам сделал этот жест —
//     учить тому, что уже умеешь, оскорбительно;
//   • есть «Показать снова» в настройках: забыл — включил обратно.
//
// Состояние хранится в prefs (синхронизируется между устройствами): выучив
// жест на телефоне, человек не должен снова видеть подсказку на планшете.
// ─────────────────────────────────────────────────────────────────────────────

import { t } from './i18n.js'

export const TOUR_PREF = 'tourSeen' // prefs[TOUR_PREF] = { [id]: true }

export const TIPS = [
  {
    id: 'day-swipe',
    emoji: '👈',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    // Показываем только когда человеку уже есть что листать.
    when: ({ loggedDays }) => loggedDays >= 2,
  },
  {
    id: 'food-swipe',
    emoji: '↔️',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    when: ({ mealsToday }) => mealsToday >= 1,
  },
  {
    id: 'food-hold',
    emoji: '📋',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    when: ({ mealsToday }) => mealsToday >= 3,
  },
  {
    id: 'day-repeat',
    emoji: '♻️',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    when: ({ loggedDays }) => loggedDays >= 3,
  },
  {
    id: 'day-body',
    emoji: '⚖️',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    when: ({ loggedDays }) => loggedDays >= 2,
  },
  {
    id: 'day-skip',
    emoji: '🚫',
    get title() { return t(`tips.${this.id}.title`) },
    get text() { return t(`tips.${this.id}.text`) },
    when: ({ loggedDays }) => loggedDays >= 4,
  },
]

export const tipById = (id) => TIPS.find((tip) => tip.id === id) || null

function seenMap(prefs) {
  const raw = prefs?.[TOUR_PREF]
  return raw && typeof raw === 'object' ? raw : {}
}

export function isTipSeen(prefs, id) {
  return seenMap(prefs)[id] === true
}

// Следующая подсказка к показу: первая невиденная, чьё условие выполнено.
// Порядок в TIPS — это и есть порядок обучения: от самого нужного к деталям.
export function nextTip(prefs, facts = {}) {
  for (const tip of TIPS) {
    if (isTipSeen(prefs, tip.id)) continue
    if (tip.when && !tip.when(facts)) continue
    return tip
  }
  return null
}

// Пометить показанной (или освоенной — вызывается и при выполнении жеста).
export function markSeen(prefs, id) {
  return { ...seenMap(prefs), [id]: true }
}

// Сброс: «показать подсказки заново» в настройках.
export function resetTips() {
  return {}
}

export function seenCount(prefs) {
  return Object.values(seenMap(prefs)).filter(Boolean).length
}
