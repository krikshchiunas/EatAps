// POST /api/ai/barcode — ИИ проверяет товар, найденный по штрихкоду.
//
// Тело: { code, lang }. Ответ: { check, usage } — см. sanitizeCheck ниже.
//
// Только Carrot Premium, и проверяет это сервер по базе, а не клиент.
//
// Данные товара сервер берёт из Open Food Facts САМ, по штрихкоду. Клиент
// присылает только код: иначе в модель уехало бы всё, что угодно, под видом
// «данных с упаковки», а платит за это владелец ключа.
//
// Open Food Facts наполняют люди, и ошибок там много: килоджоули в поле
// «ккал», значения «на порцию» в поле «на 100 г», сдвиг запятой, граммы вместо
// миллилитров, «55 г клетчатки» у чипсов. Модель (BARCODE_CHECK_MODEL)
// рассуждает, а не переписывает: сверяет цифры между собой и с тем, каким
// бывает такой продукт, читает таблицу состава на фото упаковки, а когда
// что-то не сходится — ищет данные производителя в интернете (веб-поиск,
// серверный инструмент Anthropic). Результат — весь состав на 100 г: БЖУ,
// сахар, клетчатка, витамины, минералы, вещества для ЖКТ и спортивные
// (кофеин, креатин…) — строго по схеме (strict tool use).
import {
  getUser, tierOf, spentThisPeriod, reserve, settle, callClaude, costOf, periodKey, budgetForTier, roughTokens,
} from './_shared.js'
import {
  BARCODE_CHECK_MODEL, BARCODE_CHECK_EFFORT, BARCODE_CHECK_SEARCHES, MAX_OUTPUT_TOKENS, IMAGE_TOKENS,
  WEB_SEARCH_MICRO, estimateCost,
} from '../../src/lib/aiBudget.js'
import { barcodeVariants } from '../../src/lib/barcode.js'
import { LANGUAGES } from '../../src/locales/registry.js'
import { TIER } from '../../src/lib/subscription.js'
import { MICRONUTRIENTS } from '../../src/lib/micronutrients.js'

const OFF_TIMEOUT_MS = 8000
// Open Food Facts просит, чтобы приложение представлялось. Контактов человека
// сюда не кладём — только имя приложения.
const OFF_USER_AGENT = 'EatAps/1.0 (barcode check)'

// Фото — только с серверов самой базы и только https: модель скачивает
// картинку по ссылке, и посторонний адрес превратил бы её в загрузчик чего угодно.
const IMAGE_HOSTS = new Set(['images.openfoodfacts.org', 'static.openfoodfacts.org'])
const MAX_IMAGES = 2

// Весь разбор — в пределах этого времени: модель с поиском может думать
// долго, а человек ждёт на экране количества. Дальше — честный отказ.
const DEADLINE_MS = 55_000
// Сколько раз продолжать ход, который сервер Anthropic поставил на паузу
// (stop_reason: pause_turn — длинная цепочка поисков).
const MAX_RESUMES = 2

const REPORT_TOOL = 'report_check'

// Из записи базы модели не нужны оценки и служебные показатели — только состав.
const NUTRIENT_SKIP = /^(nova-group|nutrition-score|fruits-vegetables|carbon-footprint|energy-from-fat)/
const MICRO_KEYS = MICRONUTRIENTS.map((d) => d.key)
const MICRO_UNIT = Object.fromEntries(MICRONUTRIENTS.map((d) => [d.key, d.unit]))
const UNIT_EN = { 'мг': 'mg', 'мкг': 'mcg', 'г': 'g', 'млрд КОЕ': 'billion CFU' }

export const FIELDS = ['name', 'unit', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'servingSize', 'packSize', 'micros']
const PER100 = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber']
const SOURCES = ['label_photo', 'database', 'web', 'typical_values']

const NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] }

// Схема отчёта. Все поля обязательны, неизвестное — null: так модель не может
// «забыть» поле, а мы не путаем «не знаю» с «ноль». Микронутриенты — списком
// пар «ключ — количество на 100 г»: только то, что заявлено на этикетке или
// у производителя.
export const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'name', 'unit', 'per100', 'micros', 'servingSize', 'packSize', 'corrections', 'notes', 'sources', 'confidence', 'summary'],
  properties: {
    status: { type: 'string', enum: ['ok', 'corrected', 'filled', 'unverifiable'] },
    name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    unit: { type: 'string', enum: ['g', 'ml'] },
    per100: {
      type: 'object',
      additionalProperties: false,
      required: PER100,
      properties: Object.fromEntries(PER100.map((k) => [k, NUM])),
    },
    micros: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'per100'],
        properties: {
          key: { type: 'string', enum: MICRO_KEYS },
          per100: { type: 'number' },
        },
      },
    },
    servingSize: NUM,
    packSize: NUM,
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'reason'],
        properties: {
          field: { type: 'string', enum: FIELDS },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string', enum: SOURCES } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
  },
}

