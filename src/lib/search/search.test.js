// Многоязычный поиск: точные названия на всех языках, синонимы, опечатки,
// транслитерация, раскладка, нормализация (ß, ı, арабские варианты, цифры),
// ранжирование, отсутствие дублей, детерминизм, устойчивость к мусору.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { setLang, LANGS, SOURCE_LANG } from '../i18n.js'
import { FOODS, CONSTRUCTOR_ING, searchLocal, searchByName, searchIngredients } from '../foods.js'
import { searchSupplements, SUPPLEMENTS } from '../supplements.js'
import { loadSearchNames, searchItems, matchCatalogFoodSync, queryVariants } from './index.js'
import { fold, stem, swapLayout, cyrToLat, latToCyr } from './normalize.js'
import { search, buildIndex, INDEX_VERSION } from './engine.js'
import ALIASES from './aliases.js'
import KEYWORDS from './keywords.js'
import { catalogIds, isCatalogId } from '../catalog.js'

const CODES = LANGS.map((l) => l.code)
const tables = {}
before(async () => {
  assert.equal(await loadSearchNames(), true)
  for (const c of CODES) tables[c] = (await import(`../../locales/${c}/data/foods.js`)).default.foods
})
after(() => setLang(SOURCE_LANG, { persist: false }))

const ids = (q, opts) => searchLocal(q, opts).map((f) => f.foodId)
async function ui(code) { await setLang(code, { persist: false }) }
const topN = (q, n = 3) => ids(q).slice(0, n)
const FOOD_IDS = FOODS.map((f) => f.foodId)

// ── Нормализация ─────────────────────────────────────────────────────────────
test('нормализация: регистр, диакритика, ß, ı/İ, ё/й, пунктуация, пробелы', () => {
  assert.equal(fold('  Греческий   Йогурт  '), 'греческии иогурт')
  assert.equal(fold('Weißbrot'), fold('Weissbrot'))
  assert.equal(fold('Hähnchenbrust'), 'hahnchenbrust')
  assert.equal(fold('YULAF SÜTÜ'), 'yulaf sutu')
  assert.equal(fold('İSKENDER'), 'iskender')
  assert.equal(fold('ışık'), 'isik')
  assert.equal(fold('çğşöü'), 'cgsou')
  assert.equal(fold('piña colada'), 'pina colada')
  assert.equal(fold('Pão de açúcar'), 'pao de acucar')
  assert.equal(fold('hot-dog'), 'hot dog')
  assert.equal(fold('women’s multi'), 'womens multi')
  assert.equal(fold("women's multi"), 'womens multi')
  assert.equal(fold('молоко 3,2%'), 'молоко 3.2%')
  assert.equal(fold('Ёжики.'), 'ежики')
})

test('нормализация арабского: огласовки, татвиль, алиф, та марбута, цифры', () => {
  assert.equal(fold('حَلِيب'), fold('حليب'))
  assert.equal(fold('حلـــيب'), fold('حليب'))
  assert.equal(fold('أرز'), fold('ارز'))
  assert.equal(fold('إفطار'), fold('افطار'))
  assert.equal(fold('آيس'), fold('ايس'))
  assert.equal(fold('تونة'), fold('تونه'))
  assert.equal(fold('حلوى'), fold('حلوي'))
  assert.equal(fold('٢٥٠ غ'), '250 غ')
  assert.equal(fold('۱۲۳'), '123')
  assert.equal(fold('کیک'), fold('كيك'))
})

test('стемминг отрезает одно окончание и не склеивает разное', () => {
  assert.equal(stem('бананы'), 'банан')
  assert.equal(stem('tomaten'), 'tomat')
  assert.equal(stem('potatoes'), 'potat')
  assert.equal(stem('elmalar'), 'elma')
  assert.equal(stem('التفاح'), 'تفاح')
  assert.equal(stem('сок'), 'сок') // короткое не трогаем
  assert.notEqual(stem('банан'), stem('баран'))
})

test('транслитерация и раскладка', () => {
  assert.equal(cyrToLat('овсянка'), 'ovsyanka')
  assert.equal(latToCyr('banana'), 'банана')
  assert.equal(swapLayout('jdczyrf'), 'овсянка')
  assert.equal(swapLayout('щфе ьшдл'), 'oat milk')
  assert.equal(swapLayout('mix микс'), '') // смесь — не раскладка
})

