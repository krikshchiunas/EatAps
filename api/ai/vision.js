// POST /api/ai/vision — распознавание еды по фотографии.
//
// Тело: { image: { media_type, data }, note, context, tone, prefs }
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

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Считаем ДЛИНУ base64-строки, а не размер исходного файла. У serverless-функции
// потолок тела запроса 4,5 МБ, а base64 раздувает картинку на треть: «5 МБ фото»
// превратились бы в 6,5 МБ тела, и пользователь получил бы глухую платформенную
// ошибку вместо нашего понятного текста. 3,5 МБ строки ≈ 2,6 МБ фото — с запасом
// на остальное тело. Клиент и так жмёт снимок до ~300 КБ (fileToImage).
const MAX_BASE64_CHARS = 3.5 * 1024 * 1024

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const image = req.body?.image
  if (!image?.data || !ALLOWED_TYPES.includes(image.media_type)) {
    return res.status(400).json({ error: 'bad_image', message: 'Нужен JPEG, PNG или WebP.' })
  }
  if (image.data.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'image_too_large', message: 'Фото слишком большое — сожмите его.' })
  }

  const tier = await tierOf(user.id)
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

  const system = buildSystemPrompt({ tone: resolveTone(req.body?.prefs).id, sub: { tier, status: 'active' } })
  const context = capContext(buildUserContext(req.body?.context || {}))
  const note = String(req.body?.note || '').slice(0, 500)

  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
      { type: 'text', text: [context, note || 'Что это за блюдо и сколько в нём КБЖУ?'].filter(Boolean).join('\n\n---\n\n') },
    ],
  }]

  const inputTokens = IMAGE_TOKENS + roughTokens(system) + roughTokens(context) + roughTokens(note)
  const check = checkBudget({ tier, spent, inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS.vision })
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
    data = await callClaude({ model, system, messages, maxTokens: MAX_OUTPUT_TOKENS.vision })
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
