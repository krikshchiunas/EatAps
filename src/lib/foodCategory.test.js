// Товары с полки: категория, напиток или нет, сахар и клетчатка с этикетки.
//
// Два случая отсюда пришли с реального экрана «Что внутри»:
//   • «Country · Kinder», 168 г: 92 г углеводов, а свободных сахаров «≈4,6 г»,
//     сложных «≈0 г · 0%», витамины «не удалось отнести ни к одной группе»;
//   • «Nut-Mix Natural · Trader Joe's»: орехи записаны как «40 мл» напитка.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { categoryFromOff, categoryFromName, isDrinkTag } from './foodCategory.js'
import { freeSugarOf, fiberOf, sumQuality, freeSugarShare } from './nutrition.js'
import { classifyComplexCarb, estimateProteinQuality, estimateSaturatedFat } from './nutritionClassification.js'
import { microsForEntry } from './foodMicros.js'
import { looksLikeDrink, lookupBarcode, inferCat, scale } from './foods.js'

after(() => { delete globalThis.fetch })

// Теги, как их отдаёт Open Food Facts.
const KINDER_TAGS = [
  'en:snacks', 'en:sweet-snacks', 'en:cocoa-and-its-products', 'en:confectioneries',
  'en:chocolate-candies', 'en:bars', 'en:chocolate-bars', 'en:filled-chocolate-bars',
]
const NUTS_TAGS = [
  'en:plant-based-foods-and-beverages', 'en:plant-based-foods', 'en:nuts-and-their-products',
  'en:nuts', 'en:mixed-nuts',
]

// ── Категория ────────────────────────────────────────────────────────────────

test('категория по тегам базы: шоколад — сладкое, ореховая смесь — орехи', () => {
  assert.equal(categoryFromOff(KINDER_TAGS), 'sweet')
  assert.equal(categoryFromOff(NUTS_TAGS), 'nut')
  // Узкое сильнее широкого — независимо от порядка тегов.
  assert.equal(categoryFromOff(['en:nuts', 'en:salty-snacks', 'en:snacks']), 'nut', 'солёный арахис — орех')
  assert.equal(categoryFromOff(['en:nuts', 'en:chocolates']), 'sweet', 'орехи в шоколаде — сладкое')
  assert.equal(categoryFromOff(['en:spreads', 'en:cocoa-and-hazelnuts-spreads', 'en:hazelnuts']), 'sweet', 'нутелла')
  assert.equal(categoryFromOff(['en:dairies', 'en:cheeses', 'en:cottage-cheeses']), 'dairy', 'творог')
  assert.equal(categoryFromOff(['en:plant-based-foods-and-beverages', 'en:beverages', 'en:fruit-juices']), 'drink')
  assert.equal(categoryFromOff([]), null)
  assert.equal(categoryFromOff(undefined), null)
  assert.equal(categoryFromOff(['en:plant-based-foods-and-beverages', 'en:plant-based-foods']), null, 'общий тег ничего не говорит')
})

test('категория по иноязычному названию и бренду', () => {
  assert.equal(categoryFromName('Country · Kinder'), 'sweet')
  assert.equal(categoryFromName("Nut-Mix Natural · Trader Joe's"), 'nut')
  assert.equal(categoryFromName('Peanut Butter Crunchy'), 'nut', 'не сливочное масло')
  assert.equal(categoryFromName('Almond Milk Unsweetened'), 'drink', 'не орехи')
  assert.equal(categoryFromName('Orange Juice'), 'drink', 'не фрукт')
  assert.equal(categoryFromName('Tomato Ketchup'), 'sauce', 'не овощ')
  assert.equal(categoryFromName('Vanilla Ice Cream'), 'sweet', 'не сливки')
  assert.equal(categoryFromName('Nutella'), 'sweet', '«nut» — только целым словом')
  assert.equal(categoryFromName('Müsli Classic'), 'grain', 'диакритика не мешает')
  assert.equal(categoryFromName('Coca-Cola'), 'drink')
  assert.equal(categoryFromName('Сникерс'), 'sweet')
  assert.equal(categoryFromName('Something Else'), null)
  assert.equal(categoryFromName(''), null)
})

test('порции латинского товара — по его категории', () => {
  assert.equal(inferCat("Nut-Mix Natural · Trader Joe's"), 'nut')
  assert.equal(inferCat('Country · Kinder'), 'sweet')
  assert.equal(inferCat('Шоколад молочный'), 'sweet', 'русские подсказки по-прежнему первые')
})

// ── Напиток или нет ──────────────────────────────────────────────────────────

test('«plant-based-foods-and-beverages» — не напиток', () => {
  assert.equal(isDrinkTag('en:plant-based-foods-and-beverages'), false)
  assert.equal(isDrinkTag('en:beverages'), true)
  assert.equal(isDrinkTag('en:carbonated-drinks'), true)
  assert.equal(isDrinkTag('fr:boissons-gazeuses'), true)
  assert.equal(isDrinkTag('en:nuts'), false)
})

test('ореховая смесь со штрихкода — граммы, а не миллилитры', () => {
  assert.equal(looksLikeDrink({ categories_tags: NUTS_TAGS }), false)
  assert.equal(looksLikeDrink({ categories_tags: NUTS_TAGS, quantity: '16 oz (454 g)' }), false)
  // Единица из базы — прямой ответ, сильнее всего остального.
  assert.equal(looksLikeDrink({ product_quantity_unit: 'g', categories_tags: ['en:beverages'] }), false)
  assert.equal(looksLikeDrink({ product_quantity_unit: 'ml' }), true)
  // Строка количества сильнее тегов: молотый кофе лежит в «beverages».
  assert.equal(looksLikeDrink({ quantity: '250 g', categories_tags: ['en:beverages', 'en:coffees'] }), false)
  assert.equal(looksLikeDrink({ quantity: '330 ml' }), true)
  assert.equal(looksLikeDrink({ quantity: '1 л' }), true, 'кириллица без \\b')
  assert.equal(looksLikeDrink({ quantity: '12 fl oz' }), true, 'жидкие унции — объём')
  assert.equal(looksLikeDrink({ categories_tags: ['en:beverages', 'en:sodas'] }), true)
})

