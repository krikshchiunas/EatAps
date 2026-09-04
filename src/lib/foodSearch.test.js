// ─────────────────────────────────────────────────────────────────────────────
// Поиск продуктов и память о них.
//
// Проверяется ровно то, что ломалось или отсутствовало:
//   • нормализация запроса — один и тот же запрос, набранный по-разному;
//   • латиница и иноязычные названия — «banana» находит «Банан»;
//   • память: частое ≠ недавнее ≠ избранное, и «часто» учитывает свежесть;
//   • персонализация НЕ ломает релевантность — главное правило поиска;
//   • слияние недавних не теряет счётчик (терялся при каждой синхронизации).
// ─────────────────────────────────────────────────────────────────────────────
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeQuery, translit, searchLocal, searchByName, sanitizeAmount, FOODS, scale, hasMacros, macroLabel, amountLabel } from './foods.js'
import { MEMORY_BOOST_MAX, rankedSearch } from './fuzzy.js'
import {
  buildFoodMemory, frequentFoods, recentFoods, memoryPortion, memoryBoost,
  recencyWeight, FREQUENT_HALF_LIFE_DAYS, favoriteKey, scaleSnapshot, toPer100,
  MEMORY_WINDOW_DAYS,
} from './library.js'
import { mergeState, normalizeState, recentKey } from './syncModel.js'

// Валидная HLC-метка: <мс:15>-<счётчик:5>-<устройство:8>. Строим руками, чтобы
// в тесте было видно, какая правка новее.
const ts = (ms, device = 'devaaaa1') =>
  `${String(ms).padStart(15, '0')}-${String(0).padStart(5, '0')}-${device}`

