// «Мои продукты»: модель, штрихкоды, слияние между устройствами.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanBarcode, gtin14, sameBarcode, findProductByBarcode, productLabel, splitBrand,
  normalizeProduct, productAsFood, productsForBase, productDraftFrom, upsertProduct, MAX_PRODUCTS,
  ownProductsFirst,
} from './myProducts.js'
import { mergeState, normalizeState, pickSyncable, clearedState, tombProduct, SYNC_KEYS } from './syncModel.js'
import { foodSnapshot } from './library.js'
import { scale } from './foods.js'

const GOUDA = {
  id: 'p1', name: 'Гауда 45%', brand: 'Ламбер', emoji: '🧀', unit: 'г',
  kcal: 356, protein: 25, carbs: 0, fat: 27, cat: 'cheese', baseId: 'food_gouda',
  barcode: '4601234567893', packGrams: 230, portionGrams: 20,
}

test('штрихкод: только цифры и только длины товарных кодов', () => {
  assert.equal(cleanBarcode(' 4601-2345 67893 '), '4601234567893')
  assert.equal(cleanBarcode('96385074'), '96385074')
  assert.equal(cleanBarcode('012345678905'), '012345678905')
  for (const bad of ['', '123', '1234567890', '123456789012345', null, undefined, 'abc']) {
    assert.equal(cleanBarcode(bad), '', `принят мусор: ${bad}`)
  }
})

test('один товар под 12, 13 и 14 цифрами — один и тот же', () => {
  assert.equal(gtin14('012345678905'), '00012345678905')
  assert.ok(sameBarcode('012345678905', '0012345678905'))
  assert.ok(sameBarcode('0012345678905', '00012345678905'))
  // EAN-8 не сталкивается с похожим EAN-13.
  assert.ok(!sameBarcode('96385074', '9638507400000'))
  assert.ok(!sameBarcode('', ''))
})

test('поиск своего продукта по штрихкоду терпит разные написания', () => {
  const list = [GOUDA, { id: 'p2', name: 'Кола', kcal: 42, barcode: '012345678905' }]
  assert.equal(findProductByBarcode(list, '4601234567893')?.id, 'p1')
  assert.equal(findProductByBarcode(list, '0012345678905')?.id, 'p2')
  assert.equal(findProductByBarcode(list, '4006381333931'), null)
  assert.equal(findProductByBarcode(list, ''), null)
})

test('название с брендом: бренд не повторяется', () => {
  assert.equal(productLabel(GOUDA), 'Гауда 45% · Ламбер')
  assert.equal(productLabel({ name: 'Простоквашино молоко 2,5%', brand: 'простоквашино' }), 'Простоквашино молоко 2,5%')
  assert.equal(productLabel({ name: 'Гречка' }), 'Гречка')
  assert.deepEqual(splitBrand('Сыр Гауда 45% · Ламбер'), { name: 'Сыр Гауда 45%', brand: 'Ламбер' })
  assert.deepEqual(splitBrand('Гречка'), { name: 'Гречка', brand: '' })
})

test('нормализация: неизвестное остаётся неизвестным, мусор отбрасывается', () => {
  const p = normalizeProduct({ name: '  Хлеб  ', kcal: '250', protein: '', carbs: '48,5', fat: 'abc', baseId: 'nope', barcode: 'x', photo: 'javascript:alert(1)' })
  assert.equal(p.name, 'Хлеб')
  assert.equal(p.kcal, 250)
  assert.equal(p.protein, null, 'пустое поле — не ноль')
  assert.equal(p.carbs, 48.5)
  assert.equal(p.fat, null)
  assert.equal(p.unit, 'г')
  assert.equal('baseId' in p, false, 'ссылка на несуществующий продукт базы')
  assert.equal('barcode' in p, false)
  assert.equal('photo' in p, false, 'фото только по https')
  assert.equal(normalizeProduct({ name: '', kcal: 100 }), null)
  assert.equal(normalizeProduct({ name: 'Без калорий' }), null)
  assert.equal(normalizeProduct({ name: 'Слишком', kcal: 5000 }), null)
  assert.equal(normalizeProduct(null), null)
})

test('мой продукт работает как обычная еда на 100 г', () => {
  const f = productAsFood(GOUDA)
  assert.equal(f.name, 'Гауда 45% · Ламбер')
  assert.equal(f.source, 'product')
  assert.equal(f.productId, 'p1')
  assert.equal(f.baseId, 'food_gouda')
  assert.equal(f.defaultGrams, 20, 'порция с упаковки')
  assert.deepEqual(f.portions.map((p) => p.grams), [20, 230])
  const s = scale(f, 40)
  assert.equal(s.kcal, Math.round(356 * 0.4))
  // Снимок (избранное, рецепт) помнит ссылки.
  const snap = foodSnapshot({ ...f, grams: 40 })
  assert.equal(snap.productId, 'p1')
  assert.equal(snap.baseId, 'food_gouda')
})

