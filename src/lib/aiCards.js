// ─────────────────────────────────────────────────────────────────────────────
// Карточка ассистента → запись дневника.
//
// Ассистент называет еду на языке ответа: «Haferflocken», «Oat milk»,
// «حليب الشوفان». Если это продукт каталога (точное совпадение с названием или
// синонимом на любом из языков, и ровно с одним продуктом), запись получает
// каноническое имя и стабильный id — и после смены языка показывается на новом
// языке, как любая запись из базы. Если нет — сохраняется так, как назвал
// ассистент: выдумать совпадение хуже, чем оставить название (см.
// matchCatalogFood в src/lib/search/index.js).
//
// Цифры (ккал, БЖУ, граммы) всегда берутся из карточки: ассистент считал
// конкретную порцию, а не 100 г из базы.
// ─────────────────────────────────────────────────────────────────────────────
import { FOODS } from './foods.js'
import { matchCatalogFood } from './search/index.js'
import { canonicalName } from './catalog.js'

const MAX_NAME = 80

export async function aiCardFood(card, fallbackName) {
  const original = String(card?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  if (!original) return { name: fallbackName }
  const id = await matchCatalogFood(original, FOODS)
  if (!id) return { name: original }
  return { name: canonicalName('foods', id), foodId: id, aiName: original }
}
