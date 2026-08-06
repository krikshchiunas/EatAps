// ─────────────────────────────────────────────────────────────────────────────
// Расширяемый слой классификации продуктов: насыщенные жиры, доля «сложных»
// (крахмалистых/минимально обработанных) углеводов, качество источника белка.
//
// Это ЭВРИСТИКА, а не лабораторные данные конкретного продукта: там, где нет
// явного измеренного поля (satFat и т.п.), значение оценивается по категории/
// названию и помечается confidence: 'estimated'. Если ни категория, ни название
// не дают надёжной классификации — confidence: 'unknown', значение не выдумываем.
// Никогда не выдаём эвристику за медицинский факт (см. пояснения в UI).
//
// Держим таблицы здесь, а не в компонентах — UI только показывает результат.
// ─────────────────────────────────────────────────────────────────────────────

const nrm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е')
const anyOf = (n, ws) => ws.some((w) => n.includes(w))

// Категория продукта не всегда известна (старые записи до появления поля cat,
// продукты из открытых баз и т.п.) — грубо восстанавливаем её по названию, чтобы
// не терять классификацию там, где это можно уверенно определить по слову.
// Это ниже по приоритету, чем явный food.cat, и не делает confidence 'measured'.
const NAME_CATEGORY_WORDS = [
  [['яйц', 'яичн', 'глазунь', 'омлет'], 'egg'],
  [['творог', 'сыр', 'кефир', 'йогурт', 'молок', 'сметан', 'сливк', 'ряженк', 'простокваш'], 'dairy'],
  [['курин', 'курица', 'индейк', 'утк', 'гусь', 'печень куриная'], 'poultry'],
  [['говя', 'свин', 'баран', 'телятин', 'фарш', 'кролик', 'колбас', 'сосиск', 'бекон', 'ветчин', 'салям'], 'meat'],
  [['рыб', 'лосос', 'семга', 'форел', 'тунец', 'треска', 'минтай', 'сельд', 'скумбри', 'судак', 'хек'], 'fish'],
  [['креветк', 'кальмар', 'мидии', 'краб', 'устриц'], 'sea'],
  [['чечевиц', 'нут', 'фасол', 'горох', 'бобов', 'маш', 'соя', 'эдамаме', 'тофу'], 'legume'],
  [['орех', 'миндал', 'фундук', 'кешью', 'арахис', 'фисташк', 'семечк', 'семена'], 'nut'],
  [['рис', 'гречк', 'овсян', 'булгур', 'киноа', 'перловк', 'пшен', 'кускус', 'макарон', 'спагетти'], 'grain'],
  [['хлеб', 'батон', 'лаваш', 'булк'], 'bread'],
  [['картоф', 'картош', 'батат'], 'veg'],
  [['протеин', 'whey', 'гейнер', 'изолят'], 'supp'],
]

function inferCategory(food) {
  const n = nrm(food?.name)
  for (const [words, cat] of NAME_CATEGORY_WORDS) {
    if (anyOf(n, words)) return cat
  }
  return null
}

// ── Насыщенные жиры ──────────────────────────────────────────────────────────
// Доля жира продукта, приходящаяся на насыщенные жиры — по категории (грубая,
// но объяснимая оценка, ближе к реальным средним значениям, чем 0 или 100%).
const SAT_FAT_RATIO_BY_CAT = {
  meat: 0.38, poultry: 0.30, fish: 0.22, sea: 0.25, seafood2: 0.25,
  egg: 0.30, dairy: 0.55, cheese: 0.62, oil: 0.15, nut: 0.13,
  bread: 0.20, pastry: 0.50, sweet: 0.55, dessert: 0.50, drink: 0.25,
  dish: 0.35, sauce: 0.14, supp: 0.25, veg: 0.15, fruit: 0.15, berry: 0.15,
  legume: 0.15, grain: 0.18, pasta: 0.30, pizza: 0.45, asian: 0.25,
  mexican: 0.35, fastfood: 0.42, mcdonalds: 0.42, salad: 0.30, soups: 0.35,
  hot: 0.35, caucasus: 0.35, breakfast: 0.35,
}

// Именные переопределения (сильнее категории — но всё равно оценка, не измерение).
const SAT_FAT_NAME_OVERRIDES = [
  [['кокос'], 0.85],
  [['пальмов'], 0.85],
  [['сливочное масло', 'топлёное', 'гхи'], 0.63],
  [['сало', 'бекон', 'грудинк'], 0.40],
  [['оливковое', 'подсолнечное', 'рапсовое', 'льняное'], 0.14],
]

function satFatRatio(food) {
  const n = nrm(food?.name)
  for (const [words, ratio] of SAT_FAT_NAME_OVERRIDES) {
    if (anyOf(n, words)) return ratio
  }
  const byCat = SAT_FAT_RATIO_BY_CAT[food?.cat || inferCategory(food)]
  if (byCat != null) return byCat
  return null
}

