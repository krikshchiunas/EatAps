// Тесты каталога добавок: состав, пересчёт доз, поиск.
//
// Опасная ошибка здесь — не падение, а неверная цифра на этикетке: если
// витамин D записан в МЕ, а не в микрограммах, приложение покажет «2000 из 15»
// и посоветует прекратить приём совершенно нормальной дозы.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUPPLEMENTS, SUPP_BY_ID, SUPP_GROUPS, POPULAR_SUPPLEMENTS,
  supplementById, searchSupplements, scaleProvides, makeSuppEntry,
  makeCustomSupplement, doseLabel, sumSuppMicros,
  doseFields, providesFromFields, unitProvides, unitDose, needsDoseSetup, hasOwnDose,
} from './supplements.js'
import { MICRO_BY_KEY } from './micronutrients.js'

// ── Целостность каталога ──────────────────────────────────────────────────────

test('у каждой добавки есть всё, чем её рисуют и считают', () => {
  const groups = new Set(SUPP_GROUPS.map((g) => g.key))
  for (const s of SUPPLEMENTS) {
    assert.ok(s.id, 'нет id')
    assert.ok(s.name, `${s.id}: нет названия`)
    assert.ok(s.emoji, `${s.id}: нет эмодзи`)
    assert.ok(groups.has(s.group), `${s.id}: группа «${s.group}» не объявлена`)
    assert.ok(s.unit, `${s.id}: нет единицы приёма`)
    assert.ok(s.defaultDose > 0, `${s.id}: доза по умолчанию должна быть больше нуля`)
    assert.ok(Object.keys(s.provides).length > 0, `${s.id}: пустой состав — считать нечего`)
  }
})

test('id не повторяются', () => {
  const seen = new Set()
  const dups = []
  for (const s of SUPPLEMENTS) {
    if (seen.has(s.id)) dups.push(s.id)
    seen.add(s.id)
  }
  assert.deepEqual(dups, [])
})

