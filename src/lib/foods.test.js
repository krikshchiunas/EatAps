// Сторож базы продуктов. Ошибку в одной строке таблицы («520» вместо «52»)
// глазами не заметить, а в дневнике она превращается в лишние полтысячи
// килокалорий. Поэтому каждый продукт проверяется арифметикой: калорийность
// обязана сходиться с белками, углеводами и жирами.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FOODS, BREADS, CONSTRUCTOR_ING, scale, getPortions, inferCat, searchLocal, searchIngredients, dairyProtein, saneOffMacros } from './foods.js'

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
  assert.equal(inferCat('Чипсы с паприкой'), 'snack')
})

// ── Иноязычный поиск ─────────────────────────────────────────────────────────

test('продукт находится по немецкому и английскому названию', () => {
  const finds = (q, part) =>
    searchLocal(q).slice(0, 5).some((f) => f.name.toLowerCase().includes(part.toLowerCase()))
  // Раскладка латиницей — обычное дело, когда человек живёт не в русскоязычной
  // стране. Всё это раньше уходило в Open Food Facts или не находилось вовсе.
  for (const [query, want] of [
    ['gouda', 'гауда'], ['tomate', 'помидор'], ['tomaten', 'помидор'], ['tomato', 'помидор'],
    ['kartoffel', 'картофель'], ['kartoffeln', 'картофель'], ['potato', 'картофель'],
    ['bratwurst', 'братвурст'], ['schinken', 'окорок'], ['hackfleisch', 'фарш'],
    ['quark', 'творог'], ['skyr', 'скир'], ['lachs', 'лосось'], ['huhn', 'курин'],
    ['chips', 'чипсы'], ['popcorn', 'попкорн'], ['spargel', 'спаржа'],
    ['erdbeeren', 'клубника'], ['brotchen', 'булочка'], ['frozen pizza', 'пицца заморож'],
  ]) {
    assert.ok(finds(query, want), `«${query}» не нашёл «${want}»`)
  }
})

