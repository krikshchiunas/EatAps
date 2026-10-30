// ─────────────────────────────────────────────────────────────────────────────
// Языки интерфейса.
//
// Русский — исходный язык: строка сначала появляется в locales/ru, и он же
// подстраховывает любой другой язык, если у того нет перевода ключа. Лучше
// русская подпись, чем «settings.title» на кнопке.
//
// Остальные языки грузятся лениво, отдельными чанками: человек скачивает только
// тот язык, на котором читает. Русский вшит в основной бандл — без него нечем
// подстраховываться, пока чанк едет по сети.
//
// t() — обычная функция, а не хук: её зовут и компоненты, и модули из lib
// (подписи единиц, ошибки входа, текст уведомлений). Перерисовку при смене
// языка обеспечивает App: он подписан на язык (useLang) и перерисовывает всё
// дерево. Отсюда правило — никаких t() на уровне модуля: такая строка
// вычислится один раз, на старте, и навсегда останется на прежнем языке.
// Подписи в константах-справочниках оформляются геттером (get label()).
// ─────────────────────────────────────────────────────────────────────────────
import * as ruPack from '../locales/ru.js'

// locale — для Intl: даты, числа, правила множественного числа. У арабского
// цифры латинские: числа в приложении пишутся и вводятся ими, и смесь
// «١٢٠ ккал» в одной строке с «120 г» в соседней читается хуже любой из них.
export const LANGS = [
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
  { code: 'tr', name: 'Türkçe', locale: 'tr-TR' },
  { code: 'ar', name: 'العربية', locale: 'ar-u-nu-latn', dir: 'rtl' },
]

export const SOURCE_LANG = 'ru'
// Для браузера на языке, которого у нас нет: английский поймут чаще прочих.
export const FALLBACK_LANG = 'en'
export const LANG_KEY = 'eataps:lang'

const LOADERS = {
  en: () => import('../locales/en.js'),
  de: () => import('../locales/de.js'),
  es: () => import('../locales/es.js'),
  pt: () => import('../locales/pt.js'),
  tr: () => import('../locales/tr.js'),
  ar: () => import('../locales/ar.js'),
}

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])

// Объект с формами множественного числа — это значение, а не вложенный раздел.
// Отличаем по составу ключей: только категории Intl.PluralRules, и среди них
// обязательно «other» — им закрывается любая форма, которой у языка нет.
export function isPluralLeaf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('other' in v)) return false
  return Object.keys(v).every((k) => PLURAL_FORMS.has(k))
}

// { settings: { title: '…' } } → Map('settings.title' → '…'). Вложенность
// нужна людям, которые правят файлы переводов; поиску нужна плоская таблица.
export function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v) && !isPluralLeaf(v)) flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

const compile = (mod) => ({ strings: flatten(mod.strings), data: mod.data || {} })

const packs = { [SOURCE_LANG]: compile(ruPack) }
let current = SOURCE_LANG
let rules = null
const listeners = new Set()

export const isSupported = (code) => LANGS.some((l) => l.code === code)
export const getLang = () => current
export const langInfo = (code = current) => LANGS.find((l) => l.code === code) || LANGS[0]
export const locale = () => langInfo().locale
export const isRtl = () => langInfo().dir === 'rtl'

export function onLangChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function pluralRules() {
  if (!rules) {
    try { rules = new Intl.PluralRules(locale()) } catch { rules = { select: () => 'other' } }
  }
  return rules
}

function pluralForm(forms, n) {
  const cat = typeof n === 'number' && Number.isFinite(n) ? pluralRules().select(n) : 'other'
  return forms[cat] ?? forms.other
}

// «{n} ккал» + { n: 120 } → «120 ккал». Неизвестный плейсхолдер остаётся как
// есть: пропущенный параметр лучше видеть на экране, чем молча терять кусок фразы.
function fill(s, params) {
  return s.replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])))
}

function lookup(key) {
  const own = packs[current]?.strings.get(key)
  if (own != null) return own
  return current === SOURCE_LANG ? undefined : packs[SOURCE_LANG].strings.get(key)
}

