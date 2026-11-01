// ─────────────────────────────────────────────────────────────────────────────
// Поиск продуктов, своих блюд, рецептов и добавок — на всех семи языках сразу.
//
// Слои:
//   normalize.js — конвейер нормализации (диакритика, ß, ı, арабские варианты,
//                  цифры, пунктуация), стемминг, транслитерация, раскладка;
//   engine.js    — индекс и тиры релевантности, нечёткое сравнение;
//   aliases.js   — синонимы канонических продуктов по id и языку;
//   keywords.js  — наборы ключевых слов по id (латиница без умлаутов и т. п.);
//   synonyms.js  — разговорные формы для расширения запроса (русский);
//   names.js     — ленивый чанк: названия продуктов и добавок на всех языках.
//
// Индекс строится один раз на список (WeakMap по массиву) и перестраивается,
// только если сменился язык интерфейса (меняется «главное» название и
// длина показанного имени) или догрузились названия других языков. Ключ кэша
// включает INDEX_VERSION: после обновления логики старый индекс не выживет.
//
// Сущность в выдаче одна на id: «oatmeal», «porridge», «Haferbrei» —
// синонимы одной записи и дают одну карточку, а не три.
// ─────────────────────────────────────────────────────────────────────────────
import { buildIndex, search, makeField, INDEX_VERSION } from './engine.js'
import { fold, latToCyr, cyrToLat, swapLayout } from './normalize.js'
import { expandSynonyms, SYNONYM_WEIGHT } from './synonyms.js'
import KEYWORDS from './keywords.js'
import { getLang, dataTable, LANGS, SOURCE_LANG } from '../i18n.js'
import { catalogId } from '../catalog.js'

const own = (o, k) => !!o && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k)

// ── Названия всех языков (ленивый чанк) ─────────────────────────────────────
let all = null
let allPromise = null
let namesVersion = 0
const listeners = new Set()

