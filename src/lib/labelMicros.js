// ─────────────────────────────────────────────────────────────────────────────
// Витамины, минералы и прочие вещества С ЭТИКЕТКИ товара.
//
// У продукта базы состав по микронутриентам оценивается по его виду
// (foodMicros.js). У товара со штрихкода есть кое-что точнее — то, что
// заявил производитель: обогащённые хлопья, энергетик с кофеином и таурином,
// протеиновый батончик, минеральная вода. Здесь — как эти цифры получить из
// Open Food Facts, проверить на здравый смысл и пересчитать на порцию.
//
// Формат везде один: { ключ справочника: количество на 100 г/мл } в БАЗОВОЙ
// единице ключа (micronutrients.js): витамин C — мг, B12 — мкг, креатин — г.
// В записи дневника — то же, но уже на съеденную порцию (как kcal и protein).
// ─────────────────────────────────────────────────────────────────────────────
import { MICRONUTRIENTS, microDef } from './micronutrients.js'

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// Поле Open Food Facts → ключ справочника. Значения «_100g» база хранит в
// граммах (витамин C 60 мг — это 0.06), поэтому пересчёт — по единице ключа.
export const OFF_MICRO_MAP = {
  'vitamin-a': 'vitA', 'vitamin-d': 'vitD', 'vitamin-e': 'vitE', 'vitamin-k': 'vitK', 'vitamin-c': 'vitC',
  'vitamin-b1': 'b1', 'vitamin-b2': 'b2', 'vitamin-pp': 'b3', 'pantothenic-acid': 'b5', 'vitamin-b6': 'b6',
  biotin: 'b7', 'vitamin-b9': 'b9', folates: 'b9', 'vitamin-b12': 'b12', choline: 'choline',
  calcium: 'ca', phosphorus: 'p', magnesium: 'mg', potassium: 'k', sodium: 'na', iron: 'fe', zinc: 'zn',
  copper: 'cu', manganese: 'mn', selenium: 'se', iodine: 'i', chromium: 'cr', molybdenum: 'mo', fluoride: 'f',
  caffeine: 'caffeine', taurine: 'taurine', 'omega-3-fat': 'omega3', 'alpha-linolenic-acid': 'ala',
}

const FROM_GRAMS = { 'г': 1, 'мг': 1000, 'мкг': 1_000_000 }
// Больше этого на 100 г не бывает ни у одного вещества в этих единицах.
const HARD_MAX = { 'г': 100, 'мг': 100_000, 'мкг': 100_000_000, 'млрд КОЕ': 100_000 }

const round = (v) => {
  if (!(v > 0)) return 0
  // Три значащие цифры: 0.0004 мкг и 39 300 мг одинаково не врут.
  const p = Math.pow(10, Math.max(0, 2 - Math.floor(Math.log10(v))))
  return Math.round(v * p) / p
}

// Правдоподобно ли столько вещества на 100 г. Самая частая ошибка базы —
// миллиграммы, вписанные в поле «граммы»: витамин C «60» вместо «0.06» — это
// 60 000 мг на 100 г. Порог — 50 суточных норм на 100 г: обогащённые продукты
// дают от силы несколько норм, а ошибка единиц — в тысячу раз больше.
export function plausibleMicro(key, per100) {
  const def = microDef(key)
  if (!def || !(per100 > 0)) return false
  if (per100 > (HARD_MAX[def.unit] ?? 100_000)) return false
  const rda = def.rda?.male || def.rda?.female
  return !(rda > 0 && per100 > rda * 50)
}

// Вещества из записи Open Food Facts (nutriments) → { ключ: на 100 г }.
// Натрия нет, а соль есть — натрий из соли (соль = натрий × 2.5).
export function offMicros(nutriments) {
  const n = isObj(nutriments) ? nutriments : {}
  const out = {}
  for (const [field, key] of Object.entries(OFF_MICRO_MAP)) {
    if (out[key] != null) continue
    const g = Number(n[`${field}_100g`])
    if (!Number.isFinite(g) || g <= 0) continue
    const v = round(g * (FROM_GRAMS[microDef(key)?.unit] ?? 1))
    if (plausibleMicro(key, v)) out[key] = v
  }
  if (out.na == null) {
    const salt = Number(n.salt_100g)
    if (Number.isFinite(salt) && salt > 0) {
      const na = round((salt * 1000) / 2.5)
      if (plausibleMicro('na', na)) out.na = na
    }
  }
  return out
}

// Любой вход → чистый словарь: только ключи справочника, только
// правдоподобные положительные числа. Пусто — null, а не {}.
export function cleanMicros(raw) {
  if (!isObj(raw)) return null
  const out = {}
  for (const d of MICRONUTRIENTS) {
    const v = Number(raw[d.key])
    if (Number.isFinite(v) && v > 0 && v <= (HARD_MAX[d.unit] ?? 100_000)) out[d.key] = round(v)
  }
  return Object.keys(out).length ? out : null
}

// На порцию: k = граммы / 100.
export function scaleMicros(micros, k) {
  if (!isObj(micros) || !(k > 0)) return null
  const out = {}
  for (const [key, v] of Object.entries(micros)) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) out[key] = round(n * k)
  }
  return Object.keys(out).length ? out : null
}

export const microsCount = (m) => (isObj(m) ? Object.keys(m).length : 0)

// Отличаются ли два набора — для «было → стало». Шум округления не в счёт.
export function microsDiffer(a, b) {
  const x = isObj(a) ? a : {}
  const y = isObj(b) ? b : {}
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const k of keys) {
    const p = Number(x[k]) || 0
    const q = Number(y[k]) || 0
    if (Math.abs(p - q) > Math.max(p, q) * 0.03) return true
  }
  return false
}
