// Проверка товара по штрихкоду: что уходит в модель и что из ответа доходит
// до человека.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECK_SCHEMA, FIELDS, safeImageUrl, productImages, productFacts, buildSystem, buildContent,
  sanitizeCheck, parseCheck, fetchOffProduct, languageName,
} from './barcode.js'

const PRODUCT = {
  product_name: 'Творог 9%',
  product_name_de: 'Quark 9%',
  brands: 'Простоквашино',
  quantity: '200 г',
  product_quantity: 200,
  serving_size: '100 g',
  categories_tags: ['en:dairies', 'en:cottage-cheeses'],
  image_nutrition_url: 'https://images.openfoodfacts.org/images/products/460/123/456/7893/nutrition_ru.12.400.jpg',
  image_front_url: 'https://images.openfoodfacts.org/images/products/460/123/456/7893/front_ru.3.400.jpg',
  nutriments: { 'energy-kcal_100g': 657, proteins_100g: 16, carbohydrates_100g: 3, fat_100g: 9, salt_100g: 0.1, 'nova-group': 1 },
  ingredients_text: 'молоко, закваска',
}

test('схема ответа: все поля обязательны и без лишних — так требует structured outputs', () => {
  const walk = (s, path) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${path}: additionalProperties`)
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path}: required`)
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`)
    }
    if (s.type === 'array') walk(s.items, `${path}[]`)
    for (const alt of s.anyOf || []) walk(alt, path)
  }
  walk(CHECK_SCHEMA, 'check')
  // Ограничения, которых structured outputs не понимает, в схему не попадают.
  assert.doesNotMatch(JSON.stringify(CHECK_SCHEMA), /minimum|maximum|minLength|maxLength|multipleOf/)
})

test('фото — только с серверов Open Food Facts и только https', () => {
  assert.ok(safeImageUrl('https://images.openfoodfacts.org/x.jpg'))
  assert.equal(safeImageUrl('http://images.openfoodfacts.org/x.jpg'), null)
  assert.equal(safeImageUrl('https://evil.example/x.jpg'), null)
  assert.equal(safeImageUrl('https://images.openfoodfacts.org.evil.example/x.jpg'), null)
  assert.equal(safeImageUrl('javascript:alert(1)'), null)
  assert.equal(safeImageUrl(null), null)
  // Таблица состава идёт первой.
  assert.match(productImages(PRODUCT)[0], /nutrition/)
  assert.equal(productImages({ image_front_url: 'https://evil.example/a.jpg' }).length, 0)
})

test('в модель уходит только нужное: название, фасовка, состав', () => {
  const f = productFacts(PRODUCT, '4601234567893')
  assert.equal(f.barcode, '4601234567893')
  assert.equal(f.product_name_de, 'Quark 9%')
  assert.equal(f.nutriments['energy-kcal_100g'], 657)
  assert.equal(f.nutriments['nova-group'], undefined)
  assert.equal(f.nutriments.salt_100g, undefined)
  assert.equal(f.ingredients_text, undefined)
  const content = buildContent(f, productImages(PRODUCT))
  assert.equal(content.filter((b) => b.type === 'image').length, 2)
  assert.equal(content.at(-1).type, 'text')
  assert.deepEqual(content[1].source, { type: 'url', url: PRODUCT.image_nutrition_url })
})

test('пояснения — на языке интерфейса', () => {
  assert.equal(languageName('de'), 'German')
  assert.equal(languageName('xx'), 'English')
  assert.match(buildSystem('ar'), /in Arabic/)
})

const GOOD = {
  status: 'corrected',
  name: null,
  unit: 'g',
  per100: { kcal: 157, protein: 16, carbs: 3, sugar: 3, fat: 9, satFat: 5.5, fiber: null },
  servingSize: null,
  packSize: 200,
  corrections: [{ field: 'kcal', reason: 'В поле «ккал» были килоджоули.' }],
  confidence: 'high',
  summary: 'Калорийность исправлена.',
}

test('ответ модели проходит как есть, если цифры правдоподобны', () => {
  const c = sanitizeCheck(GOOD)
  assert.equal(c.per100.kcal, 157)
  assert.equal(c.confidence, 'high')
  assert.equal(c.corrections[0].field, 'kcal')
})

test('неправдоподобные цифры понижают уверенность — такую проверку не применяют', () => {
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, protein: 60, carbs: 30, fat: 30 } }).confidence, 'low')
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, sugar: 10 } }).confidence, 'low')
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, kcal: 20 } }).confidence, 'low')
  // Вне физических границ — неизвестно, а не «как сказала модель».
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, kcal: 4000 } }).per100.kcal, null)
  // Неизвестное поле правки отбрасывается.
  assert.equal(sanitizeCheck({ ...GOOD, corrections: [{ field: 'price', reason: 'x' }] }).corrections.length, 0)
  assert.ok(FIELDS.includes('kcal'))
})

test('отказ модели и обрезанный ответ — не проверка', () => {
  const text = (t) => ({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }], stop_reason: 'end_turn' })
  assert.equal(parseCheck(text(JSON.stringify(GOOD))).per100.kcal, 157)
  assert.equal(parseCheck({ ...text(JSON.stringify(GOOD)), stop_reason: 'refusal' }), null)
  assert.equal(parseCheck({ ...text('{"status":'), stop_reason: 'max_tokens' }), null)
  assert.equal(parseCheck(text('не JSON')), null)
})

test('товар берётся из базы по обоим написаниям кода', async () => {
  const seen = []
  const fake = async (url) => {
    seen.push(url)
    if (url.includes('/012345678905.json')) return { status: 200, ok: true, json: async () => ({ status: 1, product: PRODUCT }) }
    return { status: 404, ok: false, json: async () => ({}) }
  }
  const p = await fetchOffProduct('0012345678905', 'ru', fake)
  assert.equal(p, PRODUCT)
  assert.equal(seen.length, 2)
  assert.equal(await fetchOffProduct('4006381333931', 'ru', async () => ({ status: 404, ok: false })), null)
})

// Обработчик целиком упирается в базу (тариф, учёт расхода); без неё
// проверяются входные ворота: метод и вход в аккаунт — до любого похода в
// Open Food Facts и к модели.
const fakeRes = () => {
  const r = { code: 0, body: null }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

test('без входа в аккаунт — 401, и ни базы, ни модели', async () => {
  const { default: handler } = await import('./barcode.js')
  const realFetch = globalThis.fetch
  let fetched = 0
  globalThis.fetch = async () => { fetched++; return { ok: false, status: 500, json: async () => ({}) } }
  try {
    const get = fakeRes()
    await handler({ method: 'GET', headers: {}, body: {} }, get)
    assert.equal(get.code, 405)
    const anon = fakeRes()
    await handler({ method: 'POST', headers: {}, body: { code: '4006381333931' } }, anon)
    assert.equal(anon.code, 401)
    assert.equal(fetched, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
