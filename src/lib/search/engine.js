// ─────────────────────────────────────────────────────────────────────────────
// Поисковый движок: индекс и ранжирование. Не знает ни о продуктах, ни о
// языках интерфейса — получает сущности с полями и запрос.
//
// ── Индекс ───────────────────────────────────────────────────────────────────
// Сущность: { key, item, fields[] }. Поле — одна строка, по которой сущность
// может найтись:
//   name     — название на одном из языков (на языке интерфейса — primary);
//   alias    — синоним из словаря синонимов;
//   keyword  — набор слов («chicken breast huhn hahnchen»), а не фраза;
//   translit — латинская запись русского названия («ovsyanka»).
// Для каждого поля заранее посчитаны: нормализованный текст, токены, основы,
// главное слово, склеенная запись без пробелов. Для индекса целиком — словарь
// уникальных слов и карта «первая буква → сущности». На нажатии клавиши ничего
// из этого не пересчитывается.
//
// ── Тиры релевантности (сверху вниз) ─────────────────────────────────────────
//   1000 точное совпадение поля с запросом
//    960 совпадение без пробелов («hotdog» = «hot dog»)
//    700 запрос — главное слово поля целиком. Главное слово зависит от языка
//        поля: в русском, испанском, португальском, арабском оно первое
//        («Лук репчатый», «Leche de avena»), в английском и турецком —
//        последнее («Oat milk», «Yulaf sütü»). Поэтому «milk» ставит овсяное
//        молоко выше молочного шоколада, а «лук» — лук выше лукового супа.
//    600 поле начинается с запроса
//    560 все слова запроса — целые слова поля, в любом порядке
//    520 начало поля без пробелов («oatmil» → «oat milk»)
//    420 все слова запроса — начала слов поля
//    400 одно слово запроса — целое слово поля (не главное)
//    380 все слова совпали с учётом окончаний («бананы» → «банан»)
//    350 слово запроса — начало слова поля
//    150 длинная подстрока внутри слова (от 4 букв)
//    100…320 часть слов запроса совпала точно (по доле совпавших)
//     40…120 опечатки: все слова совпали с правками (меньше правок — выше)
//     60…80 сближение по звучанию (русское «малако» → «молоко»)
// Внутри тира: поле другого языка — минус 4, синоним ×0.9, ключевое слово
// ×0.8, транслитерация ×0.9, вариант запроса — по его весу (раскладка ×0.85,
// разговорная форма ×0.75). Тай-брейк — длина показанного названия (до −6) и
// личная надбавка (до +9, MEMORY_BOOST_MAX): через тир ни то ни другое не
// переводит. Последний ключ сортировки — key сущности: одинаковые баллы всегда
// дают один и тот же порядок.
//
// ── Два прохода ──────────────────────────────────────────────────────────────
// Строгий проход смотрит только сущности, у которых есть слово на ту же букву,
// что и слова запроса. Если строгих совпадений меньше minResults, идёт полный
// проход: подстроки, опечатки, звучание. Расстояние до слов считается один раз
// на запрос по словарю уникальных слов, а не по каждому полю.
// ─────────────────────────────────────────────────────────────────────────────
import { fold, tokens as toTokens, compact, stem, phoneticKey } from './normalize.js'
import { editDistance, maxDistanceFor } from '../fuzzy.js'

export const INDEX_VERSION = 4
export const MEMORY_BOOST_MAX = 9
const OTHER_LANG_PENALTY = 4
const KIND_FACTOR = { name: 1, alias: 0.9, keyword: 0.8, translit: 0.9 }
// Языки, в которых главное слово названия стоит последним.
const HEAD_LAST = new Set(['en', 'tr'])
// Нечёткое сравнение — только для самого запроса и его близких вариантов:
// опечатка поверх синонима или раскладки — это уже гадание.
const FUZZY_MIN_WEIGHT = 0.85

export function makeField(text, kind = 'name', lang = '', primary = false) {
  const f = fold(text)
  if (!f) return null
  const tk = toTokens(f)
  const head = HEAD_LAST.has(lang) ? tk[tk.length - 1] : tk[0]
  return { kind, lang, primary, text: f, raw: String(text), tokens: tk, stems: tk.map(stem), compact: compact(f), head }
}

