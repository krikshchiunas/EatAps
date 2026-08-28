import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContext, historyDepth, HISTORY_DAYS } from './aiContext.js'
import { buildUserContext } from './aiPrompt.js'
import { TIER } from './subscription.js'

const DAY = '2026-08-25'
const render = (state, tier = TIER.AI) => buildUserContext(buildContext(state, { tier, dateKey: DAY }))

// Контекст собирается из состояния, которое годами копилось на устройстве:
// половина полей может отсутствовать, а часть — быть мусором после старых
// версий. Падать здесь нельзя: это единственный путь к ассистенту.
test('пустое состояние не роняет сборку', () => {
  assert.doesNotThrow(() => render({}))
})

test('дневник без профиля собирается — цели просто отсутствуют', () => {
  const text = render({ days: { [DAY]: { meals: [{ name: 'Хлеб', kcal: 200, protein: 6, fat: 2, carbs: 40 }] } } })
  assert.ok(text.includes('СЕГОДНЯ'))
  assert.ok(!text.includes('ПРОФИЛЬ'), 'без профиля блока целей быть не должно')
})

test('мусор вместо meals не роняет сборку', () => {
  assert.doesNotThrow(() => render({ days: { [DAY]: { meals: null } } }))
  assert.doesNotThrow(() => render({ days: { [DAY]: {} } }))
})

test('глубина истории растёт с тарифом', () => {
  assert.ok(historyDepth(TIER.FREE) < historyDepth(TIER.AI))
  assert.ok(historyDepth(TIER.AI) < historyDepth(TIER.AI_PLUS))
  assert.equal(historyDepth('МУСОР'), HISTORY_DAYS[TIER.FREE], 'неизвестный тариф не даёт длинную историю')
})

test('на AI+ история длиннее — и это видно в объёме контекста', () => {
  const days = {}
  for (let i = 1; i <= 31; i++) {
    const key = `2026-07-${String(i).padStart(2, '0')}`
    days[key] = { meals: [{ name: 'Еда', kcal: 500, protein: 30, fat: 15, carbs: 50 }] }
  }
  const state = { days }
  assert.ok(render(state, TIER.AI_PLUS).length > render(state, TIER.AI).length)
})

test('пустые дни попадают в историю — «три дня не записывал» это тоже факт', () => {
  const text = render({ days: {} }, TIER.AI)
  assert.ok(text.includes('пусто'), 'пропуски должны быть видны ассистенту')
})

test('служебные поля записи в модель не уезжают', () => {
  const text = render({
    days: { [DAY]: { meals: [{
      id: 'abc-123', createdAt: '2026-08-25T10:00:00Z', updatedAt: 'HLC:42',
      name: 'Овсянка', kcal: 300, protein: 10, fat: 5, carbs: 50,
    }] } },
  })
  for (const junk of ['abc-123', 'createdAt', 'updatedAt', 'HLC:42']) {
    assert.ok(!text.includes(junk), `${junk} не должен попадать в контекст — это оплаченные токены впустую`)
  }
})

test('память отдаётся только на AI+', () => {
  const state = { days: {} }
  const mem = ['не ест творог']
  const plus = buildContext(state, { tier: TIER.AI_PLUS, dateKey: DAY, memory: mem })
  const ai = buildContext(state, { tier: TIER.AI, dateKey: DAY, memory: mem })
  assert.deepEqual(plus.memory, mem)
  assert.deepEqual(ai.memory, [], 'на AI память не подмешивается — тариф её не включает')
})

test('guilty pleasure доезжает до ассистента', () => {
  const text = render({
    profile: { sex: 'male', age: 30, height: 180, weight: 80, goal: 'lose', activity: 'moderate', guiltyPleasure: 'Шоколадный торт' },
    days: {},
  })
  assert.ok(text.includes('Шоколадный торт'))
})

// Списки «не ест» / «любит» удалены вместе со старой моделью профиля: завести
// их негде. Читать их из блоба давнего аккаунта — значит подмешивать в промпт
// то, что человек уже не может ни увидеть, ни исправить.
test('списки старой модели профиля в промпт не подмешиваются', () => {
  const text = render({
    profile: { sex: 'male', age: 30, height: 180, weight: 80, goal: 'lose', activity: 'moderate', noGos: ['Творог'], toGos: ['Рыба'], favDish: 'Харчо' },
    days: {},
  })
  assert.ok(!text.includes('Творог'))
  assert.ok(!text.includes('Рыба'))
  assert.ok(!text.includes('Харчо'))
})
