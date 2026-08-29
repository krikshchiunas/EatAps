// Сторож базы продуктов. Ошибку в одной строке таблицы («520» вместо «52»)
// глазами не заметить, а в дневнике она превращается в лишние полтысячи
// килокалорий. Поэтому каждый продукт проверяется арифметикой: калорийность
// обязана сходиться с белками, углеводами и жирами.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FOODS, BREADS, CONSTRUCTOR_ING, scale, getPortions, inferCat, searchLocal, searchIngredients } from './foods.js'

// Алкоголь даёт 7 ккал на грамм, и этих калорий нет ни в белках, ни в
// углеводах, ни в жирах — по БЖУ такие напитки «не сходятся» законно.
// \\bвино\\b, а не «вино» подстрокой: иначе под алкоголь попадал виноград.
const ALCOHOL = /(^|[\s-])(пиво|вино|шампанское|водка|виски|коньяк|ром|текила|джин|ликёр|ликер|мохито|пина|апероль|мартини|бренди|самбука|абсент|сидр|глинтвейн)([\s-]|$)/i

// Конструкторы (бутерброд, салат, боул) собственных КБЖУ не имеют — они
// собираются из ингредиентов.
const isConstructor = (f) => f.builder === 'constructor' || f.kcal == null

function checkMacros(label, kcal, p, c, f, tolerance) {
  for (const [k, v] of Object.entries({ kcal, protein: p, carbs: c, fat: f })) {
    assert.ok(Number.isFinite(v), `${label}: ${k} не число (${v})`)
    assert.ok(v >= 0, `${label}: ${k} отрицательное (${v})`)
  }
  // Ни один продукт не бывает калорийнее чистого жира.
  assert.ok(kcal <= 950, `${label}: ${kcal} ккал на 100 г — выше чистого жира`)
  assert.ok(p <= 100 && c <= 100 && f <= 100, `${label}: белки/углеводы/жиры больше 100 г на 100 г`)
  assert.ok(p + c + f <= 105, `${label}: Б+У+Ж = ${(p + c + f).toFixed(1)} г на 100 г продукта`)

  const calc = 4 * p + 4 * c + 9 * f
  if (kcal === 0 && calc === 0) return
  const diff = Math.abs(calc - kcal)
  const rel = kcal > 0 ? diff / kcal : 1
  assert.ok(diff <= tolerance.abs || rel <= tolerance.rel,
    `${label}: заявлено ${kcal} ккал, по БЖУ выходит ${Math.round(calc)} (расхождение ${Math.round(rel * 100)}%)`)
}

test('калорийность каждого продукта сходится с его БЖУ', () => {
  let checked = 0
  for (const f of FOODS) {
    if (isConstructor(f)) continue
    // Клетчатка и многоатомные спирты дают меньше 4 ккал/г, поэтому у овощей,
    // фруктов и «лайт»-продуктов допуск шире. 25 ккал на 100 г — цена
    // округления в справочных таблицах.
    const tol = { abs: 25, rel: 0.22 }
    if (f.hasVariants && Array.isArray(f.methods)) {
      for (const v of f.methods) {
        if (ALCOHOL.test(f.name)) continue
        checkMacros(`${f.name} / ${v.label}`, v.kcal, v.protein, v.carbs, v.fat, tol)
        checked++
      }
      continue
    }
    if (ALCOHOL.test(f.name)) continue
    checkMacros(f.name, f.kcal, f.protein, f.carbs, f.fat, tol)
    checked++
  }
  assert.ok(checked > 400, `проверено всего ${checked} продуктов — таблица подозрительно пуста`)
})

test('у алкоголя калорий не меньше, чем даёт БЖУ: разница — это спирт', () => {
  const drinks = FOODS.filter((f) => ALCOHOL.test(f.name) && !isConstructor(f))
  assert.ok(drinks.length >= 5, 'алкоголь в базе не найден вовсе')
  for (const f of drinks) {
    const calc = 4 * f.protein + 4 * f.carbs + 9 * f.fat
    assert.ok(f.kcal >= calc - 5, `${f.name}: ${f.kcal} ккал меньше, чем дают одни БЖУ (${Math.round(calc)})`)
  }
})