// ── Open Food Facts ──────────────────────────────────────────────────────────

function offFields(lang) {
  const langs = [...new Set([lang, 'en'])].filter(Boolean)
  return [
    'product_name', ...langs.map((l) => `product_name_${l}`), 'generic_name', 'brands', 'quantity',
    'product_quantity', 'product_quantity_unit', 'serving_size', 'serving_quantity', 'nutrition_data_per',
    'nutriments', 'categories_tags', 'labels_tags', 'ingredients_text', 'image_nutrition_url', 'image_front_url', 'lang',
  ].join(',')
}

export async function fetchOffProduct(code, lang, fetchImpl = fetch) {
  for (const variant of barcodeVariants(code)) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS)
    try {
      const res = await fetchImpl(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(variant)}.json?fields=${offFields(lang)}`,
        { headers: { 'user-agent': OFF_USER_AGENT }, signal: ctrl.signal },
      )
      if (res.status === 404) continue
      if (!res.ok) throw new Error('off_http_' + res.status)
      const data = await res.json()
      if (data?.status === 1 && data.product) return data.product
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

export function safeImageUrl(url) {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && IMAGE_HOSTS.has(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

// Снимки базы бывают в нескольких размерах: «.400.jpg» — превью, «.full.jpg» —
// исходник. Мелкие цифры таблицы состава по превью читаются плохо, поэтому
// сначала просим исходник, а если модель его не скачала — превью.
export function fullSize(url) {
  return typeof url === 'string' ? url.replace(/\.(100|200|400)\.jpg$/, '.full.jpg') : url
}

// Таблица состава — первой: именно по ней сверяются цифры. Лицевая сторона —
// второй: по ней видно, что это за товар, граммы это или миллилитры.
export function productImages(product, { full = true } = {}) {
  return [product?.image_nutrition_url, product?.image_front_url]
    .map(safeImageUrl)
    .filter(Boolean)
    .slice(0, MAX_IMAGES)
    .map((u) => (full ? fullSize(u) : u))
}

// Только то, что относится к делу: название, фасовка, состав. Сотни служебных
// полей базы модели ни к чему, а платим мы за каждый токен.
export function productFacts(product, code) {
  const nutriments = {}
  for (const [k, v] of Object.entries(product?.nutriments || {})) {
    if (!/(_100g|_serving|_unit)$/.test(k) || NUTRIENT_SKIP.test(k)) continue
    if (v !== '' && v != null) nutriments[k] = v
  }
  const pick = (k, max = 200) => (typeof product?.[k] === 'string' && product[k].trim() ? product[k].trim().slice(0, max) : undefined)
  const names = {}
  for (const k of Object.keys(product || {})) {
    if (/^product_name(_[a-z]{2})?$/.test(k) && pick(k)) names[k] = pick(k)
  }
  return {
    barcode: code,
    ...names,
    generic_name: pick('generic_name'),
    brands: pick('brands'),
    quantity: pick('quantity'),
    product_quantity: product?.product_quantity,
    product_quantity_unit: pick('product_quantity_unit'),
    serving_size: pick('serving_size'),
    serving_quantity: product?.serving_quantity,
    nutrition_data_per: pick('nutrition_data_per'),
    categories: (product?.categories_tags || []).slice(0, 8),
    labels: (product?.labels_tags || []).slice(0, 8),
    // Состав — по нему видны подсластители, лактоза, кофеин, пробиотики.
    ingredients: pick('ingredients_text', 1500),
    nutriments,
  }
}

// ── Промпт ───────────────────────────────────────────────────────────────────

export function languageName(code) {
  const l = LANGUAGES.find((x) => x.code === code)
  return l ? l.englishName : 'English'
}

// Системная часть не зависит от товара и языка — она кэшируется (prompt
// caching) вместе с инструментами, и каждая следующая проверка платит за неё
// десятую часть цены.
export const SYSTEM = [
  'You are a nutrition data auditor in a food diary app. A user scanned the barcode of a packaged product.',
  'You get its Open Food Facts record (crowd-sourced and often wrong) and, when available, photos of the package —',
  'the nutrition table photo first. Your job: the correct nutrition facts per 100 g (per 100 ml for drinks) of THIS product.',
  '',
  'Work like an expert, do not copy the database:',
  '1. Read the nutrition table photo carefully. It is the strongest evidence when readable.',
  '2. Check every value for plausibility for this kind of product and against the others:',
  '   kcal ≈ 4·protein + 4·carbs + 9·fat + 2·fiber + 7·alcohol (within ~15%);',
  '   protein + carbs + fat + fiber + salt ≤ 100 g per 100 g; sugar ≤ carbs; saturated fat ≤ fat;',
  '   typical ranges for the category (potato chips have ~3–5 g fiber, not 55 g; cola has ~10 g sugar per 100 ml;',
  '   plain cottage cheese has no fiber). A value that is impossible for the category is an error even if the',
  '   database says so.',
  '3. When something does not add up and the photos do not settle it — or there is no nutrition photo and values',
  '   are missing or suspicious — use web_search to find the manufacturer data for this exact product (barcode,',
  '   brand, name, variant): the official site first, then large retailers. Do not search when a readable label',
  '   photo already confirms the data.',
  '4. Typical database errors to fix: kJ entered as kcal; per-serving values entered as per 100 g; misplaced',
  '   decimal point; g vs ml; swapped fields; values of a different variant or size.',
  '5. Micronutrients: report every vitamin, mineral and other substance that is declared on the label or by the',
  '   manufacturer, per 100 g in the unit given for its key below — fortified cereals, energy drinks (caffeine,',
  '   taurine, B vitamins), protein bars and sports nutrition (creatine, BCAA, EAA, leucine, beta-alanine…), gut',
  '   (probiotics in billion CFU, inulin, psyllium), mineral water (ca, mg, na, k). Sodium goes to "na" in mg',
  '   (salt g × 400). Database micronutrient values are in grams per 100 g — convert to the key unit.',
  '   Never add a micronutrient that is not declared anywhere.',
  '6. notes: up to 4 short facts that matter for the user and are supported by the data — sugar alcohols',
  '   (polyols such as maltitol, sorbitol) that can upset digestion, lactose, sweeteners, a very high caffeine dose,',
  '   a product that is mostly sugar or salt. Empty when there is nothing worth saying.',
  '7. sources: what the final values rest on. confidence: "high" only when a readable label or the manufacturer',
  '   confirms the numbers; "low" when you are guessing.',
  'Never invent numbers; unknown → null. Unit is "ml" only for liquids sold by volume; servingSize and packSize are',
  'in that unit. name: a corrected product name only when the database name is clearly wrong; otherwise null.',
  `Finish by calling ${REPORT_TOOL} exactly once with your result.`,
  '',
  'Micronutrient keys and their units:',
  MICRONUTRIENTS.map((d) => `${d.key} ${UNIT_EN[d.unit] || d.unit}`).join(', '),
].join('\n')

export function buildContent(facts, images, lang) {
  const content = []
  images.forEach((url, i) => {
    content.push({ type: 'text', text: i === 0 && /nutrition/.test(url) ? 'Nutrition table photo:' : `Photo ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'url', url } })
  })
  content.push({
    type: 'text',
    text: `Database record:\n${JSON.stringify(facts)}\n\nWrite every "reason", "note" and the "summary" in ${languageName(lang)}: one short plain sentence each.`,
  })
  return content
}

