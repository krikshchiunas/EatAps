// ─────────────────────────────────────────────────────────────────────────────
// «Мои продукты» — то, что человек покупает: конкретная пачка с полки.
//
// Чем это отличается от остального, что уже есть:
//   • продукт базы («Сыр Гауда») — усреднённый справочный образец. Цифры у него
//     честные, но чужие: у Гауды из соседнего магазина жирность другая;
//   • «Моё» (customFoods) — то, что человек собрал или ввёл сам: своё блюдо,
//     бутерброд из конструктора, домашний лимонад;
//   • МОЙ ПРОДУКТ — товар с этикеткой: название, бренд, цифры с упаковки,
//     штрихкод, вес пачки. И, главное, ссылка на продукт базы, вариантом
//     которого он является (baseId): «Гауда 45% · Ламбер» — это сыр Гауда.
//
// Ссылка на базу и делает раздел полезным в ингредиентах: в рецепт кладут либо
// «просто сыр Гауда», либо именно свой — и между ними можно переключиться, не
// теряя вес (см. RecipeEditorSheet). Она же даёт поиску названия продукта базы
// на всех семи языках: свой «Ламбер» находится и по «сыр», и по «gouda».
//
// Значения хранятся НА 100 г/мл — как у продуктов базы, — поэтому мой продукт
// проходит через тот же экран количества, что и всё остальное.
//
// Модуль чистый: состояние на вход, новое состояние на выход. Хранение,
// метки времени и тумбстоуны — в сторе и syncModel.js.
// ─────────────────────────────────────────────────────────────────────────────
import { isCatalogId } from './catalog.js'
import { normalizeName } from './text.js'

// Своих продуктов у человека — десятки. Потолок защищает размер состояния
// (оно целиком ездит в облако одним блобом), а не ограничивает обычную жизнь.
export const MAX_PRODUCTS = 300

const NAME_MAX = 80
const BRAND_MAX = 60
const PHOTO_MAX = 600

// Подписи порций с упаковки — канонические названия из каталога порций
// (portion_serving, portion_pack): portionLabel переводит их на язык человека.
// «упаковка» — так их раньше писал lookupBarcode; читаем и её.
const PORTION_SERVING = 'порция'
const PORTION_PACK = /* @i18n-data */ 'пачка'
const PORTION_PACK_OLD = /* @i18n-data */ 'упаковка'

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

// Число в пределах или null. Пустое — это «не знаю», а не ноль: ноль, записанный
// вместо пробела, стал бы неотличим от измеренного (у масла сахара и правда нет).
function numIn(v, min, max, digits = 1) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) return null
  const k = 10 ** digits
  return Math.round(n * k) / k
}

function text(v, max) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

// ── Штрихкод ─────────────────────────────────────────────────────────────────

// Только цифры и только длины, которые печатают на продуктах: EAN-8, UPC-A,
// EAN-13 и GTIN-14 (коробка). Всё остальное — не штрихкод товара.
export function cleanBarcode(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  return /^(\d{8}|\d{12,14})$/.test(d) ? d : ''
}

// Один и тот же товар записывают то 12 цифрами (UPC-A), то 13 с ведущим нулём,
// то 14 (GTIN). Стандарт GS1 сводит их к одному виду — дополнить нулями слева
// до 14 знаков. EAN-8 при этом не сталкивается с EAN-13: префикс 00000 в EAN-13
// зарезервирован ровно под такую запись коротких кодов.
export function gtin14(code) {
  const d = cleanBarcode(code)
  return d ? d.padStart(14, '0') : ''
}

export function sameBarcode(a, b) {
  const x = gtin14(a)
  return x !== '' && x === gtin14(b)
}

export function findProductByBarcode(products, code) {
  const key = gtin14(code)
  if (!key) return null
  for (const p of products || []) {
    if (isObj(p) && p.barcode && gtin14(p.barcode) === key) return p
  }
  return null
}

// ── Название ─────────────────────────────────────────────────────────────────

// «Гауда 45%» + «Ламбер» → «Гауда 45% · Ламбер». Бренд, уже вписанный в
// название, второй раз не дописываем: «Простоквашино молоко · Простоквашино».
export function productLabel(p) {
  const name = text(p?.name, NAME_MAX)
  const brand = text(p?.brand, BRAND_MAX)
  if (!brand) return name
  if (!name) return brand
  return normalizeName(name).includes(normalizeName(brand)) ? name : `${name} · ${brand}`
}

// Название с полки «Сыр Гауда 45% · Ламбер» (так его пишет lookupBarcode) →
// отдельно название и бренд: в форме это два поля.
export function splitBrand(label) {
  const s = text(label, NAME_MAX + BRAND_MAX + 3)
  const i = s.lastIndexOf(' · ')
  if (i <= 0) return { name: s.slice(0, NAME_MAX), brand: '' }
  return { name: s.slice(0, i).slice(0, NAME_MAX), brand: s.slice(i + 3).slice(0, BRAND_MAX) }
}

