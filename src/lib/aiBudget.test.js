import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MICRO, PRICES, costOf, estimateCost, checkBudget, periodKey, resetsAt,
  modelForTier, budgetForTier, usedShare, roughTokens, effortFor, DEFAULT_EFFORT, EFFORT_CAPABLE,
} from './aiBudget.js'
import { TIER } from './subscription.js'

test('умную модель (Sonnet) получает только премиум-тариф', () => {
  assert.equal(modelForTier(TIER.FREE), 'claude-haiku-4-5')
  assert.equal(modelForTier(TIER.AI), 'claude-haiku-4-5')
  assert.equal(modelForTier(TIER.AI_PLUS), 'claude-haiku-4-5')
  assert.equal(modelForTier(TIER.AI_PREMIUM), 'claude-sonnet-4-6')
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

test('дневные бюджеты: у дешёвых тарифов есть потолок, у старших — нет', () => {
  // budgetForTier теперь ДНЕВНОЙ (месячная сумма / дней в месяце).
  const free = budgetForTier(TIER.FREE)
  const ai = budgetForTier(TIER.AI)
  assert.ok(free > 0 && ai > 0, 'у FREE и AI есть дневной потолок')
  assert.ok(ai > free, 'платный AI щедрее бесплатного')
  assert.equal(budgetForTier(TIER.AI_PLUS), null, 'Carrot Pro — без потолка')
  assert.equal(budgetForTier(TIER.AI_PREMIUM), null, 'Carrot Premium — без потолка')
})

test('дневной бюджет — это месячный, делённый на число дней месяца', () => {
  const jan = new Date('2026-01-15T00:00:00Z') // 31 день
  const feb = new Date('2026-02-15T00:00:00Z') // 28 дней
  assert.ok(budgetForTier(TIER.AI, feb) > budgetForTier(TIER.AI, jan),
    'в коротком месяце дневная доля больше')
})

test('исчерпанный бюджет закрывает доступ', () => {
  const r = checkBudget({ tier: TIER.FREE, spent: 1 * MICRO, inputTokens: 10, maxOutputTokens: 10 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'exhausted')
  assert.equal(r.remaining, 0)
})

test('дорогой запрос на остатках отклоняется до вызова модели', () => {
  // Остаток почти исчерпан — тяжёлый запрос не должен пройти.
  const budget = budgetForTier(TIER.FREE)
  const r = checkBudget({ tier: TIER.FREE, spent: budget - 100, inputTokens: 50000, maxOutputTokens: 900 })
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

test('AI+ проходит проверку при любом расходе', () => {
  const r = checkBudget({ tier: TIER.AI_PLUS, spent: 999 * MICRO, inputTokens: 100000, maxOutputTokens: 2000 })
  assert.equal(r.ok, true)
  assert.equal(r.remaining, null)
})

test('период — календарный ДЕНЬ UTC, а не локальный', () => {
  assert.equal(periodKey(new Date('2026-08-24T23:30:00Z')), '2026-08-24')
  assert.equal(periodKey(new Date('2026-01-01T00:00:00Z')), '2026-01-01')
  // Обнуление — начало следующего дня UTC.
  assert.equal(resetsAt(new Date('2026-12-31T12:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z')
})

test('доля израсходованного не вылезает за 100% и не делится на null', () => {
  assert.equal(usedShare(TIER.FREE, 0), 0)
  assert.equal(usedShare(TIER.FREE, 2 * MICRO), 1)
  assert.equal(usedShare(TIER.AI_PLUS, 999 * MICRO), 0)
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
