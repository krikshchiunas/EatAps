import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt } from './aiPrompt.js'
import { historyDepth, HISTORY_DAYS } from './aiContext.js'
import { modelForTier, MODEL_BY_TIER, PRICES } from './aiBudget.js'
import { TIER } from './subscription.js'

// Все тарифы, какие вообще существуют в системе. Гвоздь этого файла: любой
// новый тариф, добавленный в TIER, должен быть учтён во ВСЕХ AI-таблицах.
// Именно рассинхрон (тариф AI_PREMIUM добавили, а в HISTORY_DAYS забыли) один
// раз уже молча урезал премиум-пользователей до 3 дней истории.
const ALL_TIERS = Object.values(TIER)

test('у каждого тарифа есть модель, и это реальная модель из прайса', () => {
  for (const tier of ALL_TIERS) {
    const model = modelForTier(tier)
    assert.ok(PRICES[model], `${tier} → ${model}: модели нет в таблице цен PRICES`)
    assert.ok(MODEL_BY_TIER[tier], `${tier} не задан в MODEL_BY_TIER — упадёт на фолбэк FREE`)
  }
})

test('у каждого тарифа своя глубина истории, без молчаливого фолбэка на FREE', () => {
  for (const tier of ALL_TIERS) {
    assert.ok(HISTORY_DAYS[tier] !== undefined, `${tier} нет в HISTORY_DAYS — история упадёт до FREE`)
    assert.ok(historyDepth(tier) >= HISTORY_DAYS[TIER.FREE], `${tier} видит меньше, чем FREE — это ошибка`)
  }
})

test('глубина истории не убывает с ростом тарифа', () => {
  // Платить больше и видеть меньше — так быть не должно.
  assert.ok(HISTORY_DAYS[TIER.AI] >= HISTORY_DAYS[TIER.FREE])
  assert.ok(HISTORY_DAYS[TIER.AI_PLUS] >= HISTORY_DAYS[TIER.AI])
  assert.ok(HISTORY_DAYS[TIER.AI_PREMIUM] >= HISTORY_DAYS[TIER.AI_PLUS])
})

test('системный промпт собирается для любого тарифа без брака', () => {
  for (const tier of ALL_TIERS) {
    const p = buildSystemPrompt({ sub: { tier, status: 'active' }, tone: 'calm' })
    assert.ok(p.length > 500, `${tier}: промпт подозрительно короткий`)
    assert.ok(!p.includes('undefined'), `${tier}: в промпте есть "undefined"`)
    assert.ok(p.includes('Carrot'), `${tier}: ассистент должен звать себя Carrot`)
    // Платный тариф нельзя называть «бесплатным» — это прямая дезинформация.
    if (tier !== TIER.FREE) {
      assert.ok(!p.includes('тариф бесплатный'), `${tier}: платный тариф назван бесплатным`)
    }
  }
})

test('память включена ровно на тех тарифах, что её обещают', () => {
  // memory:true в TIER_FEATURES должно совпадать с тем, что реально уходит
  // в контекст. Проверяем через промпт: на тарифах с памятью есть блок про неё.
  const withMemory = buildSystemPrompt({ sub: { tier: TIER.AI_PREMIUM, status: 'active' }, tone: 'calm' })
  const noMemory = buildSystemPrompt({ sub: { tier: TIER.FREE }, tone: 'calm' })
  assert.ok(withMemory.includes('помнишь факты'), 'премиум должен иметь долгую память')
  assert.ok(noMemory.includes('Долгой памяти'), 'на FREE памяти нет, и это сказано модели')
})
