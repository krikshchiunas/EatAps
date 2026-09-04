// Тесты свода дня: еда + добавки против нормы.
//
// Здесь проверяются те самые сценарии, ради которых всё это писалось:
//   • «моя норма витамина C — 500, пью 300, но сегодня добрал 500 едой —
//      покажи, что я перебираю»;
//   • «съел стейк — креатин из банки сегодня уже лишний»;
//   • «натрий надо не добирать, а не превышать».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMicroSummary, microRow, previewSupplement, STATUS } from './microSummary.js'
import { microDef } from './micronutrients.js'

const M = { sex: 'male', age: 30 }

const row = (summary, key) => summary.byKey[key]

// ── Статусы одной строки ──────────────────────────────────────────────────────

test('статус строки отражает пять разных новостей, а не три', () => {
  const def = microDef('vitC')
  const at = (total, extra = {}) => microRow(def, { food: total, supp: 0, target: 100, ...extra }).status
  assert.equal(at(0), STATUS.NONE)
  assert.equal(at(50), STATUS.LOW)
  assert.equal(at(80), STATUS.OK)
  assert.equal(at(120), STATUS.DONE)
  assert.equal(microRow(def, { food: 0, supp: 2500, target: 100 }).status, STATUS.UL)
})

test('превышение СПРАВОЧНОЙ нормы — ещё не повод кричать', () => {
  // 50 мкг витамина D — обычная капсула и три с половиной нормы, но до
  // верхнего предела там ещё вдвое. Называть это перебором значит приучить
  // человека не смотреть на предупреждения вовсе.
  const d = microRow(microDef('vitD'), { food: 0, supp: 50, target: 15 })
  assert.equal(d.status, STATUS.DONE)
  // А вот когда до предела осталась треть — это уже разговор.
  assert.equal(microRow(microDef('vitD'), { food: 0, supp: 80, target: 15 }).status, STATUS.OVER)
})

test('превышение СВОЕЙ цели — новость всегда', () => {
  // Человек назвал своё число; выходить за него он не собирался.
  const r = microRow(microDef('vitC'), { food: 500, supp: 300, target: 500, personal: true })
  assert.equal(r.total, 800)
  assert.equal(r.remaining, -300, 'минус триста — это «уже на 300 больше нормы»')
  assert.equal(r.status, STATUS.OVER)
  // То же количество без личной цели перебором не считается: 800 мг витамина C
  // при пределе 2000 — просто много и совершенно безопасно.
  assert.equal(microRow(microDef('vitC'), { food: 500, supp: 300, target: 90 }).status, STATUS.DONE)
})

test('еда и добавки видны по отдельности, а не одной кучей', () => {
  const r = microRow(microDef('vitC'), { food: 200, supp: 300, target: 500 })
  assert.equal(r.fromFood, 200)
  assert.equal(r.fromSupp, 300)
  assert.equal(r.total, 500)
  assert.equal(r.status, STATUS.DONE)
})

test('вещество, которого не бывает в еде, не получает вклада еды', () => {
  // Даже если в расчёт по ошибке просочится значение — ашваганда из продуктов
  // не приходит, и рисовать ей «из еды 200 мг» нельзя.
  const r = microRow(microDef('ashwagandha'), { food: 200, supp: 600, target: null })
  assert.equal(r.fromFood, 0)
  assert.equal(r.total, 600)
})

// ── Верхний предел ────────────────────────────────────────────────────────────

test('предел «только для добавок» не считает еду', () => {
  // Магнием из гречки и орехов UL 350 не превысить — это предел для таблеток.
  const fromFood = microRow(microDef('mg'), { food: 900, supp: 0, target: 400 })
  assert.equal(fromFood.overUl, false)
  assert.equal(fromFood.status, STATUS.OVER)

  const fromPills = microRow(microDef('mg'), { food: 0, supp: 400, target: 400 })
  assert.equal(fromPills.overUl, true)
  assert.equal(fromPills.status, STATUS.UL)
})