export const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: BARCODE_CHECK_SEARCHES },
  {
    name: REPORT_TOOL,
    description: 'Report the verified nutrition facts of the scanned product. Call exactly once, at the end.',
    strict: true,
    input_schema: CHECK_SCHEMA,
  },
]

// ── Ответ модели ─────────────────────────────────────────────────────────────

const clampNum = (v, min, max) => {
  const n = Number(v)
  return v == null || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 1000) / 1000
}
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10)
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// Верхняя граница количества вещества на 100 г — по его единице: грамм на
// 100 г больше сотни не бывает, остальное пересчитываем из этого же.
const MICRO_MAX = { 'г': 100, 'мг': 100_000, 'мкг': 100_000_000, 'млрд КОЕ': 100_000 }

// Ответ схеме соответствует, но доверять цифрам вслепую нельзя: модель
// ошибается так же, как люди, наполнявшие базу. Всё вне физических границ —
// null; цифры, не сходящиеся между собой, понижают уверенность до «low», и
// клиент такую проверку не применяет, а только показывает.
export function sanitizeCheck(raw) {
  if (!raw || typeof raw !== 'object') return null
  const per100 = {
    kcal: round1(clampNum(raw.per100?.kcal, 0, 900)),
    protein: round1(clampNum(raw.per100?.protein, 0, 100)),
    carbs: round1(clampNum(raw.per100?.carbs, 0, 100)),
    sugar: round1(clampNum(raw.per100?.sugar, 0, 100)),
    fat: round1(clampNum(raw.per100?.fat, 0, 100)),
    satFat: round1(clampNum(raw.per100?.satFat, 0, 100)),
    fiber: round1(clampNum(raw.per100?.fiber, 0, 100)),
  }
  const micros = {}
  for (const m of Array.isArray(raw.micros) ? raw.micros : []) {
    const unit = MICRO_UNIT[m?.key]
    if (!unit) continue
    const v = clampNum(m.per100, 0, MICRO_MAX[unit] ?? 100_000)
    if (v != null && v > 0) micros[m.key] = v
  }

  let confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low'
  const { kcal, protein, carbs, fat, fiber } = per100
  if ([protein, carbs, fat].every((v) => v != null)) {
    const saltG = (micros.na || 0) / 400
    // Клетчатка не больше углеводов может уже входить в них (американская
    // этикетка) — тогда второй раз её к массе не прибавляем.
    const extraFiber = fiber != null && fiber > carbs ? fiber : 0
    if (protein + carbs + fat + extraFiber + saltG > 105) confidence = 'low'
    if (kcal != null) {
      const fromMacros = protein * 4 + carbs * 4 + fat * 9
      if (Math.abs(kcal - fromMacros) > Math.max(60, fromMacros * 0.35) && kcal < fromMacros) confidence = 'low'
    }
  }
  if (per100.sugar != null && carbs != null && per100.sugar > carbs + 0.5) confidence = 'low'
  if (per100.satFat != null && fat != null && per100.satFat > fat + 0.5) confidence = 'low'
  // Вещества в граммах вместе тоже не могут весить больше самого продукта.
  const gramMicros = Object.entries(micros).filter(([k]) => MICRO_UNIT[k] === 'г').reduce((s, [, v]) => s + v, 0)
  if (gramMicros > 100) confidence = 'low'

  const status = ['ok', 'corrected', 'filled', 'unverifiable'].includes(raw.status) ? raw.status : 'unverifiable'
  const corrections = (Array.isArray(raw.corrections) ? raw.corrections : [])
    .filter((c) => FIELDS.includes(c?.field))
    .slice(0, 16)
    .map((c) => ({ field: c.field, reason: str(c.reason, 200) }))
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).map((n) => str(n, 200)).filter(Boolean).slice(0, 4)
  const sources = [...new Set((Array.isArray(raw.sources) ? raw.sources : []).filter((x) => SOURCES.includes(x)))]
  return {
    status,
    name: str(raw.name, 120) || null,
    unit: raw.unit === 'ml' ? 'ml' : 'g',
    per100,
    micros,
    servingSize: round1(clampNum(raw.servingSize, 1, 5000)),
    packSize: round1(clampNum(raw.packSize, 1, 10000)),
    corrections,
    notes,
    sources,
    confidence,
    summary: str(raw.summary, 300),
  }
}

