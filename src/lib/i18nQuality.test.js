// Качество переводов сверх «ключи совпадают»: множественное число на реальных
// числах, плейсхолдеры в каждой форме, кривые фигурные скобки, пустые строки,
// забытые непереведённые копии, единая терминология, полнота словарей данных.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flatten, isPluralLeaf, LANGS, SOURCE_LANG, setLang, t } from './i18n.js'
import { catalogIds, canonicalName, TABLES } from './catalog.js'
import { SUPPLEMENTS } from './supplements.js'
import { MICRONUTRIENTS } from './micronutrients.js'
import GLOSSARY from '../locales/glossary.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')
const CODES = LANGS.map((l) => l.code)
const pack = async (code) => import(`../locales/${code}.js`)
const strings = async (code) => flatten((await pack(code)).strings)
const forms = (v) => (isPluralLeaf(v) ? Object.entries(v) : Array.isArray(v) ? v.map((x, i) => [i, x]) : [['', v]])
const names = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const CYR = /[Ѐ-ӿ]/

// Числа, на которых ломается множественное число: 0, 1, 2, 3–4, 5, 11–14,
// 21–22, 100–111, тысячи. Для каждого числа категория Intl.PluralRules должна
// существовать в словаре явно — «other» не подменяет «few» у русского и «two»
// у арабского.
const NUMBERS = [0, 1, 2, 3, 4, 5, 10, 11, 12, 14, 19, 20, 21, 22, 25, 100, 101, 102, 103, 111, 1000]