// grams — насыщенные жиры продукта (для уже добавленной порции, т.е. food.fat —
// это граммы жира этой самой порции, не на 100 г).
export function estimateSaturatedFat(food) {
  const measured = Number(food?.satFat)
  if (Number.isFinite(measured) && measured >= 0) {
    return { grams: measured, confidence: 'measured' }
  }
  const fat = Number(food?.fat)
  if (!Number.isFinite(fat) || fat <= 0) {
    return { grams: 0, confidence: fat === 0 ? 'estimated' : 'unknown' }
  }
  const ratio = satFatRatio(food)
  if (ratio == null) return { grams: 0, confidence: 'unknown' }
  return { grams: +(fat * ratio).toFixed(1), confidence: 'estimated' }
}

// ── Сложные (крахмалистые/минимально обработанные) углеводы ─────────────────
// Это ПРОДУКТОВАЯ классификация («доля углеводов из основных цельных/крахмалистых
// источников»), а не медицинский показатель «полезных углеводов».
const COMPLEX_CARB_ALLOW_CATS = new Set(['grain', 'legume'])

const COMPLEX_CARB_ALLOW_WORDS = [
  'рис', 'гречк', 'овсян', 'геркулес', 'булгур', 'киноа', 'перловк', 'пшен',
  'кускус', 'цельнозернов', 'картоф', 'картош', 'батат', 'чечевиц', 'нут',
  'фасол', 'горох', 'бобов', 'маш', 'соя', 'эдамаме', 'тофу',
]

// Явно НЕ считаем сложными углеводами, даже если название пересекается с чем-то
// из allow-list (напр. «печенье овсяное» — это не овсянка).
const COMPLEX_CARB_DENY_CATS = new Set(['sweet', 'dessert', 'drink', 'pastry'])
const COMPLEX_CARB_DENY_WORDS = [
  'сахар', 'мед', 'сироп', 'варенье', 'джем', 'повидло', 'сгущен', 'конфет',
  'шоколад', 'печенье', 'пряник', 'зефир', 'халва', 'мармелад', 'вафл',
  'пончик', 'маффин', 'капкейк', 'кекс', 'торт', 'пирожн', 'десерт', 'сок',
  'газиров', 'лимонад', 'морс', 'компот', 'мороженое',
]

export function classifyComplexCarb(food) {
  const carbs = Number(food?.carbs)
  if (!Number.isFinite(carbs) || carbs <= 0) return { share: 0, confidence: 'estimated' }
  const n = nrm(food?.name)
  if (COMPLEX_CARB_DENY_CATS.has(food?.cat) || anyOf(n, COMPLEX_CARB_DENY_WORDS)) {
    return { share: 0, confidence: 'estimated' }
  }
  if (COMPLEX_CARB_ALLOW_CATS.has(food?.cat) || anyOf(n, COMPLEX_CARB_ALLOW_WORDS)) {
    return { share: 1, confidence: 'estimated' }
  }
  // Смешанные блюда (пельмени, пицца, бургеры и т.п.) и всё остальное без явного
  // совпадения — не относим к «сложным углеводам» по умолчанию (низкая уверенность
  // в том, что это преимущественно цельный источник).
  return { share: 0, confidence: 'unknown' }
}

// ── Качество источника белка (1..10, ориентировочно) ─────────────────────────
// Категориальная оценка «насколько полноценен и usvoяем белок источника» —
// НЕ DIAAS/PDCAAS конкретного продукта (в базе таких данных нет), поэтому
// confidence всегда 'estimated' (никогда 'measured' — если в будущем появятся
// реальные DIAAS/PDCAAS поля у продукта, сюда нужно будет добавить ветку measured).
const PROTEIN_QUALITY_BY_CAT = {
  egg: 9, dairy: 8, cheese: 8, fish: 8, sea: 7, seafood2: 7, meat: 8, poultry: 8,
  supp: 8, // сывороточный протеин и т.п.
  legume: 6, grain: 4, nut: 4, veg: 3, fruit: 2, berry: 2, bread: 4, pasta: 4,
  pastry: 3, sweet: 2, dessert: 2, drink: 3, sauce: 2, oil: 1,
  dish: 5, pizza: 5, asian: 5, mexican: 5, fastfood: 5, mcdonalds: 5,
  salad: 5, soups: 5, hot: 7, caucasus: 5, breakfast: 6,
}

// Полноценные растительные источники — выше, чем «крупы»/«орехи» по умолчанию.
const PROTEIN_QUALITY_NAME_OVERRIDES = [
  [['соя', 'тофу', 'эдамаме'], 7],
  [['сывороточ', 'whey', 'изолят'], 9],
  [['гейнер'], 7],
]

export function estimateProteinQuality(food) {
  const protein = Number(food?.protein)
  if (!Number.isFinite(protein) || protein <= 0) return { score: null, confidence: 'unknown' }
  const n = nrm(food?.name)
  for (const [words, score] of PROTEIN_QUALITY_NAME_OVERRIDES) {
    if (anyOf(n, words)) return { score, confidence: 'estimated' }
  }
  const byCat = PROTEIN_QUALITY_BY_CAT[food?.cat || inferCategory(food)]
  if (byCat != null) return { score: byCat, confidence: 'estimated' }
  return { score: null, confidence: 'unknown' }
}

// Порог, начиная с которого белок считается «высокого качества» (п.13 задания).
export const PROTEIN_QUALITY_THRESHOLD = 7
