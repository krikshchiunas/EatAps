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

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

export function humanDay(key, todayKey) {
  if (key === todayKey) return 'Сегодня'
  if (key === addDays(todayKey, -1)) return 'Вчера'
  if (key === addDays(todayKey, 1)) return 'Завтра'
  const d = fromKey(key)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function humanDow(key) {
  return DOW[fromKey(key).getDay()]
}

export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