test('у каждого продукта есть имя, эмодзи и категория', () => {
  const names = new Set()
  for (const f of FOODS) {
    assert.ok(typeof f.name === 'string' && f.name.trim(), `продукт без имени: ${JSON.stringify(f).slice(0, 80)}`)
    assert.ok(f.emoji, `${f.name}: нет эмодзи`)
    assert.ok(!names.has(f.name.toLowerCase()), `дубль в базе: ${f.name}`)
    names.add(f.name.toLowerCase())
  }
})

test('порции есть у каждого продукта и они положительные', () => {
  for (const f of FOODS) {
    const portions = getPortions(f)
    assert.ok(Array.isArray(portions) && portions.length > 0, `${f.name}: нет вариантов порции`)
    for (const p of portions) {
      assert.ok(Number.isFinite(p.grams) && p.grams > 0, `${f.name}: порция «${p.label}» = ${p.grams}`)
      assert.ok(p.label && String(p.label).trim(), `${f.name}: порция без подписи`)
    }
  }
})

test('scale пересчитывает пропорционально и не выдумывает точность', () => {
  const chicken = FOODS.find((f) => f.name === 'Куриная грудка') || FOODS.find((f) => f.cat === 'poultry')
  const s = scale(chicken, 200)
  assert.ok(Math.abs(s.kcal - chicken.kcal * 2) < 0.6, `${s.kcal} против ${chicken.kcal * 2}`)
  assert.ok(Math.abs(s.protein - chicken.protein * 2) < 0.6)
  const zero = scale(chicken, 0)
  assert.equal(zero.kcal, 0)
  assert.equal(zero.protein, 0)
})

test('ингредиенты конструктора тоже сходятся по калориям', () => {
  let checked = 0
  for (const ing of CONSTRUCTOR_ING) {
    if (!Number.isFinite(ing.kcal)) continue
    checkMacros(`ингредиент ${ing.name}`, ing.kcal, ing.protein, ing.carbs, ing.fat, { abs: 25, rel: 0.25 })
    checked++
  }
  assert.ok(checked > 50, `проверено ${checked} ингредиентов`)
})

test('хлеб для бутербродов описан корректно', () => {
  for (const b of BREADS) {
    assert.ok(b.name, 'хлеб без названия')
    assert.ok(Number.isFinite(b.each) && b.each > 0, `${b.name}: вес ломтика ${b.each}`)
    checkMacros(`хлеб ${b.name}`, b.kcal, b.protein, b.carbs, b.fat, { abs: 25, rel: 0.22 })
  }
})

test('поиск прощает опечатки, в том числе «как слышится»', () => {
  const has = (list, part) => list.some((f) => f.name.toLowerCase().includes(part))
  // Пропуск и перестановка букв.
  assert.ok(has(searchLocal('грчка'), 'гречк'), '«грчка» не нашла гречку')
  assert.ok(has(searchLocal('КУРИНАЯ'), 'курин'), 'поиск чувствителен к регистру')
  // Письмо на слух — самая частая русская опечатка. Раньше не работало:
  // «малако» отличается от «молоко» двумя правками, а порог допускал одну.
  for (const [typo, want] of [
    ['малако', 'молок'], ['смитана', 'сметан'], ['творок', 'творог'],
    ['агурец', 'огурец'], ['памидор', 'помидор'], ['гавядина', 'говядин'],
  ]) {
    assert.ok(has(searchLocal(typo), want), `«${typo}» не нашла «${want}»`)
  }
  assert.equal(searchLocal('').length >= 0, true)
  assert.deepEqual(searchLocal('zzzzzzqqq'), [])
})

test('точное совпадение всегда выше похожего', () => {
  const milk = searchLocal('молоко')
  assert.equal(milk[0].name, 'Молоко', `первым идёт ${milk[0].name}`)
  const buck = searchLocal('гречка')
  assert.equal(buck[0].name, 'Гречка', `первым идёт ${buck[0].name}`)
})

test('поиск ингредиентов не падает на пустом и мусорном запросе', () => {
  assert.ok(Array.isArray(searchIngredients('')))
  assert.ok(Array.isArray(searchIngredients('  ')))
  assert.ok(Array.isArray(searchIngredients('zzzqqq')))
  assert.ok(searchIngredients('сыр').length > 0)
})

test('категория по названию определяется для очевидных случаев', () => {
  assert.equal(inferCat('Куриная грудка'), 'poultry')
  assert.equal(inferCat('Творог 5%'), 'dairy')
  assert.equal(inferCat('Лосось слабосолёный'), 'fish')
})