test('обычный предел считает всё вместе', () => {
  // Витамин A копится независимо от того, из печени он или из капсулы.
  const r = microRow(microDef('vitA'), { food: 2000, supp: 1500, target: 900 })
  assert.equal(r.overUl, true)
  assert.equal(r.status, STATUS.UL)
})

// ── Направление: не всё надо добирать ─────────────────────────────────────────

test('натрий и кофеин не предлагают «добрать»', () => {
  const na = microRow(microDef('na'), { food: 800, supp: 0, target: 2000 })
  assert.equal(na.status, STATUS.OK, 'мало натрия — это не новость и не задача')
  const over = microRow(microDef('na'), { food: 3500, supp: 0, target: 2000 })
  assert.equal(over.status, STATUS.LIMIT)

  const coffee = microRow(microDef('caffeine'), { food: 500, supp: 0, target: 400 })
  assert.equal(coffee.status, STATUS.LIMIT)
})

test('у «не превышать» нет второго порога поверх ориентира', () => {
  // Иначе обычный солёный день получал бы красное «выше допустимого уровня».
  assert.equal(microDef('na').ul, null)
  assert.equal(microDef('caffeine').ul, null)
})

// ── Сценарии человека ─────────────────────────────────────────────────────────

test('витамин C: личная норма 500, добавка 300, еда закрыла всё сама', () => {
  const summary = buildMicroSummary({
    meals: [
      { name: 'Перец болгарский', grams: 200, unit: 'г' }, // ≈256 мг
      { name: 'Апельсин', grams: 300, unit: 'г' },         // ≈159 мг
      { name: 'Киви', grams: 100, unit: 'г' },             // ≈93 мг
    ],
    supps: [{ name: 'Витамин C 500 мг', provides: { vitC: 300 } }],
    profile: M,
    goals: { vitC: 500 },
  })
  const c = row(summary, 'vitC')
  assert.equal(c.target, 500, 'личная норма сильнее справочных 90 мг')
  assert.ok(c.fromFood > 450, `еды должно быть больше 450 мг, а вышло ${c.fromFood}`)
  assert.equal(c.fromSupp, 300)
  assert.equal(c.status, STATUS.OVER, 'человек должен увидеть перебор')

  // И отдельная подсказка: сегодня добавка была лишней.
  const hint = summary.alerts.find((a) => a.key === 'vitC' && a.level === 'low')
  assert.ok(hint, 'не сказано, что норму закрыла еда')
  assert.match(hint.text, /еда/)
})

test('креатин: съел мясо — банка сегодня уже не нужна', () => {
  const summary = buildMicroSummary({
    meals: [{ name: 'Говядина', grams: 400, unit: 'г' }], // ≈1.6 г креатина
    supps: [],
    profile: M,
    stackKeys: ['creatine'],
  })
  const c = row(summary, 'creatine')
  assert.ok(c.fromFood > 1.4, `400 г говядины — это больше 1,4 г креатина, а вышло ${c.fromFood}`)
  assert.equal(c.target, 3)
  assert.ok(c.remaining > 0 && c.remaining < 1.7, 'осталось добрать меньше половины дозы')
  assert.equal(c.shown, true, 'строка обязана быть видна тому, кто пьёт креатин')
})

test('креатин не показывается тому, кто его не пьёт и не получал', () => {
  const summary = buildMicroSummary({ meals: [{ name: 'Яблоко', grams: 150, unit: 'г' }], profile: M })
  assert.equal(row(summary, 'creatine').shown, false)
  assert.equal(row(summary, 'ashwagandha').shown, false)
  // А витамины видны всегда: их отсутствие само по себе новость.
  assert.equal(row(summary, 'vitC').shown, true)
  assert.equal(row(summary, 'b12').shown, true)
})

test('необязательное вещество появляется, как только оно принято', () => {
  const summary = buildMicroSummary({
    supps: [{ name: 'Ашваганда', provides: { ashwagandha: 600 } }],
    profile: M,
  })
  assert.equal(row(summary, 'ashwagandha').shown, true)
  assert.equal(row(summary, 'ashwagandha').total, 600)
})

test('личная цель тоже выводит строку на экран', () => {
  const summary = buildMicroSummary({ profile: M, goals: { coq10: 100 } })
  assert.equal(row(summary, 'coq10').shown, true)
})