// ── Точное название на каждом языке ──────────────────────────────────────────
// Каждый продукт базы на каждом языке находится первым по своему названию —
// при ЛЮБОМ языке интерфейса (поиск не ограничен языком интерфейса).
// Полностью — при английском интерфейсе; при немецком и арабском — каждый
// пятый продукт (порядок базы стабилен, выборка тоже).
for (const [uiLang, step] of [['en', 1], ['de', 5], ['ar', 5]]) {
  test(`точное название любого языка — первое место (интерфейс ${uiLang})`, async () => {
    await ui(uiLang)
    const fails = []
    for (const code of CODES) {
      const table = tables[code]
      const seen = new Set()
      for (const id of FOOD_IDS.filter((_, i) => i % step === 0)) {
        const name = table[id]
        if (!name || seen.has(fold(name))) continue
        seen.add(fold(name))
        const top = ids(name)[0]
        if (top !== id) fails.push(`${code} «${name}» → ${top}, ждали ${id}`)
      }
    }
    assert.deepEqual(fails, [], fails.slice(0, 30).join('\n'))
  })
}

test('в одном языке у разных продуктов базы разные названия', () => {
  const dups = []
  for (const code of CODES) {
    const seen = new Map()
    for (const id of FOOD_IDS) {
      const name = tables[code][id]
      if (!name) continue
      const k = fold(name)
      if (seen.has(k)) dups.push(`${code}: «${name}» — ${seen.get(k)} и ${id}`)
      else seen.set(k, id)
    }
  }
  assert.deepEqual(dups, [], dups.join('\n'))
})

// ── Сценарии из требований ───────────────────────────────────────────────────
const SCENARIOS = [
  // [запрос, ожидаемый id, в первых n]
  ['Haferflocken', 'food_rolled_oats_dry', 1],
  ['oatmeal', 'food_oatmeal', 1],
  ['овсянка', 'food_oatmeal', 1],
  ['овсян', 'food_oatmeal', 3],
  ['haferfloken', 'food_rolled_oats_dry', 1],
  ['haferflockn', 'food_rolled_oats_dry', 1],
  ['porridge', 'food_oatmeal', 3],
  ['oat milk', 'food_oat_milk', 1],
  ['oatmil', 'food_oat_milk', 1],
  ['oatmilk', 'food_oat_milk', 1],
  ['avena', 'food_oatmeal', 3],
  ['yulaf sut', 'food_oat_milk', 1],
  ['yulaf sütü', 'food_oat_milk', 1],
  ['ovsyanka', 'food_oatmeal', 1],
  ['ovseanka', 'food_oatmeal', 1],
  ['ovsanka', 'food_oatmeal', 1],
  ['jdczyrf', 'food_oatmeal', 1],
  ['chicken breast cooked', 'food_chicken_breast', 1],
  ['breast chicken', 'food_chicken_breast', 1],
  ['Hähnchenbrust', 'food_chicken_breast', 1],
  ['hahnchenbrust', 'food_chicken_breast', 1],
  ['haehnchen', 'food_chicken_breast', 3],
  ['pechuga de pollo', 'food_chicken_breast', 1],
  ['peito de frango', 'food_chicken_breast', 1],
  ['tavuk gogsu', 'food_chicken_breast', 1],
  ['TAVUK GÖĞSÜ', 'food_chicken_breast', 1],
  ['صدر دجاج', 'food_chicken_breast', 1],
  ['صَدْر دَجَاج', 'food_chicken_breast', 1],
  ['شوفان', 'food_rolled_oats_dry', 3],
  ['حليب الشوفان', 'food_oat_milk', 1],
  ['حليب', 'food_milk', 1],
  ['بطاطا', 'food_potato', 1],
  ['Weissbrot', 'food_white_bread', 1],
  ['Weißbrot', 'food_white_bread', 1],
  ['bananas', 'food_banana', 1],
  ['бананы', 'food_banana', 1],
  ['Tomaten', 'food_tomato', 1],
  ['kartoffeln', 'food_potato', 1],
  ['малако', 'food_milk', 1],
  ['hot-dog', 'food_hot_dog', 1],
  ['hotdog', 'food_hot_dog', 1],
  ['hot dog', 'food_hot_dog', 1],
  ['quark', 'food_cottage_cheese', 1],
  ['ekmek', 'food_white_bread', 1],
  ['manzana', 'food_apple', 1],
  ['maca', 'food_apple', 3],
  ['elma', 'food_apple', 1],
  ['تفاح', 'food_apple', 1],
  ['cafe', 'food_black_coffee', 1],
  ['joghurt', 'food_yogurt', 1],
  ['yogur', 'food_yogurt', 1],
]
for (const uiLang of ['en', 'de', 'tr', 'ar', 'ru']) {
  test(`сценарии поиска (интерфейс ${uiLang})`, async () => {
    await ui(uiLang)
    const fails = []
    for (const [q, id, n] of SCENARIOS) {
      const top = topN(q, n)
      if (!top.includes(id)) fails.push(`«${q}» → ${top.join(', ') || 'ничего'}; ждали ${id} в первых ${n}`)
    }
    assert.deepEqual(fails, [], fails.join('\n'))
  })
}

