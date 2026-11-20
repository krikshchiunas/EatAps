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
// Open Food Facts наполняют люди, и типичные ошибки там одни и те же:
// килоджоули в поле «ккал», значения «на порцию» в поле «на 100 г», сдвиг
// запятой, граммы вместо миллилитров, пустой состав. Модель сверяет цифры
// между собой и с фото таблицы состава с упаковки (база хранит его снимок) и
// возвращает исправленные значения строго по JSON-схеме (structured outputs).
// Модель — самая дешёвая из подходящих (BARCODE_CHECK_MODEL в aiBudget.js).
import {
  getUser, tierOf, spentThisPeriod, reserve, settle, callClaude, costOf, periodKey, budgetForTier, roughTokens,
} from './_shared.js'
import {
  BARCODE_CHECK_MODEL, BARCODE_CHECK_EFFORT, MAX_OUTPUT_TOKENS, IMAGE_TOKENS, estimateCost,
} from '../../src/lib/aiBudget.js'
import { barcodeVariants } from '../../src/lib/barcode.js'
import { LANGUAGES } from '../../src/locales/registry.js'
import { TIER } from '../../src/lib/subscription.js'

const OFF_TIMEOUT_MS = 8000
// Open Food Facts просит, чтобы приложение представлялось. Контактов человека
// сюда не кладём — только имя приложения.
const OFF_USER_AGENT = 'EatAps/1.0 (barcode check)'

// Фото — только с серверов самой базы и только https: модель скачивает
// картинку по ссылке, и посторонний адрес превратил бы её в загрузчик чего угодно.
const IMAGE_HOSTS = new Set(['images.openfoodfacts.org', 'static.openfoodfacts.org'])
const MAX_IMAGES = 2

const NUTRIENT_KEY = /^(energy(-kcal|-kj)?|proteins|carbohydrates|sugars|fat|saturated-fat|fiber|alcohol)(_100g|_serving|_unit|_value)?$/

export const FIELDS = ['name', 'unit', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'servingSize', 'packSize']
const PER100 = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber']

const NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] }

// Схема ответа. Все поля обязательны, неизвестное — null: так модель не может
// «забыть» поле, а мы не путаем «не знаю» с «ноль».
export const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'name', 'unit', 'per100', 'servingSize', 'packSize', 'corrections', 'confidence', 'summary'],
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
    'nutriments', 'categories_tags', 'image_nutrition_url', 'image_front_url', 'lang',
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

// Таблица состава — первой: именно по ней сверяются цифры. Лицевая сторона —
// второй: по ней видно, что это за товар, граммы это или миллилитры.
export function productImages(product) {
  return [product?.image_nutrition_url, product?.image_front_url]
    .map(safeImageUrl)
    .filter(Boolean)
    .slice(0, MAX_IMAGES)
}

// Только то, что относится к делу: название, фасовка, состав. Сотни служебных
// полей базы модели ни к чему, а платим мы за каждый токен.
export function productFacts(product, code) {
  const nutriments = {}
  for (const [k, v] of Object.entries(product?.nutriments || {})) {
    if (NUTRIENT_KEY.test(k) && v !== '' && v != null) nutriments[k] = v
  }
  const pick = (k) => (typeof product?.[k] === 'string' && product[k].trim() ? product[k].trim().slice(0, 200) : undefined)
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
    nutriments,
  }
}

// ── Промпт ───────────────────────────────────────────────────────────────────

export function languageName(code) {
  const l = LANGUAGES.find((x) => x.code === code)
  return l ? l.englishName : 'English'
}

export function buildSystem(lang) {
  return [
    'You check nutrition data of a packaged food product that a user scanned by barcode.',
    'The data comes from Open Food Facts, a crowd-sourced database, and is often wrong.',
    'Typical errors: kilojoules entered as kcal; per-serving values entered as per-100 g; a shifted decimal point;',
    'grams vs millilitres mixed up; sugar larger than carbohydrates; saturated fat larger than fat; missing values.',
    '',
    'Use, in this order of trust: the nutrition table photo (if attached), the other photos, then the database fields.',
    'Check physical consistency: kcal ≈ 4·protein + 4·carbs + 9·fat (+ 7·alcohol, + 2·fiber), within about 15%.',
    'Never invent numbers. If a value is unknown and cannot be read from a photo, return null.',
    'If nothing is wrong, return the database values unchanged with status "ok" and an empty corrections list.',
    'Use status "corrected" when you changed values, "filled" when the database had no nutrition data and you',
    'read it from a photo, "unverifiable" when there is not enough data to say anything.',
    'All nutrient values are per 100 g (or per 100 ml for drinks); unit is "ml" only for liquids sold by volume.',
    'servingSize and packSize are in the same unit; null if unknown.',
    'name: a corrected product name only when the database name is clearly wrong or garbage; otherwise null.',
    'confidence: "high" when a readable nutrition table confirms the numbers, "low" when you are guessing.',
    `Write every "reason" and the "summary" in ${languageName(lang)}, one short sentence each, plain words.`,
  ].join('\n')
}

