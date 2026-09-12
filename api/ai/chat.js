// POST /api/ai/chat — текстовый диалог с ассистентом.
//
// Тело: { messages: [{role, text}], context: {...}, tone, prefs }
// Ответ: { reply, ask, cards, memory, usage: { spentMicro, remainingMicro } }
//
// История диалога приходит с клиента: сессии на сервере нет. Это осознанно —
// дневник и так живёт на устройстве, а хранить ещё и переписку значило бы
// завести вторую копию личных данных без всякой пользы. Обрезаем историю до
// последних сообщений: и ради денег, и потому что ассистенту не нужен вчерашний
// разговор, чтобы посчитать сегодняшний ужин.
import {
  getUser, tierOf, callWithBudget, parseReply, budgetError,
  modelForTier,
  MAX_OUTPUT_TOKENS, roughTokens,
  buildSystemPrompt, buildUserContext, resolveTone, capContext,
} from './_shared.js'

const MAX_HISTORY = 12
const MAX_TEXT = 4000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const body = req.body || {}
  const history = Array.isArray(body.messages) ? body.messages.slice(-MAX_HISTORY) : []
  if (!history.length) return res.status(400).json({ error: 'empty_request' })

  const tier = await tierOf(user.id)
  const model = modelForTier(tier)

  const system = buildSystemPrompt({ tone: resolveTone(body.prefs).id, sub: { tier, status: 'active' } })
  const context = capContext(buildUserContext(body.context || {}))

  // Контекст — отдельная первая реплика пользователя, а не приклеенный к его
  // первому вопросу текст: иначе приветствие ассистента, если оно попало в
  // историю, уезжало бы в модель как слова человека.
  const turns = history
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.text || '').slice(0, MAX_TEXT),
    }))
    .filter((m) => m.content)

  // Первой репликой обязан быть пользователь — обрезаем ведущие ответы ассистента.
  while (turns.length && turns[0].role === 'assistant') turns.shift()
  if (!turns.length) return res.status(400).json({ error: 'empty_request' })

  const messages = context ? [{ role: 'user', content: context }, ...turns] : turns
  const inputTokens = roughTokens(system) + messages.reduce((n, m) => n + roughTokens(m.content), 0)

  let result
  try {
    // Резерв, вызов и расчёт — одной операцией. Решение «хватает ли лимита»
    // принимает база внутри списания, поэтому параллельные запросы не могут
    // пройти проверку по одному и тому же остатку.
    result = await callWithBudget({
      userId: user.id, tier, kind: 'chat', model, system, messages,
      inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS.chat,
    })
  } catch (e) {
    const status = [429, 529, 504].includes(e.status) ? 503 : 502
    return res.status(status).json({ error: 'upstream', message: 'Ассистент сейчас недоступен. Попробуйте через минуту.' })
  }

  if (result.denied === 'exhausted') {
    return budgetError(res, { reason: 'exhausted', remaining: 0 }, tier)
  }
  if (result.denied) {
    return res.status(503).json({
      error: 'accounting_unavailable',
      message: 'Ассистент временно недоступен. Попробуйте позже.',
    })
  }

  return res.status(200).json({ ...parseReply(result.data), usage: result.usage })
}
