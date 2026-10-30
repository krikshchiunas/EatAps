// Переводы ломаются тихо: забытый ключ показывает русскую строку посреди
// немецкого экрана, опечатка в ключе — «settings.titel» вместо текста, а
// потерянный {n} — фразу без числа. Сборка ничего из этого не видит, поэтому
// сторожат тесты.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import {
  t, setLang, getLang, LANGS, SOURCE_LANG, flatten, isPluralLeaf, browserLang, tData, locale,
} from './i18n.js'
import * as ru from '../locales/ru.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const RU = flatten(ru.strings)
const OTHERS = LANGS.map((l) => l.code).filter((c) => c !== SOURCE_LANG)

const placeholders = (v) => {
  const forms = isPluralLeaf(v) ? Object.values(v) : [v]
  const set = new Set()
  for (const f of forms) for (const m of String(f).matchAll(/\{(\w+)\}/g)) set.add(m[1])
  return [...set].sort()
}

async function pack(code) {
  return import(`../locales/${code}.js`)
}

for (const code of OTHERS) {
  test(`${code}: те же ключи, что в русском`, async () => {
    const own = flatten((await pack(code)).strings)
    const missing = [...RU.keys()].filter((k) => !own.has(k))
    const extra = [...own.keys()].filter((k) => !RU.has(k))
    assert.deepEqual(missing, [], `${code}: нет перевода — покажется по-русски:\n${missing.join('\n')}`)
    assert.deepEqual(extra, [], `${code}: ключей нет в ru.js — их никто не прочитает:\n${extra.join('\n')}`)
  })

  test(`${code}: плейсхолдеры и формы совпадают с русскими`, async () => {
    const own = flatten((await pack(code)).strings)
    const problems = []
    for (const [k, src] of RU) {
      const v = own.get(k)
      if (v == null) continue
      if (Array.isArray(src) !== Array.isArray(v)) { problems.push(`${k}: список ↔ строка`); continue }
      if (Array.isArray(src)) {
        if (src.length !== v.length) problems.push(`${k}: в списке ${v.length} вместо ${src.length}`)
        continue
      }
      // Русская строка не может стать формами числа: t() не передаст count.
      if (!isPluralLeaf(src) && isPluralLeaf(v)) problems.push(`${k}: формы числа там, где их нет в русском`)
      if (isPluralLeaf(v) && !('other' in v)) problems.push(`${k}: нет формы other`)
      if (!isPluralLeaf(v) && typeof v !== 'string') problems.push(`${k}: не строка`)
      if (placeholders(src).join() !== placeholders(v).join()) {
        problems.push(`${k}: {${placeholders(v).join(', ')}} вместо {${placeholders(src).join(', ')}}`)
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'))
  })

  test(`${code}: перевод не совпадает с русским дословно`, async () => {
    // Скопированная, но не переведённая строка проходит проверку ключей.
    // Ловим кириллицу там, где её быть не должно.
    const own = flatten((await pack(code)).strings)
    const cyr = []
    for (const [k, v] of own) {
      const forms = isPluralLeaf(v) ? Object.values(v) : Array.isArray(v) ? v : [v]
      if (forms.some((f) => /[А-Яа-яЁё]/.test(String(f)))) cyr.push(k)
    }
    assert.deepEqual(cyr, [], `${code}: кириллица в переводе:\n${cyr.join('\n')}`)
  })
}

// Ключи, которые код реально запрашивает. Литерал вида 'раздел.ключ', где
// раздел есть в русском словаре, — это ключ перевода: и прямой t('…'), и ключ,
// лежащий в таблице (как в authErrors.js), и подставленный позже.
function sourceFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'locales') sourceFiles(p, out) }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p)
  }
  return out
}

test('каждый ключ, который запрашивает код, есть в русском словаре', () => {
  const namespaces = new Set(Object.keys(ru.strings))
  const missing = []
  for (const f of sourceFiles()) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/['"`]([a-z][a-zA-Z0-9]*)\.([a-zA-Z0-9.]+)['"`]/g)) {
      if (!namespaces.has(m[1])) continue
      const key = `${m[1]}.${m[2]}`
      // Раздел целиком (например, t(`stats.tone.${k}`) собирается из кусков)
      // проверяется в месте использования, а здесь — только полные ключи.
      if (!RU.has(key) && ![...RU.keys()].some((k) => k.startsWith(`${key}.`))) {
        missing.push(`${relative(SRC, f)}: ${key}`)
      }
    }
  }
  assert.deepEqual(missing, [], `нет в словаре — на экране будет сам ключ:\n${missing.join('\n')}`)
})

test('t: подстановка, формы числа, подстраховка русским', async () => {
  assert.equal(getLang(), 'ru')
  assert.equal(t('units.kcalN', { n: 120 }), '120 ккал')
  assert.equal(t('count.products', { count: 1 }), '1 продукт')
  assert.equal(t('count.products', { count: 3 }), '3 продукта')
  assert.equal(t('count.products', { count: 11 }), '11 продуктов')
  assert.equal(t('count.products', { count: 21 }), '21 продукт')
  assert.equal(t('нет.такого'), 'нет.такого')
  // Неизвестный плейсхолдер остаётся видимым, а не пропадает.
  assert.equal(t('units.kcalN'), '{n} ккал')

  assert.equal(await setLang('en', { persist: false }), true)
  try {
    assert.equal(t('count.products', { count: 1 }), '1 item')
    assert.equal(t('count.products', { count: 2 }), '2 items')
    assert.equal(locale(), 'en-GB')
  } finally {
    await setLang('ru', { persist: false })
  }

  assert.equal(await setLang('ar', { persist: false }), true)
  try {
    assert.equal(t('count.days', { count: 2 }), 'يومان')
    assert.equal(t('count.days', { count: 5 }), '5 أيام')
  } finally {
    await setLang('ru', { persist: false })
  }
})

test('у каждого языка загружается пакет', async () => {
  for (const code of OTHERS) {
    assert.equal(await setLang(code, { persist: false }), true, code)
  }
  await setLang('ru', { persist: false })
  assert.equal(getLang(), 'ru')
})

test('язык браузера: первый поддерживаемый, регион не важен', () => {
  assert.equal(browserLang(['de-AT', 'en']), 'de')
  assert.equal(browserLang(['fr-FR', 'pt-BR']), 'pt')
  assert.equal(browserLang(['fr', 'it']), null)
  assert.equal(browserLang(['AR-eg']), 'ar')
})

test('данные без перевода показываются как есть', () => {
  assert.equal(tData('foods', 'Гречка сухая'), 'Гречка сухая')
  assert.equal(tData('foods', null), null)
})
