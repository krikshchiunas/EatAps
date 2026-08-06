import { estimateSaturatedFat, classifyComplexCarb, estimateProteinQuality, PROTEIN_QUALITY_THRESHOLD } from './nutritionClassification.js'

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: 'Мало движения' },
  light: { factor: 1.375, label: 'Лёгкая активность' },
  moderate: { factor: 1.55, label: 'Умеренная' },
  high: { factor: 1.725, label: 'Высокая' },
}

export const GOALS = {
  lose: { label: 'Снижение веса', kcalAdjust: -500, proteinPerKg: 1.9 },
  maintain: { label: 'Поддержание', kcalAdjust: 0, proteinPerKg: 1.6 },
  gain: { label: 'Набор мышц', kcalAdjust: 350, proteinPerKg: 2.0 },
}

const round10 = (n) => Math.round(n / 10) * 10

export function computeTargets(profile) {
  const { sex, age, height, weight, activity, goal } = profile
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161)
  const tdee = bmr * (ACTIVITY[activity]?.factor ?? 1.375)
  const calories = round10(Math.max(1200, tdee + (GOALS[goal]?.kcalAdjust ?? 0)))
  const protein = Math.round(weight * (GOALS[goal]?.proteinPerKg ?? 1.6))
  const fat = Math.round((calories * 0.27) / 9)
  const carbs = Math.round((calories - protein * 4 - fat * 9) / 4)
  return {
    calories,
    protein,
    fat,
    carbs: Math.max(0, carbs),
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
  }
}