for (const l of LANGS) {
  test(`${l.code}: формы множественного числа есть для реальных чисел`, async () => {
    const rules = new Intl.PluralRules(l.intlLocale)
    const own = await strings(l.code)
    const missing = []
    for (const [k, v] of own) {
      if (!isPluralLeaf(v)) continue
      for (const n of NUMBERS) {
        const cat = rules.select(n)
        if (!(cat in v)) missing.push(`${k}: нет «${cat}» (n=${n})`)
      }
    }
    assert.deepEqual([...new Set(missing)], [], [...new Set(missing)].join('\n'))
  })

  test(`${l.code}: плейсхолдеры в каждой форме, скобки, пустые строки`, async () => {
    const own = await strings(l.code)
    const ru = await strings(SOURCE_LANG)
    const problems = []
    for (const [k, v] of own) {
      const src = ru.get(k)
      const srcNames = new Set(forms(src).flatMap(([, f]) => names(f)))
      for (const [form, f] of forms(v)) {
        const s = String(f)
        if (!s.trim()) problems.push(`${k}${form !== '' ? `[${form}]` : ''}: пустая строка`)
        // Каждая «{» — начало {имени}: «{ n }», «{n», «n}» — опечатка.
        const stripped = s.replace(/\{\w+\}/g, '')
        if (/[{}]/.test(stripped)) problems.push(`${k}: кривые фигурные скобки в «${s}»`)
        const used = names(s)
        for (const n of used) if (!srcNames.has(n)) problems.push(`${k}: лишний плейсхолдер {${n}}`)
        // Плейсхолдер, кроме числа, обязан быть в каждой форме. Число ({count},
        // {n}) может растворяться в слове там, где язык так говорит: арабское
        // «يومان» — «два дня» без цифры.
        if (isPluralLeaf(v)) {
          for (const n of srcNames) {
            if (n === 'count' || n === 'n') continue
            if (!used.includes(n)) problems.push(`${k}[${form}]: потерян {${n}}`)
          }
        }
      }
      // Форма «other» — общая: в ней число обязано быть.
      if (isPluralLeaf(v) && isPluralLeaf(src)) {
        const numName = [...srcNames].find((n) => n === 'count' || n === 'n')
        if (numName && !names(v.other).includes(numName)) problems.push(`${k}[other]: нет {${numName}}`)
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'))
  })
}

// ── Непереведённые копии и терминология ─────────────────────────────────────
// Строка, дословно равная английской, — перевод забыт. Кроме случаев, когда
// она состоит только из слов-заимствований глоссария, единиц, чисел и
// плейсхолдеров («Snack», «{n} kcal», «Popular»).
const UNIT_WORDS = new Set(['kcal', 'Kcal', 'ml', 'kg', 'cm', 'mg', 'mcg', 'g', 'µg', 'BMI'])
for (const code of CODES.filter((c) => c !== 'en' && c !== SOURCE_LANG)) {
  test(`${code}: строки, совпавшие с английскими, — только заимствования глоссария`, async () => {
    const en = await strings('en')
    const own = await strings(code)
    const allowed = new Set([...(GLOSSARY[code].loanwords || []), ...UNIT_WORDS])
    const bad = []
    for (const [k, v] of own) {
      if (typeof v !== 'string' || v !== en.get(k)) continue
      const words = v.replace(/\{\w+\}/g, ' ').match(/\p{L}[\p{L}’'-]*/gu) || []
      // Однобуквенное — сокращение (Б/Ж/У → P/F/C, «d» для дней), не слово.
      const unknown = words.filter((w) => w.length > 1 && !allowed.has(w))
      if (unknown.length) bad.push(`${k} = «${v}» (${unknown.join(', ')})`)
    }
    assert.deepEqual(bad, [], `похоже на непереведённое:\n${bad.join('\n')}`)
  })
}

for (const code of CODES) {
  test(`${code}: глоссарий совпадает со словарями и соблюдается`, () => {
    const g = GLOSSARY[code]
    assert.ok(g, `нет глоссария для ${code}`)
    const dir = join(DIR, code)
    const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'boot.js')
    const ui = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    for (const [concept, term] of Object.entries(g.terms)) {
      assert.ok(ui.includes(term), `${code}: термин «${term}» (${concept}) нигде не используется — глоссарий устарел`)
    }
    for (const re of g.avoid) assert.doesNotMatch(ui, re, `${code}: запрещённый вариант термина ${re}`)
  })
}

test('у глоссария те же понятия во всех языках', () => {
  const concepts = Object.keys(GLOSSARY[SOURCE_LANG].terms).sort().join()
  for (const code of CODES) assert.equal(Object.keys(GLOSSARY[code].terms).sort().join(), concepts, code)
})

// ── Словари данных по id ─────────────────────────────────────────────────────
// Перевод обязателен для каждой сущности каталога, кроме названий без
// кириллицы в исходнике: бренды («Coca-Cola», «Big Mac») одинаковы везде.
for (const code of CODES.filter((c) => c !== SOURCE_LANG)) {
  test(`${code}: у каждой сущности каталога есть перевод, лишних id нет`, async () => {
    const data = (await pack(code)).data
    const problems = []
    for (const table of TABLES) {
      const ids = new Set(catalogIds(table))
      const own = data[table] || {}
      for (const id of ids) {
        const v = own[id]
        if (v == null && CYR.test(canonicalName(table, id))) problems.push(`${table}.${id}: нет перевода`)
        if (v != null && (!String(v).trim() || CYR.test(v))) problems.push(`${table}.${id}: «${v}»`)
      }
      for (const id of Object.keys(own)) if (!ids.has(id)) problems.push(`${table}.${id}: id нет в каталоге`)
    }
    for (const key of Object.keys(data.methodsInline || {})) if (!catalogIds('methods').includes(key)) problems.push(`methodsInline.${key}`)
    for (const key of Object.keys(data.methodsFor || {})) {
      const [f, m] = key.split('|')
      if (!catalogIds('foods').includes(f) || !catalogIds('methods').includes(m)) problems.push(`methodsFor.${key}`)
    }
    for (const s of SUPPLEMENTS) if (!data.supps?.[s.id]?.name) problems.push(`supps.${s.id}: нет названия`)
    for (const m of MICRONUTRIENTS) if (!data.micros?.[m.key]?.label) problems.push(`micros.${m.key}: нет подписи`)
    assert.deepEqual(problems, [], problems.join('\n'))
  })
}

test('id каталога: формат, уникальность, отсутствие прототипных имён', () => {
  for (const table of TABLES) {
    const ids = catalogIds(table)
    assert.equal(new Set(ids).size, ids.length, table)
    for (const id of ids) assert.match(id, /^(food|method|portion|alcohol)_[a-z0-9_]+$/, id)
    assert.ok(!ids.includes('__proto__') && !ids.includes('constructor'))
  }
})

// ── Форматы ─────────────────────────────────────────────────────────────────
test('числа и даты форматируются по локали языка', async () => {
  const expect = { ru: '1 234,5', en: '1,234.5', de: '1.234,5', es: '1234,5', pt: '1.234,5', tr: '1.234,5', ar: '1,234.5' }
  try {
    for (const l of LANGS) {
      await setLang(l.code, { persist: false })
      const { fmtNum, fmtDate } = await import('./i18n.js')
      assert.equal(fmtNum(1234.5).replace(/ | /g, ' '), expect[l.code], l.code)
      assert.equal(fmtNum(null), '')
      assert.equal(fmtNum('abc'), '')
      // Арабский — латинские цифры, а не ١٢٣.
      assert.doesNotMatch(fmtDate(new Date(2026, 0, 15)), /[٠-٩]/, l.code)
      assert.ok(t('units.kcalN', { n: 5 }).includes('5'), l.code)
    }
  } finally {
    await setLang(SOURCE_LANG, { persist: false })
  }
})
