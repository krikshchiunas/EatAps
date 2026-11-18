// Разбор ответа Open Food Facts: что попадает в дневник по штрихкоду.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOffProduct, offKcal, offProductName, lookupBarcode } from './foods.js'
import { catalogId } from './catalog.js'

test('название: язык интерфейса, затем основное, затем запасные', () => {
  assert.equal(offProductName({ product_name: 'Twaróg', product_name_ru: 'Творог' }, ['ru', 'en']), 'Творог')
  assert.equal(offProductName({ product_name: 'Twaróg', product_name_ru: 'Творог' }, ['de', 'ru', 'en']), 'Twaróg')
  assert.equal(offProductName({ product_name: '', product_name_en: 'Curd' }, ['de', 'ru', 'en']), 'Curd')
  assert.equal(offProductName({ generic_name: 'Сыр полутвёрдый' }, ['ru']), 'Сыр полутвёрдый')
  assert.equal(offProductName({}, ['ru']), '')
})

test('калорийность: ккал, затем кДж, затем по БЖУ', () => {
  assert.deepEqual(offKcal({ 'energy-kcal_100g': 250 }), { kcal: 250, src: 'label' })
  const kj = offKcal({ 'energy-kj_100g': 1046 })
  assert.equal(Math.round(kj.kcal), 250)
  // Старые записи: «energy» — это тоже килоджоули.
  assert.equal(Math.round(offKcal({ energy_100g: 1046 }).kcal), 250)
  // Энергии нет, но известны все три макронутриента — по 4/4/9.
  const byMacros = offKcal({ proteins_100g: 10, carbohydrates_100g: 20, fat_100g: 5 })
  assert.deepEqual(byMacros, { kcal: 165, src: 'macros' })
  // Двух из трёх мало: выдумывать третий нельзя.
  assert.deepEqual(offKcal({ proteins_100g: 10, carbohydrates_100g: 20 }), { kcal: null, src: null })
})

test('килоджоули, вписанные в поле «ккал», узнаются и переводятся', () => {
  // Творог 9%: Б16 У3 Ж9 → ~157 ккал. В базе «657 ккал» — это кДж.
  const r = offKcal({ 'energy-kcal_100g': 657, proteins_100g: 16, carbohydrates_100g: 3, fat_100g: 9 })
  assert.equal(r.src, 'kj-fixed')
  assert.equal(Math.round(r.kcal), 157)
  // Настоящий жирный продукт не трогаем: масло 748 ккал при Ж82.5.
  const butter = offKcal({ 'energy-kcal_100g': 748, proteins_100g: 0.5, carbohydrates_100g: 0.8, fat_100g: 82.5 })
  assert.deepEqual(butter, { kcal: 748, src: 'label' })
})

const CHEESE = {
  product_name_ru: 'Сыр Гауда 45%',
  brands: 'Ламбер,Unimilk',
  quantity: '230 г',
  product_quantity: 230,
  serving_quantity: 20,
  categories_tags: ['en:dairies', 'en:cheeses'],
  image_front_url: 'https://images.openfoodfacts.org/x.jpg',
  nutriments: { 'energy-kcal_100g': 356, proteins_100g: 25, carbohydrates_100g: 0, fat_100g: 27, 'saturated-fat_100g': 17 },
}

test('товар с полной этикеткой: бренд, порции, категория, фото', () => {
  const r = parseOffProduct(CHEESE, '4601234567893')
  assert.equal(r.status, 'ok')
  const f = r.food
  assert.equal(f.name, 'Сыр Гауда 45% · Ламбер')
  assert.equal(f.title, 'Сыр Гауда 45%')
  assert.equal(f.brand, 'Ламбер')
  assert.equal(f.kcal, 356)
  assert.equal(f.cat, 'cheese')
  assert.equal(f.barcode, '4601234567893')
  assert.equal(f.defaultGrams, 20)
  assert.deepEqual(f.portions.map((p) => p.grams), [20, 230])
  assert.ok(!('kcalSrc' in f))
})

test('порция «пачка» — каталожная и переводится', () => {
  const r = parseOffProduct(CHEESE, '4601234567893')
  const pack = r.food.portions.find((p) => p.grams === 230)
  // Раньше подпись была «упаковка» — её нет в каталоге порций, и в любом
  // интерфейсе, кроме русского, на кнопке висело русское слово.
  assert.equal(catalogId('portions', pack.label), 'portion_pack')
})

test('товар без состава — черновик своего продукта со всем, что известно', () => {
  const r = parseOffProduct({ ...CHEESE, nutriments: {} }, '4601234567893')
  assert.equal(r.status, 'no-nutrition')
  assert.equal(r.name, 'Сыр Гауда 45% · Ламбер')
  assert.equal(r.draft.barcode, '4601234567893')
  assert.equal(r.draft.brand, 'Ламбер')
  assert.equal(r.draft.title, 'Сыр Гауда 45%')
  assert.equal(r.draft.photo, CHEESE.image_front_url)
  assert.ok(r.draft.portions.some((p) => p.grams === 230))
})

test('без названия товар считается ненайденным', () => {
  assert.deepEqual(parseOffProduct({ nutriments: { 'energy-kcal_100g': 100 } }, '1'), { status: 'not-found' })
})

test('сеть: зависший ответ не вешает сканер навсегда', async () => {
  const realFetch = globalThis.fetch
  const realTimeout = globalThis.setTimeout
  // Ускоряем время: таймаут базы 8 с, ждать его в тесте незачем.
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 5), ...a)
  globalThis.fetch = (url, { signal } = {}) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  try {
    await assert.rejects(lookupBarcode('9999999999994'), /off_timeout/)
  } finally {
    globalThis.fetch = realFetch
    globalThis.setTimeout = realTimeout
  }
})

test('сеть: один обрыв связи переживается повтором', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return { status: 200, ok: true, json: async () => ({ status: 1, product: CHEESE }) }
  }
  try {
    const r = await lookupBarcode('4601234567886')
    assert.equal(r.status, 'ok')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = realFetch
  }
})
