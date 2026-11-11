// @i18n-data-file — классификация продуктов по русским основам названий.
import { estimateSaturatedFat, classifyComplexCarb, estimateProteinQuality, usableProteinShare, categoryOf } from './nutritionClassification.js'
import { t } from './i18n.js'
import { carbRefFor } from './carbRef.js'

export const ACTIVITY = {
  sedentary: { factor: 1.2, get label() { return t('activity.sedentary') } },
  light: { factor: 1.375, get label() { return t('activity.light') } },
  moderate: { factor: 1.55, get label() { return t('activity.moderate') } },
  high: { factor: 1.725, get label() { return t('activity.high') } },
}

export const GOALS = {
  lose: { get label() { return t('goal.lose') }, kcalAdjust: -500, proteinPerKg: 2.0 },
  maintain: { get label() { return t('goal.maintain') }, kcalAdjust: 0, proteinPerKg: 1.6 },
  gain: { get label() { return t('goal.gain') }, kcalAdjust: 350, proteinPerKg: 1.8 },
}

const round10 = (n) => Math.round(n / 10) * 10
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// ── Расчётная масса для дозирования белка ────────────────────────────────────
// Потребность в белке определяется тощей массой, а не общей: жировая ткань
// белок не потребляет. Состава тела мы не знаем, поэтому применяем принятую в
// клинической практике поправку — adjusted body weight:
//   ABW = «вес при ИМТ 25» + 0.4 × (реальный вес − «вес при ИМТ 25»)
// Без неё человек 180 см / 130 кг на снижении получал бы 260 г белка в сутки —
// столько не съесть, и такой цифре в приложении не место.
// При ИМТ ≤ 25 берётся реальный вес, поправка не включается.
export function proteinReferenceWeight(weight, heightCm) {
  const w = Number(weight)
  const h = Number(heightCm) / 100
  if (!Number.isFinite(w) || w <= 0) return null
  if (!Number.isFinite(h) || h <= 0.5 || h > 2.7) return w
  const atBmi25 = 25 * h * h
  if (w <= atBmi25) return w
  return atBmi25 + 0.4 * (w - atBmi25)
}

// Активность влияет и на белок: при тяжёлых нагрузках растёт потребность в
// восстановлении мышц, при постельном режиме — падает. Считаем от «лёгкой»
// активности (1.375), для которой proteinPerKg целей и подобран, и сдвигаем
// умеренно — рамки не дают уйти в крайности на краях ползунка.
const activityProteinBonus = (factor) => clamp((factor - ACTIVITY.light.factor) * 0.6, -0.15, 0.35)

// Возрастная поправка: после 60 мышцы хуже отзываются на белок (анаболическая
// резистентность), и рекомендации PROT-AGE/ESPEN поднимают норму до 1.0–1.2 г/кг
// как минимум, а при нагрузках выше. Прибавка небольшая и плавная, чтобы 59 и
// 61 год не давали ступеньку.
const ageProteinBonus = (age) => {
  const a = Number(age)
  if (!Number.isFinite(a) || a < 60) return 0
  return clamp((a - 60) * 0.01, 0, 0.2)
}

// Нижняя граница по белку — не «сколько хочется», а «ниже чего опасно»:
// RDA 0.8 г/кг реального веса, для 65+ поднимаем до 1.0 (ESPEN).
const proteinFloorGrams = (weight, age) => {
  const perKg = Number(age) >= 65 ? 1.0 : 0.8
  return weight * perKg
}

// г/кг расчётной массы для цели и активности. Экспортируем, чтобы объяснить
// пользователю, откуда взялась его норма, а не показывать «магическое» число.
export function proteinPerKgFor(goal, factor, age) {
  const base = GOALS[goal]?.proteinPerKg ?? GOALS.maintain.proteinPerKg
  return clamp(base + activityProteinBonus(factor) + ageProteinBonus(age), 0.8, 2.5)
}