export function loadSearchNames() {
  if (all) return Promise.resolve(true)
  if (!allPromise) {
    allPromise = import('./names.js')
      .then((m) => {
        all = m.default
        namesVersion += 1
        for (const fn of listeners) fn()
        return true
      })
      .catch(() => {
        allPromise = null // нет сети и нет кэша — попробуем в следующий раз
        return false
      })
  }
  return allPromise
}
export const searchNamesReady = () => !!all
export function onSearchNamesLoaded(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Таблица названий языка: из ленивого чанка, а пока он не пришёл — из пакета
// языка интерфейса (он уже загружен).
function namesOf(kind, lang) {
  if (all?.[kind]?.[lang]) return all[kind][lang]
  return lang === getLang() ? dataTable(kind) : null
}
const otherLangs = () => LANGS.map((l) => l.code).filter((c) => c !== SOURCE_LANG)

// ── Поля сущностей ───────────────────────────────────────────────────────────
// shown — название на языке интерфейса (для тай-брейка по длине).
function catalogFields(id, ruName, extraKeywords) {
  const ui = getLang()
  const fields = [{ text: ruName, kind: 'name', lang: 'ru', primary: ui === 'ru' }]
  let shown = ruName
  for (const lang of otherLangs()) {
    const name = namesOf('foods', lang)?.[id]
    if (!name) continue
    fields.push({ text: name, kind: 'name', lang, primary: lang === ui })
    if (lang === ui) shown = name
  }
  const al = all?.aliases?.[id]
  if (al) for (const lang of Object.keys(al)) for (const a of al[lang]) fields.push({ text: a, kind: 'alias', lang })
  if (own(KEYWORDS, id)) fields.push({ text: KEYWORDS[id], kind: 'keyword', lang: '' })
  if (extraKeywords) fields.push({ text: extraKeywords, kind: 'keyword', lang: 'ru' })
  const lat = cyrToLat(fold(ruName))
  if (lat) fields.push({ text: lat, kind: 'translit', lang: 'ru' })
  return { fields, shown }
}

function itemEntity(item, i) {
  if (!item || typeof item.name !== 'string') return null
  // Своё (source: 'custom') каталожным не считается, даже если названо так же,
  // как продукт базы: у него свои цифры, и найтись оно должно как своё.
  const id = item.source === 'custom' ? null : catalogId('foods', item.id) || catalogId('foods', item.name)
  if (id) {
    const { fields, shown } = catalogFields(id, item.name, item.alias)
    return { key: id, item, fields, shownLen: shown.length }
  }
  // Своё блюдо, рецепт, товар по штрихкоду: ищется по тому, как назван.
  const fields = [{ text: item.name, kind: 'name', lang: '', primary: true }]
  if (item.alias) fields.push({ text: item.alias, kind: 'keyword', lang: '' })
  const lat = cyrToLat(fold(item.name))
  if (lat) fields.push({ text: lat, kind: 'translit', lang: '' })
  return { key: `item:${item.id ?? item.name}:${i}`, item, fields, shownLen: item.name.length }
}

// Своё блюдо или рецепт: только его собственное название, без каталога.
export function ownEntity(item, i) {
  if (!item || typeof item.name !== 'string') return null
  const fields = [{ text: item.name, kind: 'name', lang: '', primary: true }]
  const lat = cyrToLat(fold(item.name))
  if (lat) fields.push({ text: lat, kind: 'translit', lang: '' })
  return { key: `own:${item.id ?? item.name}:${i}`, item, fields, shownLen: item.name.length }
}

// Добавка каталога: русское имя, жаргон и латиница из alias, названия на
// всех языках по id.
export function supplementEntity(item, i) {
  if (!item || typeof item.name !== 'string') return null
  const ui = getLang()
  const fields = [{ text: item.name, kind: 'name', lang: item.id ? 'ru' : '', primary: ui === 'ru' || !item.id }]
  let shown = item.name
  if (item.id) {
    for (const lang of otherLangs()) {
      const name = namesOf('supps', lang)?.[item.id]?.name
      if (!name) continue
      fields.push({ text: name, kind: 'name', lang, primary: lang === ui })
      if (lang === ui) shown = name
    }
  }
  if (item.alias) fields.push({ text: item.alias, kind: 'keyword', lang: '' })
  const lat = cyrToLat(fold(item.name))
  if (lat) fields.push({ text: lat, kind: 'translit', lang: 'ru' })
  return { key: item.id ? `supp:${item.id}` : `supp:${item.name}:${i}`, item, fields, shownLen: shown.length }
}

// ── Кэш индексов ─────────────────────────────────────────────────────────────
const cache = new WeakMap()
const cacheKey = () => `${INDEX_VERSION}|${getLang()}|${namesVersion}`

export function indexFor(items, toEntity = itemEntity) {
  const key = cacheKey()
  const hit = cache.get(items)
  if (hit && hit.key === key && hit.toEntity === toEntity) return hit.index
  const seen = new Set()
  const entities = []
  items.forEach((item, i) => {
    const e = toEntity(item, i)
    if (!e || seen.has(e.key)) return // дубликат id — одна карточка
    seen.add(e.key)
    entities.push(e)
  })
  const index = buildIndex(entities)
  cache.set(items, { key, index, toEntity })
  return index
}

// ── Варианты запроса ─────────────────────────────────────────────────────────
export function queryVariants(raw) {
  const q = fold(raw)
  if (!q) return []
  const out = [{ text: q, weight: 1 }]
  const seen = new Set([q])
  const add = (text, weight) => {
    if (text && !seen.has(text)) { seen.add(text); out.push({ text, weight }) }
  }
  // Латиница → кириллица: «banana» находит «Банан» и без словаря.
  add(latToCyr(q), 0.95)
  // Не та раскладка: «jdczyrf» → «овсянка», «щфе ьшдл» → «oat milk».
  add(swapLayout(raw), 0.85)
  for (const syn of expandSynonyms(q)) add(syn, SYNONYM_WEIGHT)
  return out
}

// ── Публичный поиск ──────────────────────────────────────────────────────────
// Возвращает { results: [item], suggestion } — suggestion есть, когда ничего
// не нашлось точно и выдача держится на исправлении опечатки: экран может
// тихо подсказать «Возможно, вы имели в виду: Haferflocken».
export function searchItems(items, query, { boost, minResults = 3, limit, toEntity } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!fold(query)) return { results: list, suggestion: null }
  const index = indexFor(list, toEntity)
  const { results, fuzzy } = search(index, queryVariants(query), { primaryLang: getLang(), boost, minResults, limit })
  const top = results[0]
  return {
    results: results.map((r) => r.item),
    suggestion: fuzzy && top ? { item: top.item, matched: top.matched } : null,
    ranked: results,
  }
}

// ── Сопоставление с каталогом (ответ ИИ, распознавание фото) ────────────────
// Только точное совпадение после нормализации с названием или синонимом на
// любом языке, и только если оно указывает на ОДИН продукт. Никаких опечаток
// и «похоже на»: выдумать совпадение хуже, чем оставить название как есть.
export async function matchCatalogFood(name, items) {
  await loadSearchNames()
  return matchCatalogFoodSync(name, items)
}

export function matchCatalogFoodSync(name, items) {
  const q = fold(name)
  if (!q || !Array.isArray(items)) return null
  const index = indexFor(items)
  const hits = new Set()
  for (const e of index.entities) {
    if (!catalogId('foods', e.key)) continue
    for (const f of e.fields) {
      if ((f.kind === 'name' || f.kind === 'alias') && f.text === q) { hits.add(e.key); break }
    }
    if (hits.size > 1) return null
  }
  return hits.size === 1 ? [...hits][0] : null
}

export { makeField }
