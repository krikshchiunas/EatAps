// Проверка товара по штрихкоду: что уходит в модель и что из ответа доходит
// до человека.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECK_SCHEMA, FIELDS, TOOLS, SYSTEM, safeImageUrl, fullSize, productImages, productFacts, buildContent,
  sanitizeCheck, parseCheck, reportOf, runCheck, addUsage, fetchOffProduct, languageName,
} from './barcode.js'

const PRODUCT = {
  product_name: 'Творог 9%',
  product_name_de: 'Quark 9%',
  brands: 'Простоквашино',
  quantity: '200 г',
  product_quantity: 200,
  serving_size: '100 g',
  categories_tags: ['en:dairies', 'en:cottage-cheeses'],
  ingredients_text: 'молоко нормализованное, закваска',
  image_nutrition_url: 'https://images.openfoodfacts.org/images/products/460/123/456/7893/nutrition_ru.12.400.jpg',
  image_front_url: 'https://images.openfoodfacts.org/images/products/460/123/456/7893/front_ru.3.400.jpg',
  nutriments: {
    'energy-kcal_100g': 657, proteins_100g: 16, carbohydrates_100g: 3, fat_100g: 9, salt_100g: 0.1,
    'calcium_100g': 0.12, 'nova-group': 1, 'nutrition-score-fr_100g': 2,
  },
}

test('схема отчёта: все поля обязательны и без лишних — так требует strict tool use', () => {
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
  // Ограничения, которых strict-схема не понимает, в неё не попадают.
  assert.doesNotMatch(JSON.stringify(CHECK_SCHEMA), /minimum|maximum|minLength|maxLength|multipleOf/)
  // Витамины, минералы, ЖКТ и спорт — ключами справочника приложения.
  const keys = CHECK_SCHEMA.properties.micros.items.properties.key.enum
  for (const k of ['vitC', 'b12', 'ca', 'na', 'fe', 'caffeine', 'creatine', 'bcaa', 'probiotics', 'inulin', 'taurine']) {
    assert.ok(keys.includes(k), k)
  }
})

test('инструменты: веб-поиск с потолком и строгий отчёт', () => {
  const search = TOOLS.find((t) => t.name === 'web_search')
  assert.equal(search.type, 'web_search_20260209')
  assert.ok(search.max_uses >= 1 && search.max_uses <= 5)
  const report = TOOLS.find((t) => t.name === 'report_check')
  assert.equal(report.strict, true)
  assert.equal(report.input_schema, CHECK_SCHEMA)
  // Модель знает, в чём мерить каждое вещество.
  assert.match(SYSTEM, /vitC mg/)
  assert.match(SYSTEM, /b12 mcg/)
  assert.match(SYSTEM, /creatine g/)
  assert.match(SYSTEM, /probiotics billion CFU/)
})

test('фото — только с серверов Open Food Facts и только https, таблица в полном размере', () => {
  assert.ok(safeImageUrl('https://images.openfoodfacts.org/x.jpg'))
  assert.equal(safeImageUrl('http://images.openfoodfacts.org/x.jpg'), null)
  assert.equal(safeImageUrl('https://evil.example/x.jpg'), null)
  assert.equal(safeImageUrl('https://images.openfoodfacts.org.evil.example/x.jpg'), null)
  assert.equal(safeImageUrl('javascript:alert(1)'), null)
  assert.equal(safeImageUrl(null), null)
  assert.equal(fullSize('https://images.openfoodfacts.org/a/nutrition_ru.12.400.jpg'), 'https://images.openfoodfacts.org/a/nutrition_ru.12.full.jpg')
  const full = productImages(PRODUCT)
  assert.match(full[0], /nutrition_ru\.12\.full\.jpg$/)
  assert.match(productImages(PRODUCT, { full: false })[0], /\.400\.jpg$/)
  assert.equal(productImages({ image_front_url: 'https://evil.example/a.jpg' }).length, 0)
})

test('в модель уходит состав, а не служебные поля базы', () => {
  const f = productFacts(PRODUCT, '4601234567893')
  assert.equal(f.barcode, '4601234567893')
  assert.equal(f.product_name_de, 'Quark 9%')
  assert.equal(f.nutriments['energy-kcal_100g'], 657)
  assert.equal(f.nutriments.calcium_100g, 0.12, 'витамины и минералы базы — тоже на проверку')
  assert.equal(f.nutriments['nova-group'], undefined)
  assert.equal(f.nutriments['nutrition-score-fr_100g'], undefined)
  assert.match(f.ingredients, /закваска/)
  const content = buildContent(f, productImages(PRODUCT), 'de')
  assert.equal(content.filter((b) => b.type === 'image').length, 2)
  assert.equal(content.at(-1).type, 'text')
  assert.match(content.at(-1).text, /in German/)
  assert.equal(content[1].source.type, 'url')
  assert.equal(languageName('xx'), 'English')
})

const GOOD = {
  status: 'corrected',
  name: null,
  unit: 'g',
  per100: { kcal: 157, protein: 16, carbs: 3, sugar: 3, fat: 9, satFat: 5.5, fiber: null },
  micros: [{ key: 'ca', per100: 120 }, { key: 'na', per100: 40 }, { key: 'b12', per100: 0.4 }, { key: 'nonsense', per100: 5 }],
  servingSize: null,
  packSize: 200,
  corrections: [{ field: 'kcal', reason: 'В поле «ккал» были килоджоули.' }],
  notes: ['Содержит лактозу.'],
  sources: ['label_photo', 'database'],
  confidence: 'high',
  summary: 'Калорийность исправлена.',
}

