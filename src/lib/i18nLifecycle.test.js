// Жизненный цикл языка: первый запуск, ручной выбор, перезапуск, смена языка
// устройства, испорченное хранилище, гонки загрузки, ранний lang/dir.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LANGUAGES, SOURCE_LANG, FALLBACK_LANG, LANG_KEY,
  matchLanguage, readStoredLanguage, detectLanguage, hasLegacyInstall, deviceLanguages,
} from '../locales/registry.js'
import { initI18n, setLang, getLang, detectLang, LANGS, __setLoaderForTests, __resetForTests } from './i18n.js'
import { buildBootData, bootScript } from '../../scripts/vite-plugin-i18n-boot.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── Окружение браузера ───────────────────────────────────────────────────────
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  }
}
function fakeDocument() {
  const attrs = {}
  return { documentElement: { setAttribute: (k, v) => { attrs[k] = v }, attrs } }
}
function device(languages, stored) {
  globalThis.localStorage = memoryStorage(stored)
  Object.defineProperty(globalThis, 'navigator', { value: { languages, language: languages[0] }, configurable: true, writable: true })
  globalThis.document = fakeDocument()
}

beforeEach(() => __resetForTests())
afterEach(() => {
  delete globalThis.localStorage
  delete globalThis.document
  __resetForTests()
})

// ── Сопоставление тегов ──────────────────────────────────────────────────────
test('теги устройства сопоставляются точно и по основе', () => {
  const cases = {
    'de-DE': 'de', 'de-AT': 'de', 'de-CH': 'de', 'en-US': 'en', 'en-GB': 'en', 'es-ES': 'es', 'es-MX': 'es',
    'pt-BR': 'pt', 'pt-PT': 'pt', 'tr-TR': 'tr', 'ar-SA': 'ar', 'ar-EG': 'ar', 'ru-RU': 'ru',
    de: 'de', AR_eg: 'ar', ' EN-us ': 'en',
  }
  for (const [tag, code] of Object.entries(cases)) assert.equal(matchLanguage(tag, LANGUAGES), code, tag)
  for (const tag of ['fr-FR', 'it', 'pl-PL', 'uk-UA', 'zh-Hans-CN', '', null, undefined, '*']) {
    assert.equal(matchLanguage(tag, LANGUAGES), '', String(tag))
  }
})

test('точный тег сильнее совпадения по основе (место для pt-PT)', () => {
  const langs = [...LANGUAGES, { code: 'pt-PT', matches: ['pt-PT', 'pt-AO'], dir: 'ltr', enabled: true }]
  assert.equal(matchLanguage('pt-PT', langs), 'pt-PT')
  assert.equal(matchLanguage('pt-BR', langs), 'pt')
  assert.equal(matchLanguage('pt', langs), 'pt')
})

test('выключенный в реестре язык не выбирается', () => {
  const langs = LANGUAGES.map((l) => (l.code === 'tr' ? { ...l, enabled: false } : l))
  assert.equal(matchLanguage('tr-TR', langs), '')
  assert.equal(readStoredLanguage('tr', langs), '')
})

// ── Первый запуск ────────────────────────────────────────────────────────────
const env = (preferred, stored = null, legacyInstall = false) => ({
  stored, legacyInstall, preferred, langs: LANGUAGES, source: SOURCE_LANG, fallback: FALLBACK_LANG,
})

test('первый запуск: язык устройства, а неподдерживаемый — английский', () => {
  assert.equal(detectLanguage(env(['de-DE'])), 'de')
  assert.equal(detectLanguage(env(['ar-SA'])), 'ar')
  assert.equal(detectLanguage(env(['tr-TR'])), 'tr')
  assert.equal(detectLanguage(env(['ru-RU'])), 'ru')
  for (const fr of [['fr-FR'], ['it-IT'], ['pl-PL'], []]) assert.equal(detectLanguage(env(fr)), 'en', fr.join())
  // Первый поддерживаемый в списке предпочтений, а не только первый в списке.
  assert.equal(detectLanguage(env(['fr-FR', 'de-AT', 'en-US'])), 'de')
})

test('сохранённый выбор главнее языка устройства и старой установки', () => {
  assert.equal(detectLanguage(env(['en-US'], 'tr')), 'tr')
  assert.equal(detectLanguage(env(['en-US'], 'de', true)), 'de')
})