test('штрихкод: орехи приходят орехами, с клетчаткой и категорией', async () => {
  const product = {
    product_name: 'Nut-Mix Natural',
    brands: "Trader Joe's",
    quantity: '16 oz (454 g)',
    serving_quantity: 30,
    categories_tags: NUTS_TAGS,
    nutriments: {
      'energy-kcal_100g': 657, proteins_100g: 19, carbohydrates_100g: 21, fat_100g: 59,
      sugars_100g: 4, 'saturated-fat_100g': 6.3, fiber_100g: 8,
    },
  }
  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ status: 1, product }) })
  const r = await lookupBarcode('0012345678905')
  assert.equal(r.status, 'ok')
  assert.equal(r.food.unit, 'г')
  assert.equal(r.food.cat, 'nut')
  assert.equal(r.food.emoji, '🌰')
  assert.equal(r.food.fiber, 8)
  // Клетчатка доезжает до записи дневника вместе с порцией.
  assert.equal(scale(r.food, 40).fiber, 3.2)
})

// ── Сахара, клетчатка, сложные углеводы ──────────────────────────────────────

// Запись дневника, как её пишет добавление товара со штрихкода.
const kinder = {
  name: 'Country · Kinder', unit: 'г', grams: 168, kcal: 902,
  protein: 14.4, carbs: 92.2, fat: 56.8, satFat: 36.8, sugar: 69.9, sugarSrc: 'measured',
}

test('Kinder: свободные сахара — с этикетки, а не 5% углеводов', () => {
  const s = freeSugarOf(kinder)
  assert.equal(s.source, 'label')
  assert.equal(s.grams, 69.9)
  // Старая запись без сахара на этикетке — оценка по типу «сладкое», а не «прочее».
  const est = freeSugarOf({ ...kinder, sugar: undefined, sugarSrc: undefined })
  assert.equal(est.source, 'estimate')
  assert.ok(est.grams > 70, `оценка ${est.grams}`)
  assert.ok(freeSugarShare(kinder) >= 0.8)
})

test('Kinder: сложных углеводов ноль уверенно, а не «состав неясен»', () => {
  assert.deepEqual(classifyComplexCarb(kinder), { share: 0, confidence: 'estimated' })
  assert.notEqual(estimateProteinQuality(kinder).diaas, null, 'белок теперь есть с чем сравнить')
  assert.equal(estimateSaturatedFat(kinder).confidence, 'measured')
})

test('Kinder: витамины и минералы — по группе «сладкое»', () => {
  assert.equal(microsForEntry(kinder).confidence, 'category')
})

test('орехи: сахар орехов не свободный, клетчатка — по типу', () => {
  const nuts = { name: "Nut-Mix Natural · Trader Joe's", unit: 'г', grams: 40, carbs: 8.4, protein: 7.6, fat: 23.6 }
  assert.equal(freeSugarOf(nuts).grams, 0)
  assert.equal(fiberOf(nuts).source, 'estimate')
  assert.ok(fiberOf(nuts).grams > 3, 'у орехов клетчатки много')
  // С этикетки — как есть.
  assert.deepEqual(fiberOf({ ...nuts, fiber: 3.2 }), { grams: 3.2, source: 'label' })
  // Натуральный сахар орехов (≈5 г на 100 г) вычитается из сахара этикетки.
  const sweetened = freeSugarOf({ ...nuts, sugar: 6, sugarSrc: 'measured' })
  assert.equal(sweetened.source, 'adjusted')
  assert.equal(sweetened.grams, 4)
  assert.equal(microsForEntry(nuts).confidence, 'category')
})

test('йогурт: лактоза из сахара этикетки вычитается, фрукт — весь натуральный', () => {
  const y = freeSugarOf({ name: 'Йогурт клубничный', unit: 'г', grams: 150, carbs: 18, sugar: 15, sugarSrc: 'measured' })
  assert.equal(y.source, 'adjusted')
  assert.equal(y.grams, 7.5) // 15 − 5 г/100 г × 150 г
  assert.equal(freeSugarOf({ name: 'Яблоко', unit: 'г', grams: 150, carbs: 20, sugar: 15, sugarSrc: 'measured' }).grams, 0)
})

test('сахара этикетки не бывает больше углеводов', () => {
  const s = freeSugarOf({ name: 'Конфеты', carbs: 10, sugar: 12, sugarSrc: 'measured' })
  assert.equal(s.grams, 10)
})

test('мюсли: сахар этикетки не считается сложными углеводами', () => {
  const c = classifyComplexCarb({ name: 'Мюсли', cat: 'grain', carbs: 60, sugar: 20 })
  assert.equal(c.confidence, 'estimated')
  assert.ok(Math.abs(c.share - 40 / 60) < 1e-9)
  assert.equal(classifyComplexCarb({ name: 'Гречка', cat: 'grain', carbs: 60 }).share, 1)
})

test('экран дня тоже видит сахар с этикетки', () => {
  const q = sumQuality([kinder])
  assert.equal(q.freeSugar, 70)
  assert.equal(q.buckets.sweet, 92.2)
})