test('в составах нет веществ, которых нет в справочнике', () => {
  // Чужой ключ не падает — он просто никогда не показывается. Молчаливая
  // потеря целого вещества из добавки хуже ошибки.
  const bad = []
  for (const s of SUPPLEMENTS) {
    for (const key in s.provides) {
      if (!MICRO_BY_KEY[key]) bad.push(`${s.id}:${key}`)
      else if (!(s.provides[key] > 0)) bad.push(`${s.id}:${key} = ${s.provides[key]}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('международные единицы пересчитаны в единицы справочника', () => {
  // 1 мкг витамина D = 40 МЕ. Если однажды кто-то впишет сюда «2000», строка
  // в интерфейсе покажет стократное превышение нормы.
  assert.equal(supplementById('vitd-1000').provides.vitD, 25)
  assert.equal(supplementById('vitd-2000').provides.vitD, 50)
  assert.equal(supplementById('vitd-5000').provides.vitD, 125)
  // 400 МЕ витамина E ≈ 268 мг.
  assert.equal(supplementById('vite-400').provides.vitE, 268)
  // 5000 МЕ ретинола ≈ 1500 мкг RAE.
  assert.equal(supplementById('vita').provides.vitA, 1500)
})

// Добавки, которые ДЕЙСТВИТЕЛЬНО продаются в дозах выше верхнего предела.
// Это не ошибки каталога, а факт полки: D3 по 5000 МЕ, ниацин по 500 мг и ZMA
// с 450 мг магния лежат в каждом магазине спортпита. Приложение обязано на них
// ругаться — именно за этим считается UL. Список ведётся явно, чтобы НОВОЕ
// превышение (то есть опечатка в разряде) не проскочило вместе с ними.
const KNOWN_ABOVE_UL = new Set([
  'multi-sport:b3', 'b-complex:b3', 'b3-100:b3', // ниацин: UL 35 мг для добавок
  'vitd-5000:vitD',                              // 5000 МЕ = 125 мкг при UL 100
  'zma:mg',                                      // 450 мг магния при UL 350
])

test('превышения верхнего предела — только те, что и правда бывают на полке', () => {
  const unexpected = []
  for (const s of SUPPLEMENTS) {
    for (const key in s.provides) {
      const def = MICRO_BY_KEY[key]
      if (def?.ul == null) continue
      if (s.provides[key] <= def.ul) continue
      if (KNOWN_ABOVE_UL.has(`${s.id}:${key}`)) continue
      unexpected.push(`${s.id}: ${key} ${s.provides[key]} > ${def.ul}`)
    }
  }
  assert.deepEqual(unexpected, [])
})

test('ни одна доза не промахивается мимо разряда', () => {
  // Отдельный сторож от опечатки в нулях: даже терапевтическая доза не бывает
  // в десять раз выше верхнего предела. «5000» вместо «500» поймается здесь.
  const absurd = []
  for (const s of SUPPLEMENTS) {
    for (const key in s.provides) {
      const def = MICRO_BY_KEY[key]
      if (def?.ul == null) continue
      if (s.provides[key] > def.ul * 10) absurd.push(`${s.id}: ${key} ${s.provides[key]}`)
    }
  }
  assert.deepEqual(absurd, [])
})

test('популярная подборка непуста и состоит из реальных добавок', () => {
  assert.ok(POPULAR_SUPPLEMENTS.length >= 10)
  for (const s of POPULAR_SUPPLEMENTS) assert.equal(SUPP_BY_ID[s.id], s)
})

// ── Поиск ─────────────────────────────────────────────────────────────────────

const firstName = (q) => searchSupplements(q)[0]?.name

test('поиск понимает кириллицу, латиницу и жаргон', () => {
  assert.equal(firstName('ашваганда'), 'Ашваганда (KSM-66)')
  assert.equal(firstName('ashwagandha'), 'Ашваганда (KSM-66)')
  assert.equal(firstName('melatonin'), 'Мелатонин 3 мг')
  assert.equal(firstName('омега'), 'Омега-3 (рыбий жир)')
})

test('среди одинаково подходящих первым идёт то, что берут чаще', () => {
  // «Креатин» — это почти всегда моногидрат, а не HCL, хотя название HCL короче
  // и по чистой релевантности выигрывало.
  assert.equal(firstName('креатин'), 'Креатин моногидрат')
  assert.equal(firstName('магний'), 'Магний цитрат 200 мг')
})

test('пустой запрос отдаёт весь каталог, а не пустоту', () => {
  assert.equal(searchSupplements('').length, SUPPLEMENTS.length)
  assert.equal(searchSupplements('   ').length, SUPPLEMENTS.length)
})

test('поиск не падает на мусоре', () => {
  assert.ok(Array.isArray(searchSupplements('!!!')))
  assert.ok(Array.isArray(searchSupplements(null)))
})

// ── Дозы ──────────────────────────────────────────────────────────────────────

test('состав умножается на дозу', () => {
  assert.deepEqual(scaleProvides({ vitD: 50, vitK: 100 }, 2), { vitD: 100, vitK: 200 })
  assert.deepEqual(scaleProvides({ creatine: 1 }, 5), { creatine: 5 })
})

test('бессмысленная доза не даёт состава', () => {
  assert.deepEqual(scaleProvides({ vitD: 50 }, 0), {})
  assert.deepEqual(scaleProvides({ vitD: 50 }, -1), {})
  assert.deepEqual(scaleProvides({ vitD: 50 }, 'два'), {})
})

test('дробная доза не теряет мелкие значения', () => {
  // Капля витамина D — 12,5 мкг. Округление до целого обнулило бы её.
  assert.deepEqual(scaleProvides({ vitD: 12.5 }, 1), { vitD: 12.5 })
})

test('запись для дневника берёт дозу по умолчанию, если её не задали', () => {
  const e = makeSuppEntry(supplementById('omega3'))
  assert.equal(e.dose, 2, 'у омеги по умолчанию две капсулы')
  assert.equal(e.provides.omega3, 600)
  assert.equal(e.suppId, 'omega3')
})

test('запись без добавки или с нулевой дозой не создаётся', () => {
  assert.equal(makeSuppEntry(null), null)
  assert.equal(makeSuppEntry({ name: '' }), null)
  assert.equal(makeSuppEntry(supplementById('creatine'), 0), null)
})

test('склонение дозы по-русски', () => {
  assert.equal(doseLabel(1, 'капсула'), '1 капсула')
  assert.equal(doseLabel(2, 'капсула'), '2 капсулы')
  assert.equal(doseLabel(5, 'капсула'), '5 капсул')
  assert.equal(doseLabel(11, 'таблетка'), '11 таблеток')
  assert.equal(doseLabel(21, 'таблетка'), '21 таблетка')
  assert.equal(doseLabel(1.5, 'порция'), '1,5 порции')
  assert.equal(doseLabel(5, 'г'), '5 г')
})

// ── Свой препарат ─────────────────────────────────────────────────────────────

test('своя добавка принимается, если в ней есть хоть одно известное вещество', () => {
  const s = makeCustomSupplement({ name: 'Аптечный комплекс', provides: { vitC: 250, zn: 10 } })
  assert.equal(s.name, 'Аптечный комплекс')
  assert.deepEqual(s.provides, { vitC: 250, zn: 10 })
  assert.equal(s.custom ?? true, true)
})

test('своя добавка без имени или без состава не создаётся', () => {
  assert.equal(makeCustomSupplement({ name: '', provides: { vitC: 1 } }), null)
  assert.equal(makeCustomSupplement({ name: 'Пусто', provides: {} }), null)
  assert.equal(makeCustomSupplement({ name: 'Мусор', provides: { чтоугодно: 5 } }), null)
})

test('в своей добавке чужие ключи и отрицательные числа выбрасываются', () => {
  const s = makeCustomSupplement({ name: 'Смесь', provides: { vitC: 100, выдумка: 50, zn: -3 } })
  assert.deepEqual(s.provides, { vitC: 100 })
})

// ── Сумма по добавкам дня ─────────────────────────────────────────────────────

test('добавки дня складываются по веществам', () => {
  const r = sumSuppMicros([
    { provides: { vitD: 50, mg: 200 } },
    { provides: { vitD: 25, vitC: 500 } },
  ])
  assert.equal(r.values.vitD, 75)
  assert.equal(r.values.mg, 200)
  assert.equal(r.values.vitC, 500)
  assert.equal(r.count, 2)
})

test('пустой и битый список добавок не ломает сумму', () => {
  assert.deepEqual(sumSuppMicros([]).values, {})
  assert.deepEqual(sumSuppMicros(null).values, {})
  assert.deepEqual(sumSuppMicros([null, {}, { provides: null }]).values, {})
})

// ── «Что в одной таблетке»: своя дозировка с этикетки ────────────────────────
//
// Дозировки в банках не стандартизованы, и это не мелочь: рыбий жир бывает и
// 300 мг омега-3 на капсулу, и 800. Считать по типовому числу — значит врать
// в два-три раза.

test('уточнения просят только там, где дозировка правда плавает', () => {
  // Название пришпилило дозу — переспрашивать не о чем.
  assert.equal(needsDoseSetup(supplementById('vitd-2000'), {}), false)
  assert.equal(needsDoseSetup(supplementById('vitc-500'), {}), false)
  // Меряется граммами — доза задана самим веществом.
  assert.equal(needsDoseSetup(supplementById('creatine'), {}), false)
  assert.equal(needsDoseSetup(supplementById('beta-alanine'), {}), false)
  assert.equal(needsDoseSetup(supplementById('citrulline'), {}), false)
  // А здесь у каждого производителя своё.
  assert.equal(needsDoseSetup(supplementById('omega3'), {}), true)
  assert.equal(needsDoseSetup(supplementById('vitd-k2'), {}), true)
  assert.equal(needsDoseSetup(supplementById('multi-basic'), {}), true)
  assert.equal(needsDoseSetup(supplementById('probiotic-10'), {}), true)
})

test('второй раз состав уже не спрашивают', () => {
  const saved = { omega3: { provides: { omega3: 750 }, dose: 2 } }
  assert.equal(needsDoseSetup(supplementById('omega3'), saved), false)
  assert.equal(hasOwnDose(supplementById('omega3'), saved), true)
  assert.equal(hasOwnDose(supplementById('vitd-k2'), saved), false)
})

test('рыбий жир спрашивает EPA и DHA раздельно, как на банке', () => {
  const f = doseFields(supplementById('omega3'))
  const ids = f.map((x) => x.id)
  assert.ok(ids.includes('epa') && ids.includes('dha'), 'на этикетке два числа — и полей два')
  assert.ok(f.every((x) => x.unit), 'у каждого поля должна быть единица')
})

test('EPA и DHA складываются в одну норму омега-3', () => {
  // В справочнике это ОДИН показатель (EPA + DHA), и два поля обязаны сложиться,
  // а не перезаписать друг друга.
  const f = doseFields(supplementById('omega3'))
  assert.deepEqual(providesFromFields(f, { epa: '500', dha: '250' }), { omega3: 750 })
  assert.deepEqual(providesFromFields(f, { epa: '500', dha: '250', vitE: '2' }), { omega3: 750, vitE: 2 })
})

test('поля формы у обычной добавки берутся из её состава', () => {
  const f = doseFields(supplementById('vitd-k2'))
  assert.deepEqual(f.map((x) => x.key).sort(), ['vitD', 'vitK'])
  assert.deepEqual(providesFromFields(f, { vitD: '62,5', vitK: '200' }), { vitD: 62.5, vitK: 200 })
})

test('пустые и мусорные поля не попадают в состав', () => {
  // Человек вправе не знать, сколько в его банке витамина E, — выдумывать нельзя.
  const f = doseFields(supplementById('omega3'))
  assert.deepEqual(providesFromFields(f, { epa: '500', dha: '', vitE: 'много' }), { omega3: 500 })
  assert.deepEqual(providesFromFields(f, { epa: '-5', dha: '0' }), {})
  assert.deepEqual(providesFromFields(null, {}), {})
})

test('своя банка сильнее каталожной, но не стирает её', () => {
  const supp = supplementById('omega3')
  const saved = { omega3: { provides: { omega3: 750, vitE: 2 }, dose: 3 } }
  assert.deepEqual(unitProvides(supp, saved), { omega3: 750, vitE: 2 })
  assert.equal(unitDose(supp, saved), 3)
  // Без сохранённого — типовые числа каталога.
  assert.deepEqual(unitProvides(supp, {}), supp.provides)
  assert.equal(unitDose(supp, {}), supp.defaultDose)
})

test('пустой сохранённый состав не подменяет каталожный', () => {
  // Иначе добавка молча перестала бы что-либо приносить.
  const supp = supplementById('omega3')
  assert.deepEqual(unitProvides(supp, { omega3: { provides: {}, dose: 2 } }), supp.provides)
})

test('у каждой добавки с плавающей дозой поля формы непусты', () => {
  const broken = SUPPLEMENTS.filter((s) => s.variable && doseFields(s).length === 0)
  assert.deepEqual(broken.map((s) => s.id), [], 'спрашивать нечего — форма будет пустой')
})

test('явные поля ссылаются только на существующие вещества', () => {
  const bad = []
  for (const s of SUPPLEMENTS) {
    for (const f of s.fields || []) {
      if (!MICRO_BY_KEY[f.key]) bad.push(`${s.id}:${f.key}`)
      if (!f.id || !f.label) bad.push(`${s.id}: поле без id или подписи`)
    }
  }
  assert.deepEqual(bad, [])
})
