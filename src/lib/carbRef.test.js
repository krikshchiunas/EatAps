// Сахара и клетчатка «на любых продуктах»: справочный состав и его приведение
// к конкретной порции (nutrition.js estimateCarbs / freeSugarOf / fiberOf).
//
// Ожидания — реальный состав продукта (USDA FoodData Central, этикетки), с
// допуском: это оценка по типу продукта, а не анализ конкретной пачки. Если
// тест падает, чинить надо справочник или правило, а не расширять диапазон.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carbRefFor, _carbRefKeys } from './carbRef.js'
import { estimateCarbs, freeSugarOf, fiberOf } from './nutrition.js'
import { FOODS } from './foods.js'

test('все правила и категории ведут на существующий профиль', () => {
  const { rules, cats, refs } = _carbRefKeys()
  const known = new Set(refs)
  assert.deepEqual([...rules, ...cats].filter((k) => !known.has(k)), [])
})

// [название, г/мл, ккал, углеводы, белки, жиры] и ожидания для порции:
// sugar — все сахара, free — свободные, fiber — клетчатка; [мин, макс] в граммах.
const CASES = [
  // Сладкое
  [['Шоколад молочный', 100, 535, 59, 7.6, 30], { sugar: [45, 56], free: [38, 52], fiber: [2, 4.5] }],
  [['Snickers', 50, 244, 30, 4.5, 12], { sugar: [21, 27], free: [19, 27], fiber: [0.8, 1.8] }],
  [['Country · Kinder', 168, 902, 92.2, 14.4, 56.8], { sugar: [62, 85], free: [55, 85], fiber: [2.5, 5] }],
  [['Dark chocolate 85%', 25, 150, 5.5, 3, 12], { sugar: [2.5, 4.5], free: [2.5, 4.5], fiber: [1.5, 3.5] }],
  [['Мёд', 20, 61, 16.4, 0.1, 0], { sugar: [16, 16.4], free: [16, 16.4] }],
  [['Печенье овсяное', 40, 175, 28, 2.6, 6.5], { sugar: [8, 14], free: [8, 14], fiber: [0.7, 2] }],
  // Напитки
  [['Coca-Cola', 330, 139, 35, 0, 0], { sugar: [34, 35], free: [34, 35], fiber: [0, 0] }],
  [['Coca-Cola Zero', 330, 1, 0, 0, 0], { sugar: [0, 0], free: [0, 0] }],
  [['Сок апельсиновый', 250, 112, 26, 1.7, 0.5], { sugar: [21, 26], free: [21, 26] }],
  [['Латте', 300, 132, 13, 8, 6], { sugar: [11, 13], free: [0, 0.5] }],
  // Молочное
  [['Кефир 2,5%', 250, 128, 10, 7.5, 6], { sugar: [9, 10], free: [0, 0], fiber: [0, 0] }],
  [['Йогурт натуральный', 150, 90, 7, 7.5, 3], { free: [0, 0] }],
  // Орехи и семена
  [["Nut-Mix Natural · Trader Joe's", 40, 263, 4, 7.6, 23.6], { free: [0, 0], fiber: [2.5, 4] }],
  [['Миндаль', 30, 174, 6.6, 6.3, 15], { sugar: [0.9, 1.7], free: [0, 0], fiber: [3, 4.5] }],
  [['Almonds roasted', 30, 180, 2.3, 6.4, 15.3], { free: [0, 0], fiber: [2.5, 4.5] }],
  [['Кешью', 30, 166, 9, 5.5, 13], { sugar: [1.3, 2.2], fiber: [0.7, 1.4] }],
  [['Chia seeds', 15, 73, 1.2, 2.5, 4.6], { sugar: [0, 0.3], fiber: [4, 6] }],
  // Фрукты и овощи
  [['Банан', 120, 107, 27, 1.3, 0.4], { sugar: [12, 17], free: [0, 0], fiber: [2.5, 4] }],
  [['Яблоко', 180, 94, 25, 0.5, 0.4], { sugar: [16, 20], free: [0, 0], fiber: [3.5, 5] }],
  [['Брокколи', 200, 68, 14, 5.6, 0.8], { sugar: [2.5, 4.5], free: [0, 0], fiber: [4, 6.5] }],
  [['Картофель варёный', 200, 164, 34, 3.8, 0.2], { sugar: [0, 2.5], free: [0, 0], fiber: [3, 5] }],
  [['Изюм', 40, 120, 31.6, 1.2, 0.2], { free: [0, 0], fiber: [1, 2.5] }],
  // Крупы, хлеб, бобовые
  [['Гречка варёная', 200, 220, 42, 8, 2], { sugar: [0, 2], free: [0, 1], fiber: [4, 7] }],
  [['Овсяные хлопья', 50, 183, 30, 6, 3.5], { sugar: [0, 1.5], free: [0, 0.5], fiber: [4, 6.5] }],
  [['Рис варёный', 200, 260, 56, 5.4, 0.6], { sugar: [0, 0.5], fiber: [0.4, 1.4] }],
  [['Хлеб белый', 50, 132, 25, 4, 1.6], { sugar: [1.5, 3.5], fiber: [1, 2] }],
  [['Мюсли', 60, 222, 40, 6, 3], { sugar: [8, 15], fiber: [3, 6] }],
  [['Чечевица варёная', 200, 232, 40, 18, 0.8], { free: [0, 0], fiber: [12, 18] }],
  // Блюда
  [['Борщ', 300, 147, 12, 6, 6], { sugar: [4, 9], free: [0, 2], fiber: [2, 4] }],
  [['Пельмени', 250, 690, 72, 30, 30], { sugar: [1, 6], fiber: [2, 5] }],
  [['Салат Цезарь', 250, 475, 15, 25, 35], { fiber: [1, 4] }],
]

