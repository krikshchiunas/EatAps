import test from 'node:test'
import assert from 'node:assert/strict'
import {
  foodSnapshot, favoriteKey, isFavorite, toggleFavorite, MAX_FAVORITES,
  makeTemplate, templateTotals, templateToEntries,
  makeRecipe, recipeTotals, recipePerServing, recipeToFood,
  buildPortionMemory, suggestPortion, PORTION_MIN_USES,
} from './library.js'
import { computeStreak, longestStreak, dayLogged, computeAchievements, achievementFacts, newlyEarned, FREEZE_ALLOWANCE } from './streaks.js'

const food = (name, extra = {}) => ({ name, emoji: '🍎', unit: 'г', grams: 100, kcal: 50, protein: 1, carbs: 10, fat: 0.5, ...extra })
const day = (meals = [], extra = {}) => ({ meals, mealSections: [], mood: null, wellbeing: [], note: '', ...extra })

// ── Снимок продукта ───────────────────────────────────────────────────────────

test('foodSnapshot не выдумывает сахар и насыщенные жиры', () => {
  const s = foodSnapshot(food('Яблоко'))
  assert.equal(s.sugar, undefined, 'неизвестный сахар не должен становиться нулём')
  assert.equal(s.satFat, undefined)

  const withData = foodSnapshot(food('Кола', { sugar: 10.6, satFat: 0 }))
  assert.equal(withData.sugar, 10.6)
  assert.equal(withData.satFat, 0, 'реальный ноль с этикетки — это данные, его храним')
})

test('foodSnapshot отбрасывает запись без имени', () => {
  assert.equal(foodSnapshot({ kcal: 100 }), null)
  assert.equal(foodSnapshot(null), null)
})

// ── Избранное ─────────────────────────────────────────────────────────────────

test('избранное различает единицы измерения', () => {
  assert.notEqual(favoriteKey(food('Молоко', { unit: 'г' })), favoriteKey(food('Молоко', { unit: 'мл' })))
  assert.equal(favoriteKey({ name: 'Молоко', unit: 'г' }), favoriteKey({ name: 'МОЛОКО', unit: 'г' }))
})

test('toggleFavorite закрепляет и открепляет', () => {
  let favs = []
  favs = toggleFavorite(favs, food('Овсянка'))
  assert.equal(favs.length, 1)
  assert.equal(isFavorite(favs, food('Овсянка')), true)
  assert.equal(isFavorite(favs, food('овсянка')), true, 'регистр не должен влиять')

  favs = toggleFavorite(favs, food('Овсянка'))
  assert.equal(favs.length, 0)
})

test('избранное не растёт бесконечно', () => {
  let favs = []
  for (let i = 0; i < MAX_FAVORITES + 10; i++) favs = toggleFavorite(favs, food(`Продукт ${i}`))
  assert.equal(favs.length, MAX_FAVORITES)
  assert.equal(favs[0].name, `Продукт ${MAX_FAVORITES + 9}`, 'новое закрепление идёт первым')
})

test('toggleFavorite возвращает прежний массив на мусоре', () => {
  const favs = [{ name: 'A', unit: 'г' }]
  assert.equal(toggleFavorite(favs, { kcal: 1 }), favs)
})

// ── Свои блюда ────────────────────────────────────────────────────────────────

test('шаблон складывает калории и разворачивается в приём пищи', () => {
  const tpl = makeTemplate('Мой завтрак', [
    food('Овсянка', { kcal: 150, protein: 5, carbs: 27, fat: 3 }),
    food('Банан', { kcal: 90, protein: 1.1, carbs: 23, fat: 0.3 }),
  ])
  const totals = templateTotals(tpl)
  assert.equal(totals.kcal, 240)
  assert.equal(totals.protein, 6.1)
  assert.equal(totals.carbs, 50)

  const entries = templateToEntries(tpl, 'std:breakfast')
  assert.equal(entries.length, 2)
  assert.ok(entries.every((e) => e.mealId === 'std:breakfast'))
  assert.equal(entries[0].id, undefined, 'id выдаёт store при добавлении, а не шаблон')
})

test('шаблон без имени или без продуктов не создаётся', () => {
  assert.equal(makeTemplate('', [food('A')]), null)
  assert.equal(makeTemplate('   ', [food('A')]), null)
  assert.equal(makeTemplate('Пусто', []), null)
})