// ── Вспомогательное: журнал приёмов из N дней назад ──────────────────────────
const NOW = new Date(2026, 8, 2).getTime()
const dayKey = (back) => {
  const t = new Date(2026, 8, 2 - back)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
const log = (entries) => {
  const days = {}
  for (const [back, meal] of entries) {
    days[dayKey(back)] ||= { meals: [] }
    days[dayKey(back)].meals.push({ unit: 'г', kcal: 100, protein: 1, carbs: 1, fat: 1, ...meal })
  }
  return days
}

// ── Нормализация запроса ─────────────────────────────────────────────────────

test('normalizeQuery: регистр, лишние пробелы, пунктуация', () => {
  assert.equal(normalizeQuery('  Греческий   Йогурт  '), normalizeQuery('греческий йогурт'))
  assert.equal(normalizeQuery('хот-дог'), 'хот дог')
  assert.equal(normalizeQuery('Творог 5%'), 'творог 5%')
  assert.equal(normalizeQuery(''), '')
  assert.equal(normalizeQuery(null), '')
})

test('normalizeQuery: ё и й приводятся к базовой букве', () => {
  // В базе «Мёд» и «Йогурт», человек набирает «мед» и «иогурт».
  assert.equal(normalizeQuery('Мёд'), normalizeQuery('мед'))
  assert.equal(normalizeQuery('Йогурт'), normalizeQuery('иогурт'))
})

test('normalizeQuery: латинские диакритики снимаются', () => {
  assert.equal(normalizeQuery('Müsli'), 'musli')
  assert.equal(normalizeQuery('Café'), 'cafe')
})

test('normalizeQuery: разные формы одного запроса совпадают', () => {
  const forms = ['banana', 'Banana', 'BANANA', ' banana ', 'banana!']
  const first = normalizeQuery(forms[0])
  for (const f of forms) assert.equal(normalizeQuery(f), first)
})

// ── Латиница ─────────────────────────────────────────────────────────────────

test('translit: родственные слова переводятся в кириллицу', () => {
  assert.equal(translit('banana'), 'банана')
  assert.equal(translit('tofu'), 'тофу')
  assert.equal(translit('kefir'), 'кефир')
})

test('поиск находит продукт по английскому и немецкому названию', () => {
  const cases = [
    ['banana', 'Банан'],
    ['chicken breast', 'Куриная грудка'],
    ['oatmeal', 'Овсянка'],
    ['greek yogurt', 'Греческий йогурт'],
    ['apfel', 'Яблоко'],
    ['haferflocken', 'Овсянка'],
    ['quark', 'Творог'],
    ['erdnussbutter', 'Арахисовая паста'],
    ['lachs', 'Лосось'],
  ]
  for (const [q, expected] of cases) {
    const top = searchLocal(q).slice(0, 3).map((f) => f.name)
    assert.ok(top.includes(expected), `«${q}» → ${top.join(' | ') || 'ничего'}, ждали «${expected}»`)
  }
})

test('все иноязычные псевдонимы навешены на существующие продукты', () => {
  // Опечатка в ключе таблицы FOREIGN не сломала бы сборку, но продукт молча
  // остался бы без английского названия. Проверяем, что alias реально доехал.
  const banana = FOODS.find((f) => f.name === 'Банан')
  assert.ok(banana.alias.includes('banana'))
  const chicken = FOODS.find((f) => f.name === 'Куриная грудка')
  assert.ok(chicken.alias.includes('chicken'))
})

// ── Опечатки остаются рабочими ───────────────────────────────────────────────

test('опечатки в русском вводе по-прежнему находятся', () => {
  assert.equal(searchLocal('банан')[0].name, 'Банан')
  assert.equal(searchLocal('банн')[0].name, 'Банан')
  assert.equal(searchLocal('малако')[0].name, 'Молоко')
})

// ── Память: частое, недавнее, привычная порция ───────────────────────────────

test('recencyWeight: период полураспада', () => {
  assert.equal(recencyWeight(0), 1)
  assert.ok(Math.abs(recencyWeight(FREQUENT_HALF_LIFE_DAYS) - 0.5) < 1e-9)
  assert.ok(recencyWeight(365) < 0.001)
})

test('частое учитывает свежесть, а не только счётчик', () => {
  // 8 приёмов за неделю должны обойти 50 приёмов полугодовой давности —
  // ровно тот случай, ради которого затухание и введено.
  const days = log([
    ...Array.from({ length: 8 }, (_, i) => [i, { name: 'Греческий йогурт', grams: 150 }]),
    ...Array.from({ length: 50 }, (_, i) => [180 + i, { name: 'Овсянка', grams: 50 }]),
  ])
  const mem = buildFoodMemory(days, NOW)
  const top = frequentFoods(mem, { minUses: 3 })
  assert.equal(top[0].name, 'Греческий йогурт')
  assert.equal(mem.get(favoriteKey({ name: 'Овсянка', unit: 'г' })).uses, 50) // счёт настоящий
})

test('частое требует нескольких приёмов — разовый продукт не «частый»', () => {
  const mem = buildFoodMemory(log([[1, { name: 'Пахлава', grams: 60 }]]), NOW)
  assert.equal(frequentFoods(mem, { minUses: 3 }).length, 0)
  assert.equal(recentFoods(mem, { now: NOW })[0].name, 'Пахлава') // но недавнее — есть
})

test('недавнее сортируется по времени, а не по частоте', () => {
  const days = log([
    ...Array.from({ length: 10 }, (_, i) => [i + 3, { name: 'Рис', grams: 100 }]),
    [0, { name: 'Пахлава', grams: 60 }],
  ])
  const mem = buildFoodMemory(days, NOW)
  assert.equal(recentFoods(mem, { now: NOW })[0].name, 'Пахлава')
  assert.equal(frequentFoods(mem, { minUses: 3 })[0].name, 'Рис')
})

test('привычная порция — медиана, разовый выброс её не сдвигает', () => {
  const grams = [50, 50, 55, 500] // последняя — разовая кастрюля
  const days = log(grams.map((g, i) => [i + 1, { name: 'Овсянка', grams: g }]))
  const mem = buildFoodMemory(days, NOW)
  const suggested = memoryPortion(mem, { name: 'Овсянка', unit: 'г' })
  const mean = grams.reduce((a, b) => a + b, 0) / grams.length // 163.75
  assert.ok(suggested <= 60, `подсказка ${suggested} должна остаться в районе обычной порции`)
  assert.ok(suggested < mean / 2, 'среднее перекосило бы подсказку, медиана — нет')
})

test('привычная порция не выдумывается из одного приёма', () => {
  const mem = buildFoodMemory(log([[1, { name: 'Хурма', grams: 170 }]]), NOW)
  const e = mem.get(favoriteKey({ name: 'Хурма', unit: 'г' }))
  assert.equal(e.typicalGrams, null)   // привычки ещё нет
  assert.equal(e.lastGrams, 170)       // но прошлое количество известно
  assert.equal(memoryPortion(mem, { name: 'Хурма', unit: 'г' }), 170)
})

test('память не путает продукт в граммах и в миллилитрах', () => {
  const days = log([
    [1, { name: 'Молоко', unit: 'мл', grams: 250 }],
    [2, { name: 'Молоко', unit: 'г', grams: 200 }],
  ])
  const mem = buildFoodMemory(days, NOW)
  assert.equal(mem.size, 2)
})

test('память нечувствительна к регистру и ё', () => {
  const mem = buildFoodMemory(log([[1, { name: 'Мёд', grams: 20 }], [2, { name: 'мед', grams: 20 }]]), NOW)
  assert.equal(mem.size, 1)
  assert.equal([...mem.values()][0].uses, 2)
})

test('журнал приёмов и память — разные сущности', () => {
  // Пять бананов за день — это пять записей в дневнике и ОДНА строка памяти.
  const days = log(Array.from({ length: 5 }, () => [0, { name: 'Банан', grams: 120 }]))
  assert.equal(days[dayKey(0)].meals.length, 5)
  const mem = buildFoodMemory(days, NOW)
  assert.equal(mem.size, 1)
  assert.equal([...mem.values()][0].uses, 5)
})

test('«часто едите» не показывает заброшенное', () => {
  // Пятьдесят порций прошлой зимой — это не «часто едите», это история.
  const mem = buildFoodMemory(log(Array.from({ length: 50 }, (_, i) => [200 + i, { name: 'Овсянка', grams: 50 }])), NOW)
  assert.equal(mem.get(favoriteKey({ name: 'Овсянка', unit: 'г' })).uses, 50)
  assert.equal(frequentFoods(mem).length, 0)
})

test('«недавнее» ограничено окном, а не просто сортировкой', () => {
  const mem = buildFoodMemory(log([[200, { name: 'Овсянка', grams: 50 }], [2, { name: 'Банан', grams: 120 }]]), NOW)
  assert.deepEqual(recentFoods(mem, { now: NOW }).map((e) => e.name), ['Банан'])
})

test('битые данные не роняют построение памяти', () => {
  const mem = buildFoodMemory({
    'не-дата': { meals: [{ name: 'X' }] },
    '2026-09-01': { meals: [null, { name: '' }, { grams: 10 }, { name: 'Рис', grams: 'abc' }] },
  }, NOW)
  assert.equal(mem.size, 1)
  assert.equal(mem.get(favoriteKey({ name: 'Рис', unit: 'г' })).typicalGrams, null)
  assert.deepEqual(frequentFoods(null), [])
  assert.deepEqual(recentFoods(undefined, { now: NOW }), [])
})

// ── Персонализация не ломает релевантность ───────────────────────────────────

test('ГЛАВНОЕ ПРАВИЛО: частый продукт не всплывает по чужому запросу', () => {
  const days = log(Array.from({ length: 40 }, (_, i) => [i, { name: 'Греческий йогурт', grams: 150 }]))
  const boost = memoryBoost(buildFoodMemory(days, NOW), [])
  const top = searchLocal('банан', { boost }).slice(0, 5).map((f) => f.name)
  assert.equal(top[0], 'Банан')
  assert.ok(!top.includes('Греческий йогурт'), `в выдаче: ${top.join(' | ')}`)
})

test('надбавка не может перевести запись через тир релевантности', () => {
  // «Йогурт» — точное совпадение (высший тир). Никакая история не должна
  // поставить перед ним «Греческий йогурт», совпавший лишь частью названия.
  const days = log(Array.from({ length: 60 }, (_, i) => [i % 30, { name: 'Греческий йогурт', grams: 150 }]))
  const boost = memoryBoost(buildFoodMemory(days, NOW), [])
  assert.equal(searchLocal('йогурт', { boost })[0].name, 'Йогурт')
})

test('надбавка ограничена сверху и работает внутри тира', () => {
  const items = [{ n: 'редкий продукт' }, { n: 'частый продукт' }]
  const opts = { toText: (x) => x.n, toName: (x) => x.n }
  // Оба совпадают одинаково («продукт» — начало слова), порядок решает надбавка.
  const plain = rankedSearch(items, ['продукт'], opts)
  assert.equal(plain[0].n, 'редкий продукт') // при равенстве — исходный порядок
  const boosted = rankedSearch(items, ['продукт'], { ...opts, boost: (x) => (x.n.startsWith('частый') ? 1 : 0) })
  assert.equal(boosted[0].n, 'частый продукт')
  assert.ok(MEMORY_BOOST_MAX < 10, 'потолок надбавки должен быть меньше узкого разрыва между тирами')
})

test('надбавка за пределами 0..1 обрезается', () => {
  const items = [{ n: 'банан' }, { n: 'банановый хлеб' }]
  const opts = { toText: (x) => x.n, toName: (x) => x.n }
  const out = rankedSearch(items, ['банан'], { ...opts, boost: () => 1e9 })
  assert.equal(out[0].n, 'банан') // точное совпадение всё равно первое
})

test('избранное поднимает продукт, но тоже внутри тира', () => {
  const mem = buildFoodMemory({}, NOW)
  const boost = memoryBoost(mem, [{ name: 'Греческий йогурт', unit: 'г' }])
  assert.ok(boost({ name: 'Греческий йогурт', unit: 'г' }) >= 0.5)
  assert.equal(boost({ name: 'Банан', unit: 'г' }), 0)
  assert.equal(searchLocal('йогурт', { boost })[0].name, 'Йогурт')
})

test('память по продукту со способом приготовления узнаётся по базовому имени', () => {
  // В журнал попадает «Куриная грудка, варёная», в поиске — «Куриная грудка».
  const days = log(Array.from({ length: 10 }, (_, i) => [i, { name: 'Куриная грудка, варёная', grams: 180 }]))
  const boost = memoryBoost(buildFoodMemory(days, NOW), [])
  assert.ok(boost({ name: 'Куриная грудка', unit: 'г' }) > 0)
})

test('пустой запрос отдаёт всю базу, а не пустой список', () => {
  assert.equal(searchLocal('').length, FOODS.length)
  assert.equal(searchLocal('   ').length, FOODS.length)
})

// ── Синхронизация недавних ───────────────────────────────────────────────────

test('слияние недавних не теряет счётчик', () => {
  // Телефон: съел 17 раз, но давно. Ноутбук: 3 раза, но недавно.
  // Раньше побеждала запись целиком — и «17» превращалось в «3».
  const phone = { recents: [{ name: 'Банан', unit: 'г', count: 17, ts: 1000 }] }
  const laptop = { recents: [{ name: 'Банан', unit: 'г', count: 3, ts: 2000 }] }
  const merged = mergeState(phone, laptop)
  assert.equal(merged.recents.length, 1)
  assert.equal(merged.recents[0].count, 17)
  assert.equal(merged.recents[0].ts, 2000)
})

test('недавние не двоятся из-за регистра, но различают единицы', () => {
  const s = normalizeState({
    recents: [
      { name: 'Банан', unit: 'г', count: 2, ts: 2 },
      { name: 'банан', unit: 'г', count: 5, ts: 1 },
      { name: 'Молоко', unit: 'мл', count: 1, ts: 3 },
      { name: 'Молоко', unit: 'г', count: 1, ts: 4 },
    ],
  })
  const bananas = s.recents.filter((r) => recentKey(r).startsWith('банан|'))
  assert.equal(bananas.length, 1)
  assert.equal(bananas[0].count, 5, 'больший счётчик должен пережить схлопывание дублей')
  assert.equal(s.recents.filter((r) => r.name === 'Молоко').length, 2)
})

// ── Синхронизация избранного ─────────────────────────────────────────────────

test('избранное сливается между устройствами', () => {
  const phone = { favorites: [{ id: 'a', name: 'Банан', unit: 'г', updatedAt: ts(1000) }] }
  const laptop = { favorites: [{ id: 'b', name: 'Овсянка', unit: 'г', updatedAt: ts(2000, 'devbbbb2') }] }
  const merged = mergeState(phone, laptop)
  assert.deepEqual(merged.favorites.map((f) => f.name).sort(), ['Банан', 'Овсянка'])
})

test('снятое избранное не воскресает с другого устройства', () => {
  const laptop = { favorites: [{ id: 'a', name: 'Банан', unit: 'г', updatedAt: ts(1000, 'devbbbb2') }] }
  const phone = { favorites: [], meta: { tombstones: { 'fav:a': ts(5000) } } }
  assert.equal(mergeState(laptop, phone).favorites.length, 0)
  assert.equal(mergeState(phone, laptop).favorites.length, 0) // порядок не важен
})

// ── Поле количества ──────────────────────────────────────────────────────────
// Показанное в поле обязано совпадать с тем, что будет записано.

test('sanitizeAmount: в поле остаётся ровно то, что будет записано', () => {
  assert.equal(sanitizeAmount('150'), '150')
  assert.equal(sanitizeAmount('-50'), '50')      // минус не должен исчезать молча
  assert.equal(sanitizeAmount('1,25'), '1.25')   // европейский разделитель
  assert.equal(sanitizeAmount('1.2.3'), '1.23')
  assert.equal(sanitizeAmount('abc'), '')
  assert.equal(sanitizeAmount('12.'), '12.')     // незаконченный ввод дробного
  assert.equal(sanitizeAmount('0.5'), '0.5')
  assert.equal(sanitizeAmount(''), '')
  assert.equal(sanitizeAmount(null), '')
})

test('scaleSnapshot: дробные и предельные количества не дают NaN/Infinity', () => {
  const snap = { name: 'Овсянка', unit: 'г', grams: 50, kcal: 183, protein: 6, carbs: 31, fat: 3.5 }
  for (const g of [0.5, 1.25, 33.3, 99999]) {
    const out = scaleSnapshot(snap, g)
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
      assert.ok(Number.isFinite(out[k]), `${k} при ${g} г = ${out[k]}`)
    }
  }
  // Ноль и мусор не пересчитывают запись «во что попало» — снимок остаётся собой.
  assert.equal(scaleSnapshot(snap, 0).grams, 50)
  assert.equal(scaleSnapshot(snap, NaN).grams, 50)
  assert.equal(scaleSnapshot(null, 100), null)
})