export function sumDay(meals = []) {
  return meals.reduce(
    (a, m) => ({
      kcal: a.kcal + (Number(m.kcal) || 0),
      protein: a.protein + (Number(m.protein) || 0),
      carbs: a.carbs + (Number(m.carbs) || 0),
      fat: a.fat + (Number(m.fat) || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  )
}

const nrm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е')
const anyOf = (n, ws) => ws.some((w) => n.includes(w))

// Доля углеводов продукта, которая приходится на СВОБОДНЫЕ сахара (0..1) по классификации ВОЗ.
// Сахар из цельных фруктов и лактоза молока — НЕ свободные.
export function freeSugarShare(name) {
  const n = nrm(name)
  if (anyOf(n, ['zero', 'light', 'без сахара', 'sugarfree', 'sugar free', 'диет'])) return 0
  if (anyOf(n, ['сахар', 'мед', 'сироп', 'варенье', 'джем', 'повидло', 'сгущен', 'нутелла', 'карамель', 'ирис'])) return 1
  if (anyOf(n, ['cola', 'кола', 'pepsi', 'пепси', 'fanta', 'фанта', 'sprite', 'спрайт', 'газиров', 'лимонад', 'энергет', 'burn', 'monster', 'red bull', 'mirinda', 'дюшес', 'тархун', 'байкал', 'морс', 'компот', 'кисель', 'нектар'])) return 1
  if (anyOf(n, ['сок '])) return 1
  if (anyOf(n, ['шоколад', 'конфет', 'печенье', 'пряник', 'зефир', 'халва', 'мармелад', 'вафл', 'пончик', 'маффин', 'капкейк', 'кекс', 'торт', 'пирожн', 'эклер', 'тирамису', 'чизкейк', 'мороженое', 'пломбир', 'наполеон', 'медовик', 'брауни', 'штрудель', 'макарон ', 'десерт', 'молочный коктейль', 'какао'])) return 0.85
  if (anyOf(n, ['кетчуп', 'соус терияки', 'терияки', 'кисло-сладкий'])) return 0.85
  if (anyOf(n, ['изюм', 'финик', 'курага', 'чернослив', 'цукат'])) return 0.4
  if (anyOf(n, ['банан', 'яблоко', 'груша', 'апельсин', 'мандарин', 'виноград', 'киви', 'ананас', 'манго', 'персик', 'слив', 'абрикос', 'арбуз', 'дын', 'гранат', 'хурма', 'клубник', 'черник', 'малин', 'ежевик', 'вишн', 'смородин', 'грейпфрут', 'лимон', 'фрукт', 'ягод', 'смузи'])) return 0
  if (anyOf(n, ['молоко', 'кефир', 'творог', 'йогурт', 'сметан', 'сливк', 'ряженк', 'простокваш', 'сыр', 'масло'])) return 0
  return 0.05
}

// Доля углеводов, приходящаяся на клетчатку (грубая оценка по типу продукта).
export function fiberRatioOf(name) {
  const n = nrm(name)
  if (anyOf(n, ['чечевиц', 'нут', 'фасол', 'горох', 'бобов', 'маш', 'соя', 'эдамаме'])) return 0.32
  if (anyOf(n, ['орех', 'миндал', 'фундук', 'кешью', 'арахис', 'фисташк', 'семена', 'семечк', 'чиа', 'лен', 'кунжут', 'авокадо'])) return 0.4
  if (anyOf(n, ['брокколи', 'капуст', 'шпинат', 'руккола', 'салат', 'овощ', 'перец', 'морков', 'свекл', 'огурец', 'помидор', 'кабач', 'баклажан', 'грибы', 'зелен', 'стручков'])) return 0.4
  if (anyOf(n, ['цельнозернов', 'отруб', 'ржаной', 'бородинск', 'гречк', 'овсян', 'перловк', 'булгур', 'киноа', 'пшен'])) return 0.14
  if (anyOf(n, ['хлеб', 'рис бур', 'макарон', 'паста', 'спагетти', 'крупа', 'каша', 'лаваш', 'батат'])) return 0.08
  if (anyOf(n, ['ягод', 'малин', 'черник', 'ежевик', 'смородин', 'груша', 'яблоко', 'банан', 'апельсин', 'киви', 'слив', 'чернослив', 'курага', 'изюм', 'финик'])) return 0.12
  if (anyOf(n, ['фрукт', 'фрукт', 'ананас', 'манго', 'виноград', 'дын', 'арбуз'])) return 0.06
  if (anyOf(n, ['рис', 'сахар', 'мед', 'шоколад', 'конфет', 'сок', 'кола', 'газиров', 'сироп', 'варенье'])) return 0.01
  return 0.04
}

// Источник углеводов для разбивки: sweet / grain / fruit / veg / other.
export function carbBucket(name) {
  const n = nrm(name)
  if (freeSugarShare(name) >= 0.8) return 'sweet'
  if (anyOf(n, ['хлеб', 'рис', 'гречк', 'овсян', 'макарон', 'паста', 'спагетти', 'булгур', 'киноа', 'перловк', 'пшен', 'кускус', 'лапш', 'крупа', 'каша', 'батон', 'лаваш', 'картоф', 'картош', 'пюре', 'бутерброд', 'сэндвич', 'пицц', 'бургер', 'блин', 'вареник', 'пельмен'])) return 'grain'
  if (anyOf(n, ['банан', 'яблоко', 'груша', 'апельсин', 'мандарин', 'виноград', 'киви', 'ананас', 'манго', 'персик', 'слив', 'абрикос', 'арбуз', 'дын', 'гранат', 'хурма', 'клубник', 'черник', 'малин', 'ежевик', 'вишн', 'смородин', 'грейпфрут', 'фрукт', 'ягод', 'изюм', 'финик', 'курага', 'чернослив'])) return 'fruit'
  if (anyOf(n, ['чечевиц', 'нут', 'фасол', 'горох', 'брокколи', 'капуст', 'овощ', 'перец', 'морков', 'свекл', 'огурец', 'помидор', 'кабач', 'баклажан', 'грибы', 'салат', 'шпинат'])) return 'veg'
  return 'other'
}

export const BUCKET_LABEL = { sweet: 'сладости и напитки', grain: 'крупы и хлеб', fruit: 'фрукты', veg: 'овощи и бобовые', other: 'другое' }

export function sumQuality(meals = []) {
  const buckets = { sweet: 0, grain: 0, fruit: 0, veg: 0, other: 0 }
  let freeSugar = 0
  let fiber = 0
  for (const m of meals) {
    const carbs = Number(m.carbs) || 0
    freeSugar += carbs * freeSugarShare(m.name)
    fiber += carbs * fiberRatioOf(m.name)
    buckets[carbBucket(m.name)] += carbs
  }
  return { freeSugar: Math.round(freeSugar), fiber: Math.round(fiber), buckets }
}

// Лимит свободных сахаров = 10% калорий / 4. Клетчатка — цель EFSA ~30 г.
export const sugarLimit = (calories) => Math.round((calories * 0.1) / 4)
export const fiberGoal = () => 30

// Дневной ориентир по насыщенным жирам — ВОЗ: <10% калорий из насыщенных жиров
// (9 ккал/г). Считается от цели по калориям, отдельно от общей нормы жиров.
export const satFatLimit = (calories) => Math.round((calories * 0.1) / 9)

const round1n = (n) => Math.round(n * 10) / 10

// Свод по эвристическим показателям качества питания (насыщенные жиры, доля
// «сложных» углеводов, белок высокого качества) — см. nutritionClassification.js.
// confidence на каждый показатель: 'measured' (все продукты с реальными данными),
// 'estimated' (классификация уверенная, но по эвристике), 'partial' (часть
// продуктов не удалось классифицировать — часть суммы недооценена, а не «0»),
// 'none' (в приёме нет продуктов с этим нутриентом вовсе).
function aggConfidence(list) {
  if (list.length === 0) return 'none'
  if (list.every((c) => c === 'measured')) return 'measured'
  if (list.some((c) => c === 'unknown')) return 'partial'
  return 'estimated'
}

export function sumAdvanced(meals = []) {
  const satConfidences = []
  const carbConfidences = []
  const proteinConfidences = []
  let satFat = 0
  let complexCarb = 0
  let qualityProtein = 0
  let totalProtein = 0

  for (const m of meals) {
    const fat = Number(m.fat) || 0
    const carbs = Number(m.carbs) || 0
    const protein = Number(m.protein) || 0
    totalProtein += protein

    const sf = estimateSaturatedFat(m)
    satFat += sf.grams
    if (fat > 0) satConfidences.push(sf.confidence)

    const cc = classifyComplexCarb(m)
    complexCarb += carbs * cc.share
    if (carbs > 0) carbConfidences.push(cc.confidence)

    if (protein > 0) {
      const pq = estimateProteinQuality(m)
      proteinConfidences.push(pq.confidence)
      if (pq.score != null && pq.score >= PROTEIN_QUALITY_THRESHOLD) qualityProtein += protein
    }
  }

  return {
    satFat: round1n(satFat),
    satFatConfidence: aggConfidence(satConfidences),
    complexCarb: round1n(complexCarb),
    complexCarbConfidence: aggConfidence(carbConfidences),
    qualityProtein: round1n(qualityProtein),
    totalProtein: round1n(totalProtein),
    qualityProteinShare: totalProtein > 0 ? qualityProtein / totalProtein : null,
    qualityProteinConfidence: aggConfidence(proteinConfidences),
  }
}

// Итоговая оценка качества углеводов за день: good | ok | bad.
export function carbGrade({ freeSugar, sugarLimit, fiber, fiberGoal, carbs }) {
  if (carbs < 5) return { level: 'none' }
  const sugarOver = freeSugar > sugarLimit
  const sugarBad = freeSugar > sugarLimit * 1.5
  const fiberLow = fiber < fiberGoal * 0.6
  let level = 'good'
  if (sugarBad || (sugarOver && fiberLow)) level = 'bad'
  else if (sugarOver || fiberLow) level = 'ok'
  return { level, sugarOver, fiberLow }
}
