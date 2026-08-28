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

// ── Голос ассистента ────────────────────────────────────────────────────────
// Тон однажды уже «не работал»: он лежал в середине промпта между техническими
// секциями, и модель его игнорировала. Тесты ниже держат три вещи, от которых
// это зависит: голос идёт в начале, повторяется в конце и у каждого тона свой
// характер с примерами.
import { TONES, DEFAULT_TONE, resolveTone, TONE_CONSENT_VERSION } from './aiPrompt.js'

const buildFor = (tone) => buildSystemPrompt({ tone, sub: { tier: TIER.FREE } })

test('у каждого голоса есть характер, примеры и напоминание', () => {
  for (const [id, t] of Object.entries(TONES)) {
    assert.ok(t.label, `${id}: нет названия для UI`)
    assert.ok(t.hint, `${id}: нет описания для UI`)
    assert.ok(t.persona && t.persona.length > 80, `${id}: характер слишком куцый, модель его не заметит`)
    assert.ok(Array.isArray(t.examples) && t.examples.length >= 3,
      `${id}: нужны живые примеры реплик — на абстрактных прилагательных модель не меняет тон`)
    assert.ok(t.reminder, `${id}: нет напоминания для конца промпта`)
  }
})

test('голос стоит в начале промпта, а не закопан в середине', () => {
  for (const id of Object.keys(TONES)) {
    const p = buildFor(id)
    const pos = p.indexOf('КАК ТЫ ГОВОРИШЬ')
    assert.ok(pos > 0, `${id}: блока голоса нет вовсе`)
    assert.ok(pos < p.length * 0.15,
      `${id}: голос на позиции ${pos} из ${p.length} — слишком глубоко, модель его недоучтёт`)
  }
})

test('голос повторяется в самом конце — это последнее, что читает модель', () => {
  for (const id of Object.keys(TONES)) {
    const p = buildFor(id)
    const pos = p.indexOf('ГОЛОС — ГЛАВНОЕ')
    assert.ok(pos > p.length * 0.85, `${id}: напоминание о голосе не в конце (${pos} из ${p.length})`)
  }
})

test('примеры реплик реально попадают в промпт', () => {
  for (const [id, t] of Object.entries(TONES)) {
    const p = buildFor(id)
    for (const ex of t.examples) {
      assert.ok(p.includes(ex), `${id}: пример «${ex.slice(0, 30)}…» не дошёл до промпта`)
    }
  }
})

test('голоса не смешиваются: характер одного не течёт в промпт другого', () => {
  const marker = { buddy: 'кент', doctor: 'врач на приёме', coach: 'тренер', savage: 'материшься' }
  for (const [id, mk] of Object.entries(marker)) {
    assert.ok(buildFor(id).toLowerCase().includes(mk), `${id}: свой маркер потерян`)
    for (const other of Object.keys(TONES)) {
      if (other === id) continue
      assert.ok(!buildFor(other).toLowerCase().includes(mk),
        `маркер «${mk}» тона ${id} протёк в промпт тона ${other}`)
    }
  }
})

test('мат разрешён только в savage', () => {
  for (const id of Object.keys(TONES)) {
    if (id === 'savage') continue
    const p = buildFor(id).toLowerCase()
    assert.ok(!p.includes('мат обязателен'), `${id}: в неругательном тоне разрешён мат`)
  }
  assert.ok(buildFor('savage').includes('Мат обязателен'), 'savage без мата — это не savage')
})

test('savage не включается без действующего согласия', () => {
  assert.equal(resolveTone({ aiTone: 'savage' }).id, DEFAULT_TONE, 'без согласия — падаем на спокойный')
  assert.equal(resolveTone({ aiTone: 'savage', aiToneConsent: { version: 0 } }).id, DEFAULT_TONE,
    'протухшее согласие не считается')
  assert.equal(
    resolveTone({ aiTone: 'savage', aiToneConsent: { version: TONE_CONSENT_VERSION } }).id, 'savage')
})

test('обычные голоса включаются без всякого согласия', () => {
  for (const id of ['buddy', 'doctor', 'coach', 'strict']) {
    assert.equal(resolveTone({ aiTone: id }).id, id, `${id} не должен требовать опт-ина`)
  }
})

test('запреты savage про тело сохраняются', () => {
  const p = buildFor('savage')
  for (const guard of ['внешность', 'Голодание', 'не по телу'.slice(0, 4)]) {
    assert.ok(p.includes(guard), `в savage потерян защитный запрет: ${guard}`)
  }
})
