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
import {
  LANGUAGES, SOURCE_LANG, FALLBACK_LANG, LANG_KEY, LEGACY_INSTALL_KEYS, LEGACY_INSTALL_PREFIXES,
  matchLanguage, readStoredLanguage, detectLanguage, hasLegacyInstall, deviceLanguages,
} from '../locales/registry.js'

// Языки — из реестра (src/locales/registry.js). locale — прежнее имя поля
// intlLocale: его читают компоненты, переименовывать незачем.
export const LANGS = LANGUAGES.filter((l) => l.enabled !== false).map((l) => ({ ...l, locale: l.intlLocale }))
export { SOURCE_LANG, FALLBACK_LANG, LANG_KEY }

// Пакеты языков — отдельные чанки. Русский вшит: он подстраховка, и без него
// нечем показать экран, пока чанк едет по сети.
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
export { matchLanguage }
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

// Переводы данных по стабильному id: названия продуктов, способов
// приготовления, порций, добавок, нутриентов (см. src/lib/catalog.js).
// Нет перевода на текущем языке — исходное (русское) название; нет и его —
// fallback, а если и он не задан, сам id. Словари без прототипа не нужны:
// поиск идёт только по собственным ключам таблицы.
const hasKey = (obj, k) => !!obj && typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k)
export function tData(table, id, fallback) {
  const own = packs[current]?.data?.[table]
  if (hasKey(own, id)) return own[id]
  const src = packs[SOURCE_LANG]?.data?.[table]
  if (hasKey(src, id)) return src[id]
  return fallback === undefined ? id : fallback
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
// Пусто, null и не-число — пустая строка, а не «0» и не «NaN»: неизвестное
// значение не должно выглядеть измеренным.
export function fmtNum(n, opts) {
  if (n == null || n === '') return ''
  const v = Number(n)
  return Number.isFinite(v) ? v.toLocaleString(locale(), opts) : ''
}

// ── Выбор языка ──────────────────────────────────────────────────────────────
function storage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function readSaved() {
  try { return readStoredLanguage(storage()?.getItem(LANG_KEY), LANGS) } catch { return '' }
}

function save(code) {
  try { storage()?.setItem(LANG_KEY, code) } catch {}
}

// Тег браузера → код языка. list — для тестов; по умолчанию navigator.languages.
export function browserLang(list) {
  const prefs = list || deviceLanguages(typeof navigator === 'undefined' ? null : navigator)
  for (const tag of prefs) {
    const code = matchLanguage(tag, LANGS)
    if (code) return code
  }
  return null
}

// Язык запуска — та же функция, что встроена в index.html (см. registry.js):
// загрузочный экран и приложение не могут выбрать разные языки.
export function detectLang({ stored, preferred, legacyInstall } = {}) {
  const st = storage()
  return detectLanguage({
    stored: stored !== undefined ? stored : st?.getItem?.(LANG_KEY),
    legacyInstall: legacyInstall !== undefined ? legacyInstall : (st ? hasLegacyInstall(st, LEGACY_INSTALL_KEYS, LEGACY_INSTALL_PREFIXES) : false),
    preferred: preferred || deviceLanguages(typeof navigator === 'undefined' ? null : navigator),
    langs: LANGS,
    source: SOURCE_LANG,
    fallback: FALLBACK_LANG,
  })
}

function applyDocument() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.setAttribute('lang', current)
  el.setAttribute('dir', langInfo().dir || 'ltr')
}

// Загрузка пакета. Одновременные запросы одного языка делят одну загрузку.
const inflight = new Map()
function loadPack(code) {
  if (packs[code]) return Promise.resolve(true)
  const loader = LOADERS[code]
  if (!loader) return Promise.resolve(false)
  if (!inflight.has(code)) {
    inflight.set(code, loader()
      .then((mod) => { packs[code] = compile(mod); return true })
      .catch(() => false)
      .finally(() => inflight.delete(code)))
  }
  return inflight.get(code)
}

// Переключает язык. Пакет не загрузился (нет сети, а чанка нет в кэше) —
// остаёмся на прежнем языке и возвращаем false: экран выбора покажет, что
// переключиться не вышло, вместо того чтобы молча оставить всё как было.
//
// Порядок гарантирован: если человек успел выбрать второй язык, пока грузился
// первый, применится только последний выбор, в каком бы порядке ни пришли
// чанки. Перекрытый запрос возвращает true — он не ошибся, его просто сменили.
let switchSeq = 0
export async function setLang(code, { persist = true } = {}) {
  const target = readStoredLanguage(code, LANGS)
  if (!target) return false
  const seq = ++switchSeq
  const ok = await loadPack(target)
  if (seq !== switchSeq) return ok
  if (!ok) return false
  const changed = current !== target
  current = target
  rules = null
  if (persist) save(target)
  applyDocument()
  if (changed) for (const fn of listeners) fn(target)
  return true
}

// Один раз при запуске, до первого рендера. Определённый автоматически язык
// запоминаем сразу: иначе смена языка в настройках телефона однажды молча
// переключила бы и приложение. Выбор человека не перезаписывается ничем.
//
// Если пакет нужного языка недоступен (первый запуск без сети, чанка нет в
// кэше), показываем английский, а если нет и его — вшитый русский. Сохранённый
// выбор при этом НЕ затираем: появится сеть — следующий запуск откроется на
// языке человека.
export async function initI18n() {
  const code = detectLang()
  if (await setLang(code)) return code
  // Язык определён, но его пакет сейчас недоступен. Запоминаем сам язык (не
  // запасной!): иначе следующий запуск увидел бы данные приложения без
  // выбранного языка, принял бы их за установку старше языков и открылся бы
  // по-русски. А так — снова попробует язык устройства.
  if (!readSaved()) save(code)
  for (const fallback of [FALLBACK_LANG, SOURCE_LANG]) {
    if (fallback !== code && (await setLang(fallback, { persist: false }))) return fallback
  }
  return getLang()
}

// Для тестов: подменить загрузчик пакета (медленная сеть, офлайн).
export function __setLoaderForTests(code, loader) {
  const prev = LOADERS[code]
  if (loader) LOADERS[code] = loader
  else delete LOADERS[code]
  delete packs[code]
  return () => { if (prev) LOADERS[code] = prev; else delete LOADERS[code]; delete packs[code] }
}

// Для тестов: сбросить состояние модуля к исходному.
export function __resetForTests() {
  current = SOURCE_LANG
  rules = null
  switchSeq += 1
  for (const k of Object.keys(packs)) if (k !== SOURCE_LANG) delete packs[k]
}