// t('units.kcalN', { n: 300 }) — строка на текущем языке.
// Для форм множественного числа число передаётся в count:
// t('count.products', { count: 3 }) → «3 продукта» / «3 products».
export function t(key, params) {
  let v = lookup(key)
  if (v == null) return key
  if (isPluralLeaf(v)) v = pluralForm(v, params?.count)
  if (typeof v !== 'string') return v // списки (дни недели и т.п.)
  return params ? fill(v, params) : v
}

// Есть ли у ключа перевод на текущем языке (без подстраховки русским).
export const hasOwn = (key) => packs[current]?.strings.has(key) || false

// Переводы данных: названия продуктов, добавок, нутриентов. Ключ — исходное
// русское значение (оно же хранится в дневнике), поэтому смена языка не
// трогает записанное: переводится только показ. Нет перевода — исходник.
export function tData(table, key) {
  if (key == null || current === SOURCE_LANG) return key
  const v = packs[current]?.data?.[table]?.[key]
  return v == null ? key : v
}

// Вся таблица данных текущего языка — для поиска по переведённым названиям.
export const dataTable = (table) => packs[current]?.data?.[table] || null

// ── Числа и даты ─────────────────────────────────────────────────────────────
export function fmtDate(d, opts) {
  return new Date(d).toLocaleDateString(locale(), opts)
}
export function fmtTime(d, opts = { hour: '2-digit', minute: '2-digit' }) {
  return new Date(d).toLocaleTimeString(locale(), opts)
}
export function fmtDateTime(d, opts) {
  return new Date(d).toLocaleString(locale(), opts)
}
export function fmtNum(n, opts) {
  return Number(n).toLocaleString(locale(), opts)
}

// ── Выбор языка ──────────────────────────────────────────────────────────────
function readSaved() {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return isSupported(v) ? v : null
  } catch { return null }
}

function save(code) {
  try { localStorage.setItem(LANG_KEY, code) } catch {}
}

// До появления языков EatAps был только русским. Человек, у которого на
// устройстве уже лежат данные, читал его по-русски — переключать его на язык
// браузера посреди привычного дневника было бы сюрпризом, а не заботой.
function hasExistingInstall() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('eataps:state:') || k === 'eataps:v1')) return true
    }
  } catch {}
  return false
}

export function browserLang(list) {
  const prefs = list || (typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]))
  for (const tag of prefs) {
    const code = String(tag || '').toLowerCase().split(/[-_]/)[0]
    if (isSupported(code)) return code
  }
  return null
}

export function detectLang() {
  return readSaved() || (hasExistingInstall() ? SOURCE_LANG : null) || browserLang() || FALLBACK_LANG
}

function applyDocument() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.setAttribute('lang', current)
  el.setAttribute('dir', langInfo().dir || 'ltr')
}

async function loadPack(code) {
  if (packs[code]) return true
  try {
    packs[code] = compile(await LOADERS[code]())
    return true
  } catch {
    return false
  }
}

// Переключает язык. Пакет не загрузился (нет сети, а чанка нет в кэше) —
// остаёмся на прежнем языке и сообщаем об этом false: экран выбора покажет,
// что переключиться не вышло, вместо того чтобы молча оставить всё как было.
export async function setLang(code, { persist = true } = {}) {
  if (!isSupported(code)) code = SOURCE_LANG
  if (!(await loadPack(code))) return false
  current = code
  rules = null
  if (persist) save(code)
  applyDocument()
  for (const fn of listeners) fn(code)
  return true
}

// Один раз при запуске, до первого рендера. Выбранный автоматически язык
// запоминаем сразу: иначе смена языка в настройках телефона однажды молча
// переключила бы и приложение.
export async function initI18n() {
  const code = detectLang()
  if (await setLang(code)) return
  // Чанк выбранного языка недоступен — показываем исходный, но выбор человека
  // не затираем: появится сеть, и следующий запуск откроется на его языке.
  await setLang(SOURCE_LANG, { persist: false })
}
