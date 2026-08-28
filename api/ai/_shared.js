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

import { createClient } from '@supabase/supabase-js'
import {
  modelForTier, budgetForTier, checkBudget, costOf, periodKey, effortFor,
  MAX_OUTPUT_TOKENS, roughTokens, IMAGE_TOKENS,
  dailyBudgetForTier, rateLimitForTier, dayKey, fitHistory, MAX_INPUT_TOKENS,
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

// Суточный расход. Отдельная строка в той же таблице с периодом 'YYYY-MM-DD':
// атомарный инкремент уже написан и проверен, заводить вторую таблицу с той же
// логикой (и той же гонкой, которую там решили) незачем.
//
// Ошибку здесь, в отличие от месячной, НЕ бросаем. Суточный потолок — второй
// слой поверх месячного, а месячный теперь конечен у всех тарифов. Если формат
// периода ещё не расширен миграцией 2026-08-28, честнее работать по месячному
// лимиту и громко написать об этом в лог, чем отключить ассистента всем.
export async function spentToday(userId, day = dayKey()) {
  const { data, error } = await admin()
    .from('ai_usage')
    .select('spent_micro')
    .eq('user_id', userId)
    .eq('period', day)
    .maybeSingle()
  if (error) {
    console.error('ai_usage daily read failed', { userId, day, error: error.message })
    return null
  }
  return Number(data?.spent_micro || 0)
}

// Дельта расхода. Может быть отрицательной — это возврат неизрасходованного
// резерва (см. reserve/settle ниже). count = false у корректировок: запрос уже
// посчитан при резервировании.
export async function recordSpend(userId, micro, period = periodKey(), { count = true } = {}) {
  const delta = Math.round(Number(micro) || 0)
  if (!delta) return
  const { error } = await admin().rpc('ai_usage_add', {
    p_user_id: userId,
    p_period: period,
    p_micro: delta,
    p_count: count,
  })
  // Провал записи не должен ронять ответ, который пользователь уже оплатил
  // своим лимитом, но обязан быть виден в логах: это дыра в учёте.
  if (error) {
    console.error('ai_usage_add failed', { userId, micro: delta, error: error.message })
    return false
  }
  return true
}

// Резерв: списываем верхнюю оценку ДО обращения к модели. Без этого проверка
// «хватает ли остатка» и списание разнесены во времени, и несколько запросов,
// отправленных одновременно, проходят её по одному и тому же остатку.
// Возвращает false, если резерв не записался. Вызывающий обязан прерваться:
// без записи резерва лимит не действует, а деньги уже начнут тратиться.
// Резервируем В ОБА периода сразу. Иначе суточный потолок можно обойти теми же
// параллельными вкладками, от которых защищает месячный резерв.
export async function reserve(userId, micro, period, day = dayKey()) {
  const ok = await recordSpend(userId, micro, period, { count: true })
  if (!ok) return false
  // Провал суточной записи не отменяет запрос: месячный резерв уже стоит, и
  // именно он — обязательная граница. Но это дыра в учёте, и её видно в логе.
  await recordSpend(userId, micro, day, { count: true })
  return true
}

// Расчёт по факту: возвращаем разницу между резервом и реальной ценой.
// Отдельная функция, потому что знак тут неочевиден и легко перепутать
// направление — а перепутанный знак означает потерянные или подаренные деньги.
export async function settle(userId, { reserved, actual }, period, day = dayKey()) {
  const delta = actual - reserved
  await recordSpend(userId, delta, period, { count: false })
  await recordSpend(userId, delta, day, { count: false })
}

// Ограничение частоты. Считает база (см. миграцию 2026-08-28_audit_fixes.sql):
// счётчик в памяти процесса на бессерверной платформе фиктивен — экземпляров
// много, память между ними не общая. Ровно тот урок, который уже записан в
// комментарии к api/feedback.js.
//
// Возвращает true, если запрос разрешён. При недоступности RPC пропускаем:
// перекрывать ассистента из-за сбоя счётчика частоты неправильно — деньги
// всё равно ограничены потолками расхода, а они обязательны.
export async function withinRateLimit(userId, tier) {
  const { data, error } = await admin().rpc('rate_limit_take', {
    p_bucket: 'ai',
    p_key: String(userId),
    p_max: rateLimitForTier(tier),
    p_window: '00:01:00',
  })
  if (error) {
    console.error('rate_limit_take failed', { userId, error: error.message })
    return true
  }
  return data !== false
}

// Действующий бан. Проверяется здесь, а не только в поддержке: забаненный не
// должен тратить бюджет владельца на модель.
export async function isBanned(userId) {
  const { data, error } = await admin()
    .from('bans')
    .select('until')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return false
  return data.until === null || new Date(data.until) > new Date()
}

// ─────────────────────────────────────────────────────────────────────────────
// Единый вход для обоих эндпоинтов.
//
// Проверки идут в одном месте намеренно: chat.js и vision.js повторяли их
// построчно, и любая правка в одном файле молча расходилась со вторым. Ровно
// этот класс расхождения аудит нашёл в политиках app_state.
//
// Порядок важен и менять его нельзя:
//   вход → бан → частота → тариф ИЗ БАЗЫ → остаток → резерв.
// Всё, что пришло из тела запроса, — заявка, а не факт.
// ─────────────────────────────────────────────────────────────────────────────
export async function preflight(req, res, { maxOutputTokens }) {
  const user = await getUser(req)
  if (!user) {
    res.status(401).json({ error: 'unauthorized' })
    return null
  }

  if (await isBanned(user.id)) {
    res.status(403).json({
      error: 'banned',
      message: 'Доступ к ассистенту закрыт. Причина и срок — в настройках приложения.',
    })
    return null
  }

  const tier = await tierOf(user.id)

  if (!(await withinRateLimit(user.id, tier))) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({
      error: 'rate_limited',
      message: 'Слишком часто. Подождите минуту.',
    })
    return null
  }

  const period = periodKey()
  const day = dayKey()

  let spent
  try {
    spent = await spentThisPeriod(user.id, period)
  } catch {
    // Учёт недоступен (не прогнана миграция, лежит база) — отказываем. Пустить
    // запрос значило бы работать без лимита за счёт владельца ключа.
    res.status(503).json({
      error: 'accounting_unavailable',
      message: 'Ассистент временно недоступен. Попробуйте позже.',
    })
    return null
  }

  return {
    user,
    tier,
    period,
    day,
    spent,
    spentDay: await spentToday(user.id, day),
    model: modelForTier(tier),
    maxOutputTokens,
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
        // Системный промпт уходит блоком с cache_control: он стабилен внутри
        // пары «тон + тариф» и повторяется в каждом сообщении диалога, то есть
        // это ровно тот случай, ради которого кэш существует. Порядок рендера
        // (tools → system → messages) ставит его первым, поэтому префикс не
        // ломается переменной частью запроса.
        //
        // costOf уже умеет считать cache_creation/cache_read по множителям
        // 1.25× и 0.1× — до этой правки обе ветки всегда давали ноль, потому
        // что кэш не создавался ни разу. Короткий промпт кэш просто не создаст
        // (минимум около 1024 токенов) — вреда от заголовка при этом нет.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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

// Карточка блюда из ответа модели. Всё, что приходит отсюда, — недоверенные
// данные: модель может вернуть строку вместо числа, отрицательные калории,
// Infinity, объект вместо имени или сотню карточек на один банан.
//
// Раньше карточки уходили в клиент как есть, и приведение делал уже интерфейс
// (AIHomeScreen). Это работало, но означало, что граница валидации проходит по
// UI: любой второй потребитель этого ответа получил бы сырьё. Приводим здесь.
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
const CONFIDENCE = ['high', 'medium', 'low']

// Неотрицательное целое в разумных пределах или null.
const num = (v, max) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(Math.round(n), max)
}

function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  const kcal = num(raw.kcal, 20000)
  // Карточка без имени или без калорий не показывается и не добавляется в
  // дневник — отбрасываем целиком, а не рисуем «undefined, 0 ккал».
  if (!name || kcal == null) return null
  return {
    name,
    grams: num(raw.grams, 100000),
    kcal,
    protein: num(raw.protein, 5000) ?? 0,
    fat: num(raw.fat, 5000) ?? 0,
    carbs: num(raw.carbs, 5000) ?? 0,
    meal: MEALS.includes(raw.meal) ? raw.meal : null,
    confidence: CONFIDENCE.includes(raw.confidence) ? raw.confidence : null,
  }
}