// ── Группы и честность итога ──────────────────────────────────────────────────

test('в счёт «закрыто N из M» не попадает то, что надо не добирать', () => {
  const summary = buildMicroSummary({
    meals: [{ name: 'Соль', grams: 10, unit: 'г' }],
    profile: M,
  })
  const minerals = summary.groups.find((g) => g.key === 'mineral')
  const na = row(summary, 'na')
  assert.equal(na.status, STATUS.LIMIT)
  // Натрий за ориентиром — но в «закрыто» он не идёт ни как успех, ни как цель.
  assert.ok(minerals.total < minerals.rows.length)
})

test('нераспознанная еда честно уменьшает достоверность', () => {
  const summary = buildMicroSummary({
    meals: [
      { name: 'Шпинат', grams: 100, unit: 'г' },
      { name: 'Zxqwerty', grams: 200, unit: 'г' },
      { name: 'Qwerty2', grams: 200, unit: 'г' },
    ],
    profile: M,
  })
  assert.equal(summary.coverage.total, 3)
  assert.equal(summary.coverage.covered, 1)
  assert.ok(summary.coverage.ratio < 0.4)
})

test('пустой день не падает и ничего не выдумывает', () => {
  const summary = buildMicroSummary({})
  assert.equal(summary.coverage.total, 0)
  assert.equal(summary.coverage.ratio, 1)
  assert.equal(summary.alerts.length, 0)
  assert.ok(summary.groups.length > 0, 'витамины и минералы показываются и в пустой день')
  for (const r of summary.shown) assert.equal(r.total, 0)
})

test('битые записи не ломают свод', () => {
  const summary = buildMicroSummary({
    meals: [null, {}, { name: 'Шпинат', grams: 100, unit: 'г' }],
    supps: [null, { provides: null }, { provides: { vitD: 50 } }],
    profile: M,
  })
  assert.equal(row(summary, 'vitD').fromSupp, 50)
  assert.ok(row(summary, 'vitK').fromFood > 400)
})

// ── Предупреждения ────────────────────────────────────────────────────────────

test('превышение предела попадает в предупреждения с понятным текстом', () => {
  const summary = buildMicroSummary({
    supps: [{ name: 'Магний', provides: { mg: 600 } }],
    profile: M,
  })
  const a = summary.alerts.find((x) => x.key === 'mg')
  assert.ok(a)
  assert.equal(a.level, 'high')
  assert.match(a.text, /добавок/, 'для предела «только таблетки» текст должен это объяснять')
  // Единица обязана стоять у обоих чисел, иначе «600 при пределе 350 мг»
  // читается так, будто у первого числа единица другая.
  assert.match(a.text, /600 мг.*350 мг/, `единицы потерялись: ${a.text}`)
})

// ── Прикидка перед приёмом ────────────────────────────────────────────────────

test('прикидка говорит, что доза добьёт, что закроет, а что уведёт за предел', () => {
  const summary = buildMicroSummary({
    meals: [{ name: 'Перец болгарский', grams: 200, unit: 'г' }],
    profile: M,
    goals: { vitC: 500 },
  })
  const preview = previewSupplement(summary, { vitC: 500, vitD: 50 })
  const c = preview.find((p) => p.key === 'vitC')
  const d = preview.find((p) => p.key === 'vitD')
  assert.equal(c.verdict, 'excess', '256 + 500 при цели 500 — это заметный перебор')
  assert.ok(c.before > 250 && c.after > 750)
  assert.equal(d.verdict, 'completes', '50 мкг при норме 15 закрывают её')
})

test('прикидка предупреждает о выходе за верхний предел', () => {
  const summary = buildMicroSummary({ profile: M })
  const preview = previewSupplement(summary, { vitD: 250 })
  assert.equal(preview[0].verdict, 'ul')
})

test('прикидка молчит про то, чего в добавке нет', () => {
  const summary = buildMicroSummary({ profile: M })
  const preview = previewSupplement(summary, { vitC: 0, выдумка: 100 })
  assert.deepEqual(preview, [])
})
