// ─────────────────────────────────────────────────────────────────────────────
// Общий слой AI-эндпоинтов: кто спрашивает, на что имеет право, сколько уже
// потратил и во что обошёлся ответ.
//
// Порядок здесь не случаен и менять его нельзя:
//   1. проверили токен пользователя,
//   2. взяли тариф из БАЗЫ (не из тела запроса — иначе AI+ включается руками),
//   3. посчитали остаток бюджета,
//   4. отказали ДО вызова модели, если не хватает,
//   5. вызвали модель,
//   6. записали фактический расход.
//
// Шаг 6 выполняется даже при ошибке разбора ответа: токены уже потрачены, и
// не записать их — значит подарить обходной путь через оборванные запросы.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  modelForTier, budgetForTier, checkBudget, costOf, periodKey, effortFor, estimateCost,
  MAX_OUTPUT_TOKENS, roughTokens, IMAGE_TOKENS,
} from '../../src/lib/aiBudget.js'
import { buildSystemPrompt, buildUserContext, resolveTone } from '../../src/lib/aiPrompt.js'
import { activeGrant, bestTier } from '../../src/lib/subscription.js'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

let _admin
export function admin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

export async function getUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  const token = String(auth).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await admin().auth.getUser(token)
  if (error) return null
  return data?.user || null
}

// Тариф читаем из базы. Всё, что пришло с фронта, — заявка, а не факт.
//
// Источников доступа два и они равноправны: подписка Stripe и промокод.
// Берём лучший — тем же правилом, что и клиент (bestTier), чтобы экран и
// лимиты не разошлись в оценке того, что человеку положено.
export async function tierOf(userId) {
  const db = admin()
  const [sub, grants] = await Promise.all([
    db.from('subscriptions').select('tier, status').eq('user_id', userId).maybeSingle(),
    db.from('promo_grants').select('tier, granted_until, code')
      .eq('user_id', userId).gt('granted_until', new Date().toISOString()),
  ])

  const row = sub.data
  const active = row && ['active', 'trialing', 'past_due'].includes(row.status)
  const stripeTier = active ? (row.tier || 'FREE') : 'FREE'

  const grant = activeGrant(grants.data || [])
  return bestTier(stripeTier, grant?.tier || 'FREE')
}

// Расход за период. Ошибку НЕ проглатываем: раньше здесь возвращался ноль, и
// недоступная таблица учёта означала бы не «сбой», а «лимитов больше нет» —
// каждый пользователь тратил бы ключ владельца без потолка. Отказать дороже,
// чем раздать бесплатный доступ к платной модели.
export async function spentThisPeriod(userId, period = periodKey()) {
  const { data, error } = await admin()
    .from('ai_usage')
    .select('spent_micro')
    .eq('user_id', userId)
    .eq('period', period)
    .maybeSingle()
  if (error) {
    const err = new Error(`ai_usage unavailable: ${error.message}`)
    err.code = 'accounting_unavailable'
    throw err
  }
  return Number(data?.spent_micro || 0)
}

// ── Учёт расхода ─────────────────────────────────────────────────────────────
//
// ⚠ ЗДЕСЬ БЫЛА ГОНКА, И ОНА СТОИЛА ДЕНЕГ.
//
// Прежний порядок — прочитать расход, решить по прочитанному, списать —
// не атомарен: между чтением и списанием любое число параллельных запросов
// проходит проверку по ОДНОМУ И ТОМУ ЖЕ остатку. Сто одновременных запросов
// на тарифе с лимитом в три проходили все сто.
//
// Теперь решение принимает БАЗА, внутри той же операции, что и списание
// (см. ai_reserve в миграции 2026-09-12_ai_ledger). Здесь остаётся только
// передать потолок и разобрать ответ.
//
// Второе свойство — идемпотентность. У каждого запроса свой идентификатор:
// повторная заявка с тем же id не списывает дважды, а повторный расчёт не
// возвращает дважды.

export function newRequestId() {
  return randomUUID()
}