// Ответ модели — JSON по контракту из aiPrompt.js. Модель иногда оборачивает
// его в ```json — снимаем обёртку, но не «чиним» содержимое: если пришёл мусор,
// честнее показать запасной текст, чем угадывать смысл.
export function parseReply(data) {
  const blocks = Array.isArray(data?.content) ? data.content : []
  const text = blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()

  const fallback = (reply) => ({
    reply: reply || 'Не получилось ответить. Попробуйте ещё раз.',
    ask: null, cards: [], memory: null, malformed: true,
  })

  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return fallback(text.slice(0, 4000))
  }

  // JSON.parse('123') и JSON.parse('"текст"') разбираются успешно, но объектом
  // не являются — обращение к .reply дало бы undefined и пустой ответ на экране.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallback(typeof parsed === 'string' ? parsed.trim().slice(0, 4000) : text.slice(0, 4000))
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 4000) : ''
  const ask = typeof parsed.ask === 'string' && parsed.ask.trim()
    ? parsed.ask.trim().slice(0, 500)
    : null
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.slice(0, 10).map(normalizeCard).filter(Boolean)
    : []

  // Пустота во всех трёх полях — это не ответ. Показываем запасной текст, а не
  // пустой пузырь, из которого человеку непонятно, что произошло.
  //
  // ask проверяется наравне с остальными намеренно: по контракту уточняющий
  // вопрос приходит именно так — "reply": "", "cards": [], вопрос в "ask", —
  // и выбросить его как «пустой ответ» значило бы сломать штатный сценарий.
  if (!reply && !ask && !cards.length) return fallback(text.slice(0, 4000))

  return {
    reply,
    ask,
    cards,
    memory: typeof parsed.memory === 'string' && parsed.memory.trim()
      ? parsed.memory.trim().slice(0, 300)
      : null,
  }
}

// Отказ по лимиту: фронт показывает экран апгрейда, а не «что-то пошло не так».
//
// Суточный отказ отличаем от месячного: «лимит на сегодня» и «лимит на месяц» —
// разные новости, и предлагать апгрейд в первом случае неуместно, доступ
// вернётся сам завтра.
export function budgetError(res, check, tier) {
  const daily = check.reason === 'daily_exhausted' || check.reason === 'daily_too_expensive'
  return res.status(402).json({
    error: daily ? 'daily_limit' : 'budget_exhausted',
    reason: check.reason,
    tier,
    remainingMicro: check.remaining,
    budgetMicro: budgetForTier(tier),
    dailyRemainingMicro: check.dailyRemaining ?? null,
    dailyBudgetMicro: dailyBudgetForTier(tier),
  })
}

export {
  modelForTier, budgetForTier, checkBudget, costOf, periodKey, effortFor,
  MAX_OUTPUT_TOKENS, roughTokens, IMAGE_TOKENS,
  dailyBudgetForTier, rateLimitForTier, dayKey, fitHistory, MAX_INPUT_TOKENS,
  buildSystemPrompt, buildUserContext, resolveTone,
}