// Отчёт — вызов инструмента report_check. Модель могла ответить и текстом
// (JSON без вызова) — разбираем и его, но только целиком.
export function reportOf(data) {
  const block = (data?.content || []).find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL)
  if (block?.input) return block.input
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  try { return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return null }
}

export function parseCheck(data) {
  if (data?.stop_reason === 'refusal' || data?.stop_reason === 'max_tokens') return null
  return sanitizeCheck(reportOf(data))
}

export function addUsage(a, b) {
  if (!b) return a
  const out = { ...a }
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    out[k] = (out[k] || 0) + (b[k] || 0)
  }
  out.server_tool_use = {
    web_search_requests: (a.server_tool_use?.web_search_requests || 0) + (b.server_tool_use?.web_search_requests || 0),
  }
  return out
}

// Один разговор с моделью до отчёта: продолжение хода на паузе (длинная
// цепочка поисков) и одна просьба вызвать отчёт, если модель закончила
// словами. Расход складывается по всем запросам.
export async function runCheck({ ask, content, deadline = Date.now() + DEADLINE_MS }) {
  let messages = [{ role: 'user', content }]
  let usage = {}
  let resumes = 0
  let nudged = false
  for (;;) {
    const left = deadline - Date.now()
    if (left < 5000) return { data: null, usage }
    let data
    try {
      data = await ask({ messages, timeoutMs: left })
    } catch (e) {
      e.usage = addUsage(usage, e.usage)
      throw e
    }
    usage = addUsage(usage, data.usage)
    if (data.stop_reason === 'pause_turn' && resumes < MAX_RESUMES) {
      // Сервер сам продолжит ход по последнему блоку — новых слов не добавляем.
      messages = [...messages, { role: 'assistant', content: data.content }]
      resumes++
      continue
    }
    if (reportOf(data) || nudged || data.stop_reason !== 'end_turn') return { data, usage }
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: `Now call ${REPORT_TOOL} with your result.` },
    ]
    nudged = true
  }
}