test('варианты продукта базы', () => {
  const list = [GOUDA, { id: 'p2', name: 'Гауда фермерская', kcal: 360, baseId: 'food_gouda' }, { id: 'p3', name: 'Кефир', kcal: 50 }]
  assert.deepEqual(productsForBase(list, 'food_gouda').map((p) => p.id), ['p1', 'p2'])
  assert.deepEqual(productsForBase(list, null), [])
})

test('черновик из товара со штрихкода переносит цифры и порции', () => {
  const scanned = {
    name: 'Сыр Гауда 45% · Ламбер', title: 'Сыр Гауда 45%', brand: 'Ламбер', emoji: '🧀', unit: 'г',
    kcal: 356, protein: 25, carbs: null, fat: 27, cat: 'cheese', barcode: '4601234567893',
    portions: [{ label: 'порция', grams: 20 }, { label: 'пачка', grams: 230 }], photo: 'https://images.example/1.jpg',
  }
  const d = productDraftFrom(scanned)
  assert.equal(d.name, 'Сыр Гауда 45%')
  assert.equal(d.brand, 'Ламбер')
  assert.equal(d.carbs, null)
  assert.equal(d.portionGrams, 20)
  assert.equal(d.packGrams, 230)
  assert.equal(d.barcode, '4601234567893')
  // Повторный разбор черновика ничего не теряет.
  assert.deepEqual(productDraftFrom(d), d)
  // Продукт базы как образец: ссылка на него становится baseId.
  const base = productDraftFrom({ name: 'Сыр Гауда', foodId: 'food_gouda', kcal: 356 })
  assert.equal(base.baseId, 'food_gouda')
})

test('вставка: тот же штрихкод — правка, а не второй продукт', () => {
  let { list, entry } = upsertProduct([], GOUDA, { id: 'p1', ts: 't1' })
  assert.equal(list.length, 1)
  assert.equal(entry.updatedAt, 't1')
  const again = upsertProduct(list, { ...GOUDA, id: undefined, kcal: 360, barcode: '04601234567893' }, { id: 'zzz', ts: 't2' })
  assert.equal(again.list.length, 1, 'второй скан той же пачки завёл дубль')
  assert.equal(again.entry.id, 'p1')
  assert.equal(again.entry.kcal, 360)
  assert.ok(again.existing)
  const other = upsertProduct(again.list, { name: 'Кефир', kcal: 50 }, { id: 'p2', ts: 't3' })
  assert.equal(other.list.length, 2)
  assert.equal(other.list[0].id, 'p2', 'новое — в начало')
})

test('полный список не вытесняет старое молча', () => {
  const list = Array.from({ length: MAX_PRODUCTS }, (_, i) => ({ id: 'p' + i, name: 'П' + i, kcal: 10 }))
  const res = upsertProduct(list, { name: 'Ещё один', kcal: 10 }, { id: 'new', ts: 't' })
  assert.equal(res.full, true)
  assert.equal(res.entry, null)
  assert.equal(res.list.length, MAX_PRODUCTS)
  // Правка существующего проходит и при полном списке.
  assert.equal(upsertProduct(list, { id: 'p3', name: 'П3', kcal: 20 }, { ts: 't' }).entry.kcal, 20)
})

test('в выдаче мои продукты — первыми, остальной порядок не меняется', () => {
  const base = { name: 'Гауда', foodId: 'food_gouda' }
  const aged = { name: 'Гауда выдержанная', foodId: 'food_aged_gouda' }
  const mine = { name: 'Гауда 45% · Ламбер', source: 'product', baseId: 'food_gouda' }
  const kefir = { name: 'Кефир', source: 'product' }
  assert.deepEqual(ownProductsFirst([base, aged, mine, kefir]).map((f) => f.name), ['Гауда 45% · Ламбер', 'Кефир', 'Гауда', 'Гауда выдержанная'])
  const plain = [base, aged]
  assert.equal(ownProductsFirst(plain), plain, 'без своих продуктов выдача та же самая')
  assert.deepEqual(ownProductsFirst(null), [])
})

// ── Синхронизация ────────────────────────────────────────────────────────────