// ── Опечатки на каждом языке ─────────────────────────────────────────────────
const typo = (s) => {
  // Перестановка двух соседних букв в середине — частая опечатка набора.
  const i = Math.floor(s.length / 2)
  return s.slice(0, i - 1) + s[i] + s[i - 1] + s.slice(i + 1)
}
test('опечатка в длинном названии на любом языке находит продукт', async () => {
  await ui('en')
  const sample = ['food_chicken_breast', 'food_oat_milk', 'food_strawberries', 'food_cottage_cheese', 'food_watermelon', 'food_buckwheat', 'food_sour_cream']
  const fails = []
  for (const code of CODES) {
    for (const id of sample) {
      const name = tables[code][id]
      if (!name) continue
      // Всё название, опечатка — в самом длинном слове: так её и делают.
      const words = fold(name).split(' ')
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '')
      if (longest.length < 7) continue
      const q = words.map((w) => (w === longest ? typo(w) : w)).join(' ')
      if (!topN(q, 5).includes(id)) fails.push(`${code} «${q}» (из «${name}») → ${topN(q, 5).join(', ')}`)
    }
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('без диакритики и в другом регистре — то же самое', async () => {
  await ui('en')
  for (const [a, b] of [['Pão de centeio', 'pao de centeio'], ['Calabacín', 'CALABACIN'], ['Çilek', 'cilek'], ['Müsli', 'musli'], ['Crème fraîche', 'creme fraiche']]) {
    assert.deepEqual(topN(a, 3), topN(b, 3), `${a} / ${b}`)
  }
})

// ── Ранжирование и отрицательные случаи ──────────────────────────────────────
test('«milk»: сначала молоко и виды молока, а не шоколад и коктейли', async () => {
  await ui('en')
  const top = topN('milk', 6)
  assert.equal(top[0], 'food_milk')
  for (const id of top.slice(1, 4)) assert.match(id, /_milk$/, `«${id}» среди первых по «milk»`)
  const choc = ids('milk').indexOf('food_milk_chocolate')
  assert.ok(choc === -1 || choc > top.indexOf('food_oat_milk'), 'молочный шоколад выше овсяного молока')
})

test('«oat milk» — овсяное молоко, а не молоко вообще; «almond milk» — миндальное', async () => {
  await ui('de')
  assert.equal(topN('oat milk', 1)[0], 'food_oat_milk')
  assert.equal(topN('almond milk', 1)[0], 'food_almond_milk')
  assert.equal(topN('Mandelmilch', 1)[0], 'food_almond_milk')
  assert.ok(topN('milk', 1)[0] === 'food_milk')
})

test('«лук» — лук, а не луковый суп; «рис» — рис, а не блюдо с рисом', async () => {
  await ui('ru')
  assert.equal(topN('лук', 1)[0], 'food_onion')
  assert.ok(ids('лук').indexOf('food_onion') < ids('лук').indexOf('food_french_onion_soup'))
  assert.equal(topN('рис', 1)[0], 'food_rice')
})

test('бессмыслица и мусор ничего не находят и не падают', async () => {
  await ui('en')
  for (const q of ['qzxqzxq', 'ъъъъъ', '%%%', '٠٠٠']) assert.deepEqual(ids(q), [], q)
  for (const q of ['__proto__', 'constructor', 'toString', '<img src=x onerror=alert(1)>', '.*+?[(', 'a'.repeat(10_000), '\u0000\u0001', '🍕🍕']) {
    assert.doesNotThrow(() => searchLocal(q), q.slice(0, 20))
    assert.ok(Array.isArray(searchLocal(q)))
  }
  assert.equal(searchLocal('').length, FOODS.length, 'пустой запрос — вся база')
  assert.equal(searchLocal('.....').length, FOODS.length, 'одна пунктуация — как пустой запрос')
})

test('синонимы одного продукта дают одну карточку', async () => {
  await ui('en')
  for (const q of ['porridge', 'oats', 'oatmeal', 'quark', 'Haferflocken']) {
    const list = ids(q)
    assert.equal(new Set(list).size, list.length, q)
  }
  // Даже если тот же продукт попал в список дважды.
  const doubled = [...FOODS, ...FOODS]
  const r = searchItems(doubled, 'banana').results
  assert.equal(r.filter((f) => f.foodId === 'food_banana').length, 1)
})

test('порядок детерминирован и не зависит от порядка базы', async () => {
  await ui('en')
  const shuffled = [...FOODS].reverse()
  for (const q of ['milk', 'chicken', 'bread', 'хлеб', 'pan']) {
    const a = searchLocal(q).slice(0, 15).map((f) => f.foodId)
    const b = searchLocal(q, { items: shuffled }).slice(0, 15).map((f) => f.foodId)
    assert.deepEqual(a, b, q)
    assert.deepEqual(a, searchLocal(q).slice(0, 15).map((f) => f.foodId), `${q}: повтор`)
  }
})

test('личная надбавка не переводит продукт через тир', async () => {
  await ui('en')
  const boost = (f) => (f.foodId === 'food_milk_chocolate' ? 1 : 0)
  assert.equal(searchLocal('milk', { boost })[0].foodId, 'food_milk')
})

test('подсказка «вы имели в виду» — только когда выдача держится на исправлении', async () => {
  await ui('de')
  const typoRes = searchItems(FOODS, 'haferfloken')
  assert.equal(typoRes.suggestion?.item.foodId, 'food_rolled_oats_dry')
  assert.equal(searchItems(FOODS, 'Haferflocken').suggestion, null)
  assert.equal(searchItems(FOODS, 'qzxqzxq').suggestion, null)
})

// ── Свои блюда, ингредиенты, добавки ─────────────────────────────────────────
test('своё блюдо ищется по своему имени и не превращается в продукт базы', async () => {
  await ui('en')
  const mine = [{ id: 'u1', name: 'Бабушкин борщ', source: 'custom' }, { id: 'u2', name: 'Банан', source: 'custom', kcal: 1 }]
  assert.equal(searchByName(mine, 'бабушкин')[0].id, 'u1')
  assert.equal(searchByName(mine, 'бабушкен')[0]?.id, 'u1', 'опечатка')
  // «Банан» человека не находится по «Plátano»: перевода у своего нет.
  assert.equal(searchByName(mine, 'plátano').length, 0)
  const pool = searchItems([...mine, ...FOODS], 'банан').results
  assert.ok(pool.some((f) => f.id === 'u2') && pool.some((f) => f.foodId === 'food_banana'), 'своё и базовое — разные карточки')
})

test('ингредиенты конструктора ищутся на всех языках', async () => {
  await ui('en')
  const names = searchIngredients('Gurke').slice(0, 3).map((i) => i.foodId)
  assert.ok(names.includes('food_cucumber'), names.join())
  assert.ok(CONSTRUCTOR_ING.every((i) => i.foodId === null || isCatalogId('foods', i.foodId)))
})

test('добавки ищутся на всех языках', async () => {
  await ui('ru')
  const find = (q) => searchSupplements(q).slice(0, 3).map((s) => s.id)
  assert.ok(find('ashwagandha').includes('ashwagandha'))
  assert.ok(find('ашваганда').includes('ashwagandha'), 'опечатка')
  assert.ok(find('Magnesium').some((id) => id.startsWith('mg')))
  assert.ok(find('كرياتين').includes('creatine') || find('كرياتين').some((id) => id.startsWith('creatine')))
  assert.equal(searchSupplements('').length, SUPPLEMENTS.length)
})

// ── Сопоставление с каталогом (ИИ, импорт) ───────────────────────────────────
test('точное название на любом языке → id; опечатка и неоднозначность → null', () => {
  assert.equal(matchCatalogFoodSync('Haferflocken', FOODS), 'food_rolled_oats_dry')
  assert.equal(matchCatalogFoodSync('Oat milk', FOODS), 'food_oat_milk')
  assert.equal(matchCatalogFoodSync('حليب الشوفان', FOODS), 'food_oat_milk')
  assert.equal(matchCatalogFoodSync('Yulaf sütü', FOODS), 'food_oat_milk')
  assert.equal(matchCatalogFoodSync('  овсянка ', FOODS), 'food_oatmeal')
  assert.equal(matchCatalogFoodSync('haferfloken', FOODS), null, 'опечатка — не совпадение')
  assert.equal(matchCatalogFoodSync('Овсянка с ягодами и мёдом', FOODS), null, 'блюдо — не продукт')
  assert.equal(matchCatalogFoodSync('', FOODS), null)
  assert.equal(matchCatalogFoodSync('__proto__', FOODS), null)
})

// ── Словари синонимов ────────────────────────────────────────────────────────
test('синонимы и ключевые слова привязаны к существующим id и языкам', () => {
  const langs = new Set(CODES)
  for (const [id, byLang] of Object.entries(ALIASES)) {
    assert.ok(isCatalogId('foods', id), `aliases: нет id ${id}`)
    for (const [lang, list] of Object.entries(byLang)) {
      assert.ok(langs.has(lang), `${id}: язык ${lang}`)
      assert.ok(Array.isArray(list) && list.every((a) => typeof a === 'string' && a.trim()), `${id}.${lang}`)
    }
  }
  for (const id of Object.keys(KEYWORDS)) assert.ok(isCatalogId('foods', id), `keywords: нет id ${id}`)
})

test('синоним не указывает на два разных продукта сразу', () => {
  const owner = new Map()
  const clashes = []
  for (const [id, byLang] of Object.entries(ALIASES)) {
    for (const list of Object.values(byLang)) {
      for (const a of list) {
        const k = fold(a)
        if (owner.has(k) && owner.get(k) !== id) clashes.push(`«${a}»: ${owner.get(k)} и ${id}`)
        owner.set(k, id)
      }
    }
  }
  assert.deepEqual(clashes, [], clashes.join('\n'))
})

test('индекс версионирован, кэш перестраивается при смене языка', async () => {
  assert.ok(Number.isInteger(INDEX_VERSION) && INDEX_VERSION > 0)
  await ui('en')
  const a = searchItems(FOODS, 'milk').results[0]
  await ui('de')
  const b = searchItems(FOODS, 'milk').results[0]
  assert.equal(a.id, b.id)
  const idx = buildIndex([{ key: 'x', item: {}, fields: [{ text: 'Test', kind: 'name', lang: 'en' }] }])
  assert.equal(idx.version, INDEX_VERSION)
  assert.equal(search(idx, [{ text: 'test', weight: 1 }]).results[0].key, 'x')
})

test('варианты запроса: раскладка и транслитерация весят меньше самого запроса', () => {
  const v = queryVariants('jdczyrf')
  assert.equal(v[0].weight, 1)
  assert.ok(v.some((x) => x.text === 'овсянка' && x.weight < 1))
})

// ── Скорость ─────────────────────────────────────────────────────────────────
// Пороги щедрые (CI медленнее ноутбука), но ловят возврат к пересчёту всего
// на каждой букве: тогда нечёткий запрос стоил 100–150 мс.
test('скорость: построение индекса и запросы', async () => {
  await ui('tr')
  const t0 = performance.now()
  searchLocal('x')
  const build = performance.now() - t0
  const times = []
  for (const q of ['milk', 'haferfloken', 'ovseanka', 'chicken breast cooked', 'حليب الشوفان', 'jdczyrf', 'tavuk', 'ab']) {
    const s = performance.now()
    searchLocal(q)
    times.push(performance.now() - s)
  }
  times.sort((a, b) => a - b)
  assert.ok(build < 1500, `индекс строится ${build.toFixed(0)} мс`)
  assert.ok(times[times.length - 1] < 250, `самый медленный запрос ${times[times.length - 1].toFixed(0)} мс`)
})