// ── Обработчик ───────────────────────────────────────────────────────────────

const unavailable = (res) => res.status(503).json({ error: 'accounting_unavailable', message: 'AI is temporarily unavailable.' })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const tier = await tierOf(user.id)
  if (tier !== TIER.AI_PREMIUM) return res.status(403).json({ error: 'premium_required' })

  const code = String(req.body?.code || '').replace(/\D/g, '')
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return res.status(400).json({ error: 'bad_code' })
  const lang = LANGUAGES.some((l) => l.code === req.body?.lang) ? req.body.lang : 'en'

  let product
  try {
    product = await fetchOffProduct(code, lang)
  } catch {
    return res.status(502).json({ error: 'upstream', message: 'Open Food Facts did not answer.' })
  }
  if (!product) return res.status(404).json({ error: 'not_found' })

  const facts = productFacts(product, code)
  const model = BARCODE_CHECK_MODEL
  const maxTokens = MAX_OUTPUT_TOKENS.barcode
  const period = periodKey()
  // Неизменная часть запроса — инструменты и системный промпт — кэшируется.
  const system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }]

  let spent
  try {
    spent = await spentThisPeriod(user.id, period)
  } catch {
    return unavailable(res)
  }

  // Лимита у Premium нет, но расход учитывается так же, как везде: резерв по
  // верхней оценке до запроса и расчёт по факту после. Поиск добавляет к входу
  // найденные страницы — закладываем на них запас.
  const reserved = estimateCost({
    inputTokens: roughTokens(SYSTEM) + roughTokens(JSON.stringify(facts)) + IMAGE_TOKENS * MAX_IMAGES + 30_000,
    maxOutputTokens: maxTokens,
    model,
  }) + WEB_SEARCH_MICRO * BARCODE_CHECK_SEARCHES
  if (!(await reserve(user.id, reserved, period))) return unavailable(res)

  const ask = ({ messages, timeoutMs }) => callClaude({
    model, system, messages, maxTokens, timeoutMs,
    effort: BARCODE_CHECK_EFFORT,
    tools: TOOLS,
  })

  // Фото: сначала исходники (мелкие цифры), потом превью, потом без фото.
  // 400 — запрос отвергнут до генерации (токены не потрачены): чаще всего база
  // уже удалила снимок или исходник слишком велик для скачивания.
  const attempts = [productImages(product, { full: true }), productImages(product, { full: false }), []]
    .filter((imgs, i, all) => i === 0 || JSON.stringify(imgs) !== JSON.stringify(all[i - 1]))

  const deadline = Date.now() + DEADLINE_MS
  let result = null
  let usage = {}
  try {
    for (let i = 0; i < attempts.length; i++) {
      try {
        result = await runCheck({ ask, content: buildContent(facts, attempts[i], lang), deadline })
        usage = addUsage(usage, result.usage)
        break
      } catch (e) {
        usage = addUsage(usage, e.usage)
        if (e.status !== 400 || i === attempts.length - 1) throw e
      }
    }
  } catch (e) {
    await settle(user.id, { reserved, actual: costOf(usage, model) }, period)
    const status = [429, 529, 504].includes(e.status) ? 503 : 502
    return res.status(status).json({ error: 'upstream', message: 'Could not check the product.' })
  }

  const cost = costOf(usage, model)
  await settle(user.id, { reserved, actual: cost }, period)

  const check = result?.data ? parseCheck(result.data) : null
  if (!check) return res.status(502).json({ error: 'upstream', message: 'Could not check the product.' })

  const budget = budgetForTier(tier)
  return res.status(200).json({
    check,
    usage: {
      spentMicro: spent + cost,
      remainingMicro: budget === null ? null : Math.max(0, budget - spent - cost),
      budgetMicro: budget,
      period,
    },
  })
}