test('toPer100 и обратно не портят числа', () => {
  const eaten = { name: 'Банан', unit: 'г', grams: 125, kcal: 108, protein: 1.4, carbs: 29, fat: 0.4 }
  const per100 = toPer100(eaten)
  assert.equal(per100.kcal, 86) // 108 / 1.25
  assert.equal(per100.grams, undefined) // «на 100» — не порция
})

test('неизвестные сахар и насыщенные жиры не превращаются в ноль', () => {
  // Ноль означал бы «измерено и равно нулю». Отсутствие данных обязано
  // оставаться отсутствием — иначе дневная статистика тихо занижается.
  const noSugar = scaleSnapshot({ name: 'X', unit: 'г', grams: 100, kcal: 100, protein: 1, carbs: 1, fat: 1 }, 200)
  assert.equal('sugar' in noSugar, false)
  assert.equal('satFat' in noSugar, false)
  assert.equal('sugar' in toPer100({ name: 'X', grams: 50, kcal: 10, protein: 0, carbs: 0, fat: 0 }), false)
  // А известные — переносятся и пересчитываются.
  const withSugar = scaleSnapshot({ name: 'X', unit: 'г', grams: 100, kcal: 100, protein: 1, carbs: 10, fat: 1, sugar: 4 }, 50)
  assert.equal(withSugar.sugar, 2)
})