test('отчёт проходит как есть, если цифры правдоподобны; витамины — по ключам справочника', () => {
  const c = sanitizeCheck(GOOD)
  assert.equal(c.per100.kcal, 157)
  assert.equal(c.confidence, 'high')
  assert.deepEqual(c.micros, { ca: 120, na: 40, b12: 0.4 }, 'неизвестный ключ отброшен')
  assert.deepEqual(c.notes, ['Содержит лактозу.'])
  assert.deepEqual(c.sources, ['label_photo', 'database'])
})

test('55 г клетчатки в чипсах — не данные, а ошибка: уверенность падает', () => {
  const chips = { ...GOOD, per100: { kcal: 536, protein: 6, carbs: 50, sugar: 1, fat: 33, satFat: 3, fiber: 55 }, micros: [] }
  assert.equal(sanitizeCheck(chips).confidence, 'low')
  // Те же чипсы с нормальной клетчаткой — правдоподобны.
  assert.equal(sanitizeCheck({ ...chips, per100: { ...chips.per100, fiber: 4 } }).confidence, 'high')
})

test('неправдоподобные цифры понижают уверенность — такую проверку не применяют', () => {
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, protein: 60, carbs: 30, fat: 30 } }).confidence, 'low')
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, sugar: 10 } }).confidence, 'low')
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, kcal: 20 } }).confidence, 'low')
  assert.equal(sanitizeCheck({ ...GOOD, micros: [{ key: 'creatine', per100: 70 }, { key: 'bcaa', per100: 40 }] }).confidence, 'low')
  // Вне физических границ — неизвестно, а не «как сказала модель».
  assert.equal(sanitizeCheck({ ...GOOD, per100: { ...GOOD.per100, kcal: 4000 } }).per100.kcal, null)
  assert.equal(sanitizeCheck({ ...GOOD, corrections: [{ field: 'price', reason: 'x' }] }).corrections.length, 0)
  assert.ok(FIELDS.includes('micros'))
})

const tool = (input) => ({ type: 'tool_use', id: 't1', name: 'report_check', input })

test('отчёт берётся из вызова инструмента; отказ и обрыв — не проверка', () => {
  const data = (content, stop = 'tool_use') => ({ content, stop_reason: stop })
  assert.equal(parseCheck(data([{ type: 'thinking', thinking: '' }, tool(GOOD)])).per100.kcal, 157)
  assert.equal(parseCheck(data([{ type: 'text', text: JSON.stringify(GOOD) }], 'end_turn')).per100.kcal, 157)
  assert.equal(parseCheck(data([tool(GOOD)], 'refusal')), null)
  assert.equal(parseCheck(data([{ type: 'text', text: '{"status":' }], 'max_tokens')), null)
  assert.equal(reportOf(data([{ type: 'text', text: 'не JSON' }], 'end_turn')), null)
})

test('пауза хода продолжается без новых слов; ответ словами — одна просьба вызвать отчёт', async () => {
  const calls = []
  const replies = [
    { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Готово, цифры сходятся.' }], usage: { input_tokens: 200, output_tokens: 20 } },
    { stop_reason: 'tool_use', content: [tool(GOOD)], usage: { input_tokens: 300, output_tokens: 30 } },
  ]
  const ask = async ({ messages }) => { calls.push(messages); return replies[calls.length - 1] }
  const { data, usage } = await runCheck({ ask, content: [{ type: 'text', text: 'x' }] })
  assert.equal(calls.length, 3)
  // После паузы — тот же разговор плюс ход модели, без «продолжай».
  assert.equal(calls[1].length, 2)
  assert.equal(calls[1][1].role, 'assistant')
  // После ответа словами — одна просьба вызвать отчёт.
  assert.equal(calls[2].at(-1).role, 'user')
  assert.match(calls[2].at(-1).content, /report_check/)
  assert.equal(parseCheck(data).per100.kcal, 157)
  assert.equal(usage.input_tokens, 600)
  assert.equal(usage.server_tool_use.web_search_requests, 1)
})

test('сбой запроса уносит с собой уже потраченное — его спишут', async () => {
  let n = 0
  const ask = async () => {
    n++
    if (n === 1) return { stop_reason: 'pause_turn', content: [], usage: { input_tokens: 500 } }
    throw Object.assign(new Error('boom'), { status: 529, usage: { input_tokens: 50 } })
  }
  await assert.rejects(runCheck({ ask, content: [] }), (e) => e.usage.input_tokens === 550)
  assert.deepEqual(addUsage({}, null), {})
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

test('модель проверки — Sonnet 5.5 с ценой, effort и учётом поиска', async () => {
  const { PRICES, BARCODE_CHECK_MODEL, BARCODE_CHECK_EFFORT, EFFORT_CAPABLE, costOf, WEB_SEARCH_MICRO } = await import('../../src/lib/aiBudget.js')
  assert.equal(BARCODE_CHECK_MODEL, 'claude-sonnet-5-5')
  assert.ok(PRICES[BARCODE_CHECK_MODEL])
  assert.ok(EFFORT_CAPABLE.includes(BARCODE_CHECK_MODEL))
  assert.ok(['low', 'medium', 'high'].includes(BARCODE_CHECK_EFFORT))
  // Без поиска: ~4000 токенов входа, ~2000 ответа с размышлением — пара центов.
  const plain = costOf({ input_tokens: 4000, output_tokens: 2000 }, BARCODE_CHECK_MODEL)
  assert.ok(plain > 10_000 && plain < 40_000, `проверка без поиска стоит ${plain} микродолларов`)
  // Поиск оплачивается отдельно.
  assert.equal(costOf({ server_tool_use: { web_search_requests: 2 } }, BARCODE_CHECK_MODEL), 2 * WEB_SEARCH_MICRO)
})