// ── Нормализация ─────────────────────────────────────────────────────────────

// Любой вход → рабочий продукт или null. Никогда не бросает: продукт приходит
// и из формы, и из облака, и из старой версии приложения.
// id, updatedAt и createdAt не трогаем — ими заведуют стор и синхронизация.
export function normalizeProduct(raw) {
  if (!isObj(raw)) return null
  const name = text(raw.name, NAME_MAX)
  if (!name) return null
  const kcal = numIn(raw.kcal, 0, 900, 0)
  if (kcal == null) return null

  const out = {
    name,
    emoji: text(raw.emoji, 8) || '🛒',
    unit: raw.unit === 'мл' ? 'мл' : 'г',
    kcal,
    // БЖУ: null — «не указано на этикетке», и так и показывается («—»).
    protein: numIn(raw.protein, 0, 100),
    carbs: numIn(raw.carbs, 0, 100),
    fat: numIn(raw.fat, 0, 100),
  }
  if (raw.id != null) out.id = String(raw.id)
  if (raw.updatedAt) out.updatedAt = raw.updatedAt
  if (typeof raw.createdAt === 'string') out.createdAt = raw.createdAt

  const brand = text(raw.brand, BRAND_MAX)
  if (brand) out.brand = brand
  for (const key of ['sugar', 'satFat', 'fiber']) {
    const v = numIn(raw[key], 0, 100)
    if (v != null) out[key] = v
  }
  if (typeof raw.cat === 'string' && /^[a-z0-9_]{1,20}$/.test(raw.cat)) out.cat = raw.cat
  // Ссылка — только на то, что в каталоге есть. Мусорный id превратил бы
  // переключатель «мой ↔ обычный» в кнопку, ведущую в никуда.
  if (isCatalogId('foods', raw.baseId)) out.baseId = raw.baseId
  const barcode = cleanBarcode(raw.barcode)
  if (barcode) out.barcode = barcode
  const pack = numIn(raw.packGrams, 1, 10000, 0)
  if (pack != null) out.packGrams = pack
  const portion = numIn(raw.portionGrams, 1, 5000, 0)
  if (portion != null) out.portionGrams = portion
  // Фото упаковки — только по https: в состоянии не должно оказаться ни data:
  // на мегабайт, ни javascript:.
  if (typeof raw.photo === 'string' && /^https:\/\/\S+$/.test(raw.photo) && raw.photo.length <= PHOTO_MAX) {
    out.photo = raw.photo
  }
  return out
}

// ── Мой продукт как еда ──────────────────────────────────────────────────────

// Продукт → запись того же вида, что продукты базы (на 100 г/мл): по ней
// работают поиск, экран количества, избранное, рецепты и конструктор.
//
// source: 'product' — не 'custom': поиск ищет мой продукт ещё и по названиям
// продукта базы (см. productEntity в search/index.js), а своё блюдо — нет.
export function productAsFood(p) {
  const clean = normalizeProduct(p)
  if (!clean) return null
  const food = {
    name: productLabel(clean),
    emoji: clean.emoji,
    unit: clean.unit,
    kcal: clean.kcal,
    protein: clean.protein,
    carbs: clean.carbs,
    fat: clean.fat,
    source: 'product',
    productId: clean.id ?? null,
  }
  for (const key of ['sugar', 'satFat', 'fiber', 'cat', 'baseId', 'barcode', 'photo']) {
    if (clean[key] != null) food[key] = clean[key]
  }
  if (clean.brand) food.brand = clean.brand
  // Порции с упаковки идут первыми в подсказках количества: они точнее любой
  // усреднённой «тарелки». Подписи — каталожные порции, они переводятся.
  const portions = []
  if (clean.portionGrams) portions.push({ label: PORTION_SERVING, grams: clean.portionGrams })
  if (clean.packGrams && clean.packGrams !== clean.portionGrams) portions.push({ label: PORTION_PACK, grams: clean.packGrams })
  if (portions.length) food.portions = portions
  // Что подставить в поле количества: порция с упаковки, маленькая пачка
  // целиком (её обычно и съедают), иначе — решит экран количества.
  const def = clean.portionGrams || (clean.packGrams && clean.packGrams <= 500 ? clean.packGrams : null)
  if (def) food.defaultGrams = def
  return food
}

export function productsAsFoods(products) {
  const out = []
  for (const p of products || []) {
    const f = productAsFood(p)
    if (f) out.push(f)
  }
  return out
}

// Мои продукты, которые являются вариантом продукта базы baseId.
export function productsForBase(products, baseId) {
  if (!baseId) return []
  return (products || []).filter((p) => isObj(p) && p.baseId === baseId)
}

export function productById(products, id) {
  if (id == null) return null
  return (products || []).find((p) => isObj(p) && p.id === id) || null
}