// ── Совпадение со всем запросом важнее совпадения с его частью ───────────────

test('точное совпадение со всем запросом стоит выше совпадения с частью', () => {
  // Синоним «плов» давал короткому «Плов» те же 1000 баллов, что полному
  // совпадению «Плов тёщин», и тай-брейк по длине ставил его первым:
  // человек искал своё блюдо по полному имени и получал чужое.
  const items = [
    { name: 'Плов', kcal: 190, unit: 'г' },
    { name: 'Плов свиной', kcal: 210, unit: 'г' },
    { name: 'Плов тёщин', kcal: 210, unit: 'г' },
  ]
  assert.equal(searchLocal('плов тёщин', { items })[0].name, 'Плов тёщин')
  assert.equal(searchLocal('плов', { items })[0].name, 'Плов') // короткий запрос — короткое имя
})

test('синонимы продолжают расширять поиск, просто весят меньше', () => {
  // «биф» — синоним говядины: без синонимов запрос не нашёл бы ничего.
  const top = searchLocal('биф').slice(0, 5).map((f) => f.name)
  assert.ok(top.some((n) => /говя/i.test(n)), top.join(' | '))
})

test('запрос из нескольких слов не рассыпается на пробелах', () => {
  assert.equal(searchLocal('греческий йогурт')[0].name, 'Греческий йогурт')
  assert.equal(searchLocal('  греческий   йогурт  ')[0].name, 'Греческий йогурт')
  assert.equal(searchLocal('куриная грудка')[0].name, 'Куриная грудка')
})

