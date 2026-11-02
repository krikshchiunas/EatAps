// POST /api/ai/vision — распознавание еды по фотографии.
//
// Тело: { images: [{ media_type, data }, …], note, context, tone, prefs }
//   (старое { image } тоже принимаем — у кого-то в кэше висит прошлый фронт)
// Ответ тот же, что у чата: { reply, ask, cards, memory, usage }
//
// Картинка приходит base64 в теле, а не ссылкой на storage: фото тарелки не
// должно оседать в облаке ради одного распознавания. Модель его видит, ответ
// возвращается, оригинал остаётся на устройстве пользователя.
import {
  getUser, tierOf, spentThisPeriod, reserve, settle, callClaude, parseReply, budgetError,
  modelForTier, checkBudget, costOf, periodKey, budgetForTier,
  MAX_OUTPUT_TOKENS, roughTokens, IMAGE_TOKENS,
  buildSystemPrompt, buildUserContext, resolveTone, capContext,
} from './_shared.js'
import { maxPhotosForTier } from '../../src/lib/aiBudget.js'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Считаем ДЛИНУ base64-строки, а не размер исходного файла. У serverless-функции
// потолок тела запроса 4,5 МБ, а base64 раздувает картинку на треть: «5 МБ фото»
// превратились бы в 6,5 МБ тела, и пользователь получил бы глухую платформенную
// ошибку вместо нашего понятного текста. 3,5 МБ строки ≈ 2,6 МБ фото — с запасом
// на остальное тело. Клиент и так жмёт снимок до ~300 КБ (fileToImage).
const MAX_BASE64_CHARS = 3.5 * 1024 * 1024
// Несколько фото — один приём пищи с разных сторон или несколько блюд за раз.
// Сколько именно — зависит от тарифа (maxPhotosForTier). Потолок тела запроса
// общий, поэтому ограничиваем и сумму, а не только каждое фото.
const MAX_TOTAL_BASE64_CHARS = 3.8 * 1024 * 1024
// Каждое следующее фото — потенциально ещё блюдо и ещё карточка в ответе.
const EXTRA_OUTPUT_PER_IMAGE = 250

// Достаём список картинок из тела и проверяем его.
// Возвращает { images } или { error, status, message }.
export function readImages(body, maxImages = 1) {
  const raw = Array.isArray(body?.images) ? body.images : body?.image ? [body.image] : []
  if (!raw.length) return { error: 'bad_image', status: 400, message: 'Нужен JPEG, PNG или WebP.' }
  if (raw.length > maxImages) {
    return { error: 'too_many_images', status: 400, max: maxImages, message: `На вашем тарифе — не больше ${maxImages} фото за раз.` }
  }
  let total = 0
  for (const image of raw) {
    if (typeof image?.data !== 'string' || !image.data || !ALLOWED_TYPES.includes(image.media_type)) {
      return { error: 'bad_image', status: 400, message: 'Нужен JPEG, PNG или WebP.' }
    }
    total += image.data.length
    if (image.data.length > MAX_BASE64_CHARS || total > MAX_TOTAL_BASE64_CHARS) {
      return { error: 'image_too_large', status: 413, message: 'Фото слишком большое — сожмите его.' }
    }
  }
  return { images: raw.map(({ media_type, data }) => ({ media_type, data })) }
}

// Содержимое сообщения для модели. Несколько фото подписываем «Фото 1», «Фото 2»
// — так модель может сослаться на конкретный снимок и не путает, что где.
export function buildContent(images, text) {
  const content = []
  images.forEach((image, i) => {
    if (images.length > 1) content.push({ type: 'text', text: `Фото ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } })
  })
  content.push({ type: 'text', text })
  return content
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  // Тариф — до разбора картинок: от него зависит, сколько их можно прислать.
  const tier = await tierOf(user.id)
  const read = readImages(req.body, maxPhotosForTier(tier))
  if (read.error) return res.status(read.status).json({ error: read.error, message: read.message, max: read.max })
  const { images } = read

  const model = modelForTier(tier)
  const period = periodKey()

  let spent
  try {
    spent = await spentThisPeriod(user.id, period)
  } catch {
    // Учёт недоступен (не прогнана миграция, лежит база) — отказываем. Пустить
    // запрос значило бы работать без лимита за счёт владельца ключа.
    return res.status(503).json({
      error: 'accounting_unavailable',
      message: 'Ассистент временно недоступен. Попробуйте позже.',
    })
  }

  const system = buildSystemPrompt({ tone: resolveTone(req.body?.prefs).id, sub: { tier, status: 'active' }, lang: req.body?.lang })
  const context = capContext(buildUserContext(req.body?.context || {}))
  const note = String(req.body?.note || '').slice(0, 500)

  const question = note || (images.length > 1
    ? 'Что за блюда на этих фото и сколько в них КБЖУ? Если на нескольких фото одно и то же блюдо — посчитай его один раз.'
    : 'Что это за блюдо и сколько в нём КБЖУ?')
  const messages = [{
    role: 'user',
    content: buildContent(images, [context, question].filter(Boolean).join('\n\n---\n\n')),
  }]

  const maxTokens = MAX_OUTPUT_TOKENS.vision + EXTRA_OUTPUT_PER_IMAGE * (images.length - 1)
  const inputTokens = IMAGE_TOKENS * images.length + roughTokens(system) + roughTokens(context) + roughTokens(question)
  const check = checkBudget({ tier, spent, inputTokens, maxOutputTokens: maxTokens })
  if (!check.ok) return budgetError(res, check, tier)

  // Резервируем верхнюю оценку до похода в модель — иначе несколько запросов,
  // отправленных одновременно, пройдут проверку по одному и тому же остатку.
  const reserved = check.needed
  if (!(await reserve(user.id, reserved, period))) {
    return res.status(503).json({
      error: 'accounting_unavailable',
      message: 'Ассистент временно недоступен. Попробуйте позже.',
    })
  }

  let data
  try {
    data = await callClaude({ model, system, messages, maxTokens })
  } catch (e) {
    // Упавший запрос мог сжечь токены — платит за них пользователь, остальной
    // резерв возвращаем. Не списать вовсе значило бы сделать обрыв на середине
    // способом обойти лимит.
    await settle(user.id, { reserved, actual: e.usage ? costOf(e.usage, model) : 0 }, period)
    const status = [429, 529, 504].includes(e.status) ? 503 : 502
    return res.status(status).json({ error: 'upstream', message: 'Не удалось разобрать фото. Попробуйте ещё раз.' })
  }

  const cost = costOf(data.usage, model)
  await settle(user.id, { reserved, actual: cost }, period)

  const parsed = parseReply(data)
  const budget = budgetForTier(tier)
  return res.status(200).json({
    ...parsed,
    usage: {
      spentMicro: spent + cost,
      remainingMicro: budget === null ? null : Math.max(0, budget - spent - cost),
      budgetMicro: budget,
      period,
    },
  })
}
