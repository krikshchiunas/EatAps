// ─────────────────────────────────────────────────────────────────────────────
// «Штрихкод: помощь ИИ» — ИИ проверяет товар, найденный по штрихкоду, и
// исправляет ошибки базы (Carrot Premium).
//
// Здесь — чистая часть на клиенте: включена ли функция и как применить
// ответ сервера (api/ai/barcode.js) к товару. Решение «доступно или нет»
// продублировано на сервере: настоящая проверка тарифа — там, по базе.
//
// Правило применения простое: что ИИ подтвердил — остаётся, что исправил —
// меняется, и человек видит каждую правку со старым и новым числом и может
// вернуть как было. Ответ с низкой уверенностью не применяется вовсе:
// неуверенная правка опаснее, чем ошибка базы, которую видно и можно поправить.
// ─────────────────────────────────────────────────────────────────────────────
import { hasAIPremium } from './subscription.js'

// Ключ настройки в prefs (синхронизируется между устройствами).
export const BARCODE_AI_PREF = 'barcodeAI'

// Функция доступна тарифу и человеку с аккаунтом (ИИ ходит через сервер).
export const barcodeAIAvailable = (sub) => hasAIPremium(sub)

export function barcodeAIOn({ prefs, subscription, signedIn }) {
  return prefs?.[BARCODE_AI_PREF] === true && barcodeAIAvailable(subscription) && !!signedIn
}

const NUMERIC = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber']

// Отличается ли новое число настолько, чтобы считать это правкой. Шум
// округления («16.04» против «16») правкой не считаем: человек увидел бы
// «исправлено» там, где ничего не менялось.
function differs(from, to) {
  if (to == null) return false
  if (from == null) return true
  const a = Number(from)
  const b = Number(to)
  return Math.abs(a - b) > Math.max(0.5, Math.abs(a) * 0.02)
}

const portionOf = (food, label) => (food?.portions || []).find((p) => p.label === label)?.grams ?? null

// Порции товара с новыми весами. Подписи — каталожные «порция»/«пачка», как у
// lookupBarcode: переводятся на язык интерфейса.
function withPortions(food, serving, pack) {
  const rest = (food.portions || []).filter((p) => p.label !== 'порция' && p.label !== /* @i18n-data */ 'пачка')
  const out = []
  if (serving) out.push({ label: 'порция', grams: Math.round(serving) })
  if (pack && pack !== serving) out.push({ label: /* @i18n-data */ 'пачка', grams: Math.round(pack) })
  return [...out, ...rest]
}

// Товар + ответ проверки → { food, changes, applied }.
//   changes — [{ field, from, to, reason }] для показа «было → стало»;
//   applied — false, если проверку применять нельзя (низкая уверенность,
//             нечего проверять): тогда food — исходный товар.
export function applyCheck(food, check) {
  if (!food || !check) return { food, changes: [], applied: false }
  if (check.confidence === 'low' || check.status === 'unverifiable') return { food, changes: [], applied: false }

  const reasons = new Map((check.corrections || []).map((c) => [c.field, c.reason]))
  const next = { ...food }
  const changes = []

  for (const key of NUMERIC) {
    const to = check.per100?.[key]
    if (!differs(food[key], to)) continue
    changes.push({ field: key, from: food[key] ?? null, to, reason: reasons.get(key) || '' })
    next[key] = key === 'kcal' ? Math.round(to) : to
  }

  const unit = check.unit === 'ml' ? 'мл' : 'г'
  if ((food.unit || 'г') !== unit) {
    changes.push({ field: 'unit', from: food.unit || 'г', to: unit, reason: reasons.get('unit') || '' })
    next.unit = unit
  }

  const serving = portionOf(food, 'порция')
  const pack = portionOf(food, /* @i18n-data */ 'пачка') ?? portionOf(food, /* @i18n-data */ 'упаковка')
  const newServing = differs(serving, check.servingSize) ? check.servingSize : serving
  const newPack = differs(pack, check.packSize) ? check.packSize : pack
  if (newServing !== serving) changes.push({ field: 'servingSize', from: serving, to: newServing, reason: reasons.get('servingSize') || '' })
  if (newPack !== pack) changes.push({ field: 'packSize', from: pack, to: newPack, reason: reasons.get('packSize') || '' })
  if (newServing !== serving || newPack !== pack) {
    next.portions = withPortions(food, newServing, newPack)
    if (newServing) next.defaultGrams = Math.round(newServing)
  }

  if (check.name && check.name !== food.title) {
    const brand = food.brand || ''
    next.title = check.name
    next.name = brand && !check.name.toLowerCase().includes(brand.toLowerCase()) ? `${check.name} · ${brand}` : check.name
    changes.push({ field: 'name', from: food.name, to: next.name, reason: reasons.get('name') || '' })
  }

  // Цифры, подтверждённые или исправленные по этикетке, — это измерение, а не
  // оценка: сахар с таким происхождением считается измеренным (см. scale).
  if (changes.some((c) => c.field === 'sugar')) next.sugarSrc = 'measured'
  next.aiChecked = true
  return { food: next, changes, applied: true }
}

// Черновик своего продукта (товар без состава в базе) + ответ проверки, где
// ИИ прочитал цифры с фото этикетки → черновик с заполненными цифрами.
// Заполняем только пустое: что человек или база уже знают, ИИ не перетирает.
export function fillDraft(draft, check) {
  if (!draft || !check || check.confidence === 'low') return null
  const out = { ...draft }
  let filled = 0
  for (const key of NUMERIC) {
    const v = check.per100?.[key]
    if (v != null && (out[key] == null || out[key] === '')) { out[key] = v; filled++ }
  }
  if (!filled) return null
  // Этикетка надёжнее догадки по строке количества: «мл» на ней — значит напиток.
  if (check.unit === 'ml') out.unit = 'мл'
  if (check.servingSize && !out.portionGrams) out.portionGrams = check.servingSize
  if (check.packSize && !out.packGrams) out.packGrams = check.packSize
  if (check.name && !out.title) out.title = check.name
  return out
}

// Ответы проверки на время жизни вкладки: один и тот же товар, отсканированный
// ещё раз, не проверяется заново — ни ожидания, ни лишних денег.
const CACHE = new Map()
const CACHE_MAX = 60

export function cachedCheck(code, lang) {
  return CACHE.get(`${lang}|${code}`) || null
}

export function rememberCheck(code, lang, check) {
  if (CACHE.size >= CACHE_MAX) CACHE.clear()
  CACHE.set(`${lang}|${code}`, check)
}
