// ─────────────────────────────────────────────────────────────────────────────
// Бюджет AI: сколько токенов пользователю можно сжечь за месяц.
//
// Лимит считается не в сообщениях и не в фотографиях, а в деньгах — иначе он
// врёт. Одно сообщение с разбором месяца стоит как двадцать «сколько белка в
// твороге», и лимит «50 сообщений» в первом случае разоряет, а во втором зря
// отключает человека, который ничего не потратил.
//
// Все суммы — целые микродоллары (1e-6 USD). Никаких float: центов тут мало,
// а ошибка округления, помноженная на десятки тысяч запросов, становится
// реальными деньгами. Приятное совпадение: цена «$N за миллион токенов» — это
// ровно N микродолларов за токен, поэтому таблица цен читается как прайс-лист.
// ─────────────────────────────────────────────────────────────────────────────

import { TIER } from './subscription.js'

export const MICRO = 1_000_000 // микродолларов в долларе

// Цены Anthropic, микродолларов за токен (= долларов за миллион токенов).
// Кэш: запись стоит 1.25× от входа, чтение — 0.1×.
export const PRICES = Object.freeze({
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-6': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
})

// Уровень усилий — medium везде, где модель вообще принимает этот параметр.
// Ответ у нас в 1–3 предложения: заводской high тут переплата, а у AI+ потолка
// расходов нет.
//
// «Везде» имеет границу, которую задаём не мы: Haiku 4.5 параметр effort не
// поддерживает и отвечает на него ошибкой, поэтому ей он не отправляется вовсе.
// Список ниже — именно модели, УМЕЮЩИЕ effort; добавите сюда новую — она
// автоматически получит тот же medium, а не собственное значение.
export const DEFAULT_EFFORT = 'medium'

export const EFFORT_CAPABLE = Object.freeze([
  'claude-sonnet-4-6',
])

export function effortFor(model) {
  return EFFORT_CAPABLE.includes(model) ? DEFAULT_EFFORT : null
}

// Модель по тарифу. FREE и AI живут на Haiku, AI+ — на Sonnet.
export const MODEL_BY_TIER = Object.freeze({
  [TIER.FREE]: 'claude-haiku-4-5',
  [TIER.AI]: 'claude-haiku-4-5',
  [TIER.AI_PLUS]: 'claude-sonnet-4-6',
})

// Месячный потолок расходов на токены, микродолларов.
//
// У AI+ здесь был null, и checkBudget на null отвечал безусловным «можно» —
// то есть у самого дорогого тарифа не было верхней границы вообще. В паре с
// отсутствием ограничения частоты это означало, что один аккаунт (в том числе
// получивший AI+ по промокоду) способен в цикле сжечь счёт владельца в
// Anthropic: запрос на Sonnet с полным контекстом стоит около четырёх центов.
//
// «Без потолка» в описании тарифа и «без потолка» в коде — разные вещи.
// Шестьдесят долларов в месяц человек не израсходует обычным пользованием:
// это больше полутора тысяч разборов дневника. Цифра существует не чтобы
// ограничивать людей, а чтобы у счёта была верхняя граница.
export const MONTHLY_BUDGET = Object.freeze({
  [TIER.FREE]: 1 * MICRO,        // $1.00
  [TIER.AI]: 3.5 * MICRO,        // $3.50
  [TIER.AI_PLUS]: 60 * MICRO,    // $60.00
})

// Суточный подпотолок. Месячного лимита мало: он не мешает израсходовать всё
// за одну ночь скриптом, и владелец узнаёт об этом постфактум. Суточный
// растягивает худший случай и оставляет время заметить.
export const DAILY_BUDGET = Object.freeze({
  [TIER.FREE]: 0.35 * MICRO,     // $0.35
  [TIER.AI]: 1 * MICRO,          // $1.00
  [TIER.AI_PLUS]: 8 * MICRO,     // $8.00
})