for (const [[name, grams, kcal, carbs, protein, fat], want] of CASES) {
  test(`${name}, ${grams} г: сахар и клетчатка правдоподобны`, () => {
    const m = { name, unit: 'г', grams, kcal, carbs, protein, fat }
    const got = {
      sugar: estimateCarbs(m).sugar,
      free: freeSugarOf(m).grams,
      fiber: fiberOf(m).grams,
    }
    for (const [key, [lo, hi]] of Object.entries(want)) {
      assert.ok(got[key] >= lo - 1e-9 && got[key] <= hi + 1e-9,
        `${key}: ${got[key].toFixed(2)} г вне [${lo}; ${hi}] (профиль ${carbRefFor(m).key})`)
    }
  })
}

test('весь каталог: свободные ≤ все сахара ≤ углеводы, клетчатка в разумных пределах', () => {
  const problems = []
  for (const f of FOODS) {
    if (f.builder || !(f.carbs >= 0)) continue
    const m = { ...f, grams: 100, unit: f.unit || 'г' }
    const free = freeSugarOf(m)
    const fiber = fiberOf(m).grams
    if (!(free.grams >= 0 && free.grams <= free.total + 1e-9 && free.total <= f.carbs + 1e-9)) {
      problems.push(`${f.name}: свободных ${free.grams}, всего ${free.total}, углеводов ${f.carbs}`)
    }
    // Больше 45 г клетчатки на 100 г не бывает даже у отрубей и чиа.
    if (!(fiber >= 0 && fiber <= 45)) problems.push(`${f.name}: клетчатка ${fiber}`)
  }
  assert.deepEqual(problems, [])
})