const TS1 = '000001700000001-00000-dev00001'
const TS2 = '000001700000002-00000-dev00002'
const TS3 = '000001700000003-00000-dev00001'

test('мои продукты уезжают в облако и сливаются по записям', () => {
  assert.ok(SYNC_KEYS.includes('products'))
  const phone = { products: [{ ...GOUDA, updatedAt: TS1 }] }
  const laptop = { products: [{ id: 'p2', name: 'Кефир', kcal: 50, updatedAt: TS2 }] }
  const merged = mergeState(phone, laptop)
  assert.deepEqual(merged.products.map((p) => p.id).sort(), ['p1', 'p2'])
  assert.ok('products' in pickSyncable(merged))
  // Правка новее побеждает.
  const edited = mergeState(merged, { products: [{ ...GOUDA, kcal: 999, updatedAt: TS3 }] })
  assert.equal(edited.products.find((p) => p.id === 'p1').kcal, 999)
})

test('удалённый продукт не воскресает из копии другого устройства', () => {
  const withTomb = { products: [], meta: { tombstones: { [tombProduct('p1')]: TS2 } } }
  const stale = { products: [{ ...GOUDA, updatedAt: TS1 }] }
  assert.equal(mergeState(withTomb, stale).products.length, 0)
  assert.equal(mergeState(stale, withTomb).products.length, 0)
})

test('сброс данных хоронит и мои продукты', () => {
  const s = normalizeState({ products: [{ ...GOUDA, updatedAt: TS1 }] })
  const cleared = clearedState(s, TS2)
  assert.deepEqual(cleared.products, [])
  assert.equal(cleared.meta.tombstones[tombProduct('p1')], TS2)
})

test('состояние без продуктов (старая версия) читается как пустой список', () => {
  assert.deepEqual(normalizeState({}).products, [])
  assert.deepEqual(normalizeState({ products: 'мусор' }).products, [])
})

// ── Поиск ────────────────────────────────────────────────────────────────────

test('свой продукт находится по продукту базы на любом языке и по категории', async () => {
  const search = await import('./search/index.js')
  const { FOODS } = await import('./foods.js')
  const { productsAsFoods } = await import('./myProducts.js')
  await search.loadSearchNames()
  const own = productsAsFoods([{ id: 'p1', name: 'Ламбер 50%', brand: 'Умалат', kcal: 356, cat: 'cheese', baseId: 'food_gouda' }])
  const pool = [...own, ...FOODS]
  for (const q of ['ламбер', 'умалат', 'гауда', 'gouda', 'сыр']) {
    const res = ownProductsFirst(search.searchItems(pool, q).results)
    assert.equal(res[0]?.productId, 'p1', `«${q}»: свой продукт не первый`)
  }
  // Свой продукт не склеивается с продуктом базы: в выдаче оба.
  const res = search.searchItems(pool, 'гауда').results
  assert.ok(res.some((f) => f.foodId === 'food_gouda'), 'пропала обычная Гауда')
  // Без ссылки на базу и без категории — только по своему названию.
  const plain = productsAsFoods([{ id: 'p2', name: 'Ламбер', kcal: 356 }])
  assert.ok(!search.searchItems([...plain, ...FOODS], 'gouda').results.some((f) => f.productId === 'p2'))
})

test('своё название товара со штрихкода: название с упаковки остаётся для поиска', async () => {
  const scanned = { name: 'Quark 9% · Milbona', title: 'Quark 9%', brand: 'Milbona', source: 'off', barcode: '4006381333931', kcal: 157 }
  const d = productDraftFrom(scanned)
  assert.equal(d.name, 'Quark 9%')
  assert.equal(d.dbName, 'Quark 9%')
  // Оставил как в базе — второй копии названия не храним.
  assert.equal('dbName' in normalizeProduct({ ...d }), false)
  // Назвал по-своему — показывается своё, название с упаковки хранится.
  const own = normalizeProduct({ ...d, name: 'Творожок к завтраку' })
  assert.equal(own.dbName, 'Quark 9%')
  const food = productAsFood({ ...own, id: 'p9' })
  assert.equal(food.name, 'Творожок к завтраку · Milbona')
  assert.equal(food.dbName, 'Quark 9%')
  // Поиск находит его и по названию с пачки.
  const search = await import('./search/index.js')
  await search.loadSearchNames()
  assert.equal(search.searchItems([food], 'quark').results[0]?.productId, 'p9')
  // Продукт, заведённый руками без штрихкода, названия «из базы» не получает.
  assert.equal(productDraftFrom({ name: 'Гречка', kcal: 330 }).dbName, null)
})
