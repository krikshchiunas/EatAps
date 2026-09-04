// ─────────────────────────────────────────────────────────────────────────────
// Стек добавок и записи о приёме.
//
// Две разные сущности, которые легко перепутать, а путать нельзя:
//
//   СТЕК (state.supplements) — «что я пью вообще». Список, собранный руками:
//     креатин 5 г, витамин D 2000 МЕ, магний на ночь. Он не про сегодня.
//
//   ПРИЁМ (day.supps) — «что я выпил в этот день». Именно он идёт в счёт
//     микронутриентов и именно он отвечает на вопрос «я сегодня креатин пил
//     или забыл?».
//
// Стек нужен ровно затем, чтобы приём отмечался одним касанием, а не
// собирался заново каждое утро. Галочка в стеке = запись приёма за день.
//
// Здесь же — нормализация обеих форм. Она нужна на входе в состояние, а не в
// интерфейсе: в блоб прилетает всё что угодно (старая версия приложения, чужое
// устройство, повреждённый кэш), и запись с дозой «-5» или составом
// { чтоугодно: 'много' } не должна доживать до расчёта.
// ─────────────────────────────────────────────────────────────────────────────

import { MICRO_BY_KEY } from './micronutrients.js'
import { normalizeName } from './text.js'

// Предел размера стека — как у избранного: список, который человек ведёт
// руками, не бывает бесконечным, а безлимитный список молча раздувает блоб
// состояния, который целиком гоняется по сети при каждой синхронизации.
export const MAX_STACK = 40

// Разумные границы дозы. Верхняя не «запрет», а защита от опечатки в разряде:
// 500 капсул за раз — это промах по клавише, а не приём.
const MAX_DOSE = 1000
const MAX_PROVIDE = 1e6

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanProvides(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key in raw) {
    if (!MICRO_BY_KEY[key]) continue // чужой ключ — приложению его не показать
    const n = Number(raw[key])
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PROVIDE) continue
    out[key] = Math.round(n * 1000) / 1000
  }
  return out
}

function cleanDose(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_DOSE) return null
  return Math.round(n * 100) / 100
}

// ── Запись о приёме (day.supps) ──────────────────────────────────────────────
// Состав хранится уже умноженным на дозу — снимком, как у продуктов. Запись
// без единого вещества всё равно принимается: «выпил витамины» без состава —
// это по-прежнему факт приёма, и терять его нельзя. А вот без имени записи не
// бывает: показать её будет нечем.
export function normalizeSuppEntry(raw) {
  const name = str(raw?.name, 60)
  if (!name) return null
  const dose = cleanDose(raw?.dose)
  return {
    suppId: raw?.suppId ? str(raw.suppId, 40) : null,
    name,
    emoji: str(raw?.emoji, 8) || '💊',
    unit: str(raw?.unit, 20) || 'шт',
    dose: dose ?? 1,
    provides: cleanProvides(raw?.provides),
  }
}

// ── Элемент стека (state.supplements) ────────────────────────────────────────
// Отличается от приёма тем, что хранит состав НА ОДНУ ЕДИНИЦУ и привычную дозу
// отдельно. Так «пью 2 капсулы» остаётся редактируемым: поменяв дозу, человек
// не должен пересчитывать состав руками.
export function normalizeStackItem(raw) {
  const name = str(raw?.name, 60)
  if (!name) return null
  const provides = cleanProvides(raw?.provides)
  return {
    suppId: raw?.suppId ? str(raw.suppId, 40) : null,
    name,
    emoji: str(raw?.emoji, 8) || '💊',
    unit: str(raw?.unit, 20) || 'шт',
    dose: cleanDose(raw?.dose) ?? 1,
    provides,
    // Своя добавка (не из каталога) — помечаем, чтобы интерфейс мог дать её
    // отредактировать, а каталожную — нет.
    custom: raw?.custom === true || !raw?.suppId,
  }
}

// Из каталожной добавки — элемент стека.
export function stackItemFromSupplement(supp, dose = null) {
  if (!supp?.name) return null
  return normalizeStackItem({
    suppId: supp.id || null,
    name: supp.name,
    emoji: supp.emoji,
    unit: supp.unit,
    dose: dose ?? supp.defaultDose ?? 1,
    provides: supp.provides,
    custom: !supp.id,
  })
}

