// ─────────────────────────────────────────────────────────────────────────────
// Карточки еды от ассистента: проверка перед показом и записью в дневник.
//
// Модель оценивает КБЖУ сама, и ошибается она не только «немного»: бывает,
// что белка в карточке больше, чем весит вся порция, или что белок, жиры и
// углеводы вместе дают вдвое больше энергии, чем написано в ккал. Такая
// карточка — не оценка, а сбой, и записывать её в дневник нельзя: потом она
// неделями тянет вверх белок в статистике.
//
// Правило простое: всё, что противоречит физике, отбрасываем целиком, а не
// чиним. Подправить одну цифру значило бы угадывать, какая из них неверна.
// Обычную неточность оценки (±10–20%) не трогаем — её видно по пометке
// «примерно» на карточке.
// ─────────────────────────────────────────────────────────────────────────────

// Типы, которые понимает разбор качества белка (nutritionClassification.js).
export const CARD_CATS = new Set([
  'meat', 'poultry', 'fish', 'sea', 'egg', 'dairy', 'cheese', 'legume', 'grain',
  'bread', 'pasta', 'veg', 'fruit', 'nut', 'sweet', 'drink', 'dish', 'supp',
])
const MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snack'])
const CONFIDENCE = new Set(['high', 'medium', 'low'])

const nonNeg = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

// null — карточку показывать нельзя.
export function sanitizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim().slice(0, 80)
  const kcal = nonNeg(raw.kcal)
  if (!name || kcal == null) return null
  const protein = nonNeg(raw.protein) ?? 0
  const fat = nonNeg(raw.fat) ?? 0
  const carbs = nonNeg(raw.carbs) ?? 0
  const g = Number(raw.grams)
  const grams = Number.isFinite(g) && g > 0 ? Math.round(g) : null

  // Белок, жиры и углеводы — часть массы порции, больше неё их быть не может.
  // Запас в 5% и 2 г — на округление до целых.
  if (grams != null && protein + fat + carbs > grams * 1.05 + 2) return null
  // Калорийнее чистого жира (9 ккал/г) еды не бывает.
  if (grams != null && kcal > grams * 9.2 + 10) return null
  // Энергия из БЖУ не может сильно превышать заявленную: это значит, что
  // макросы раздуты (чаще всего — белок). Обратное законно: спирт даёт
  // калории, которых в БЖУ нет.
  const fromMacros = protein * 4 + fat * 9 + carbs * 4
  // Запас на клетчатку (её считают в углеводах, а энергии она даёт вдвое меньше)
  // и на округление.
  if (fromMacros > kcal * 1.25 + 25) return null

  const card = { name, grams, kcal, protein, fat, carbs }
  if (CARD_CATS.has(raw.cat)) card.cat = raw.cat
  if (MEALS.has(raw.meal)) card.meal = raw.meal
  if (CONFIDENCE.has(raw.confidence)) card.confidence = raw.confidence
  return card
}

// Возвращает проверенные карточки и число отброшенных: о них человеку надо
// сказать, иначе «ассистент обещал карточку, а её нет» выглядит как сбой.
export function sanitizeCards(list) {
  const src = Array.isArray(list) ? list : []
  const cards = src.map(sanitizeCard).filter(Boolean)
  return { cards, dropped: src.length - cards.length }
}