export function buildContent(facts, images) {
  const content = []
  images.forEach((url, i) => {
    content.push({ type: 'text', text: i === 0 && /nutrition/.test(url) ? 'Nutrition table photo:' : `Photo ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'url', url } })
  })
  content.push({ type: 'text', text: `Database record:\n${JSON.stringify(facts)}` })
  return content
}

// ── Ответ модели ─────────────────────────────────────────────────────────────

const clampNum = (v, min, max) => {
  const n = Number(v)
  return v == null || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 10) / 10
}
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// Ответ схеме соответствует, но доверять цифрам вслепую нельзя: модель
// ошибается так же, как люди, наполнявшие базу. Всё вне физических границ —
// null; цифры, не сходящиеся между собой, понижают уверенность до «low», и
// клиент такую проверку не применяет, а только показывает.
export function sanitizeCheck(raw) {
  if (!raw || typeof raw !== 'object') return null
  const per100 = {
    kcal: clampNum(raw.per100?.kcal, 0, 900),
    protein: clampNum(raw.per100?.protein, 0, 100),
    carbs: clampNum(raw.per100?.carbs, 0, 100),
    sugar: clampNum(raw.per100?.sugar, 0, 100),
    fat: clampNum(raw.per100?.fat, 0, 100),
    satFat: clampNum(raw.per100?.satFat, 0, 100),
    fiber: clampNum(raw.per100?.fiber, 0, 100),
  }
  let confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low'
  const { kcal, protein, carbs, fat } = per100
  if ([protein, carbs, fat].every((v) => v != null)) {
    if (protein + carbs + fat > 105) confidence = 'low'
    if (kcal != null) {
      const fromMacros = protein * 4 + carbs * 4 + fat * 9
      if (Math.abs(kcal - fromMacros) > Math.max(60, fromMacros * 0.35) && kcal < fromMacros) confidence = 'low'
    }
  }
  if (per100.sugar != null && carbs != null && per100.sugar > carbs + 0.5) confidence = 'low'
  if (per100.satFat != null && fat != null && per100.satFat > fat + 0.5) confidence = 'low'

  const status = ['ok', 'corrected', 'filled', 'unverifiable'].includes(raw.status) ? raw.status : 'unverifiable'
  const corrections = (Array.isArray(raw.corrections) ? raw.corrections : [])
    .filter((c) => FIELDS.includes(c?.field))
    .slice(0, 12)
    .map((c) => ({ field: c.field, reason: str(c.reason, 200) }))
  return {
    status,
    name: str(raw.name, 120) || null,
    unit: raw.unit === 'ml' ? 'ml' : 'g',
    per100,
    servingSize: clampNum(raw.servingSize, 1, 5000),
    packSize: clampNum(raw.packSize, 1, 10000),
    corrections,
    confidence,
    summary: str(raw.summary, 300),
  }
}

export function parseCheck(data) {
  if (data?.stop_reason === 'refusal' || data?.stop_reason === 'max_tokens') return null
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  try {
    return sanitizeCheck(JSON.parse(text))
  } catch {
    return null
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
  const images = productImages(product)
  const system = buildSystem(lang)
  const messages = [{ role: 'user', content: buildContent(facts, images) }]
  const model = BARCODE_CHECK_MODEL
  const maxTokens = MAX_OUTPUT_TOKENS.barcode
  const period = periodKey()

  let spent
  try {
    spent = await spentThisPeriod(user.id, period)
  } catch {
    return unavailable(res)
  }

  // Лимита у Premium нет, но расход учитывается так же, как везде: резерв по
  // верхней оценке до запроса и расчёт по факту после.
  const reserved = estimateCost({
    inputTokens: roughTokens(system) + roughTokens(JSON.stringify(facts)) + IMAGE_TOKENS * images.length,
    maxOutputTokens: maxTokens,
    model,
  })
  if (!(await reserve(user.id, reserved, period))) return unavailable(res)

  const ask = (opts) => callClaude({
    model, system, maxTokens,
    effort: BARCODE_CHECK_EFFORT,
    format: { type: 'json_schema', schema: CHECK_SCHEMA },
    ...opts,
  })

  let data
  try {
    try {
      data = await ask({ messages })
    } catch (e) {
      // 400 — запрос отвергнут до генерации (токены не потрачены). Чаще всего
      // это фото, которое база уже удалила или не отдаёт по ссылке. Проверка по
      // одним цифрам базы всё равно полезна: повторяем без фото.
      if (e.status !== 400 || !images.length) throw e
      data = await ask({ messages: [{ role: 'user', content: buildContent(facts, []) }] })
    }
  } catch (e) {
    await settle(user.id, { reserved, actual: e.usage ? costOf(e.usage, model) : 0 }, period)
    const status = [429, 529, 504].includes(e.status) ? 503 : 502
    return res.status(status).json({ error: 'upstream', message: 'Could not check the product.' })
  }

  const cost = costOf(data.usage, model)
  await settle(user.id, { reserved, actual: cost }, period)

  const check = parseCheck(data)
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