// activityFactor (число) имеет приоритет над activity (ключ): день задаёт
// активность непрерывным баллом 0–100, профиль — одним из четырёх уровней.
export function computeTargets(profile) {
  const { sex, age, height, weight, activity, goal, activityFactor } = profile
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161)
  const factor = Number.isFinite(Number(activityFactor))
    ? Number(activityFactor)
    : (ACTIVITY[activity]?.factor ?? ACTIVITY.light.factor)
  const tdee = bmr * factor

  // ── Калории ────────────────────────────────────────────────────────────────
  // Дефицит и профицит ограничены ДОЛЕЙ от расхода, а не только абсолютом:
  // −500 ккал для человека с расходом 1700 — это минус 29%, слишком резко.
  // Потолок 20–25% — обычная рекомендация для устойчивого темпа (≈0.5–0.7 кг/нед).
  const adjust = goal === 'lose'
    ? -Math.min(500, tdee * 0.25)
    : goal === 'gain'
      ? Math.min(350, tdee * 0.2)
      : 0
  // Абсолютный минимум: ниже него рацион трудно закрыть по витаминам и минералам.
  // Разный для мужчин и женщин — так его и дают клинические руководства.
  const floor = sex === 'male' ? 1500 : 1200
  // Но заставлять есть БОЛЬШЕ поддержания того, кто хочет худеть, тоже нельзя:
  // у невысокой женщины расход бывает ниже минимального ориентира.
  let calories = round10(goal === 'lose'
    ? Math.min(tdee, Math.max(floor, tdee + adjust))
    : Math.max(floor, tdee + adjust))
  // Округление до десятков само по себе способно перебросить цель через расход
  // (947 → 950): на снижении это противоречие видно прямо на экране дня.
  if (goal === 'lose' && calories > tdee) calories = Math.floor(tdee / 10) * 10

  // ── Белок ──────────────────────────────────────────────────────────────────
  const refWeight = proteinReferenceWeight(weight, height) ?? weight
  const perKg = proteinPerKgFor(goal, factor, age)
  let protein = refWeight * perKg
  // Потолок: больше 40% калорий из белка есть тяжело и незачем.
  protein = Math.min(protein, (calories * 0.4) / 4)
  // Пол — жёсткая физиологическая граница, она сильнее потолка по калориям.
  protein = Math.max(protein, proteinFloorGrams(weight, age))
  protein = Math.round(protein)

  // ── Жиры ───────────────────────────────────────────────────────────────────
  // 27% калорий — как раньше, но с нижней границей: жиры нужны для гормонов и
  // усвоения витаминов A, D, E, K, и «сжать» их до нуля ради углеводов нельзя.
  const fatFloor = Math.max(refWeight * 0.6, (calories * 0.2) / 9)
  let fat = Math.max((calories * 0.27) / 9, fatFloor)

  // ── Углеводы — остаток ─────────────────────────────────────────────────────
  // Раньше остаток просто зажимался в ноль, и сумма Б×4 + Ж×9 + У×4 переставала
  // сходиться с калориями — цифры на экране противоречили друг другу. Теперь,
  // если остатка не хватает, ужимаем сначала жир (до его физиологического
  // минимума), и только потом признаём, что углеводов ноль.
  const carbKcalRaw = calories - protein * 4 - fat * 9
  if (carbKcalRaw < 0) {
    fat = Math.max(fatFloor, (calories - protein * 4) / 9)
  }
  const carbs = Math.max(0, Math.round((calories - protein * 4 - Math.round(fat) * 9) / 4))

  return {
    calories,
    protein,
    fat: Math.round(fat),
    carbs,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    activityFactor: factor,
    // Пояснения для интерфейса: откуда взялась норма белка.
    proteinPerKg: Math.round(perKg * 100) / 100,
    proteinRefWeight: Math.round(refWeight * 10) / 10,
  }
}