test('память смотрит на год назад, но не дальше', () => {
  // Окно — то, что делает пересчёт независимым от длины истории. Если его
  // однажды сузят, привычные порции начнут молча пропадать, поэтому граница
  // закреплена тестом.
  const mem = buildFoodMemory(
    log([[300, { name: 'Плов', grams: 300 }], [301, { name: 'Плов', grams: 300 }]]),
    NOW,
  )
  assert.equal(memoryPortion(mem, { name: 'Плов', unit: 'г' }), 300, 'год назад — ещё помним')

  const old = buildFoodMemory(
    log([[400, { name: 'Плов', grams: 300 }], [401, { name: 'Плов', grams: 300 }]]),
    NOW,
  )
  assert.equal(old.size, 0, 'за окном — не читаем вовсе')
  assert.ok(MEMORY_WINDOW_DAYS >= 365)
})

test('пересчёт памяти не растёт вместе с историей', () => {
  // Память пересобирается при каждом добавлении еды. Без окна пятилетний
  // журнал означал бы пятикратную работу на каждое нажатие «＋».
  const mk = (nDays) => log(
    Array.from({ length: nDays }, (_, d) => [d, { name: 'Продукт ' + (d % 40), grams: 100 }]),
  )
  const half = mk(180), five = mk(1825)
  const time = (days) => {
    buildFoodMemory(days, NOW)
    const t = Date.now()
    for (let i = 0; i < 20; i++) buildFoodMemory(days, NOW)
    return (Date.now() - t) / 20
  }
  const tHalf = time(half), tFive = time(five)
  assert.ok(tFive < tHalf * 3 + 2, `полгода ${tHalf.toFixed(2)}мс против пяти лет ${tFive.toFixed(2)}мс`)
})