// Резерв верхней оценки. Возвращает:
//   { ok: true, spent, remaining } — можно звать модель;
//   { ok: false, reason: 'exhausted' } — лимит исчерпан;
//   { ok: false, reason: 'unavailable' } — учёт недоступен, звать нельзя.
export async function reserve({ requestId, userId, period, micro, budget, kind, db = null }) {
  const { data, error } = await (db || admin()).rpc('ai_reserve', {
    p_request_id: requestId,
    p_user_id: userId,
    p_period: period,
    p_micro: Math.max(0, Math.round(Number(micro) || 0)),
    p_budget: budget === null || budget === undefined ? null : Math.round(budget),
    p_kind: kind || 'chat',
  })
  if (error) {
    // Учёт недоступен — отказываем. Пустить запрос значило бы работать без
    // лимита за счёт владельца ключа: отказать дешевле.
    console.error('[ai] резерв не записан', { userId, error: error.message })
    return { ok: false, reason: 'unavailable' }
  }
  return data || { ok: false, reason: 'unavailable' }
}

// Расчёт по факту. Провал записи не должен ронять уже полученный ответ, но
// обязан быть виден в логах: зависший резерв вернёт ai_reconcile.
export async function settle({ requestId, actualMicro, db = null }) {
  const { data, error } = await (db || admin()).rpc('ai_settle', {
    p_request_id: requestId,
    p_actual_micro: Math.max(0, Math.round(Number(actualMicro) || 0)),
  })
  if (error) {
    console.error('[ai] расчёт не записан — резерв вернёт сверка', {
      requestId, error: error.message,
    })
    return { ok: false }
  }
  return data || { ok: true }
}

// ── Полный путь одного обращения к модели ────────────────────────────────────
// Резерв → вызов → расчёт. Вынесено сюда, потому что chat и vision отличаются
// только составом сообщений: держать эту последовательность в двух местах
// значит рано или поздно поправить её в одном.
//
// Резерв возвращается ВСЕГДА, в том числе при ошибке модели: часть токенов
// могла сгореть, за них платит пользователь, остальное возвращается. Не
// списать вовсе — значит сделать обрыв на середине способом обойти лимит.
export async function callWithBudget({
  userId, tier, kind, model, system, messages, inputTokens, maxOutputTokens,
  // Зависимости приходят параметрами, чтобы весь путь можно было прогнать
  // тестом без настоящей базы и без обращения к модели.
  db = null, call = callClaude,
}) {
  const period = periodKey()
  const budget = budgetForTier(tier)
  const needed = estimateCost({ inputTokens, maxOutputTokens, model })
  const requestId = newRequestId()

  const reserved = await reserve({
    requestId, userId, period, micro: needed, budget, kind, db,
  })
  if (!reserved.ok) {
    return { denied: reserved.reason || 'unavailable', period, budget, spent: reserved.spent ?? 0 }
  }

  let data
  try {
    data = await call({ model, system, messages, maxTokens: maxOutputTokens })
  } catch (e) {
    const burned = e.usage ? costOf(e.usage, model) : 0
    await settle({ requestId, actualMicro: burned, db })
    throw e
  }

  const cost = costOf(data.usage, model)
  const settled = await settle({ requestId, actualMicro: cost, db })
  // spent берём из ответа расчёта — это фактическое состояние счётчика после
  // записи, а не наша оценка.
  const spent = typeof settled?.spent === 'number' ? settled.spent : (reserved.spent ?? 0)

  return {
    data,
    usage: {
      spentMicro: spent,
      remainingMicro: budget === null ? null : Math.max(0, budget - spent),
      budgetMicro: budget,
      period,
    },
  }
}

// Свой таймаут, заметно короче платформенного. Дело не в вежливости к
// пользователю: если функцию убьёт платформа, код после fetch не выполнится
// НИКОГДА — а значит, зарезервированные деньги не вернутся на счёт. Обрывая
// запрос сами, мы гарантированно попадаем в catch и делаем возврат.
const REQUEST_TIMEOUT_MS = 60_000