test('каталог по группам: сладкое сладкое, фрукты без свободного сахара, орехи с клетчаткой', () => {
  const problems = []
  for (const f of FOODS) {
    if (f.builder || !(f.carbs > 0)) continue
    const m = { ...f, grams: 100, unit: f.unit || 'г' }
    const free = freeSugarOf(m)
    const fiber = fiberOf(m).grams
    const sugarFree = /без сахара|zero|light|sugarfree|max/i.test(f.name)
    if (f.cat === 'sweet' && !sugarFree && !/протеин|пудинг/i.test(f.name) && free.total < f.carbs * 0.3) {
      problems.push(`сладкое «${f.name}»: сахара ${free.total.toFixed(1)} из ${f.carbs}`)
    }
    if ((f.cat === 'fruit' || f.cat === 'berry') && !/цукат|в сахаре/i.test(f.name) && free.grams > 0.05) {
      problems.push(`фрукт «${f.name}»: свободных ${free.grams.toFixed(1)}`)
    }
    if (f.cat === 'nut' && !/паста|урбеч/i.test(f.name) && fiber < 3) {
      problems.push(`орехи «${f.name}»: клетчатки ${fiber.toFixed(1)} на 100 г`)
    }
    if (f.cat === 'drink' && sugarFree && free.total > 0.5) {
      problems.push(`напиток без сахара «${f.name}»: сахара ${free.total.toFixed(1)}`)
    }
    if (['meat', 'poultry', 'fish', 'egg'].includes(f.cat) && fiber > 1.5 && !/панир|наггетс|шницел|палоч/i.test(f.name)) {
      problems.push(`животный белок «${f.name}»: клетчатки ${fiber.toFixed(1)}`)
    }
  }
  assert.deepEqual(problems, [])
})

// ── Предохранитель от неверно опознанного продукта ───────────────────────────
// Каталог FOODS всегда согласован: у «Чипсов» и название, и ккал — от чипсов.
// А вот запись со штрихкода или от руки — нет: имя может быть составным или
// брендовым («Crunchips») и не найти своё правило в carbRef.js, зацепившись
// за случайное другое слово («paprika» → профиль болгарского перца, 31
// ккал/100 г). Тогда клетчатку и сахар тянут на калорийность РЕАЛЬНОГО
// продукта (fromRef, byEnergy) через профиль, который к нему никак не
// относится — и получаются абсурдные граммы. Чинить нужно не конкретное
// слово (их бесконечно много), а сам факт: оценка обязана оставаться
// правдоподобной, даже если профиль найден неверно.
test('несоответствие калорийности найденного профиля калорийности записи не даёт абсурдную клетчатку/сахар', () => {
  // [запись, ожидаемый максимум клетчатки в граммах на запись]. Максимум —
  // не точная цифра (это оценка), а потолок правдоподобия: без предохранителя
  // в refForEntry (nutrition.js) обе записи дают в разы больше.
  const cases = [
    // Воспроизводит реальный баг: «Crunchips Hot Paprika» без исправления
    // бренда в RULES нашёл бы профиль болгарского перца (31 ккал/100 г,
    // 2.1 г клетчатки/100 г) для пачки чипсов (537 ккал/100 г). Без
    // предохранителя это даёт 48.75 г клетчатки на 150 г; с ним — ≈8.5 г.
    [{ name: 'Snaxoids Hot Paprika', grams: 150, unit: 'г', kcal: 806, carbs: 75, protein: 8.4, fat: 51 }, 15],
    // Та же ошибка с другим профилем: составное/брендовое слово зацепилось
    // за «овощ» (30 ккал/100 г) вместо реального жареного снека
    // (224 ккал/100 г). Без предохранителя — 24.6 г клетчатки на 150 г;
    // с ним — ≈8.5 г.
    [{ name: 'ОвощTop Snack Bites', grams: 150, unit: 'г', kcal: 336, carbs: 75, protein: 5, fat: 10 }, 15],
  ]
  const problems = []
  for (const [m, maxFiber] of cases) {
    const fiber = fiberOf(m).grams
    const sugar = freeSugarOf(m)
    if (!(fiber >= 0 && fiber <= maxFiber)) {
      problems.push(`${m.name}: клетчатка ${fiber.toFixed(1)} г при массе ${m.grams} г (ожидали ≤ ${maxFiber})`)
    }
    if (!(sugar.grams >= 0 && sugar.grams <= sugar.total + 1e-9 && sugar.total <= m.carbs + 1e-9)) {
      problems.push(`${m.name}: свободных ${sugar.grams.toFixed(1)}, всего ${sugar.total.toFixed(1)}, углеводов ${m.carbs}`)
    }
  }
  assert.deepEqual(problems, [])
})