// ── Рецепты ───────────────────────────────────────────────────────────────────

test('рецепт делится на порции', () => {
  const r = makeRecipe({
    name: 'Паста болоньезе',
    servings: 4,
    items: [
      food('Спагетти', { grams: 400, kcal: 1400, protein: 48, carbs: 280, fat: 6 }),
      food('Фарш', { grams: 500, kcal: 1100, protein: 90, carbs: 0, fat: 80 }),
    ],
  })
  const total = recipeTotals(r)
  assert.equal(total.kcal, 2500)
  assert.equal(total.grams, 900)

  const per = recipePerServing(r)
  assert.equal(per.kcal, 625)
  assert.equal(per.grams, 225)

  const eaten = recipeToFood(r, 1, 'std:dinner')
  assert.equal(eaten.kcal, 625)
  assert.equal(eaten.grams, 225)
  assert.equal(eaten.mealId, 'std:dinner')
  assert.equal(eaten.recipeId, r.id)

  const half = recipeToFood(r, 0.5)
  assert.equal(half.kcal, 313) // 625 * 0.5 = 312.5 → округление
})

test('сахар рецепта известен только если известен у ВСЕХ ингредиентов', () => {
  const known = makeRecipe({ name: 'A', servings: 1, items: [food('X', { sugar: 5 }), food('Y', { sugar: 3 })] })
  assert.equal(recipeTotals(known).sugar, 8)

  const partial = makeRecipe({ name: 'B', servings: 1, items: [food('X', { sugar: 5 }), food('Y')] })
  assert.equal(recipeTotals(partial).sugar, undefined, 'неполные данные нельзя выдавать за измеренные')
})

test('рецепт нормализует число порций', () => {
  assert.equal(makeRecipe({ name: 'A', servings: 0 }).servings, 1)
  assert.equal(makeRecipe({ name: 'A', servings: -3 }).servings, 1)
  assert.equal(makeRecipe({ name: 'A', servings: 2.6 }).servings, 3)
  assert.equal(makeRecipe({ name: '' }), null)
})

// ── Память порций ─────────────────────────────────────────────────────────────

test('память порций берёт медиану и игнорирует разовый выброс', () => {
  const days = {
    '2026-01-01': day([food('Овсянка', { grams: 180 })]),
    '2026-01-02': day([food('Овсянка', { grams: 200 })]),
    '2026-01-03': day([food('Овсянка', { grams: 190 })]),
    '2026-01-04': day([food('Овсянка', { grams: 900 })]), // разовый перебор
  }
  const mem = buildPortionMemory(days)
  const s = suggestPortion(mem, { name: 'Овсянка', unit: 'г' })
  assert.equal(s.uses, 4)
  assert.equal(s.grams, 195, 'медиана 180/190/200/900 = 195, среднее было бы 367')
})

test('одно использование ещё не привычка', () => {
  const mem = buildPortionMemory({ '2026-01-01': day([food('Экзотика', { grams: 123 })]) })
  assert.equal(suggestPortion(mem, { name: 'Экзотика', unit: 'г' }), null)
  assert.ok(PORTION_MIN_USES >= 2)
})

test('память порций не ломается на записях без веса', () => {
  const mem = buildPortionMemory({
    '2026-01-01': day([food('Суп', { grams: null }), food('Суп', { grams: 0 }), { name: 'Без всего' }]),
  })
  assert.deepEqual(mem, {})
  assert.equal(suggestPortion(null, { name: 'A' }), null)
  assert.equal(suggestPortion({}, null), null)
})

// ── Стрик ─────────────────────────────────────────────────────────────────────

test('dayLogged: пропущенный вручную день в серию не идёт', () => {
  assert.equal(dayLogged(day([food('A')])), true)
  assert.equal(dayLogged(day([])), false)
  assert.equal(dayLogged(day([food('A')], { statsExcluded: true })), false)
})

test('серия считается назад от сегодня', () => {
  const days = {
    '2026-03-10': day([food('A')]),
    '2026-03-09': day([food('A')]),
    '2026-03-08': day([food('A')]),
  }
  const s = computeStreak(days, '2026-03-10')
  assert.equal(s.current, 3)
  assert.equal(s.todayLogged, true)
  assert.equal(s.atRisk, false)
  assert.equal(s.freezesUsed, 0)
})