test('старая установка без выбора языка остаётся русской', () => {
  assert.equal(detectLanguage(env(['de-DE'], null, true)), 'ru')
  assert.equal(hasLegacyInstall(memoryStorage({ 'eataps:v1': '{}' }), ['eataps:v1'], ['eataps:state:']), true)
  assert.equal(hasLegacyInstall(memoryStorage({ 'eataps:state:guest': '{}' }), ['eataps:v1'], ['eataps:state:']), true)
  assert.equal(hasLegacyInstall(memoryStorage({ 'eataps:lang': 'de', other: '1' }), ['eataps:v1'], ['eataps:state:']), false)
  assert.equal(hasLegacyInstall({ get length() { throw new Error('denied') } }, [], []), false)
})

test('испорченное или старое значение в хранилище не роняет запуск', () => {
  const ok = { de: 'de', ' DE ': 'de', 'de-DE': 'de', '"ar"': 'ar', '{"code":"tr"}': 'tr', '{"lang":"es"}': 'es', PT: 'pt' }
  for (const [raw, code] of Object.entries(ok)) assert.equal(readStoredLanguage(raw, LANGUAGES), code, raw)
  for (const raw of ['xx', '', '{bad', '__proto__', 'constructor', '{"code":{"x":1}}', 'x'.repeat(10_000), null, undefined, '[]']) {
    assert.equal(readStoredLanguage(raw, LANGUAGES), '', String(raw).slice(0, 20))
    assert.equal(detectLanguage(env(['de-DE'], raw)), 'de', String(raw).slice(0, 20))
  }
})

test('deviceLanguages: navigator.languages, иначе navigator.language', () => {
  assert.deepEqual(deviceLanguages({ languages: ['de-DE', 'en'], language: 'de-DE' }), ['de-DE', 'en'])
  assert.deepEqual(deviceLanguages({ languages: [], language: 'ar' }), ['ar'])
  assert.deepEqual(deviceLanguages(null), [])
})

// ── Полный цикл через i18n.js ────────────────────────────────────────────────
test('немецкое устройство: сразу немецкий, выбор сохранён, lang/dir выставлены', async () => {
  device(['de-DE', 'en'])
  assert.equal(await initI18n(), 'de')
  assert.equal(getLang(), 'de')
  assert.equal(localStorage.getItem(LANG_KEY), 'de')
  assert.deepEqual(document.documentElement.attrs, { lang: 'de', dir: 'ltr' })
})

test('французское устройство: английский', async () => {
  device(['fr-FR'])
  assert.equal(await initI18n(), 'en')
  assert.equal(localStorage.getItem(LANG_KEY), 'en')
})

test('арабское устройство: арабский и rtl', async () => {
  device(['ar-SA'])
  assert.equal(await initI18n(), 'ar')
  assert.deepEqual(document.documentElement.attrs, { lang: 'ar', dir: 'rtl' })
})

test('ручной выбор переживает перезапуск и смену языка устройства', async () => {
  device(['de-DE'])
  await initI18n()
  assert.equal(await setLang('tr'), true)
  const saved = localStorage.dump()
  // Перезапуск приложения на устройстве, переключённом на английский.
  __resetForTests()
  device(['en-US'], saved)
  assert.equal(await initI18n(), 'tr')
  assert.equal(getLang(), 'tr')
  assert.equal(localStorage.getItem(LANG_KEY), 'tr')
})

test('старое значение в хранилище переписывается каноническим кодом', async () => {
  device(['en-US'], { [LANG_KEY]: '{"code":"pt"}' })
  assert.equal(await initI18n(), 'pt')
  assert.equal(localStorage.getItem(LANG_KEY), 'pt')
})

test('нет пакета языка (первый запуск офлайн): английский, выбор не затёрт', async () => {
  device(['de-DE'], { [LANG_KEY]: 'de' })
  const restore = __setLoaderForTests('de', () => Promise.reject(new Error('offline')))
  try {
    assert.equal(await initI18n(), 'en')
    assert.equal(localStorage.getItem(LANG_KEY), 'de', 'появится сеть — откроется по-немецки')
  } finally { restore() }
})

