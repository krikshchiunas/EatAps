// Стабильные id каталога и совместимость со старыми данными: записи, сделанные
// до появления id, находят свой продукт и показываются на языке человека;
// свои названия не переводятся; переименованная запись не тянет чужой id.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { setLang, LANGS, SOURCE_LANG } from './i18n.js'
import { catalogId, catalogRef, canonicalName, isCatalogId, withCatalogRef, methodId } from './catalog.js'
import { foodName, entryName, methodLabel, portionLabel, alcLabel, catalogName } from './foodNames.js'
import { FOODS } from './foods.js'
import legacyNames from '../data/legacyNames.js'

after(() => setLang(SOURCE_LANG, { persist: false }))

test('старые русские названия из дневника → id', () => {
  assert.equal(catalogId('foods', 'Овсяные хлопья сухие'), 'food_rolled_oats_dry')
  assert.equal(catalogId('foods', 'food_rolled_oats_dry'), 'food_rolled_oats_dry')
  assert.equal(catalogId('foods', 'овсяные хлопья сухие'), 'food_rolled_oats_dry', 'регистр')
  assert.equal(catalogId('foods', 'Сельдь'), catalogId('foods', 'сельдь'))
  for (const [name, id] of Object.entries(legacyNames.foods)) assert.equal(catalogId('foods', name), id, name)
  assert.equal(catalogId('foods', 'Бабушкин борщ'), null)
  for (const evil of ['__proto__', 'constructor', 'hasOwnProperty', '', null, 42, {}]) {
    assert.equal(catalogId('foods', evil), null, String(evil))
    assert.equal(isCatalogId('foods', evil), false)
  }
})

test('у каждого продукта базы есть id, и он ведёт обратно к его названию', () => {
  for (const f of FOODS) {
    assert.ok(f.foodId, f.name)
    assert.equal(canonicalName('foods', f.foodId), f.name)
    // Поля id у продукта базы нет: { id, ...food } в записи дневника иначе
    // затёр бы уникальный id записи, и две записи одного продукта слиплись бы.
    assert.equal(f.id, undefined)
  }
})

test('ссылка на каталог для составных названий записи', () => {
  assert.deepEqual(catalogRef('Картофель, варёный'), { foodId: 'food_potato', methodId: methodId('Варёный') })
  assert.deepEqual(catalogRef('Молоко 2.5%'), { foodId: 'food_milk' })
  assert.deepEqual(catalogRef('Овсянка'), { foodId: 'food_oatmeal' })
  assert.equal(catalogRef('Моя овсянка'), null)
  assert.equal(catalogRef(''), null)
})

test('withCatalogRef: id пересчитывается по названию при каждой записи', () => {
  assert.deepEqual(withCatalogRef({ name: 'Банан', kcal: 89 }), { name: 'Банан', kcal: 89, foodId: 'food_banana' })
  // Переименовали — id снят: своё название не должно показываться чужим.
  assert.deepEqual(withCatalogRef({ name: 'Банан от бабушки', foodId: 'food_banana', kcal: 89 }), { name: 'Банан от бабушки', kcal: 89 })
  // Подложенный чужой id не прилипает к другому продукту.
  assert.equal(withCatalogRef({ name: 'Яблоко', foodId: 'food_banana' }).foodId, 'food_apple')
  assert.equal(withCatalogRef(null), null)
})

test('старая запись дневника показывается на каждом языке, своя — как записана', async () => {
  const oldEntry = { name: 'Овсяные хлопья сухие', kcal: 366 } // записано год назад, без id
  const mine = { name: 'Бабушкин борщ', kcal: 120 }
  const expected = { en: 'Rolled oats, dry', de: 'Haferflocken, trocken' }
  try {
    for (const l of LANGS) {
      await setLang(l.code, { persist: false })
      const shown = entryName(oldEntry)
      if (expected[l.code]) assert.equal(shown, expected[l.code])
      if (l.code !== 'ru') assert.doesNotMatch(shown, /[а-яё]/i, `${l.code}: ${shown}`)
      assert.equal(entryName(mine), 'Бабушкин борщ', 'своё не переводится')
      // Запись с id, но пустым названием — по id.
      assert.equal(foodName('', 'food_banana'), catalogName('food_banana'))
      // Переименованная старой версией приложения: id есть, название своё.
      assert.equal(foodName('Мой банан', 'food_banana'), 'Мой банан')
    }
  } finally {
    await setLang(SOURCE_LANG, { persist: false })
  }
})

test('способы, порции и алкоголь — по id, со старыми написаниями', async () => {
  try {
    await setLang('es', { persist: false })
    assert.equal(foodName('Свинина, варёная'), 'Cerdo, cocido', 'род согласован по-испански')
    assert.equal(methodLabel('Варёная', 'Свинина'), 'Cocido')
    assert.equal(portionLabel('стакан'), 'vaso')
    assert.equal(portionLabel('2 шт'), '2 ud.')
    assert.equal(alcLabel('Самогон / другое'), alcLabel('Самогон / Другое'), 'старое написание')
    await setLang('de', { persist: false })
    assert.equal(foodName('Картофель, пюре'), 'Kartoffeln, Püree')
    assert.equal(foodName('Молоко 2.5%'), 'Milch 2,5%')
  } finally {
    await setLang(SOURCE_LANG, { persist: false })
  }
})

test('продукт базы, развёрнутый в запись, не затирает её id', () => {
  // Так запись собирает store.addFood: { id, createdAt, ...withCatalogRef(food) }.
  const banana = FOODS.find((f) => f.foodId === 'food_banana')
  const a = { id: 'entry-1', createdAt: 'x', ...withCatalogRef({ ...banana, grams: 120 }) }
  const b = { id: 'entry-2', createdAt: 'x', ...withCatalogRef({ ...banana, grams: 80 }) }
  assert.equal(a.id, 'entry-1')
  assert.equal(b.id, 'entry-2')
  assert.equal(a.foodId, 'food_banana')
})