test('иноязычные названия дописаны в alias, а не потеряны', () => {
  // Ключ FOREIGN, не совпавший с именем продукта, не падает и не виден:
  // алиас просто молча не применяется, и поиск по-немецки перестаёт работать.
  const src = readFileSync(new URL('./foods.js', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('const FOREIGN = {'), src.indexOf('const withForeign'))
  const keys = [...block.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
  const names = new Set(FOODS.map((f) => f.name))
  const dangling = keys.filter((k) => !names.has(k))
  assert.deepEqual(dangling, [], 'ключи FOREIGN без продукта в базе')
  assert.ok(keys.length > 200, `иноязычных названий всего ${keys.length}`)
})

test('в алиасах нет слов со смешанным алфавитом', () => {
  // «sussкirsche» с кириллической «к» выглядит как латиница и не находится
  // ничем: ни латинским запросом, ни русским. Отловить можно только так.
  const mixed = []
  for (const f of FOODS) {
    for (const w of String(f.alias || '').split(/\s+/)) {
      if (/[а-яё]/i.test(w) && /[a-z]/i.test(w)) mixed.push(`${f.name}: ${w}`)
    }
  }
  assert.deepEqual(mixed, [])
})

// ── Качество данных базы ─────────────────────────────────────────────────────

test('база покрывает повседневные категории, а не только готовые блюда', () => {
  const byCat = {}
  for (const f of FOODS) byCat[f.cat] = (byCat[f.cat] || 0) + 1
  // Нижние границы — защита от случайного удаления куска таблицы, а не цель.
  for (const [cat, min] of [
    ['cheese', 20], ['meat', 30], ['fish', 20], ['veg', 40], ['fruit', 25],
    ['dairy', 20], ['grain', 20], ['bread', 15], ['snack', 15], ['sauce', 15],
  ]) {
    assert.ok((byCat[cat] || 0) >= min, `${cat}: всего ${byCat[cat] || 0}, ожидалось ≥ ${min}`)
  }
  assert.ok(FOODS.length > 750, `в базе ${FOODS.length} продуктов`)
})

test('единица измерения — либо известная, либо отсутствует', () => {
  // Отсутствие unit законно: у продуктов с вариантами приготовления единицу
  // подставляет интерфейс (`food.unit || 'г'`). Ловим не пропуск, а ОПЕЧАТКУ —
  // «гр» вместо «г» не сломает расчёт, но напечатает в дневнике чужое слово.
  const allowed = new Set(['г', 'мл', 'шт', 'порция'])
  for (const f of FOODS) {
    if (f.unit == null) continue
    assert.ok(allowed.has(f.unit), `${f.name}: единица «${f.unit}»`)
  }
})

test('названия продуктов опрятные', () => {
  for (const f of FOODS) {
    assert.equal(f.name, f.name.trim(), `${f.name}: пробелы по краям`)
    assert.ok(!/\s{2,}/.test(f.name), `${f.name}: двойной пробел`)
    assert.ok(f.name.length <= 60, `${f.name}: слишком длинное название`)
  }
})

// ── Белок: то, что раньше завышалось ─────────────────────────────────────────

const food = (name) => FOODS.find((f) => f.name === name)

test('у мяса и птицы есть «сырое», и оно первое — так взвешивают', () => {
  // Готовое мясо легче сырого на четверть-треть, и в 100 г готового белка
  // больше. Без варианта «сырое» человек, взвесивший сырую грудку и выбравший
  // «Гриль», получал белка на треть больше, чем съел.
  for (const f of FOODS.filter((x) => x.hasVariants && ['meat', 'poultry', 'fish'].includes(x.cat))) {
    const first = f.methods[0]
    assert.match(first.label, /^Сыр/, `${f.name}: первым должен быть сырой вариант, а не «${first.label}»`)
    // Мясо, приготовленное без соуса и рассола, теряет только воду — белка в
    // 100 г становится больше. Тушёное (с подливой) и копчёное (с рассолом)
    // законно бывает и ниже, их не сравниваем.
    for (const m of f.methods.slice(1).filter((x) => /^(Варён|Запечён|Гриль|На гриле|На пару|Готов|В аэрогриле)/.test(x.label))) {
      assert.ok(m.protein >= first.protein, `${f.name} / ${m.label}: в готовом белка не меньше, чем в сыром`)
    }
  }
  for (const name of ['Куриная грудка', 'Говядина', 'Свинина', 'Куриное бедро', 'Индейка грудка', 'Баранина']) {
    assert.ok(food(name)?.hasVariants, `${name}: нет выбора сырое/готовое`)
  }
})

test('сырое мясо — с белком сырого, а не готового', () => {
  // Справочные значения сырого (USDA / Скурихин) с небольшим запасом.
  const raw = {
    'Фарш говяжий': 20, 'Фарш куриный': 19, 'Фарш индейки': 21, 'Бекон': 16,
  }
  for (const [name, max] of Object.entries(raw)) {
    assert.ok(food(name), `${name}: нет в базе`)
    assert.ok(food(name).protein <= max, `${name}: ${food(name).protein} г белка — это значение готового продукта`)
  }
  assert.ok(food('Куриное бедро').methods[0].protein < 20, 'сырое бедро с кожей — около 16,5 г белка')
  assert.ok(food('Бекон жареный').protein > food('Бекон').protein * 2, 'жареный бекон отдельно, с белком жареного')
})

test('белок творога падает с жирностью', () => {
  const t = food('Творог')
  assert.equal(dairyProtein(t, 0), 18)
  assert.equal(dairyProtein(t, 18), 14)
  assert.ok(dairyProtein(t, 9) < dairyProtein(t, 5))
  // Промежуточная жирность — между соседними точками.
  const mid = dairyProtein(t, 12)
  assert.ok(mid < 16.7 && mid > 14, `${mid}`)
  // У продуктов без таблицы — одно число на все жирности, как раньше.
  const milk = food('Молоко')
  assert.equal(dairyProtein(milk, 3.2), milk.protein)
})

test('одно яйцо — 50 г съедобной части, без скорлупы', () => {
  assert.equal(getPortions(food('Яйцо'))[0].grams, 50)
  assert.equal(getPortions(food('Яйцо варёное'))[0].grams, 50)
})

test('сухие крупы и бобовые получают меры сухого продукта', () => {
  for (const name of ['Гречка сухая', 'Овсяные хлопья сухие', 'Чечевица сухая', 'Нут сухой', 'Соевое мясо', 'Мюсли']) {
    const ps = getPortions(food(name))
    assert.ok(ps.length > 0, name)
    for (const p of ps) {
      assert.ok(p.grams <= 250, `${name}: «${p.label}» ${p.grams} г — мера готовой каши`)
    }
    // Первая мера — то, что подставится в поле веса: не больше обычной порции.
    assert.ok(ps[0].grams <= 70, `${name}: по умолчанию ${ps[0].grams} г сухого`)
  }
  // «Сухое» вино — не сухая крупа.
  assert.ok(getPortions(food('Вино красное сухое')).some((p) => p.grams >= 100))
})

test('нарезки и колбасы меряются ломтиками, а не порцией мяса', () => {
  for (const name of ['Салями', 'Сервелат', 'Докторская колбаса', 'Ветчина', 'Индейка нарезка']) {
    const first = getPortions(food(name))[0]
    assert.ok(first.grams <= 15, `${name}: первая мера ${first.label} ${first.grams} г`)
    assert.ok(getPortions(food(name)).every((p) => p.grams <= 100), `${name}: «стейк 200 г» колбасы`)
  }
  assert.equal(getPortions(food('Сосиски'))[0].label, '1 шт')
})

test('бутерброды из жалобы: два ломтика хлеба, 4 ломтика салями, 4 пластинки сыра', () => {
  // Честная арифметика того самого примера. Сыр — четверть веса белок,
  // салями — пятая часть, поэтому 20 г белка набираются уже при тонких
  // пластинках сыра по 10 г; при стандартных ломтиках по 20 г — почти 30.
  const ing = (name) => CONSTRUCTOR_ING.find((i) => i.name === name)
  const bread = BREADS.find((b) => b.name === 'Тостерный хлеб')
  const protein = (cheeseSlice) =>
    scale(bread, 2 * bread.each).protein +
    scale(ing('Салями'), 4 * ing('Салями').each).protein +
    scale(ing('Гауда'), 4 * cheeseSlice).protein
  const thin = protein(10)
  const regular = protein(ing('Гауда').each)
  assert.ok(thin > 18 && thin < 22, `тонкие пластинки: ${thin} г`)
  assert.ok(regular > 28 && regular < 32, `обычные ломтики: ${regular} г`)
})

test('невозможные цифры Open Food Facts не попадают в дневник', () => {
  // Белок «на порцию» в поле «на 100 г»: 60 г белка у йогурта на 70 ккал.
  assert.equal(saneOffMacros(70, { protein: 60, carbs: 5, fat: 2 }).protein, null)
  assert.equal(saneOffMacros(70, { protein: 60, carbs: 5, fat: 2 }).carbs, 5)
  // Обычный продукт не трогаем, протеиновый порошок — тоже.
  assert.deepEqual(saneOffMacros(363, { protein: 23, carbs: 0, fat: 29 }), { protein: 23, carbs: 0, fat: 29 })
  assert.equal(saneOffMacros(380, { protein: 80, carbs: 6, fat: 5 }).protein, 80)
  // Больше 100 г на 100 г не бывает.
  assert.equal(saneOffMacros(400, { protein: 250, carbs: 1, fat: 1 }).protein, null)
  // Неизвестное остаётся неизвестным.
  assert.equal(saneOffMacros(100, { protein: null, carbs: 10, fat: 1 }).protein, null)
})