test('нет ни пакета, ни английского: вшитый русский, без падения', async () => {
  device(['de-DE'])
  const r1 = __setLoaderForTests('de', () => Promise.reject(new Error('offline')))
  const r2 = __setLoaderForTests('en', () => Promise.reject(new Error('offline')))
  try {
    assert.equal(await initI18n(), 'ru')
    assert.equal(getLang(), 'ru')
  } finally { r1(); r2() }
})

test('неудачное переключение оставляет прежний язык и сообщает false', async () => {
  device(['en-US'])
  await initI18n()
  const restore = __setLoaderForTests('ar', () => Promise.reject(new Error('offline')))
  try {
    assert.equal(await setLang('ar'), false)
    assert.equal(getLang(), 'en')
    assert.equal(localStorage.getItem(LANG_KEY), 'en')
    assert.equal(document.documentElement.attrs.dir, 'ltr')
  } finally { restore() }
  assert.equal(await setLang('xx'), false)
  assert.equal(getLang(), 'en')
})

test('гонка: применяется последний выбор, в каком бы порядке ни пришли пакеты', async () => {
  device(['en-US'])
  await initI18n()
  const real = await import('../locales/de.js')
  let releaseDe
  const restore = __setLoaderForTests('de', () => new Promise((r) => { releaseDe = () => r(real) }))
  try {
    const first = setLang('de') // медленный
    const second = setLang('ar') // быстрый — и последний
    assert.equal(await second, true)
    releaseDe()
    await first
    assert.equal(getLang(), 'ar')
    assert.equal(localStorage.getItem(LANG_KEY), 'ar')
    assert.equal(document.documentElement.attrs.dir, 'rtl')
  } finally { restore() }
})

test('detectLang в i18n.js и detectLanguage реестра — одно и то же', () => {
  for (const preferred of [['de-AT'], ['fr'], ['ar-EG', 'en']]) {
    assert.equal(detectLang({ stored: null, preferred, legacyInstall: false }), detectLanguage(env(preferred)))
  }
  assert.deepEqual(LANGS.map((l) => l.code), LANGUAGES.filter((l) => l.enabled !== false).map((l) => l.code))
})

// ── Загрузочный скрипт index.html ────────────────────────────────────────────
test('функции выбора языка пригодны для встраивания в ES5-скрипт', () => {
  for (const fn of [matchLanguage, readStoredLanguage, detectLanguage, hasLegacyInstall, deviceLanguages]) {
    const src = fn.toString()
    assert.ok(src.startsWith('function '), fn.name)
    assert.doesNotMatch(src, /=>|\bconst\b|\blet\b|`|\?\.|\?\?|\.\.\./, `${fn.name}: не ES5`)
  }
})

test('загрузочный скрипт выбирает тот же язык и dir, что приложение', async () => {
  const data = await buildBootData(ROOT)
  const script = bootScript(data)
  const run = (languages, stored) => {
    const ctx = { navigator: { languages, language: languages[0] }, localStorage: memoryStorage(stored || {}) }
    vm.createContext(ctx)
    vm.runInContext(`${script}
      var lang = detectLanguage({ stored: localStorage.getItem(I18N.key), legacyInstall: hasLegacyInstall(localStorage, I18N.legacyKeys, I18N.legacyPrefixes), preferred: deviceLanguages(navigator), langs: LANGS, source: I18N.source, fallback: I18N.fallback });
      var dir = 'ltr'; for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === lang) dir = LANGS[i].dir;
      var text = TEXT[lang];`, ctx)
    return { lang: ctx.lang, dir: ctx.dir, title: ctx.text[0] }
  }
  assert.deepEqual(run(['de-CH']).lang, 'de')
  assert.deepEqual(run(['fr-FR']).lang, 'en')
  const ar = run(['ar-SA'])
  assert.equal(ar.dir, 'rtl')
  assert.match(ar.title, /EatAps/)
  assert.equal(run(['de-DE'], { [LANG_KEY]: 'tr' }).lang, 'tr')
  assert.equal(run(['de-DE'], { 'eataps:v1': '{}' }).lang, 'ru')
  // Каждый язык реестра есть на аварийном экране.
  for (const l of LANGUAGES) assert.ok(data.text[l.code], l.code)
})
