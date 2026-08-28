import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MICRO, PRICES, costOf, estimateCost, checkBudget, periodKey, resetsAt,
  modelForTier, budgetForTier, usedShare, roughTokens, effortFor, DEFAULT_EFFORT, EFFORT_CAPABLE,
  dailyBudgetForTier, rateLimitForTier, dayKey, fitHistory,
} from './aiBudget.js'
import { TIER } from './subscription.js'

test('модель зависит от тарифа: AI+ получает Sonnet', () => {
  assert.equal(modelForTier(TIER.FREE), 'claude-haiku-4-5')
  assert.equal(modelForTier(TIER.AI), 'claude-haiku-4-5')
  assert.equal(modelForTier(TIER.AI_PLUS), 'claude-sonnet-4-6')
  assert.equal(modelForTier('МУСОР'), 'claude-haiku-4-5', 'неизвестный тариф не даёт дорогую модель')
})

test('цена считается по всем четырём видам токенов', () => {
  const usage = {
    input_tokens: 1000, output_tokens: 100,
    cache_creation_input_tokens: 200, cache_read_input_tokens: 4000,
  }
  const p = PRICES['claude-haiku-4-5']
  const expected = 1000 * p.in + 100 * p.out + 200 * p.cacheWrite + 4000 * p.cacheRead
  assert.equal(costOf(usage, 'claude-haiku-4-5'), Math.ceil(expected))
})

test('кэш дешевле обычного входа — иначе он бессмыслен', () => {
  const cold = costOf({ input_tokens: 10000 }, 'claude-haiku-4-5')
  const warm = costOf({ cache_read_input_tokens: 10000 }, 'claude-haiku-4-5')
  assert.ok(warm < cold / 5, `чтение кэша ${warm} должно быть много дешевле ${cold}`)
})

test('цена округляется вверх: доли микродоллара не теряются', () => {
  assert.equal(costOf({ cache_read_input_tokens: 1 }, 'claude-haiku-4-5'), 1)
})

test('неизвестная модель стоит ноль, а не NaN', () => {
  assert.equal(costOf({ input_tokens: 100 }, 'gpt-нет-такого'), 0)
  assert.equal(estimateCost({ inputTokens: 100, maxOutputTokens: 10, model: 'нет' }), 0)
})

test('бюджеты тарифов заданы как обещано пользователю', () => {
  assert.equal(budgetForTier(TIER.FREE), 1 * MICRO)
  assert.equal(budgetForTier(TIER.AI), 3.5 * MICRO)
  assert.equal(budgetForTier(TIER.AI_PLUS), 60 * MICRO)
})

// Регрессия на находку аудита: у AI+ потолок был null, и checkBudget на null
// отвечал безусловным «можно». Один аккаунт мог в цикле сжечь счёт владельца.
test('ни у одного тарифа нет безлимита', () => {
  for (const tier of [TIER.FREE, TIER.AI, TIER.AI_PLUS]) {
    const cap = budgetForTier(tier)
    assert.ok(Number.isFinite(cap) && cap > 0, `у тарифа ${tier} потолок должен быть конечным, получено ${cap}`)
    const day = dailyBudgetForTier(tier)
    assert.ok(Number.isFinite(day) && day > 0 && day <= cap,
      `суточный потолок ${tier} должен быть конечным и не больше месячного`)
    assert.ok(Number.isInteger(rateLimitForTier(tier)) && rateLimitForTier(tier) > 0,
      `у тарифа ${tier} должно быть ограничение частоты`)
  }
})

test('неизвестный тариф получает самые строгие лимиты, а не самые щедрые', () => {
  assert.equal(budgetForTier('МУСОР'), budgetForTier(TIER.FREE))
  assert.equal(dailyBudgetForTier('МУСОР'), dailyBudgetForTier(TIER.FREE))
  assert.equal(rateLimitForTier(undefined), rateLimitForTier(TIER.FREE))
})