// entities: [{ key, item, fields: [{text, kind, lang, primary}], shownLen }]
export function buildIndex(entities) {
  const list = []
  const vocab = new Set()
  const compacts = new Set()
  const byChar = new Map()
  for (const e of entities) {
    const fields = []
    const seen = new Set()
    for (const spec of e.fields) {
      const f = spec && spec.tokens ? spec : spec && makeField(spec.text, spec.kind, spec.lang, spec.primary)
      if (!f) continue
      const sig = `${f.kind}|${f.lang}|${f.text}`
      if (seen.has(sig)) continue
      seen.add(sig)
      fields.push(f)
    }
    if (!fields.length) continue
    const idx = list.length
    list.push({ key: String(e.key), item: e.item, fields, shownLen: e.shownLen ?? 20 })
    for (const f of fields) {
      compacts.add(f.compact)
      for (const t of f.tokens) {
        vocab.add(t)
        const c = t[0]
        let set = byChar.get(c)
        if (!set) byChar.set(c, (set = new Set()))
        set.add(idx)
      }
    }
  }
  return { version: INDEX_VERSION, entities: list, vocab: [...vocab], compacts: [...compacts], byChar, phon: new Map() }
}

// ── Подготовка запроса ───────────────────────────────────────────────────────
export function prepareQuery(text, weight = 1) {
  const q = fold(text)
  if (!q) return null
  const tk = toTokens(q)
  return { q, tokens: tk, stems: tk.map(stem), compact: compact(q), weight }
}

// ── Строгое сравнение поля с вариантом запроса ───────────────────────────────
function strictScore(f, qv, full) {
  const { q, tokens: qt } = qv
  if (f.text === q) return 1000
  if (qv.compact.length >= 4 && f.compact === qv.compact) return 960
  if ((qt.length === 1 && f.head === q) || (qt.length > 1 && f.text.startsWith(q + ' '))) return 700
  if (f.text.startsWith(q)) return 600

  // Каждое слово запроса совпадает с полем одним из способов: целым словом,
  // началом слова или основой («бананы» → «банан», «Tomaten» → «Tomate»).
  let exact = 0
  let prefix = 0
  let stemmed = 0
  for (let i = 0; i < qt.length; i++) {
    const t = qt[i]
    if (f.tokens.includes(t)) { exact++; continue }
    // Начало слова засчитываем от двух букв: «ка» в «картофель» — уже намерение.
    if (t.length >= 2 && f.tokens.some((w) => w.startsWith(t))) { prefix++; continue }
    const st = qv.stems[i]
    if (st.length >= 3 && f.stems.some((w) => w === st || (st.length >= 4 && w.startsWith(st)))) stemmed++
  }
  const n = qt.length
  if (n > 1 && exact === n) return 560
  if (qv.compact.length >= 4 && f.compact.startsWith(qv.compact)) return 520
  if (n > 1 && exact + prefix === n) return 420
  if (n === 1 && exact === 1) return 400
  if (exact + prefix + stemmed === n && stemmed > 0) return 380
  if (n === 1 && prefix === 1) return 350
  // Подстрока ВНУТРИ слова — только для длинных запросов: на двух-трёх буквах
  // это шум («щи» в «тёщин»). И только в полном проходе.
  if (full && q.length >= 4 && f.text.includes(q)) return 150
  if (n > 1 && exact > 0 && qt.some((t) => t.length >= 3 && f.tokens.includes(t))) {
    return 100 + Math.round(220 * (exact / n))
  }
  return -1
}

// ── Опечатки ────────────────────────────────────────────────────────────────
// Для каждого слова запроса один раз проходим словарь индекса и запоминаем
// слова в пределах допустимых правок. Порог зависит от длины слова (fuzzy.js):
// в коротком слове одна правка меняет смысл («сок» → «сом»).
function distanceMap(index, t, pool) {
  const max = maxDistanceFor(t)
  const map = new Map()
  if (max === 0) return map
  for (const w of pool) {
    if (w.length < t.length - max) continue
    // Слово сильно длиннее запроса — сравниваем его НАЧАЛО: «гречнев» и
    // «гречневая».
    const cand = w.length > t.length + max ? w.slice(0, t.length + max) : w
    if (cand[0] !== t[0] && cand[1] !== t[1] && cand[0] !== t[1]) continue // разные начала — почти всегда разные слова
    const d = editDistance(cand, t, max)
    if (d <= max) map.set(w, d)
  }
  return map
}

