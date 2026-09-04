import test from 'node:test'
import assert from 'node:assert/strict'
import {
  foodSnapshot, favoriteKey, toggleFavorite, MAX_FAVORITES,
  makeTemplate, templateTotals, templateToEntries,
  makeRecipe, recipeTotals, recipePerServing, recipeToFood,
  toPer100, PORTION_MIN_USES,
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
  // Проверяем через ключ — так же, как это делает экран добавления (Set ключей).
  const has = (list, f) => list.some((x) => favoriteKey(x) === favoriteKey(f))
  assert.equal(has(favs, food('Овсянка')), true)
  assert.equal(has(favs, food('овсянка')), true, 'регистр не должен влиять')

  favs = toggleFavorite(favs, food('Овсянка'))
  assert.equal(favs.length, 0)
})

test('избранное не растёт бесконечно', () => {
  let favs = []
  for (let i = 0; i < MAX_FAVORITES + 10; i++) favs = toggleFavorite(favs, food(`Продукт ${i}`))
  assert.equal(favs.length, MAX_FAVORITES, 'предел соблюдён')
  // Переполнение отбрасывает НОВОЕ, а не вытесняет старое: см. соседний тест
  // «предел избранного не вытесняет молча» — там причина.
  assert.equal(favs[0].name, `Продукт ${MAX_FAVORITES - 1}`, 'последнее влезшее — первое')
  assert.equal(favs.some((f) => f.name === `Продукт ${MAX_FAVORITES + 9}`), false)
})

test('новое закрепление идёт первым, пока есть место', () => {
  let favs = []
  for (const n of ['Овсянка', 'Банан', 'Творог']) favs = toggleFavorite(favs, food(n))
  assert.equal(favs[0].name, 'Творог')
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
  // grams при unit «порция» — это ЧИСЛО ПОРЦИЙ, а не вес: пара (grams, unit)
  // печатается в дневнике как «1 порция». Вес порции — в portionGrams.
  assert.equal(eaten.grams, 1)
  assert.equal(eaten.unit, 'порция')
  assert.equal(eaten.portionGrams, 225)
  assert.equal(eaten.mealId, 'std:dinner')
  assert.equal(eaten.recipeId, r.id)

  const half = recipeToFood(r, 0.5)
  assert.equal(half.kcal, 313) // 2500 / 4 * 0.5 = 312.5 → округление
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

// Привычная порция теперь считается в buildFoodMemory (тесты — в
// foodSearch.test.js): медиана, устойчивость к выбросам, «одно использование
// ещё не привычка» и битые записи проверяются там же, по единственной
// оставшейся реализации.
test('порог «привычки» остаётся осмысленным', () => {
  assert.ok(PORTION_MIN_USES >= 2)
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

test('предел избранного не вытесняет молча', () => {
  // Чистая функция ведёт себя так же, как стор: полный список не принимает
  // новое, а не выбрасывает самое старое. Вытеснение здесь было бы вдвойне
  // неверным — закреплённое человеком терялось бы без слова, и без тумбстоуна
  // оно всё равно вернулось бы с другого устройства при синхронизации.
  const full = Array.from({ length: MAX_FAVORITES }, (_, i) => food('Продукт ' + i))
  const after = toggleFavorite(full, food('Ещё один'))
  assert.equal(after.length, MAX_FAVORITES)
  assert.equal(after.some((f) => f.name === 'Ещё один'), false, 'новое не влезло')
  assert.equal(after[MAX_FAVORITES - 1].name, 'Продукт ' + (MAX_FAVORITES - 1), 'старое на месте')
})

// ── Рецепт → запись в дневнике ───────────────────────────────────────────────

test('в дневник рецепт попадает порциями, а не граммами', () => {
  // Пара (grams, unit) во всём приложении читается как «сколько и в чём».
  // Вес в grams при unit «порция» давал в дневнике строку «260 порция».
  const r = makeRecipe({
    name: 'Борщ',
    servings: 4,
    items: [food('Говядина', { grams: 600, kcal: 1122, protein: 111, carbs: 0, fat: 72 })],
  })
  const entry = recipeToFood(r, 1.5)
  assert.equal(entry.unit, 'порция')
  assert.equal(entry.grams, 1.5, 'в grams — число порций')
  assert.equal(entry.servings, 1.5)
  assert.ok(entry.portionGrams > 0, 'вес не теряется, он в portionGrams')
  // Округление ОДИН раз, от итога кастрюли: 1122 / 4 * 1.5 = 420.75 → 421.
  // Умножение уже округлённой порции (281 × 1.5) дало бы 422.
  assert.equal(entry.kcal, 421)
})

test('дробная порция считается честно, а не округляется до целой', () => {
  const r = makeRecipe({ name: 'Суп', servings: 2, items: [food('Курица', { grams: 200, kcal: 400, protein: 40, carbs: 0, fat: 26 })] })
  assert.equal(recipeToFood(r, 0.5).kcal, 100)
  assert.equal(recipeToFood(r, 1).kcal, 200)
})

// ── Неизвестное БЖУ переживает сохранение ────────────────────────────────────

test('снимок продукта не выдумывает нули вместо неизвестного', () => {
  // Глобальная база часто знает только калорийность. Снимок кладут в избранное,
  // в своё блюдо и в рецепт — и раньше именно в этот момент «БЖУ не указаны»
  // молча превращалось в «Б0 У0 Ж0». Поиск говорил одно, избранное — другое.
  const snap = foodSnapshot({ name: 'Печенье', unit: 'г', grams: 150, kcal: 683, protein: null, carbs: null, fat: null })
  assert.equal(snap.kcal, 683, 'калорийность известна')
  assert.equal(snap.protein, null)
  assert.equal(snap.carbs, null)
  assert.equal(snap.fat, null)
})

test('измеренный ноль снимок сохраняет как ноль', () => {
  // Обратная сторона: у масла углеводов действительно нет.
  const snap = foodSnapshot({ name: 'Масло', unit: 'г', grams: 10, kcal: 90, protein: 0, carbs: 0, fat: 10 })
  assert.equal(snap.protein, 0)
  assert.equal(snap.carbs, 0)
})

test('пересчёт записи на 100 г не создаёт знания', () => {
  const per = toPer100({ name: 'Печенье', unit: 'г', grams: 150, kcal: 683, protein: null, carbs: null, fat: null })
  assert.equal(per.kcal, 455)
  assert.equal(per.protein, null, 'делить «неизвестно» бессмысленно')
  const known = toPer100({ name: 'Овсянка', unit: 'г', grams: 50, kcal: 100, protein: 5, carbs: 10, fat: 2 })
  assert.equal(known.protein, 10, 'известное считается как считалось')
})