// Из элемента стека — запись о приёме за день. Состав умножается на дозу
// ровно здесь, один раз.
export function suppEntryFromStack(item, dose = null) {
  if (!item?.name) return null
  const amount = cleanDose(dose ?? item.dose) ?? 1
  const provides = {}
  for (const key in item.provides || {}) {
    const v = item.provides[key] * amount
    if (v > 0) provides[key] = Math.round(v * 1000) / 1000
  }
  return normalizeSuppEntry({
    suppId: item.suppId || null,
    name: item.name,
    emoji: item.emoji,
    unit: item.unit,
    dose: amount,
    provides,
  })
}

// Состав ОДНОЙ единицы из записи о приёме — обратная операция к
// suppEntryFromStack.
//
// В записи состав хранится уже умноженным на дозу (снимком, как у продуктов), а
// стек и правка дозы работают от состава единицы. Без обратного деления
// «3 таблетки по 200 мг» превращались в стеке в «1 таблетку по 600», и первая
// же галочка записывала втрое больше, чем человек выпил.
export function perUnitOf(entry) {
  const prev = Number(entry?.dose) || 1
  const out = {}
  for (const key in entry?.provides || {}) {
    const v = entry.provides[key] / prev
    if (v > 0) out[key] = Math.round(v * 1000) / 1000
  }
  return out
}

// Куда класть добавку в стеке: править существующую строку или заводить новую.
//
// Решение вынесено сюда из стора нарочно. Во-первых, его нельзя принимать
// внутри колбэка setState — React вызывает его позже и в StrictMode дважды, и
// ответ «не влезло» до вызывающего не доезжает. Во-вторых, здесь его можно
// проверить тестом, а в сторе — нет.
//
// Возвращает { existing, full }:
//   existing — строка стека, которую надо перезаписать (или null);
//   full     — места нет и новую строку заводить нельзя.
export function findStackSlot(list, item, id = null, max = MAX_STACK) {
  const rows = Array.isArray(list) ? list : []
  // Пришли с id — правим именно ту строку. Иначе ищем такую же добавку по
  // ключу: одна и та же банка не должна попадать в стек дважды.
  const existing = id
    ? rows.find((x) => x.id === id) || null
    : rows.find((x) => stackKey(x) === stackKey(item)) || null
  return { existing, full: !existing && rows.length >= max }
}

// ── Сопоставление стека и дня ────────────────────────────────────────────────
// Ключ — id из каталога, а для своих добавок нормализованное имя. По одному
// имени сравнивать нельзя: «Магний» и «магний» — это одна добавка, и человек
// не должен видеть в стеке две галочки вместо одной.
export function stackKey(x) {
  return x?.suppId ? `id:${x.suppId}` : `nm:${normalizeName(x?.name)}`
}

// Что из стека уже отмечено в этом дне. Возвращает Map ключ → запись дня,
// чтобы галочку можно было и поставить, и снять.
export function takenMap(day) {
  const map = new Map()
  for (const e of day?.supps || []) {
    const key = stackKey(e)
    // Если добавка принята дважды за день (утром и вечером), в карте остаётся
    // ПЕРВАЯ запись: снятие галочки убирает один приём, а не весь день сразу.
    if (!map.has(key)) map.set(key, e)
  }
  return map
}

// Сколько раз добавка принята за день — для подписи «2 раза» у галочки.
export function takenCount(day, item) {
  const key = stackKey(item)
  let n = 0
  for (const e of day?.supps || []) if (stackKey(e) === key) n += 1
  return n
}

// Вещества, которые человеку вообще интересны: всё, что есть в его стеке.
// По этому набору свод решает, показывать ли строку креатина или ашваганды —
// см. buildMicroSummary({ stackKeys }).
export function stackMicroKeys(stack = []) {
  const keys = new Set()
  for (const item of stack) for (const key in item?.provides || {}) keys.add(key)
  return keys
}

// Всё, что принято за день, одной суммой по веществам — без учёта еды.
// Нужно карточке «сегодня выпито», где еда как раз не при чём.
export function suppTotals(day) {
  const out = {}
  for (const e of day?.supps || []) {
    for (const key in e?.provides || {}) out[key] = (out[key] || 0) + e.provides[key]
  }
  return out
}