// ── Неизвестное — не ноль ────────────────────────────────────────────────────

test('отсутствующие БЖУ остаются неизвестными на всём пути', () => {
  // Глобальная база часто знает только калорийность. Записать туда ноль значит
  // соврать: человек увидит «0 г белка» и поверит.
  const off = { name: 'Печенье', kcal: 455, protein: null, carbs: null, fat: null }
  assert.equal(hasMacros(off), false)
  assert.equal(macroLabel(off), 'Б— У— Ж—')

  const portion = scale(off, 150)
  assert.equal(portion.kcal, 683, 'калории известны — считаем')
  assert.equal(portion.protein, null, 'а белок так и не появился')
  assert.equal(portion.carbs, null)
  assert.equal(portion.fat, null)
})

test('частично известные БЖУ не портятся прочерками', () => {
  const half = { kcal: 455, protein: 7.5, carbs: 66, fat: null }
  assert.equal(hasMacros(half), true)
  assert.equal(macroLabel(half), 'Б7.5 У66 Ж—')
  const p = scale(half, 150)
  assert.equal(p.protein, 11.3)
  assert.equal(p.carbs, 99)
  assert.equal(p.fat, null, 'неизвестное не масштабируется в NaN')
})

test('настоящий ноль отличается от неизвестного', () => {
  // Масло действительно содержит 0 углеводов — это измеренный факт.
  assert.equal(macroLabel({ protein: 0, carbs: 0, fat: 99.8 }), 'Б0 У0 Ж99.8')
  assert.equal(scale({ kcal: 899, protein: 0, carbs: 0, fat: 99.8 }, 10).carbs, 0)
})