test('исчерпанный бюджет закрывает доступ', () => {
  const r = checkBudget({ tier: TIER.FREE, spent: 1 * MICRO, inputTokens: 10, maxOutputTokens: 10 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'exhausted')
  assert.equal(r.remaining, 0)
})

test('дорогой запрос на остатках отклоняется до вызова модели', () => {
  const r = checkBudget({ tier: TIER.AI, spent: 3.49 * MICRO, inputTokens: 50000, maxOutputTokens: 900 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too_expensive')
  assert.ok(r.needed > r.remaining)
})

test('перерасход невозможен: сумма всех разрешённых запросов не превышает бюджет', () => {
  // Прогоняем цикл «проверили → потратили по верхней оценке» до отказа.
  let spent = 0
  for (let i = 0; i < 10000; i++) {
    const r = checkBudget({ tier: TIER.FREE, spent, inputTokens: 3000, maxOutputTokens: 700 })
    if (!r.ok) break
    spent += r.needed
  }
  assert.ok(spent <= budgetForTier(TIER.FREE), `потрачено ${spent} при бюджете ${budgetForTier(TIER.FREE)}`)
})

test('AI+ тоже упирается в потолок — безлимита нет ни у кого', () => {
  const rich = checkBudget({ tier: TIER.AI_PLUS, spent: 1 * MICRO, inputTokens: 3000, maxOutputTokens: 700 })
  assert.equal(rich.ok, true, 'обычное пользование AI+ не должно упираться в лимит')

  const drained = checkBudget({ tier: TIER.AI_PLUS, spent: 999 * MICRO, inputTokens: 100000, maxOutputTokens: 2000 })
  assert.equal(drained.ok, false)
  assert.equal(drained.reason, 'exhausted')
  assert.equal(drained.remaining, 0)
})

test('суточный подпотолок закрывает доступ раньше месячного', () => {
  // Месячного бюджета вагон, а дневной уже выбран — отказ должен наступить,
  // и причина должна отличаться, чтобы интерфейс сказал «на сегодня», а не
  // «на месяц».
  const r = checkBudget({
    tier: TIER.AI_PLUS,
    spent: 0,
    spentDay: dailyBudgetForTier(TIER.AI_PLUS),
    inputTokens: 3000,
    maxOutputTokens: 700,
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'daily_exhausted')
  assert.ok(r.remaining > 0, 'месячный остаток при этом не тронут')
})

test('без spentDay проверка ведёт себя как прежняя месячная', () => {
  const r = checkBudget({ tier: TIER.AI, spent: 0, inputTokens: 3000, maxOutputTokens: 700 })
  assert.equal(r.ok, true)
  assert.equal(r.dailyRemaining, undefined)
})

test('мусор в расходе не открывает доступ', () => {
  for (const spent of [NaN, Infinity, -1e9, null, undefined, 'много']) {
    const r = checkBudget({ tier: TIER.FREE, spent, inputTokens: 3000, maxOutputTokens: 700 })
    assert.equal(typeof r.ok, 'boolean')
    assert.ok(Number.isFinite(r.remaining), `remaining должен быть числом при spent=${String(spent)}`)
    assert.ok(Number.isFinite(r.needed))
  }
})

test('битый usage из модели не обнуляет учёт и не даёт NaN', () => {
  const model = 'claude-haiku-4-5'
  assert.equal(costOf({ input_tokens: NaN, output_tokens: 'x' }, model), 0)
  assert.equal(costOf({ input_tokens: Infinity }, model), 0)
  assert.equal(costOf({ input_tokens: -500, output_tokens: 100 }, model), Math.ceil(100 * PRICES[model].out))
  assert.equal(costOf(null, model), 0)
  assert.equal(costOf('строка', model), 0)
})

test('история обрезается по самым старым репликам, контекст остаётся', () => {
  const ctx = { role: 'user', content: 'КОНТЕКСТ ДНЕВНИКА' }
  const turns = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: 'x'.repeat(1000) + i }))
  const fitted = fitHistory([ctx, ...turns], 2000)

  assert.equal(fitted[0], ctx, 'контекст дневника выбрасывать нельзя — иначе ассистент начнёт выдумывать')
  assert.ok(fitted.length < 21, 'что-то должно было отвалиться')
  assert.equal(fitted[fitted.length - 1], turns[turns.length - 1], 'последний вопрос обязан уцелеть')
})

test('короткая история не трогается', () => {
  const list = [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'здравствуйте' }]
  assert.deepEqual(fitHistory(list, 100000), list)
  assert.deepEqual(fitHistory([], 10), [])
})

test('день считается в UTC, как и месяц', () => {
  assert.equal(dayKey(new Date('2026-08-24T23:30:00Z')), '2026-08-24')
  assert.equal(dayKey(new Date('2026-01-05T00:00:00Z')), '2026-01-05')
})