function fuzzyScore(f, qv, dist, cdist, phon) {
  let total = 0
  for (let i = 0; i < qv.tokens.length; i++) {
    const t = qv.tokens[i]
    let best = null
    for (const w of f.tokens) {
      if (w === t || (t.length >= 2 && w.startsWith(t))) { best = 0; break }
      const d = dist[i].get(w)
      if (d !== undefined && (best == null || d < best)) best = d
    }
    if (best == null && qv.tokens.length === 1 && f.tokens.length > 1) {
      // «haferfloken» против склеенного «hafer flocken».
      const d = cdist.get(f.compact)
      if (d !== undefined) best = d
    }
    if (best == null) return phonetic(f, qv, phon)
    total += best
  }
  if (total === 0) return -1 // точные совпадения уже оценил строгий проход
  return Math.max(40, 120 - total * 40)
}

function phonetic(f, qv, phon) {
  if (!phon.key) return -1
  let best = -1
  for (const w of f.tokens) {
    let wk = phon.cache.get(w)
    if (wk === undefined) { wk = phoneticKey(w); phon.cache.set(w, wk) }
    if (wk === phon.key) return 80
    // Правка поверх сближения — только в длинных словах («сметанна»): в
    // коротких она склеивает разное («бананы» и «бараний»).
    if (phon.key.length >= 7 && Math.abs(wk.length - phon.key.length) <= 1 && editDistance(wk, phon.key, 1) <= 1) best = 60
  }
  return best
}

// ── Поиск ───────────────────────────────────────────────────────────────────
// variants: [{ text, weight }] — сам запрос и его варианты (транслитерация,
// раскладка, разговорные формы). primaryLang — язык интерфейса: поля на нём
// главнее. boost(item) → 0..1 — личная надбавка. minResults — сколько строгих
// совпадений достаточно, чтобы не запускать полный проход.
export function search(index, variants, { primaryLang = '', boost, minResults = 3, limit = Infinity } = {}) {
  const qvs = variants.map((v) => prepareQuery(v.text, v.weight)).filter(Boolean)
  if (!qvs.length || !index) return { results: [], fuzzy: false }
  const bonus = boost ? (item) => Math.max(0, Math.min(1, Number(boost(item)) || 0)) * MEMORY_BOOST_MAX : () => 0

  const scoreEntity = (e, full, fz) => {
    let best = -1
    let match = null
    for (const f of e.fields) {
      for (let v = 0; v < qvs.length; v++) {
        const qv = qvs[v]
        let raw = strictScore(f, qv, full)
        if (raw < 0 && fz && fz[v] && f.kind !== 'keyword') raw = fuzzyScore(f, qv, fz[v].dist, fz[v].cdist, fz[v].phon)
        if (raw < 0) continue
        let s = raw * KIND_FACTOR[f.kind] * qv.weight
        if (f.kind === 'name' && primaryLang && f.lang && f.lang !== primaryLang) s -= OTHER_LANG_PENALTY
        if (s > best) { best = s; match = f }
      }
    }
    return best < 0 ? null : { s: best, match }
  }

  const collect = (candidates, full, fz) => {
    const out = []
    for (const i of candidates) {
      const e = index.entities[i]
      const r = scoreEntity(e, full, fz)
      if (!r) continue
      out.push({ e, score: r.s - Math.min(e.shownLen, 60) * 0.1 + bonus(e.item), base: r.s, match: r.match })
    }
    out.sort((a, b) => b.score - a.score || (a.e.key < b.e.key ? -1 : a.e.key > b.e.key ? 1 : 0))
    return out
  }

  // Строгий проход: только сущности со словом на первую букву слова запроса.
  const cand = new Set()
  for (const qv of qvs) for (const t of qv.tokens) for (const i of index.byChar.get(t[0]) || []) cand.add(i)
  let out = collect(cand, false, null)
  let fuzzy = false

  if (out.length < minResults) {
    const fz = qvs.map((qv) => {
      if (qv.weight < FUZZY_MIN_WEIGHT) return null
      const pk = qv.tokens.length === 1 ? phoneticKey(qv.q) : ''
      return {
        dist: qv.tokens.map((t) => distanceMap(index, t, index.vocab)),
        cdist: qv.tokens.length === 1 ? distanceMap(index, qv.q, index.compacts) : new Map(),
        phon: { key: pk.length >= 3 && /[а-я]/.test(pk) ? pk : '', cache: index.phon },
      }
    })
    out = collect(index.entities.keys(), true, fz)
    fuzzy = out.length > 0 && out[0].base < 150
  }
  const results = (limit < out.length ? out.slice(0, limit) : out).map((r) => ({
    key: r.e.key, item: r.e.item, score: r.score, matched: r.match ? { kind: r.match.kind, lang: r.match.lang, text: r.match.raw } : null,
  }))
  return { results, fuzzy }
}
