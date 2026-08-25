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
// null = без потолка.
export const MONTHLY_BUDGET = Object.freeze({
  [TIER.FREE]: 1 * MICRO,        // $1.00
  [TIER.AI]: 3.5 * MICRO,        // $3.50
  [TIER.AI_PLUS]: null,          // без лимита — см. docs/ai-assistant.md
})

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

// Расчётный период — календарный месяц в UTC. Не «30 дней с оплаты»: так
// пользователю понятно, когда лимит обнулится, и период одинаков на всех
// устройствах независимо от их часового пояса.
export function periodKey(date = new Date()) {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Цена ответа по факту. usage — объект из Anthropic API.
export function costOf(usage, model) {
  const p = PRICES[model]
  if (!p || !usage) return 0
  const cost =
    (usage.input_tokens || 0) * p.in +
    (usage.output_tokens || 0) * p.out +
    (usage.cache_creation_input_tokens || 0) * p.cacheWrite +
    (usage.cache_read_input_tokens || 0) * p.cacheRead
  return Math.ceil(cost)
}

// Верхняя оценка стоимости запроса до его отправки: весь вход по полной цене
// плюс максимально возможный ответ. Намеренно пессимистично — лучше отказать
// на последних центах, чем уйти в минус.
export function estimateCost({ inputTokens = 0, maxOutputTokens = 0, model }) {
  const p = PRICES[model]
  if (!p) return 0
  return Math.ceil(inputTokens * p.in + maxOutputTokens * p.out)
}

// Грубая оценка числа токенов в тексте до вызова API. Нужна только для
// предварительной проверки бюджета: считать точно через count_tokens — лишний
// сетевой вызов на каждое сообщение. Коэффициент занижен (то есть оценка
// завышена) намеренно, с запасом на кириллицу.
export function roughTokens(text) {
  if (!text) return 0
  return Math.ceil(String(text).length / 2.5)
}

// Фото стоит примерно (ширина×высота)/750 токенов, но верхняя граница у Haiku
// и Sonnet — ~1600 токенов на изображение. Считаем по верхней границе.
export const IMAGE_TOKENS = 1600

// Главная проверка перед запросом.
// Возвращает { ok, remaining, needed, reason }.
export function checkBudget({ tier, spent = 0, inputTokens = 0, maxOutputTokens = 0 }) {
  const model = modelForTier(tier)
  const budget = budgetForTier(tier)
  const needed = estimateCost({ inputTokens, maxOutputTokens, model })

  if (budget === null) return { ok: true, remaining: null, needed, reason: null }

  const remaining = Math.max(0, budget - spent)
  if (remaining <= 0) return { ok: false, remaining: 0, needed, reason: 'exhausted' }
  if (needed > remaining) return { ok: false, remaining, needed, reason: 'too_expensive' }
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
