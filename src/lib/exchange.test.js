// Выгрузка и загрузка CSV на всех языках.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { setLang, LANGS, SOURCE_LANG } from './i18n.js'
import { buildMealsCsv, buildDaysCsv, parseImportCsv, parseCsvLine, mapColumns, importErrorText, importWarningText } from './exchange.js'
import { loadSearchNames } from './search/index.js'

after(() => setLang(SOURCE_LANG, { persist: false }))
const CYR = /[а-яё]/i
const days = {
  '2026-03-01': {
    meals: [
      { name: 'Овсяные хлопья сухие', grams: 50, unit: 'г', kcal: 183, protein: 6, carbs: 31, fat: 3.5, mealId: 'std:breakfast' },
      { name: 'Бабушкин борщ', grams: 300, unit: 'г', kcal: 150, mealId: 'std:lunch' },
    ],
    wellbeing: ['Энергия'],
  },
}

test('выгрузка на каждом языке читается обратно, продукт базы узнаётся', async () => {
  await loadSearchNames()
  try {
    for (const l of LANGS) {
      await setLang(l.code, { persist: false })
      const csv = buildMealsCsv(days, ['2026-03-01'])
      const header = parseCsvLine(csv.split('\r\n')[0], ',')
      if (l.code !== 'ru') assert.doesNotMatch(csv.replace('Бабушкин борщ', ''), CYR, `${l.code}: ${csv}`)
      const cols = mapColumns(header)
      for (const f of ['date', 'meal', 'name', 'grams', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'sugar', 'satFat']) {
        assert.ok(cols[f] != null, `${l.code}: колонка ${f} не узнана в ${header.join(' | ')}`)
      }
      const back = parseImportCsv(csv)
      assert.equal(back.ok, true, l.code)
      const [oats, borsch] = back.days['2026-03-01'].meals
      assert.equal(oats.foodId, 'food_rolled_oats_dry', l.code)
      assert.equal(oats.name, 'Овсяные хлопья сухие')
      assert.equal(oats.mealId, 'std:breakfast', l.code)
      assert.equal(oats.unit, 'г', l.code)
      assert.equal(borsch.name, 'Бабушкин борщ', 'своё — как записано')
      assert.equal(borsch.foodId, undefined)
      const daysCsv = buildDaysCsv(days, ['2026-03-01'])
      if (l.code !== 'ru') assert.doesNotMatch(daysCsv, CYR, `${l.code}: ${daysCsv}`)
    }
  } finally { await setLang(SOURCE_LANG, { persist: false }) }
})

test('ошибки импорта — кодами, текст на языке интерфейса', async () => {
  assert.deepEqual(parseImportCsv(''), { ok: false, error: 'empty' })
  const missing = parseImportCsv('foo,bar\n1,2')
  assert.equal(missing.error, 'missingColumns')
  assert.deepEqual(missing.missing, ['date', 'food', 'kcal'])
  const skipped = parseImportCsv('Date,Food,kcal\n2026-01-01,Apple,52\n,,\n')
  assert.deepEqual(skipped.warnings, [{ code: 'rowSkipped', row: 3 }], 'строка из одних запятых — пропущена с предупреждением')
  const bad = parseImportCsv('Date,Food,kcal\nxx,,\n2026-01-01,Apple,52')
  assert.deepEqual(bad.warnings[0], { code: 'rowSkipped', row: 2 })
  try {
    for (const l of LANGS) {
      await setLang(l.code, { persist: false })
      for (const text of [importErrorText(missing), importErrorText({ ok: false, error: 'empty' }), importWarningText(bad.warnings[0]), importWarningText({ code: 'tooManyRows', n: 20000 })]) {
        assert.ok(text && !text.includes('exchange.'), `${l.code}: «${text}»`)
        if (l.code !== 'ru') assert.doesNotMatch(text, CYR, `${l.code}: ${text}`)
      }
    }
  } finally { await setLang(SOURCE_LANG, { persist: false }) }
})

test('формулы в ячейках обезврежены, кавычки и разделители переживают круг', () => {
  const csv = buildMealsCsv({ '2026-01-01': { meals: [{ name: '=HYPERLINK("x")', kcal: 1 }, { name: 'a, "b"; c', kcal: 2 }] } }, ['2026-01-01'])
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`))
  const back = parseImportCsv(csv)
  assert.equal(back.days['2026-01-01'].meals[0].name, '=HYPERLINK("x")')
  assert.equal(back.days['2026-01-01'].meals[1].name, 'a, "b"; c')
})