export function sumDay(meals = []) {
  const t = meals.reduce(
    (a, m) => ({
      kcal: a.kcal + (Number(m.kcal) || 0),
      protein: a.protein + (Number(m.protein) || 0),
      carbs: a.carbs + (Number(m.carbs) || 0),
      fat: a.fat + (Number(m.fat) || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  )
  // Складывая дробные граммы, double накапливает мусор: 27.4 + 12.3 + 77
  // даёт 116.69999999999999, и это уезжало прямо в интерфейс. Десятой доли
  // грамма хватает с запасом, поэтому срезаем разряды здесь, в единственном
  // месте, где суммы рождаются, — а не в каждом потребителе по отдельности.
  return {
    kcal: round1n(t.kcal),
    protein: round1n(t.protein),
    carbs: round1n(t.carbs),
    fat: round1n(t.fat),
  }
}

const nrm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е')
const anyOf = (n, ws) => ws.some((w) => n.includes(w))

const nameOf = (x) => (typeof x === 'string' ? x : x?.name)
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Сахара и клетчатка записи ────────────────────────────────────────────────
// Источники, от точного к оценке:
//   1. этикетка (штрихкод, поиск по базе, ручной ввод) или оценка ИИ по фото —
//      поля sugar и fiber самой записи;
//   2. справочный состав продукта (carbRef.js): название → профиль на 100 г;
//   3. категория продукта → усреднённый профиль группы.
//
// Раньше сахар и клетчатку считали «долей от углеводов по слову в названии»,
// и всё, что не совпало с русским словом, получало долю «прочего»: шоколадный
// батончик — 5% сахара, ореховая смесь — 4% клетчатки. Отсюда «4,6 г сахара
// в 168 г Kinder» и «0,2 г клетчатки в 40 г орехов».
//
// Профиль описывает продукт на 100 г, а запись — конкретную порцию, которая
// бывает сухой крупой или варёной, с европейской этикеткой (углеводы без
// клетчатки) или американской (с ней). Поэтому цифры профиля приводятся к
// записи так:
//   • по КАЛОРИЯМ — это переживает и «сухая/варёная» (вода разбавляет всё
//     одинаково), и «европейская/американская этикетка» (калории те же);
//   • и ограничиваются УГЛЕВОДАМИ самой записи: сахара и клетчатки не может
//     быть больше, чем допускают её же углеводы при любом из двух способов их
//     указывать. Это страховка от промаха профиля: жирное блюдо не получит
//     клетчатку салатного листа.

// Калории записи; если их нет — из Б/Ж/У.
function entryKcal(m) {
  const k = num(m?.kcal)
  if (k != null && k > 0) return k
  const e = 4 * (num(m?.protein) ?? 0) + 4 * (num(m?.carbs) ?? 0) + 9 * (num(m?.fat) ?? 0)
  return e > 0 ? e : null
}

// Профиль, который правда описывает углеводы записи. Если углеводов в записи
// в разы больше, чем бывает у продукта профиля («Курица в соусе терияки» —
// профиль курицы, а углеводы из соуса и панировки), профиль ничего не знает об
// их составе — берём профиль смешанного блюда.
function refForEntry(m, carbs, kcal) {
  const ref = carbRefFor(m)
  if (carbs > 0 && kcal > 0 && ref.kcal > 0) {
    const entryDensity = carbs / kcal
    const refDensity = (ref.carbs + ref.fiber) / ref.kcal
    if (entryDensity > 4 * refDensity + 0.01) return carbRefFor({ name: '', cat: 'dish' })
  }
  return ref
}

// Значение профиля (г на 100 г) для этой записи — см. пояснение выше.
// slack — запас сверху: доля клетчатки у разных продуктов одной группы
// разнится сильнее, чем доля сахара (шоколад 70% и 85%, разные ореховые смеси).
function fromRef(ref, per100, carbs, kcal, slack = 1) {
  if (!(per100 > 0) || !(carbs > 0)) return 0
  const total = ref.carbs + ref.fiber
  // Углеводы записи — по-американски, с клетчаткой: нижняя граница.
  const lo = total > 0 ? (carbs * per100) / total : 0
  // Углеводы записи — по-европейски, без клетчатки: верхняя граница.
  const hi = ref.carbs > 0 ? (carbs * per100 * slack) / ref.carbs : lo
  if (!(kcal > 0) || !(ref.kcal > 0)) return lo
  const byEnergy = (kcal * per100) / ref.kcal
  return Math.min(Math.max(byEnergy, lo), Math.max(lo, hi))
}

// Оценка по профилю: { ref, sugar, fiber, natural } в граммах на эту порцию.
export function estimateCarbs(m) {
  const carbs = Math.max(0, num(m?.carbs) ?? 0)
  const kcal = entryKcal(m)
  const ref = refForEntry(m, carbs, kcal)
  const sugar = Math.min(carbs, fromRef(ref, ref.sugar, carbs, kcal))
  const fiber = fromRef(ref, ref.fiber, carbs, kcal, 1.3)
  const natural = ref.sugar > 0 ? (sugar * ref.natural) / ref.sugar : 0
  return { ref, sugar, fiber, natural, kcal }
}

// Сахар с этикетки: тот же смысл нуля, что в stats.js realSugar — ноль считается
// данными, только если помечен как измеренный.
function labelSugar(m) {
  const n = num(m?.sugar)
  if (n == null || n < 0) return null
  if (n > 0) return n
  return m?.sugarSrc === 'measured' ? 0 : null
}

// Масса порции в граммах — только когда она правда масса (см. foodMicros massOf).
function massOf(m) {
  const unit = m?.unit || 'г'
  if (unit !== 'г' && unit !== 'мл') return null
  const n = num(m?.grams)
  return n != null && n > 0 ? n : null
}

// Свободные сахара записи (ВОЗ: всё добавленное плюс мёд, сиропы, соки; НЕ
// лактоза молока и не сахара целых плодов, орехов, овощей).
//
// Возвращает { grams, total, source }:
//   total     — все сахара порции;
//   'label'    — с этикетки (или от ИИ) как есть;
//   'adjusted' — с этикетки за вычетом натуральных: этикетка их не отделяет;
//   'estimate' — этикетки нет, оценка по справочному составу.
export function freeSugarOf(m) {
  const carbs = Math.max(0, num(m?.carbs) ?? 0)
  const est = estimateCarbs(m)
  const label = labelSugar(m)
  if (label == null) {
    return { grams: Math.max(0, est.sugar - est.natural), total: est.sugar, source: 'estimate' }
  }
  // Сахара не бывает больше углеводов; если этикетка так говорит — верим
  // углеводам: больше быть не может.
  const sugar = carbs > 0 ? Math.min(label, carbs) : label
  const { ref, kcal } = est
  if (!(ref.natural > 0) || sugar === 0) return { grams: sugar, total: sugar, source: 'label' }
  // Сколько натурального сахара в такой порции такого продукта. По весу — для
  // лактозы в молочном и сахаров в орехах; у фруктов и овощей ещё и по
  // калориям: сушёное яблоко — это то же яблоко без воды.
  const mass = massOf(m)
  let natural
  if (mass != null) {
    natural = (mass * ref.natural) / 100
    if (ref.plant && kcal > 0) natural = Math.max(natural, (kcal * ref.natural) / ref.kcal)
  } else if (kcal > 0 && ref.kcal > 0) {
    natural = (kcal * ref.natural) / ref.kcal
  } else {
    natural = ref.sugar > 0 ? (sugar * ref.natural) / ref.sugar : 0
  }
  natural = Math.min(sugar, natural)
  const grams = sugar - natural
  return { grams, total: sugar, source: natural >= 0.05 ? 'adjusted' : 'label' }
}

// Клетчатка записи: { grams, source } — 'label' (этикетка или ИИ) или 'estimate'.
export function fiberOf(m) {
  const label = num(m?.fiber)
  if (label != null && label >= 0) return { grams: label, source: 'label' }
  return { grams: estimateCarbs(m).fiber, source: 'estimate' }
}

// Доля свободных сахаров в углеводах (0..1). По записи — из расчёта выше; по
// одному названию — из справочного состава продукта.
export function freeSugarShare(food) {
  if (typeof food !== 'string' && num(food?.carbs) > 0) {
    return Math.min(1, freeSugarOf(food).grams / num(food.carbs))
  }
  const ref = carbRefFor(typeof food === 'string' ? { name: food } : food)
  return ref.carbs > 0 ? Math.min(1, Math.max(0, ref.sugar - ref.natural) / ref.carbs) : 0
}

// Доля клетчатки относительно углеводов (по-американски, с клетчаткой).
export function fiberRatioOf(food) {
  if (typeof food !== 'string' && num(food?.carbs) > 0) {
    return fiberOf(food).grams / num(food.carbs)
  }
  const ref = carbRefFor(typeof food === 'string' ? { name: food } : food)
  const total = ref.carbs + ref.fiber
  return total > 0 ? ref.fiber / total : 0
}

// Источник углеводов для разбивки: sweet / grain / fruit / veg / other.
export function carbBucket(food) {
  const n = nrm(nameOf(food))
  // Сладкое — где свободные сахара бóльшая часть углеводов (у молочного
  // шоколада это ~0,75: часть сахара — лактоза).
  if (freeSugarShare(food) >= 0.6) return 'sweet'
  if (anyOf(n, ['хлеб', 'рис', 'гречк', 'овсян', 'макарон', 'паста', 'спагетти', 'булгур', 'киноа', 'перловк', 'пшен', 'кускус', 'лапш', 'крупа', 'каша', 'батон', 'лаваш', 'картоф', 'картош', 'пюре', 'бутерброд', 'сэндвич', 'пицц', 'бургер', 'блин', 'вареник', 'пельмен'])) return 'grain'
  if (anyOf(n, ['банан', 'яблоко', 'груша', 'апельсин', 'мандарин', 'виноград', 'киви', 'ананас', 'манго', 'персик', 'слив', 'абрикос', 'арбуз', 'дын', 'гранат', 'хурма', 'клубник', 'черник', 'малин', 'ежевик', 'вишн', 'смородин', 'грейпфрут', 'фрукт', 'ягод', 'изюм', 'финик', 'курага', 'чернослив'])) return 'fruit'
  if (anyOf(n, ['чечевиц', 'нут', 'фасол', 'горох', 'брокколи', 'капуст', 'овощ', 'перец', 'морков', 'свекл', 'огурец', 'помидор', 'кабач', 'баклажан', 'грибы', 'салат', 'шпинат'])) return 'veg'
  const cat = categoryOf(typeof food === 'string' ? { name: food } : food)
  if (cat === 'sweet' || cat === 'dessert' || cat === 'pastry') return 'sweet'
  if (cat === 'grain' || cat === 'bread' || cat === 'pasta' || cat === 'pizza') return 'grain'
  if (cat === 'fruit' || cat === 'berry') return 'fruit'
  if (cat === 'veg' || cat === 'legume') return 'veg'
  return 'other'
}

export const BUCKET_LABEL = {
  get sweet() { return t('bucket.sweet') },
  get grain() { return t('bucket.grain') },
  get fruit() { return t('bucket.fruit') },
  get veg() { return t('bucket.veg') },
  get other() { return t('bucket.other') },
}

export function sumQuality(meals = []) {
  const buckets = { sweet: 0, grain: 0, fruit: 0, veg: 0, other: 0 }
  let freeSugar = 0
  let fiber = 0
  for (const m of meals) {
    const carbs = Number(m.carbs) || 0
    freeSugar += freeSugarOf(m).grams
    fiber += fiberOf(m).grams
    buckets[carbBucket(m)] += carbs
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
  let classifiedProtein = 0

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
      // Непрерывный зачёт по DIAAS вместо порога «7 и выше — целиком, ниже —
      // ноль»: чечевица теперь даёт свои 55%, а не исчезает из счёта.
      const share = usableProteinShare(pq.diaas)
      if (share != null) {
        qualityProtein += protein * share
        classifiedProtein += protein
      }
    }
  }

  return {
    satFat: round1n(satFat),
    satFatConfidence: aggConfidence(satConfidences),
    complexCarb: round1n(complexCarb),
    complexCarbConfidence: aggConfidence(carbConfidences),
    qualityProtein: round1n(qualityProtein),
    totalProtein: round1n(totalProtein),
    // Доля считается от белка, который УДАЛОСЬ классифицировать: иначе один
    // неопознанный продукт занижал бы «качество» всего дня, хотя про него
    // просто ничего не известно.
    qualityProteinShare: classifiedProtein > 0 ? qualityProtein / classifiedProtein : null,
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