test('незаписанное СЕГОДНЯ не рвёт серию, а помечает её под угрозой', () => {
  const days = {
    '2026-03-09': day([food('A')]),
    '2026-03-08': day([food('A')]),
  }
  const s = computeStreak(days, '2026-03-10')
  assert.equal(s.current, 2, 'день ещё не закончился — серия жива')
  assert.equal(s.todayLogged, false)
  assert.equal(s.atRisk, true)
})

test('одиночный пропуск съедает заморозку, но серию сохраняет', () => {
  const days = {
    '2026-03-10': day([food('A')]),
    // 09 пропущен
    '2026-03-08': day([food('A')]),
    '2026-03-07': day([food('A')]),
  }
  const s = computeStreak(days, '2026-03-10')
  assert.equal(s.current, 3)
  assert.equal(s.freezesUsed, 1)
  assert.equal(s.freezesLeft, FREEZE_ALLOWANCE - 1)
  assert.deepEqual(s.frozenDays, ['2026-03-09'])
})

test('два пропуска подряд серию прерывают', () => {
  const days = {
    '2026-03-10': day([food('A')]),
    // 09 и 08 пропущены
    '2026-03-07': day([food('A')]),
  }
  const s = computeStreak(days, '2026-03-10')
  assert.equal(s.current, 1)
})

test('заморозки конечны', () => {
  const days = {
    '2026-03-10': day([food('A')]),
    '2026-03-08': day([food('A')]),
    '2026-03-06': day([food('A')]),
    '2026-03-04': day([food('A')]), // третий одиночный пропуск — уже перебор
  }
  const s = computeStreak(days, '2026-03-10')
  assert.equal(s.freezesUsed, FREEZE_ALLOWANCE)
  assert.equal(s.current, 3, 'серия обрывается там, где кончились заморозки')
})

test('пустая история — нулевая серия без падений', () => {
  const s = computeStreak({}, '2026-03-10')
  assert.equal(s.current, 0)
  assert.equal(s.longest, 0)
  assert.equal(s.freezesUsed, 0)
  assert.equal(s.atRisk, false)
  assert.equal(computeStreak(null, '2026-03-10').current, 0)
})

test('longestStreak — честные дни подряд, без заморозок', () => {
  const days = {
    '2026-01-01': day([food('A')]),
    '2026-01-02': day([food('A')]),
    '2026-01-03': day([food('A')]),
    // разрыв
    '2026-01-05': day([food('A')]),
  }
  assert.equal(longestStreak(days), 3)
})

// ── Достижения ────────────────────────────────────────────────────────────────

test('достижения считают прогресс и факт получения', () => {
  const facts = achievementFacts({
    streak: { totalLoggedDays: 10, longest: 8 },
    stats: { nutrients: { kcal: { daysIn: 3 }, protein: { daysIn: 2 } } },
    weight: { entries: 4, goal: 80, current: 79, first: 85 },
    activity: { markedDays: 5 },
    library: { recipes: 1, templates: 0 },
  })
  const list = computeAchievements(facts)
  const by = Object.fromEntries(list.map((a) => [a.id, a]))

  assert.equal(by['first-log'].earned, true)
  assert.equal(by['days-7'].earned, true)
  assert.equal(by['days-30'].earned, false)
  assert.equal(by['days-30'].progress, 10 / 30)
  assert.equal(by['streak-7'].earned, true)
  assert.equal(by['streak-30'].earned, false)
  assert.equal(by['weight-goal'].earned, true, 'снижали с 85 к 80 и дошли до 79')
})

test('цель по весу при наборе засчитывается в обратную сторону', () => {
  const gaining = achievementFacts({ weight: { entries: 3, goal: 85, current: 86, first: 80 } })
  assert.equal(gaining.weightGoalReached, true)

  const notYet = achievementFacts({ weight: { entries: 3, goal: 85, current: 82, first: 80 } })
  assert.equal(notYet.weightGoalReached, false)

  assert.equal(achievementFacts({}).weightGoalReached, false)
})

test('newlyEarned отдаёт только те, что ещё не отмечены', () => {
  const facts = achievementFacts({ streak: { totalLoggedDays: 8, longest: 1 } })
  const list = computeAchievements(facts, { 'first-log': '2026-01-01' })
  const fresh = newlyEarned(list, { 'first-log': '2026-01-01' })
  assert.ok(fresh.includes('days-7'))
  assert.ok(!fresh.includes('first-log'))
})