// ── Количество по-русски ─────────────────────────────────────────────────────

test('дробное количество печатается с запятой и в нужном падеже', () => {
  // Дневник печатал «1.5 порция» — и точка не наша, и падеж не тот.
  assert.equal(amountLabel(1.5, 'порция'), '1,5 порции')
  assert.equal(amountLabel(0.5, 'порция'), '0,5 порции')
  assert.equal(amountLabel(2.5, 'порция'), '2,5 порции')
})

test('целые порции склоняются по правилам, а не по «1, 2, много»', () => {
  const forms = [1, 2, 4, 5, 11, 21, 22, 25, 101].map((n) => amountLabel(n, 'порция'))
  assert.deepEqual(forms, [
    '1 порция', '2 порции', '4 порции', '5 порций',
    '11 порций', '21 порция', '22 порции', '25 порций', '101 порция',
  ])
})

test('неизменяемые единицы остаются как есть', () => {
  assert.equal(amountLabel(150, 'г'), '150 г')
  assert.equal(amountLabel(2, 'шт'), '2 шт')
  assert.equal(amountLabel(250, 'мл'), '250 мл')
  assert.equal(amountLabel(0.5, 'г'), '0,5 г', 'запятая нужна и здесь')
})

// ── Поиск по своим блюдам и рецептам ─────────────────────────────────────────

const mine = [{ id: 'r1', name: 'Борщ' }, { id: 't1', name: 'Мой завтрак' }, { id: 'r2', name: 'Плов тёщин' }]

test('своё находится по имени и с опечаткой', () => {
  // Человек сварил борщ и назвал рецепт «Борщ». Набрав «борщ», он обязан
  // увидеть СВОЙ рецепт, а не одноимённый из общей базы.
  assert.deepEqual(searchByName(mine, 'борщ').map((x) => x.name), ['Борщ'])
  assert.deepEqual(searchByName(mine, 'борш').map((x) => x.name), ['Борщ'], 'опечатки — как везде')
  assert.deepEqual(searchByName(mine, 'завтак').map((x) => x.name), ['Мой завтрак'])
})

test('короткий запрос не цепляет случайную подстроку внутри слова', () => {
  // «щи» находились в «Плов тёщин». В большом списке такой шум тонет, но в
  // коротком личном он оказывается первой строкой — и человек видит не то.
  assert.deepEqual(searchByName(mine, 'щи'), [])
  assert.deepEqual(searchByName(mine, 'xyz'), [])
})

test('длинная подстрока по-прежнему находится', () => {
  assert.deepEqual(searchLocal('сгущенка')[0].name, 'Сгущёнка')
  assert.equal(searchLocal('творог')[0].name, 'Творог')
  assert.equal(searchLocal('щи')[0].name, 'Щи', 'короткое имя целиком — это точное совпадение')
})