// Ограничение частоты, запросов в минуту. Деньги и частота — разные защиты:
// потолок расхода не мешает слать сто запросов в секунду, пока он не выбран,
// а очередь к модели и лимиты Anthropic от этого страдают сразу.
// Считается на сервере через RPC ai_rate_limit_take (см. миграцию
// 2026-08-28_audit_fixes.sql): счётчик в памяти процесса на бессерверной
// платформе не работает — экземпляров много, память между ними не общая.
export const RATE_LIMIT_PER_MIN = Object.freeze({
  [TIER.FREE]: 6,
  [TIER.AI]: 12,
  [TIER.AI_PLUS]: 20,
})

// Жёсткий потолок входа. Контекст режется отдельно (MAX_CONTEXT_CHARS), но
// история диалога приходит от клиента и в сумме может вырасти сверх разумного.
// Здесь верхняя граница на ВЕСЬ вход: то, что не влезло, обрезается по самым
// старым репликам — отказывать человеку целиком из-за длинной переписки хуже,
// чем показать ответ без вчерашнего разговора.
export const MAX_INPUT_TOKENS = 32_000

// Запас, который резервируется до запроса. Реальную цену мы узнаём только из
// ответа, а к тому моменту деньги уже потрачены — поэтому пускаем в модель
// только того, у кого хватает на самый дорогой возможный ответ.
export const MAX_OUTPUT_TOKENS = Object.freeze({
  chat: 700,
  vision: 900,
  digest: 2000, // разбор недели/месяца
})

export function modelForTier(tier) {
  return MODEL_BY_TIER[tier] || MODEL_BY_TIER[TIER.FREE]
}

export function budgetForTier(tier) {
  const b = MONTHLY_BUDGET[tier]
  return b === undefined ? MONTHLY_BUDGET[TIER.FREE] : b
}

// Неизвестный тариф всегда падает на FREE — самый дешёвый и самый строгий.
// Ошибиться в эту сторону безопасно, в обратную — нет.
export function dailyBudgetForTier(tier) {
  const b = DAILY_BUDGET[tier]
  return b === undefined ? DAILY_BUDGET[TIER.FREE] : b
}

export function rateLimitForTier(tier) {
  const n = RATE_LIMIT_PER_MIN[tier]
  return n === undefined ? RATE_LIMIT_PER_MIN[TIER.FREE] : n
}

