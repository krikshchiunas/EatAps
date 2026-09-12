// Подписи количества и макронутриентов.
//
// Вынесено из foods.js отдельным модулем по одной причине: эти три функции
// нужны на ПЕРВОМ экране (дневник печатает «150 г · Б12 У30 Ж4»), а foods.js —
// это полуторатысячестрочный справочник продуктов. Пока они лежали вместе,
// ради трёх строчек форматирования в стартовую загрузку приезжали 152 КБ
// таблиц, которые нужны только на экране добавления еды.
//
// foods.js эти функции реэкспортирует, поэтому существующие импорты
// продолжают работать и менять их по всему проекту не потребовалось.

// Число в человеческом виде. Две вещи, которые здесь важны:
//   • десятичный разделитель. По-русски это запятая, а Number печатает точку;
//   • склонение. «1 порция», «2 порции», «5 порций», а любое дробное — всегда
//     «порции» (1,5 порции; 0,5 порции). Раньше дневник печатал «1.5 порция».
// Граммы, миллилитры и штуки не склоняются, поэтому таблица нужна только для
// порций — но проходить через эту функцию должны все, иначе разделитель снова
// разъедется.
const UNIT_FORMS = { 'порция': ['порция', 'порции', 'порций'] }

export function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return (Math.round(n * 100) / 100).toString().replace('.', ',')
}

export function amountLabel(value, unit = 'г') {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const forms = UNIT_FORMS[unit]
  if (!forms) return `${formatAmount(n)} ${unit}`
  // Дробное число — всегда родительный падеж единственного числа.
  if (!Number.isInteger(n)) return `${formatAmount(n)} ${forms[1]}`
  const mod10 = n % 10
  const mod100 = n % 100
  const form = mod10 === 1 && mod100 !== 11 ? forms[0]
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? forms[1]
      : forms[2]
  return `${n} ${form}`
}

// Единая подпись «Б… У… Ж…» для всего приложения.
//
// Неизвестное показываем прочерком, а не нулём и не пустотой. Пустота — это
// как раз то, что получалось раньше: в дневнике висела буква «Ж» без числа.
export function macroLabel(m) {
  const v = (x) => (x == null || !Number.isFinite(+x) ? '—' : +(+x).toFixed(1))
  return `Б${v(m?.protein)} У${v(m?.carbs)} Ж${v(m?.fat)}`
}

// Что остаётся в поле количества после ввода. Живёт здесь, а не в foods.js,
// по той же причине: функция чистая, справочник ей не нужен, а нужна она
// экранам, которые не должны тянуть полторы тысячи строк таблиц.
export function sanitizeAmount(raw) {
  const s = String(raw ?? '').replace(/[^\d.,]/g, '').replace(/,/g, '.')
  const dot = s.indexOf('.')
  if (dot === -1) return s
  // Вторая и последующие точки — уже не число: «1.2.3» превращается в «1.23».
  return s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
}

// ── Приёмы пищи ──────────────────────────────────────────────────────────────
// Здесь, а не в foods.js: этот список нужен meals.js, то есть стартовому графу.
export const MEAL_TYPES = [
  { key: 'breakfast', label: 'Завтрак', emoji: '🌅' },
  { key: 'lunch', label: 'Обед', emoji: '🥗' },
  { key: 'dinner', label: 'Ужин', emoji: '🌙' },
  { key: 'snack', label: 'Перекус', emoji: '🍎' },
]

export function mealMeta(type) {
  return MEAL_TYPES.find((m) => m.key === type) || MEAL_TYPES[3]
}

// ── Нормализация запроса ─────────────────────────────────────────────────────
// Нужна supplements.js, тоже стартовому модулю.
const DIACRITICS = /[̀-ͯ]/g

export function normalizeQuery(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я%.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