// Единственное место, где мы ходим в Anthropic.
export async function callClaude({ model, system, messages, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')

  const effort = effortFor(model)
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), REQUEST_TIMEOUT_MS)

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: stop.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(effort ? { output_config: { effort } } : {}),
      }),
    })
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'Anthropic timeout' : e.message)
    err.status = 504
    err.usage = null // ответа не было — возвращаем резерв целиком
    throw err
  } finally {
    clearTimeout(timer)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Anthropic ${res.status}`)
    err.status = res.status
    err.usage = data?.usage || null
    throw err
  }
  return data
}

// Контекст собирает клиент, а значит его размер задаёт клиент. Свой бюджет
// человек этим и так спалит (оценка считается по фактической длине), но принимать
// мегабайты в модель незачем: режем по верхней границе разумного дневника.
export const MAX_CONTEXT_CHARS = 24_000

export function capContext(text) {
  const s = String(text || '')
  return s.length > MAX_CONTEXT_CHARS ? s.slice(0, MAX_CONTEXT_CHARS) : s
}

// Ответ модели — JSON по контракту из aiPrompt.js. Модель иногда оборачивает
// его в ```json — снимаем обёртку, но не «чиним» содержимое: если пришёл мусор,
// честнее показать запасной текст, чем угадывать смысл.
// Достаём поле reply из ОБОРВАННОГО JSON. Ответ упирается в max_tokens, и
// тогда строка обрывается на полуслове: JSON.parse на такое падает, а показывать
// человеку `{"reply": "Твой завтрак...` — стыдно. Забираем текст, который модель
// успела написать, и разворачиваем экранирование.
function salvageReply(text) {
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text)
  if (!m) return null
  const raw = m[1]
  try {
    // Закрываем строку сами — JSON.parse сделает всё разэкранирование за нас.
    return String(JSON.parse(`"${raw}"`)).trim() || null
  } catch {
    return raw.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() || null
  }
}

// Модель нередко дублирует уточняющий вопрос: кладёт его и в "reply", и в "ask".
// На экране они склеиваются, и человек читает один и тот же вопрос дважды
// («Уточни: что в бутерброде? Что в бутерброде?»). Убираем повтор из reply —
// каноничным остаётся ask, по нему интерфейс подсвечивает ожидание ответа.
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function dedupeAsk(reply, ask) {
  if (!reply || !ask) return reply
  const askWords = new Set(norm(ask).split(' ').filter(Boolean))
  if (askWords.size < 2) return reply
  // Сравниваем по словам, а не по подстроке: модель любит добавить «Уточни:»
  // или переставить слова, и точное вхождение такой повтор не ловит.
  const kept = (reply.match(/[^.!?…]+[.!?…]*/g) || [reply]).filter((sentence) => {
    const words = norm(sentence).split(' ').filter(Boolean)
    if (!words.length) return false
    if (words.length < 2) return true
    const shared = words.filter((w) => askWords.has(w)).length
    return shared / words.length < 0.7
  })
  return kept.join('').trim()
}

export function parseReply(data) {
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Модель упёрлась в потолок ответа — что бы ни пришло, оно неполное.
  const truncated = data?.stop_reason === 'max_tokens'

  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(stripped)
    const ask = parsed.ask ? String(parsed.ask).trim() : null
    return {
      reply: dedupeAsk(String(parsed.reply || '').trim(), ask),
      ask,
      // Карточки обрезанного ответа не отдаём: последняя из них почти наверняка
      // недописана, а карточка с половиной КБЖУ хуже, чем её отсутствие.
      cards: !truncated && Array.isArray(parsed.cards) ? parsed.cards.slice(0, 10) : [],
      memory: parsed.memory ? String(parsed.memory).slice(0, 300) : null,
      ...(truncated ? { truncated: true } : {}),
    }
  } catch {
    const salvaged = salvageReply(stripped)
    if (salvaged) {
      return { reply: salvaged, ask: null, cards: [], memory: null, truncated: true }
    }
    // Похоже на JSON, но вытащить нечего — сырую разметку человеку не показываем.
    const looksLikeJson = /^[[{]/.test(stripped) || /"reply"\s*:/.test(stripped)
    return {
      reply: (!looksLikeJson && text) || 'Не получилось ответить. Попробуйте ещё раз.',
      ask: null,
      cards: [],
      memory: null,
      malformed: true,
    }
  }
}

// Отказ по лимиту: фронт показывает экран апгрейда, а не «что-то пошло не так».
export function budgetError(res, check, tier) {
  return res.status(402).json({
    error: 'budget_exhausted',
    reason: check.reason,
    tier,
    remainingMicro: check.remaining,
    budgetMicro: budgetForTier(tier),
  })
}

export {
  modelForTier, budgetForTier, checkBudget, costOf, periodKey, effortFor, estimateCost,
  MAX_OUTPUT_TOKENS, roughTokens, IMAGE_TOKENS,
  buildSystemPrompt, buildUserContext, resolveTone,
}
