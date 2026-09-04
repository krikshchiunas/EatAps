// Тесты справочника микронутриентов: нормы, верхние пределы, единицы.
//
// Ошибка в этом файле не падает и не видна в интерфейсе — она просто тихо
// показывает человеку неверную норму, а он по ней принимает решения о том, что
// глотать. Поэтому проверяем не только функции, но и целостность самой таблицы.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MICRONUTRIENTS, MICRO_BY_KEY, MICRO_GROUPS, microDef,
  rdaFor, microTargets, sanitizeMicroGoal, formatMicro,
} from './micronutrients.js'

const M = { sex: 'male', age: 30 }
const F = { sex: 'female', age: 30 }

// ── Целостность таблицы ───────────────────────────────────────────────────────

test('у каждого микронутриента есть всё, чем его рисуют', () => {
  const groups = new Set(MICRO_GROUPS.map((g) => g.key))
  for (const d of MICRONUTRIENTS) {
    assert.ok(d.key, 'нет ключа')
    assert.ok(d.label, `${d.key}: нет названия`)
    assert.ok(d.short, `${d.key}: нет короткого имени`)
    assert.ok(d.unit, `${d.key}: нет единицы`)
    assert.ok(groups.has(d.group), `${d.key}: группа «${d.group}» не объявлена в MICRO_GROUPS`)
    assert.ok(['target', 'limit'].includes(d.kind), `${d.key}: странный kind`)
    assert.ok(['all', 'supp'].includes(d.ulScope), `${d.key}: странный ulScope`)
  }
})

test('ключи не повторяются', () => {
  const seen = new Set()
  const dups = []
  for (const d of MICRONUTRIENTS) {
    if (seen.has(d.key)) dups.push(d.key)
    seen.add(d.key)
  }
  assert.deepEqual(dups, [])
})

test('единицы берутся из закрытого списка', () => {
  // Свободный текст в единице означал бы, что где-то сложатся миллиграммы с
  // микрограммами и никто этого не заметит.
  const allowed = new Set(['мг', 'мкг', 'г', 'млрд КОЕ'])
  for (const d of MICRONUTRIENTS) {
    assert.ok(allowed.has(d.unit), `${d.key}: единица «${d.unit}» не из списка`)
  }
})

test('верхний предел не бывает ниже нормы', () => {
  // Такой предел означал бы «норму закрыть нельзя, не превысив предел» —
  // человек получил бы красное предупреждение за то, что просто поел.
  for (const d of MICRONUTRIENTS) {
    if (d.ul == null || !d.rda) continue
    if (d.ulScope === 'supp') continue // предел про таблетки, норму закрывает еда
    for (const sex of ['male', 'female']) {
      const rda = d.rda[sex]
      if (rda == null) continue
      assert.ok(d.ul >= rda, `${d.key}: предел ${d.ul} ниже нормы ${rda} (${sex})`)
    }
  }
})

test('«не превышать» стоит только там, где это правда', () => {
  const limits = MICRONUTRIENTS.filter((d) => d.kind === 'limit').map((d) => d.key)
  assert.deepEqual(limits.sort(), ['caffeine', 'na'])
})

test('вещества, которых не бывает в еде, помечены и необязательны', () => {
  for (const d of MICRONUTRIENTS) {
    if (d.fromFood) continue
    assert.ok(d.optional, `${d.key}: в еде его нет, но строка показывается всем`)
  }
})

// ── Нормы под человека ────────────────────────────────────────────────────────

test('норма железа различает пол', () => {
  assert.equal(rdaFor(microDef('fe'), M), 8)
  assert.equal(rdaFor(microDef('fe'), F), 18)
})

test('возрастные уточнения применяются с самого старшего подходящего порога', () => {
  // Железо женщине после 50 — 8 мг, до 50 — 18.
  assert.equal(rdaFor(microDef('fe'), { sex: 'female', age: 49 }), 18)
  assert.equal(rdaFor(microDef('fe'), { sex: 'female', age: 55 }), 8)
  // Кальций: в 51 поднимается женщинам, в 71 — обоим.
  assert.equal(rdaFor(microDef('ca'), { sex: 'male', age: 60 }), 1000)
  assert.equal(rdaFor(microDef('ca'), { sex: 'male', age: 75 }), 1200)
  assert.equal(rdaFor(microDef('ca'), { sex: 'female', age: 60 }), 1200)
})

test('без профиля берутся мужские нормы — занижать опаснее, чем завысить', () => {
  assert.equal(rdaFor(microDef('vitC'), null), 90)
  assert.equal(rdaFor(microDef('mg'), undefined), 400)
})

test('личная цель сильнее справочной нормы', () => {
  const t = microTargets(M, { vitC: 500 })
  assert.equal(t.vitC, 500)
  assert.equal(t.fe, 8, 'остальные нормы не должны поехать')
})

test('пустая и мусорная личная цель не сохраняется', () => {
  assert.equal(sanitizeMicroGoal('vitC', ''), null)
  assert.equal(sanitizeMicroGoal('vitC', null), null)
  assert.equal(sanitizeMicroGoal('vitC', '0'), null)
  assert.equal(sanitizeMicroGoal('vitC', '-5'), null)
  assert.equal(sanitizeMicroGoal('vitC', 'много'), null)
  assert.equal(sanitizeMicroGoal('нетакого', '100'), null)
})

test('личная цель принимает запятую и режет опечатку в разряде', () => {
  assert.equal(sanitizeMicroGoal('vitD', '12,5'), 12.5)
  // Потолок — десять верхних пределов: 2000 мг витамина C можно, 200 000 — это
  // промах по нулям, а не решение.
  assert.equal(sanitizeMicroGoal('vitC', '2000'), 2000)
  assert.equal(sanitizeMicroGoal('vitC', '200000'), null)
})

test('микронутриент без нормы не попадает в цели', () => {
  const t = microTargets(M)
  assert.equal(t.ashwagandha, undefined)
  assert.equal(t.bor, undefined)
})

// ── Форматирование ────────────────────────────────────────────────────────────

test('числа печатаются по-русски и без мусорных нулей', () => {
  assert.equal(formatMicro(0.9, 'мг'), '0,9 мг')
  assert.equal(formatMicro(2.4, 'мкг'), '2,4 мкг')
  assert.equal(formatMicro(100, 'мг'), '100 мг')
  assert.equal(formatMicro(1000, 'мг'), '1000 мг')
  assert.equal(formatMicro(0.5, 'г'), '0,5 г')
  assert.equal(formatMicro(2, 'мкг'), '2 мкг')
  assert.equal(formatMicro(15.0, 'мг'), '15 мг')
})

test('неизвестное число — прочерк, а не ноль', () => {
  assert.equal(formatMicro(null, 'мг'), '—')
  assert.equal(formatMicro(undefined, 'мг'), '—')
  assert.equal(formatMicro(NaN, 'мг'), '—')
})

test('MICRO_BY_KEY согласован со списком', () => {
  assert.equal(Object.keys(MICRO_BY_KEY).length, MICRONUTRIENTS.length)
  assert.equal(MICRO_BY_KEY.vitC.label, 'Витамин C')
  assert.equal(microDef('нетакого'), null)
})