test('период — календарный месяц UTC, а не локальный', () => {
  assert.equal(periodKey(new Date('2026-08-24T23:30:00Z')), '2026-08')
  assert.equal(periodKey(new Date('2026-01-01T00:00:00Z')), '2026-01')
  assert.equal(resetsAt(new Date('2026-12-15T00:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z')
})

test('доля израсходованного не вылезает за 100% и не делится на ноль', () => {
  assert.equal(usedShare(TIER.FREE, 0), 0)
  assert.equal(usedShare(TIER.FREE, 2 * MICRO), 1)
  // Раньше здесь ожидался 0: у AI+ не было потолка, и делить было не на что.
  // Теперь потолок конечный у всех — шкала расхода работает на любом тарифе.
  assert.equal(usedShare(TIER.AI_PLUS, 999 * MICRO), 1)
  assert.equal(usedShare(TIER.AI_PLUS, 30 * MICRO), 0.5)
})

test('оценка токенов завышена на кириллице — лимит не должен протекать', () => {
  const text = 'Съел на завтрак овсянку с бананом и two hundred грамм творога'
  assert.ok(roughTokens(text) >= text.length / 3, 'оценка не должна занижать')
})

test('effort задаётся только там, где модель его принимает', () => {
  // На Haiku 4.5 параметр effort — ошибка API, поэтому его быть не должно.
  assert.equal(effortFor('claude-haiku-4-5'), null)
  assert.equal(effortFor('неизвестная-модель'), null)
})

test('везде, где effort поддерживается, стоит medium — без исключений', () => {
  assert.equal(DEFAULT_EFFORT, 'medium')
  for (const model of EFFORT_CAPABLE) {
    assert.equal(effortFor(model), 'medium', `${model} должен идти на medium`)
  }
})

test('все используемые тарифами модели имеют осознанный effort', () => {
  for (const tier of [TIER.FREE, TIER.AI, TIER.AI_PLUS]) {
    const model = modelForTier(tier)
    const effort = effortFor(model)
    assert.ok(
      effort === DEFAULT_EFFORT || effort === null,
      `${tier} → ${model}: effort должен быть medium либо отсутствовать, а не «${effort}»`,
    )
  }
})

// ── Резерв и расчёт ──────────────────────────────────────────────────────────
// Модель того, что делают api/ai/*: резерв верхней оценки ДО вызова модели,
// затем корректировка до фактической цены. Проверяем именно то, ради чего это
// затевалось: одновременные запросы не должны вместе перебрать месячный лимит.
function makeLedger() {
  let spent = 0
  return {
    get spent() { return spent },
    add(delta) { spent = Math.max(0, spent + delta) },
  }
}

test('расчёт по факту приводит расход к реальной цене', () => {
  const ledger = makeLedger()
  const reserved = 6500
  ledger.add(reserved)
  const actual = 4200
  ledger.add(actual - reserved) // settle
  assert.equal(ledger.spent, actual)
})

test('упавший запрос без usage возвращает резерв полностью', () => {
  const ledger = makeLedger()
  const reserved = 6500
  ledger.add(reserved)
  ledger.add(0 - reserved)
  assert.equal(ledger.spent, 0)
})

test('одновременные запросы не пробивают лимит: резерв держит остаток', () => {
  const ledger = makeLedger()
  const tier = TIER.FREE
  const budget = budgetForTier(tier)

  // Десять «вкладок» проверяют остаток и сразу резервируют — так делает сервер.
  let started = 0
  for (let i = 0; i < 500; i++) {
    const r = checkBudget({ tier, spent: ledger.spent, inputTokens: 3000, maxOutputTokens: 700 })
    if (!r.ok) break
    ledger.add(r.needed)
    started++
  }
  assert.ok(ledger.spent <= budget, `зарезервировано ${ledger.spent} при бюджете ${budget}`)
  assert.ok(started > 0, 'на пустом счёте запросы должны проходить')
})

test('без резерва лимит пробивается — фиксируем, зачем он нужен', () => {
  // Старое поведение: проверили по общему остатку, списали только после ответа.
  // Остатка хватает ровно на ОДИН запрос, но десять отправленных одновременно
  // видят один и тот же spent и проходят проверку все.
  const budget = budgetForTier(TIER.FREE)
  const one = checkBudget({ tier: TIER.FREE, spent: 0, inputTokens: 3000, maxOutputTokens: 700 }).needed
  const spentBefore = budget - one // остаток ровно на один запрос
  const parallel = 10

  let passed = 0
  for (let i = 0; i < parallel; i++) {
    const r = checkBudget({ tier: TIER.FREE, spent: spentBefore, inputTokens: 3000, maxOutputTokens: 700 })
    if (r.ok) passed++
  }
  assert.equal(passed, parallel, 'все десять проходят проверку по одному и тому же остатку')
  assert.ok(spentBefore + passed * one > budget, 'и вместе перебирают бюджет — ради этого и нужен резерв')

  // С резервом проходит ровно один: остаток уменьшается сразу.
  let spent = spentBefore
  let allowed = 0
  for (let i = 0; i < parallel; i++) {
    const r = checkBudget({ tier: TIER.FREE, spent, inputTokens: 3000, maxOutputTokens: 700 })
    if (!r.ok) continue
    spent += r.needed
    allowed++
  }
  assert.equal(allowed, 1)
  assert.ok(spent <= budget)
})
