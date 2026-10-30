import { t, fmtDate, getLang } from './i18n.js'

export function keyOf(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key, delta) {
  const d = fromKey(key)
  d.setDate(d.getDate() + delta)
  return keyOf(d)
}

// Названия месяцев и дней недели — из Intl, а не из своих таблиц: он знает и
// падежи («30 октября»), и порядок слов («30 de octubre», «30. Oktober»).
export function humanDay(key, todayKey) {
  if (key === todayKey) return t('date.today')
  if (key === addDays(todayKey, -1)) return t('date.yesterday')
  if (key === addDays(todayKey, 1)) return t('date.tomorrow')
  return fmtDate(fromKey(key), { day: 'numeric', month: 'long' })
}

export function humanDow(key) {
  return fmtDate(fromKey(key), { weekday: 'long' })
}

// Месяц в именительном падеже, с заглавной: заголовок календаря.
export function monthName(m) {
  return cap(fmtDate(new Date(2000, m, 1), { month: 'long' }))
}

// Короткие дни недели с понедельника — шапка календаря. Арабские «короткие»
// названия совпадают с полными и в семь узких колонок не помещаются — там
// берём однобуквенные, как и принято в арабских календарях.
export function weekdaysShort() {
  const weekday = getLang() === 'ar' ? 'narrow' : 'short'
  // 1 января 2024 — понедельник.
  return Array.from({ length: 7 }, (_, i) => cap(fmtDate(new Date(2024, 0, 1 + i), { weekday })))
}

const cap = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1)