// ── Черновик из найденного товара ────────────────────────────────────────────

// Товар со штрихкода (или любой продукт с экрана количества) → черновик формы.
// Цифры переносим как есть, неизвестное остаётся пустым — додумывать нельзя.
export function productDraftFrom(food, extra = {}) {
  const src = isObj(food) ? food : {}
  const split = src.brand != null
    ? { name: text(src.title || src.name, NAME_MAX), brand: text(src.brand, BRAND_MAX) }
    : splitBrand(src.name)
  // Бренд, уже стоящий в конце названия через «·», в название не возвращаем.
  const name = split.brand && split.name.endsWith(` · ${split.brand}`)
    ? split.name.slice(0, -(split.brand.length + 3))
    : split.name
  const draft = {
    name,
    brand: split.brand,
    emoji: src.emoji && src.emoji !== '🛒' && src.emoji !== '🥤' ? src.emoji : '',
    unit: src.unit === 'мл' ? 'мл' : 'г',
    kcal: src.kcal ?? null,
    protein: src.protein ?? null,
    carbs: src.carbs ?? null,
    fat: src.fat ?? null,
    sugar: src.sugar ?? null,
    satFat: src.satFat ?? null,
    fiber: src.fiber ?? null,
    cat: src.cat || null,
    baseId: isCatalogId('foods', src.baseId) ? src.baseId : isCatalogId('foods', src.foodId) ? src.foodId : null,
    barcode: cleanBarcode(src.barcode),
    photo: src.photo || null,
    // Черновик может прийти уже разобранным (повторный разбор не должен
    // ничего терять) — тогда вес пачки и порции лежат в своих полях.
    packGrams: src.packGrams ?? null,
    portionGrams: src.portionGrams ?? null,
  }
  for (const p of src.portions || []) {
    if (p?.label === PORTION_SERVING && !draft.portionGrams) draft.portionGrams = p.grams
    if ((p?.label === PORTION_PACK || p?.label === PORTION_PACK_OLD) && !draft.packGrams) draft.packGrams = p.grams
  }
  return { ...draft, ...extra }
}

// ── Запись в список ──────────────────────────────────────────────────────────

// Вставка или правка. Правило дублей: тот же id — правка; тот же штрихкод —
// тоже правка (одну и ту же пачку дважды не заводим, второй скан её обновляет);
// иначе — новый продукт в начало списка.
//
// Возвращает { list, entry, existing, full }. full — список полон и новое не
// влезло: молча вытеснять старое нельзя (вытеснение без тумбстоуна всё равно
// отменилось бы синхронизацией), поэтому экран говорит об этом словами.
export function upsertProduct(list, product, { id, ts } = {}) {
  const cur = Array.isArray(list) ? list : []
  const clean = normalizeProduct(product)
  if (!clean) return { list: cur, entry: null, existing: null, full: false }
  const existing =
    (clean.id && cur.find((p) => p.id === clean.id)) ||
    (clean.barcode && findProductByBarcode(cur, clean.barcode)) ||
    null
  if (existing) {
    const entry = { ...clean, id: existing.id, createdAt: existing.createdAt || clean.createdAt, updatedAt: ts ?? clean.updatedAt }
    if (!entry.createdAt) delete entry.createdAt
    return { list: cur.map((p) => (p.id === existing.id ? entry : p)), entry, existing, full: false }
  }
  if (cur.length >= MAX_PRODUCTS) return { list: cur, entry: null, existing: null, full: true }
  const entry = { ...clean, id: clean.id || id, createdAt: clean.createdAt || new Date().toISOString(), updatedAt: ts ?? clean.updatedAt }
  return { list: [entry, ...cur], entry, existing: null, full: false }
}

// Выдача поиска: подходящие под запрос мои продукты — первыми, в своём
// порядке релевантности, дальше всё остальное как было.
//
// Своё человек купил и держит в холодильнике — на «сыр» он ищет СВОЮ Гауду, а
// не «Сыр тёртый». По одной релевантности она оказывалась десятой: у «Гауды» в
// названии нет слова «сыр», и находит её только категория. В выдачу при этом
// попадает лишь то, что поиск и так счёл совпадением, — первыми мои продукты
// становятся, а не появляются ниоткуда. Обычный продукт базы остаётся рядом:
// выбрать «просто Гауду» можно так же, как раньше.
export function ownProductsFirst(results) {
  const list = Array.isArray(results) ? results : []
  const mine = []
  const rest = []
  for (const f of list) (f?.source === 'product' ? mine : rest).push(f)
  return mine.length ? [...mine, ...rest] : list
}

// Список для экрана: по названию на языке человека, без учёта регистра.
export function sortProducts(products, locale) {
  return [...(products || [])].sort((a, b) => productLabel(a).localeCompare(productLabel(b), locale, { sensitivity: 'base' }))
}
