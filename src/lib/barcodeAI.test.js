// «Штрихкод: помощь ИИ»: кому доступно и как ответ проверки ложится на товар.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCheck, fillDraft, barcodeAIOn, barcodeAIAvailable, BARCODE_AI_PREF, cachedCheck, rememberCheck } from './barcodeAI.js'
import { TIER } from './subscription.js'

const premium = { tier: TIER.AI_PREMIUM, status: 'active' }
const pro = { tier: TIER.AI_PLUS, status: 'active' }

test('функция только для Premium, с аккаунтом и включённой настройкой', () => {
  const on = { [BARCODE_AI_PREF]: true }
  assert.equal(barcodeAIAvailable(premium), true)
  assert.equal(barcodeAIAvailable(pro), false)
  assert.equal(barcodeAIAvailable({ tier: TIER.AI_PREMIUM, status: 'canceled' }), false)
  assert.equal(barcodeAIOn({ prefs: on, subscription: premium, signedIn: true }), true)
  assert.equal(barcodeAIOn({ prefs: {}, subscription: premium, signedIn: true }), false, 'по умолчанию выключено')
  assert.equal(barcodeAIOn({ prefs: on, subscription: pro, signedIn: true }), false)
  assert.equal(barcodeAIOn({ prefs: on, subscription: premium, signedIn: false }), false)
})

// Творог 9%: в базе в поле «ккал» записаны килоджоули.
const FOOD = {
  name: 'Творог 9% · Простоквашино', title: 'Творог 9%', brand: 'Простоквашино',
  unit: 'г', kcal: 657, protein: 16, carbs: 3, fat: 9, source: 'off', barcode: '4601234567893',
  portions: [{ label: 'пачка', grams: 200 }], defaultGrams: 200,
}
const check = (over = {}) => ({
  status: 'corrected', name: null, unit: 'g',
  per100: { kcal: 157, protein: 16, carbs: 3, sugar: 3, fat: 9, satFat: null, fiber: null },
  servingSize: null, packSize: 200,
  corrections: [{ field: 'kcal', reason: 'В поле «ккал» были килоджоули.' }],
  confidence: 'high', summary: 'Калорийность исправлена.',
  ...over,
})

test('исправление применяется, и видно «было → стало» с причиной', () => {
  const r = applyCheck(FOOD, check())
  assert.equal(r.applied, true)
  assert.equal(r.food.kcal, 157)
  const kcal = r.changes.find((c) => c.field === 'kcal')
  assert.deepEqual([kcal.from, kcal.to], [657, 157])
  assert.match(kcal.reason, /килоджоули/)
  // Сахара в базе не было — ИИ его дочитал с этикетки: это тоже правка, и она
  // измеренная, а не оценка.
  assert.ok(r.changes.some((c) => c.field === 'sugar'))
  assert.equal(r.food.sugarSrc, 'measured')
  assert.equal(r.food.aiChecked, true)
  // Исходный товар не тронут — к нему можно вернуться.
  assert.equal(FOOD.kcal, 657)
})

test('совпадающие цифры и шум округления — не правки', () => {
  const same = applyCheck(FOOD, check({ status: 'ok', per100: { kcal: 657.4, protein: 16.1, carbs: 3, sugar: null, fat: 9, satFat: null, fiber: null }, corrections: [] }))
  assert.equal(same.applied, true)
  assert.deepEqual(same.changes, [])
})

test('неуверенная или пустая проверка не применяется', () => {
  for (const c of [check({ confidence: 'low' }), check({ status: 'unverifiable' }), null]) {
    const r = applyCheck(FOOD, c)
    assert.equal(r.applied, false)
    assert.equal(r.food, FOOD)
    assert.deepEqual(r.changes, [])
  }
})

test('единица и порции: напиток в мл, порция с упаковки становится количеством по умолчанию', () => {
  const r = applyCheck(FOOD, check({ unit: 'ml', servingSize: 250, packSize: 1000 }))
  assert.equal(r.food.unit, 'мл')
  assert.ok(r.changes.some((c) => c.field === 'unit'))
  assert.deepEqual(r.food.portions.map((p) => [p.label, p.grams]), [['порция', 250], ['пачка', 1000]])
  assert.equal(r.food.defaultGrams, 250)
})

test('исправленное название сохраняет бренд', () => {
  const r = applyCheck(FOOD, check({ name: 'Творог 5%' }))
  assert.equal(r.food.name, 'Творог 5% · Простоквашино')
  assert.equal(r.food.title, 'Творог 5%')
})

test('цифры с фото этикетки заполняют только пустое в черновике своего продукта', () => {
  const draft = { name: 'Творог 9% · Простоквашино', title: 'Творог 9%', brand: 'Простоквашино', unit: 'г', barcode: '4601234567893' }
  const filled = fillDraft(draft, check({ status: 'filled', servingSize: 100 }))
  assert.equal(filled.kcal, 157)
  assert.equal(filled.portionGrams, 100)
  assert.equal(filled.packGrams, 200)
  // Уже известное ИИ не перетирает.
  assert.equal(fillDraft({ ...draft, kcal: 160 }, check()).kcal, 160)
  assert.equal(fillDraft(draft, check({ confidence: 'low' })), null)
  assert.equal(fillDraft(draft, check({ per100: { kcal: null, protein: null, carbs: null, sugar: null, fat: null, satFat: null, fiber: null } })), null)
})

test('повторный скан того же товара не проверяется заново', () => {
  assert.equal(cachedCheck('4601234567893', 'ru'), null)
  rememberCheck('4601234567893', 'ru', check())
  assert.equal(cachedCheck('4601234567893', 'ru').per100.kcal, 157)
  // На другом языке пояснения другие — проверка своя.
  assert.equal(cachedCheck('4601234567893', 'de'), null)
})
