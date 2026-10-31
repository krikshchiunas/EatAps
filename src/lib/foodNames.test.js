// Переводы базы продуктов. Новый продукт в foods.js без перевода не падает —
// он молча показывается по-русски посреди немецкого дневника. Сторожат тесты.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANGS, SOURCE_LANG, setLang, dataTable } from './i18n.js'
import { FOODS, CONSTRUCTOR_ING, BASE_GROUPS, BREADS, getPortions, searchLocal, normalizeQuery } from './foods.js'
import { foodName, methodLabel, portionLabel } from './foodNames.js'

const CYR = /[А-Яа-яЁё]/
const OTHERS = LANGS.map((l) => l.code).filter((c) => c !== SOURCE_LANG)

// Всё, что база может показать как название продукта.
function allNames() {
  const out = new Set()
  for (const f of FOODS) out.add(f.name)
  for (const i of CONSTRUCTOR_ING) out.add(i.name)
  for (const g of Object.values(BASE_GROUPS)) for (const it of g.items || []) out.add(it.name)
  for (const b of BREADS) out.add(b[0])
  return [...out].filter((n) => CYR.test(n))
}

function allPortionWords() {
  const out = new Set()
  const word = (l) => out.add(/^\d+(?:[.,]\d+)? (.+)$/.exec(l)?.[1] || l)
  for (const f of FOODS) for (const p of getPortions(f)) word(p.label)
  for (const i of CONSTRUCTOR_ING) word(i.unitName)
  for (const g of Object.values(BASE_GROUPS)) for (const it of g.items || []) if (it.unitName) word(it.unitName)
  return [...out].filter((w) => CYR.test(w))
}

for (const code of OTHERS) {
  test(`${code}: у каждого продукта базы есть перевод`, async () => {
    await setLang(code, { persist: false })
    const untranslated = allNames().filter((n) => CYR.test(foodName(n)))
    assert.deepEqual(untranslated, [], `${code}: покажется по-русски:\n${untranslated.join('\n')}`)
  })

  test(`${code}: способы приготовления и порции переведены`, async () => {
    await setLang(code, { persist: false })
    const methods = FOODS.flatMap((f) => (f.methods || []).map((m) => [f.name, m.label]))
    const badMethods = methods.filter(([base, m]) => CYR.test(methodLabel(m, base)) || CYR.test(foodName(`${base}, ${m.toLowerCase()}`)))
    assert.deepEqual(badMethods, [], badMethods.map((x) => x.join(', ')).join('\n'))
    const badPortions = allPortionWords().filter((w) => CYR.test(portionLabel(w)) || CYR.test(portionLabel(`2 ${w}`)))
    assert.deepEqual(badPortions, [], badPortions.join('\n'))
  })

  test(`${code}: methodsFor ссылается на настоящие пары «продукт|способ»`, async () => {
    await setLang(code, { persist: false })
    const real = new Set(FOODS.flatMap((f) => (f.methods || []).map((m) => `${f.name}|${m.label.toLowerCase()}`)))
    const stale = Object.keys(dataTable('methodsFor') || {}).filter((k) => !real.has(k))
    assert.deepEqual(stale, [], `висячие ключи — форма никогда не применится:\n${stale.join('\n')}`)
  })
}

test('поиск находит продукт по названию на языке интерфейса', async () => {
  const cases = { de: ['hähnchenbrust', 'Hähnchenbrust'], en: ['oat milk', 'Oat milk'], tr: ['karpuz', 'Karpuz'], ar: ['تفاح', 'تفاح'], es: ['sandía', 'Sandía'], pt: ['melancia', 'Melancia'] }
  for (const [code, [query, expected]] of Object.entries(cases)) {
    await setLang(code, { persist: false })
    assert.equal(foodName(searchLocal(query)[0]?.name), expected, `${code}: «${query}»`)
  }
  // Русский запрос при чужом интерфейсе не ломается: исходное название в поиске остаётся.
  await setLang('de', { persist: false })
  assert.equal(searchLocal('гречка')[0]?.name, 'Гречка')
  await setLang(SOURCE_LANG, { persist: false })
})

test('нормализация запроса не теряет турецкие, немецкие и арабские буквы', () => {
  assert.equal(normalizeQuery('Kırmızı Mercimek'), 'kirmizi mercimek')
  assert.equal(normalizeQuery('Süßkartoffel'), 'susskartoffel')
  assert.equal(normalizeQuery('أَرُزّ'), 'ارز', 'огласовки и хамза над алифом уходят')
  assert.equal(normalizeQuery('سلطة ١٢٠'), 'سلطه 120', 'арабские цифры — обычные, «ة» → «ه»')
})

test('у каждой добавки и каждого микронутриента есть перевод', async () => {
  const { SUPPLEMENTS, searchSupplements } = await import('./supplements.js')
  const { MICRONUTRIENTS } = await import('./micronutrients.js')
  const { suppName, suppNote, suppWarn } = await import('./suppNames.js')
  for (const code of OTHERS) {
    await setLang(code, { persist: false })
    const bad = []
    for (const s of SUPPLEMENTS) {
      for (const [field, text] of [['name', suppName(s)], ['note', suppNote(s)], ['warn', suppWarn(s)]]) {
        if (CYR.test(text)) bad.push(`${s.id}.${field}`)
      }
    }
    for (const m of MICRONUTRIENTS) {
      for (const field of ['label', 'short', 'about']) if (CYR.test(m[field] || '')) bad.push(`${m.key}.${field}`)
    }
    assert.deepEqual(bad, [], `${code}: покажется по-русски:\n${bad.join('\n')}`)
  }
  await setLang('de', { persist: false })
  assert.equal(searchSupplements('baldrian')[0]?.id, 'valerian', 'поиск добавки по немецкому названию')
  await setLang(SOURCE_LANG, { persist: false })
})