// Ключ суточного периода — 'YYYY-MM-DD' UTC. Тот же принцип, что у месячного:
// одинаков на всех устройствах независимо от их часового пояса.
export function dayKey(date = new Date()) {
  const d = new Date(date)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

// Расчётный период — календарный месяц в UTC. Не «30 дней с оплаты»: так
// пользователю понятно, когда лимит обнулится, и период одинаков на всех
// устройствах независимо от их часового пояса.
export function periodKey(date = new Date()) {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Неотрицательное конечное число или ноль. usage приходит из ответа модели,
// то есть из внешней системы: NaN, Infinity, строка или отрицательное значение
// не должны превращать цену в NaN и обнулять весь учёт расхода.
const safeCount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Цена ответа по факту. usage — объект из Anthropic API.
export function costOf(usage, model) {
  const p = PRICES[model]
  if (!p || !usage || typeof usage !== 'object') return 0
  const cost =
    safeCount(usage.input_tokens) * p.in +
    safeCount(usage.output_tokens) * p.out +
    safeCount(usage.cache_creation_input_tokens) * p.cacheWrite +
    safeCount(usage.cache_read_input_tokens) * p.cacheRead
  return Number.isFinite(cost) ? Math.ceil(cost) : 0
}

// Верхняя оценка стоимости запроса до его отправки: весь вход по полной цене
// плюс максимально возможный ответ. Намеренно пессимистично — лучше отказать
// на последних центах, чем уйти в минус.
export function estimateCost({ inputTokens = 0, maxOutputTokens = 0, model }) {
  const p = PRICES[model]
  if (!p) return 0
  const cost = safeCount(inputTokens) * p.in + safeCount(maxOutputTokens) * p.out
  return Number.isFinite(cost) ? Math.ceil(cost) : 0
}

// Грубая оценка числа токенов в тексте до вызова API. Нужна только для
// предварительной проверки бюджета: считать точно через count_tokens — лишний
// сетевой вызов на каждое сообщение. Коэффициент занижен (то есть оценка
// завышена) намеренно, с запасом на кириллицу.
export function roughTokens(text) {
  if (!text) return 0
  const len = String(text).length
  return len > 0 ? Math.ceil(len / 2.5) : 0
}

// Обрезка истории диалога под потолок входа. Убираем САМЫЕ СТАРЫЕ реплики:
// последний вопрос человека всегда важнее позавчерашнего. Возвращаем новый
// массив, исходный не трогаем.
//
// Первый элемент (контекст дневника) при этом не выбрасывается: без него
// ассистент начнёт выдумывать цифры вместо честного «нет данных» — ровно то,
// что чинил коммит 1d26d64. Если не влезает даже он один, отдаём его одного:
// решение «отказать» принимает вызывающий, а не эта функция.
export function fitHistory(messages, budgetTokens = MAX_INPUT_TOKENS, reservedTokens = 0) {
  const list = Array.isArray(messages) ? messages.slice() : []
  if (list.length <= 1) return list
  const limit = Math.max(0, safeCount(budgetTokens) - safeCount(reservedTokens))

  const cost = (m) => roughTokens(typeof m?.content === 'string' ? m.content : '')
  let total = list.reduce((n, m) => n + cost(m), 0)

  // Индекс 0 — контекст, его держим до последнего; режем со второго элемента.
  let i = 1
  while (total > limit && list.length - i > 1) {
    total -= cost(list[i])
    i += 1
  }
  return i === 1 ? list : [list[0], ...list.slice(i)]
}

// Фото стоит примерно (ширина×высота)/750 токенов, но верхняя граница у Haiku
// и Sonnet — ~1600 токенов на изображение. Считаем по верхней границе.
export const IMAGE_TOKENS = 1600

// Главная проверка перед запросом.
// Возвращает { ok, remaining, needed, reason }.
//
// Проверок теперь две — месячная и суточная, — и первой отказывает та, которая
// строже. reason различает их, чтобы интерфейс мог сказать «лимит на сегодня»
// вместо «лимит на месяц»: это разные новости, и вторая куда обиднее.
//
// spentDay не обязателен: там, где суточный расход неизвестен (например, в
// интерфейсе, который показывает только месячный остаток), проверка сводится
// к прежней месячной и ведёт себя как раньше.
export function checkBudget({ tier, spent = 0, spentDay = null, inputTokens = 0, maxOutputTokens = 0 }) {
  const model = modelForTier(tier)
  const budget = budgetForTier(tier)
  const needed = estimateCost({ inputTokens, maxOutputTokens, model })
  const used = safeCount(spent)

  // budget === null здесь больше не встречается (у всех тарифов конечный
  // потолок), но ветка остаётся: она страхует опечатку в таблице лимитов от
  // превращения в безлимит. Раньше именно так и произошло.
  if (budget === null) return { ok: true, remaining: null, needed, reason: null }

  const remaining = Math.max(0, budget - used)
  if (remaining <= 0) return { ok: false, remaining: 0, needed, reason: 'exhausted' }
  if (needed > remaining) return { ok: false, remaining, needed, reason: 'too_expensive' }

  if (spentDay != null) {
    const dayCap = dailyBudgetForTier(tier)
    const dayLeft = Math.max(0, dayCap - safeCount(spentDay))
    if (dayLeft <= 0) {
      return { ok: false, remaining, needed, reason: 'daily_exhausted', dailyRemaining: 0 }
    }
    if (needed > dayLeft) {
      return { ok: false, remaining, needed, reason: 'daily_too_expensive', dailyRemaining: dayLeft }
    }
    return { ok: true, remaining, needed, reason: null, dailyRemaining: dayLeft }
  }

  return { ok: true, remaining, needed, reason: null }
}

// Для UI: сколько процентов месячного лимита израсходовано.
export function usedShare(tier, spent = 0) {
  const budget = budgetForTier(tier)
  if (budget === null || budget <= 0) return 0
  return Math.min(1, spent / budget)
}

// Когда обнулится: первое число следующего месяца UTC.
export function resetsAt(date = new Date()) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}
