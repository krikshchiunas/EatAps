// Слияние состояния: сценарии, из-за которых раньше пропадали данные.
// Каждый тест назван по симптому, который он предотвращает.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClock, ZERO_TS } from './hlc.js'
import {
  mergeState, normalizeState, pickSyncable, sameSyncable, clearedState,
  addTombstone, setDayFieldTs, setPrefTs, emptyMeta, blankDay,
  tombMeal, tombSection, tombCustomFood, tombTemplate, tombRecipe,
  tombSupp, tombSupplement, isDayEmpty,
} from './syncModel.js'

// Два независимых устройства с собственными часами.
const ms = { a: 1_000, b: 1_000 }
const phone = createClock({ deviceId: 'aaaaaaaa', now: () => ms.a })
const laptop = createClock({ deviceId: 'bbbbbbbb', now: () => ms.b })

const DATE = '2026-08-06'
const food = (id, name, ts) => ({ id, name, kcal: 100, updatedAt: ts })

function stateWith(days = {}, extra = {}) {
  return normalizeState({ days, meta: emptyMeta(), ...extra })
}

function withMeal(state, date, entry) {
  const day = state.days[date] || blankDay()
  return { ...state, days: { ...state.days, [date]: { ...day, meals: [...day.meals, entry] } } }
}

// ── Основной сценарий: потеря чужих правок ──────────────────────────────────

test('правки двух устройств объединяются, ни одна не теряется', () => {
  const server = stateWith({ [DATE]: { ...blankDay(), meals: [food('m1', 'Овсянка', phone.tick())] } })

  // Телефон добавил яблоко, ноутбук — кофе; оба основаны на одной версии.
  const fromPhone = withMeal(server, DATE, food('m2', 'Яблоко', phone.tick()))
  const fromLaptop = withMeal(server, DATE, food('m3', 'Кофе', laptop.tick()))

  const merged = mergeState(fromPhone, fromLaptop)
  const names = merged.days[DATE].meals.map((m) => m.name).sort()
  assert.deepEqual(names, ['Кофе', 'Овсянка', 'Яблоко'])
})

test('старый снимок устройства не затирает более новые правки', () => {
  const base = stateWith({ [DATE]: { ...blankDay(), meals: [food('m1', 'Овсянка', phone.tick())] } })

  // Ноутбук успел отредактировать продукт.
  ms.b = 5_000
  const edited = {
    ...base,
    days: { [DATE]: { ...base.days[DATE], meals: [food('m1', 'Овсянка 200 г', laptop.tick())] } },
  }

  // Телефон приходит из офлайна со своей устаревшей копией.
  const merged = mergeState(edited, base)
  assert.equal(merged.days[DATE].meals[0].name, 'Овсянка 200 г')
})

test('слияние идемпотентно и коммутативно по результату', () => {
  const a = withMeal(stateWith(), DATE, food('m1', 'Рис', phone.tick()))
  const b = withMeal(stateWith(), DATE, food('m2', 'Рыба', laptop.tick()))

  const ab = mergeState(a, b)
  const ba = mergeState(b, a)
  assert.deepEqual(
    ab.days[DATE].meals.map((m) => m.id).sort(),
    ba.days[DATE].meals.map((m) => m.id).sort(),
  )
  // Повторное слияние ничего не меняет — движок не будет писать в цикле.
  assert.ok(sameSyncable(ab, mergeState(ab, ab)))
  assert.ok(sameSyncable(ab, mergeState(ab, a)))
})

// ── Удаления ────────────────────────────────────────────────────────────────

test('удалённый продукт не воскресает из копии другого устройства', () => {
  const eaten = food('m1', 'Пирожное', phone.tick())
  const withFood = withMeal(stateWith(), DATE, eaten)

  // Телефон удалил запись и оставил тумбстоун.
  const deleted = {
    ...withFood,
    days: { [DATE]: { ...withFood.days[DATE], meals: [] } },
    meta: addTombstone(withFood.meta, tombMeal(DATE, 'm1'), phone.tick()),
  }

  const merged = mergeState(withFood, deleted)  // сервер ещё со старой копией
  assert.equal(merged.days[DATE], undefined, 'пустой день не сохраняется')
  assert.equal(Object.keys(merged.days).length, 0)
})

test('запись, изменённая после удаления, остаётся живой', () => {
  const entry = food('m1', 'Салат', phone.tick())
  const withFood = withMeal(stateWith(), DATE, entry)
  const deletedTs = phone.tick()

  ms.b = 90_000
  const revived = withMeal(
    { ...stateWith(), meta: addTombstone(emptyMeta(), tombMeal(DATE, 'm1'), deletedTs) },
    DATE,
    food('m1', 'Салат заново', laptop.tick()),
  )

  const merged = mergeState(withFood, revived)
  assert.equal(merged.days[DATE].meals.length, 1)
  assert.equal(merged.days[DATE].meals[0].name, 'Салат заново')
})

test('удаление приёма пищи уносит его продукты и не возвращает их', () => {
  const ts = phone.tick()
  const base = normalizeState({
    days: { [DATE]: { ...blankDay(), meals: [food('m1', 'Суп', ts)], mealSections: [{ id: 's1', type: 'custom', updatedAt: ts }] } },
    meta: emptyMeta(),
  })
  const delTs = phone.tick()
  let meta = addTombstone(base.meta, tombSection(DATE, 's1'), delTs)
  meta = addTombstone(meta, tombMeal(DATE, 'm1'), delTs)
  const deleted = { ...base, days: { [DATE]: blankDay() }, meta }

  const merged = mergeState(base, deleted)
  assert.equal(merged.days[DATE], undefined)
})

// ── Скаляры ─────────────────────────────────────────────────────────────────

test('профиль: выигрывает более поздняя правка, а не «кто последним вошёл»', () => {
  const older = { ...stateWith(), profile: { name: 'Аня', weight: 60 }, meta: { ...emptyMeta(), profileTs: phone.tick() } }
  ms.b = 200_000
  const newer = { ...stateWith(), profile: { name: 'Аня', weight: 58 }, meta: { ...emptyMeta(), profileTs: laptop.tick() } }

  assert.equal(mergeState(older, newer).profile.weight, 58)
  assert.equal(mergeState(newer, older).profile.weight, 58)
})

test('пустой профиль без метки не стирает заполненный (легаси-данные)', () => {
  const cloud = { ...stateWith(), profile: { name: 'Аня' }, meta: emptyMeta() }
  const freshDevice = stateWith() // профиля нет, метки нулевые
  assert.equal(mergeState(cloud, freshDevice).profile.name, 'Аня')
  assert.equal(mergeState(freshDevice, cloud).profile.name, 'Аня')
})

test('настроение и заметка дня версионируются отдельно от списка еды', () => {
  const base = withMeal(stateWith(), DATE, food('m1', 'Чай', phone.tick()))

  // Телефон отметил настроение.
  const moodTs = phone.tick()
  const withMood = {
    ...base,
    days: { [DATE]: { ...base.days[DATE], mood: 'good' } },
    meta: setDayFieldTs(base.meta, DATE, 'mood', moodTs),
  }
  // Ноутбук в это же время добавил еду.
  const withFood = withMeal(base, DATE, food('m2', 'Хлеб', laptop.tick()))

  const merged = mergeState(withMood, withFood)
  assert.equal(merged.days[DATE].mood, 'good', 'настроение не потерялось')
  assert.equal(merged.days[DATE].meals.length, 2, 'еда не потерялась')
})

test('настройки сливаются по ключам, а не объектом целиком', () => {
  const a = { ...stateWith(), prefs: { unit: 'г' }, meta: setPrefTs(emptyMeta(), 'unit', phone.tick()) }
  ms.b = 300_000
  const b = { ...stateWith(), prefs: { sort: 'name' }, meta: setPrefTs(emptyMeta(), 'sort', laptop.tick()) }
  const merged = mergeState(a, b)
  assert.deepEqual(merged.prefs, { unit: 'г', sort: 'name' })
})

test('тема — личная настройка устройства только до явного выбора', () => {
  const a = { ...stateWith(), theme: 'dark', meta: { ...emptyMeta(), themeTs: phone.tick() } }
  ms.b = 400_000
  const b = { ...stateWith(), theme: 'light', meta: { ...emptyMeta(), themeTs: laptop.tick() } }
  assert.equal(mergeState(a, b).theme, 'light')
})

// ── Устойчивость к мусору ───────────────────────────────────────────────────

test('нормализация переживает любой вход и не бросает', () => {
  for (const junk of [null, undefined, 0, 'строка', [], { days: 'нет' }, { days: { 'кривая-дата': {} } }]) {
    const n = normalizeState(junk)
    assert.equal(typeof n.days, 'object')
    assert.ok(Array.isArray(n.customFoods))
    assert.equal(n.meta.v, 2)
  }
  assert.deepEqual(normalizeState({ days: { 'кривая-дата': {} } }).days, {})
})

test('записи без id отбрасываются, дубликаты id схлопываются', () => {
  const n = normalizeState({
    customFoods: [{ name: 'Без id' }, { id: 'x', name: 'Первый' }, { id: 'x', name: 'Дубль' }],
  })
  assert.equal(n.customFoods.length, 1)
  assert.equal(n.customFoods[0].name, 'Первый')
})

test('легаси-состояние без meta читается и не теряет данных', () => {
  const legacy = {
    profile: { name: 'Старый' },
    theme: 'system',
    days: { [DATE]: { meals: [{ id: 'm1', name: 'Каша', kcal: 200 }], mood: 'ok' } },
    customFoods: [{ id: 'cf1', name: 'Творог' }],
    recents: [{ name: 'Творог', ts: 5 }],
  }
  const n = normalizeState(legacy)
  assert.equal(n.profile.name, 'Старый')
  assert.equal(n.theme, null, "'system' больше не режим — приводится к системной теме на устройстве")
  assert.equal(n.days[DATE].meals[0].updatedAt, ZERO_TS)
  assert.equal(n.customFoods[0].name, 'Творог')

  // И такое состояние спокойно сливается с новым.
  const updated = withMeal(n, DATE, food('m2', 'Кефир', laptop.tick()))
  const merged = mergeState(n, updated)
  assert.equal(merged.days[DATE].meals.length, 2)
})

test('pickSyncable не выпускает подписку в облако', () => {
  const picked = pickSyncable({ ...stateWith(), subscription: { tier: 'AI_PLUS' }, случайноеПоле: 1 })
  assert.equal(picked.subscription, undefined)
  assert.equal(picked.случайноеПоле, undefined)
  assert.ok('meta' in picked)
})

test('recents схлопываются по имени и ограничены сорока', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `Еда${i}`, ts: i }))
  const a = { ...stateWith(), recents: many }
  const b = { ...stateWith(), recents: [{ name: 'Еда0', ts: 999 }] }
  const merged = mergeState(a, b)
  assert.equal(merged.recents.length, 40)
  assert.equal(merged.recents.find((r) => r.name === 'Еда0').ts, 999)
})

// ── Сброс данных ────────────────────────────────────────────────────────────

test('сброс данных переживает слияние с сервером — история не возвращается', () => {
  const full = withMeal(
    { ...stateWith(), profile: { name: 'Аня' }, customFoods: [{ id: 'cf1', name: 'Творог', updatedAt: phone.tick() }] },
    DATE,
    food('m1', 'Овсянка', phone.tick()),
  )

  const wiped = clearedState(full, phone.tick())
  const merged = mergeState(full, wiped) // full = то, что ещё лежит на сервере

  assert.deepEqual(merged.days, {})
  assert.deepEqual(merged.customFoods, [])
  assert.equal(merged.profile, null)
  assert.ok(merged.meta.tombstones[tombMeal(DATE, 'm1')])
  assert.ok(merged.meta.tombstones[tombCustomFood('cf1')])
})

// ── Шаблоны приёмов и рецепты ────────────────────────────────────────────────

test('шаблон, созданный на телефоне, доезжает до ноутбука', () => {
  const t = phone.tick()
  const a = stateWith({}, { templates: [{ id: 't1', name: 'Мой завтрак', items: [food('i1', 'Овсянка', t)], updatedAt: t }] })
  const merged = mergeState(stateWith(), a)
  assert.equal(merged.templates.length, 1)
  assert.equal(merged.templates[0].name, 'Мой завтрак')
})

test('удалённый шаблон не воскресает со второго устройства', () => {
  // Тот самый случай, ради которого нужны тумбстоуны: на ноутбуке шаблон ещё
  // жив, и без записи об удалении слияние вернуло бы его обратно.
  const t0 = phone.tick()
  const tpl = { id: 't1', name: 'Мой завтрак', items: [food('i1', 'Овсянка', t0)], updatedAt: t0 }
  const laptopState = stateWith({}, { templates: [tpl] })

  const tDel = phone.tick()
  const phoneState = normalizeState({
    ...stateWith({}, { templates: [] }),
    meta: addTombstone(emptyMeta(), tombTemplate('t1'), tDel),
  })

  assert.equal(mergeState(phoneState, laptopState).templates.length, 0)
  assert.equal(mergeState(laptopState, phoneState).templates.length, 0, 'порядок слияния не важен')
})

test('правка шаблона сохраняет id, а не плодит копии', () => {
  const t0 = phone.tick()
  const base = stateWith({}, { templates: [{ id: 't1', name: 'Завтрак', items: [food('i1', 'Овсянка', t0)], updatedAt: t0 }] })
  const t1 = laptop.tick()
  const edited = stateWith({}, { templates: [{ id: 't1', name: 'Завтрак выходного дня', items: [food('i1', 'Овсянка', t0)], updatedAt: t1 }] })
  const merged = mergeState(base, edited)
  assert.equal(merged.templates.length, 1, 'два «Завтрака» — недопустимо')
  assert.equal(merged.templates[0].name, 'Завтрак выходного дня', 'выигрывает более поздняя правка')
})

test('рецепты сливаются и удаляются по тем же правилам', () => {
  const t = phone.tick()
  const rcp = { id: 'r1', name: 'Борщ', servings: 6, items: [food('i1', 'Свёкла', t)], updatedAt: t }
  const withRecipe = stateWith({}, { recipes: [rcp] })
  assert.equal(mergeState(stateWith(), withRecipe).recipes.length, 1)

  const tDel = phone.tick()
  const deleted = normalizeState({ ...stateWith(), meta: addTombstone(emptyMeta(), tombRecipe('r1'), tDel) })
  assert.equal(mergeState(deleted, withRecipe).recipes.length, 0)
})

test('шаблоны и рецепты уходят в облако и стираются при очистке', () => {
  const t = phone.tick()
  const s = stateWith({}, {
    templates: [{ id: 't1', name: 'Завтрак', items: [food('i1', 'Овсянка', t)], updatedAt: t }],
    recipes: [{ id: 'r1', name: 'Борщ', servings: 6, items: [], updatedAt: t }],
  })
  const syncable = pickSyncable(s)
  assert.ok('templates' in syncable && 'recipes' in syncable, 'иначе они не переживут переустановку')

  const wiped = clearedState(s, phone.tick())
  assert.deepEqual(wiped.templates, [])
  assert.deepEqual(wiped.recipes, [])
  assert.ok(wiped.meta.tombstones[tombTemplate('t1')], 'без тумбстоуна вернётся с другого устройства')
  assert.ok(wiped.meta.tombstones[tombRecipe('r1')])
})

// ── Добавки ──────────────────────────────────────────────────────────────────
// Приёмы добавок живут в дне отдельным списком, а стек — отдельной сущностью
// верхнего уровня. И то и другое человек ведёт руками, поэтому оба обязаны
// сливаться как еда и избранное, а не «кто последний, тот прав».

const supp = (id, name, ts, provides = { vitD: 50 }) =>
  ({ id, suppId: null, name, unit: 'капсула', dose: 1, provides, updatedAt: ts })

test('приёмы добавок с двух устройств объединяются, ни один не теряется', () => {
  const server = stateWith({ [DATE]: { ...blankDay(), supps: [supp('p1', 'Витамин D', phone.tick())] } })
  const addTo = (state, entry) => {
    const day = state.days[DATE]
    return { ...state, days: { ...state.days, [DATE]: { ...day, supps: [...day.supps, entry] } } }
  }
  const fromPhone = addTo(server, supp('p2', 'Магний', phone.tick()))
  const fromLaptop = addTo(server, supp('p3', 'Омега-3', laptop.tick()))

  const merged = mergeState(fromPhone, fromLaptop)
  const names = merged.days[DATE].supps.map((x) => x.name).sort()
  assert.deepEqual(names, ['Витамин D', 'Магний', 'Омега-3'])
})

test('снятая на телефоне галочка не возвращается с ноутбука', () => {
  const t = phone.tick()
  const withSupp = stateWith({ [DATE]: { ...blankDay(), supps: [supp('p1', 'Креатин', t)] } })
  const tDel = phone.tick()
  const deleted = normalizeState({
    ...stateWith({ [DATE]: { ...blankDay(), meals: [food('m1', 'Овсянка', t)] } }),
    meta: addTombstone(emptyMeta(), tombSupp(DATE, 'p1'), tDel),
  })
  const merged = mergeState(deleted, withSupp)
  assert.deepEqual(merged.days[DATE].supps, [], 'приём воскрес из копии другого устройства')
})

test('день, где только выпиты витамины, не считается пустым', () => {
  // Иначе слияние выбросило бы его целиком, и человек потерял бы отметку
  // «сегодня креатин выпит» просто потому, что забыл записать еду.
  const day = { ...blankDay(), supps: [supp('p1', 'Креатин', phone.tick())] }
  assert.equal(isDayEmpty(day), false)
  assert.equal(isDayEmpty(blankDay()), true)

  const merged = mergeState(stateWith(), stateWith({ [DATE]: day }))
  assert.equal(merged.days[DATE].supps.length, 1, 'день с одними добавками не должен исчезать')
})

test('стек добавок сливается и удаляется как избранное', () => {
  const t = phone.tick()
  const item = { id: 's1', suppId: 'creatine', name: 'Креатин', unit: 'г', dose: 5, provides: { creatine: 1 }, updatedAt: t }
  const withStack = stateWith({}, { supplements: [item] })
  assert.equal(mergeState(stateWith(), withStack).supplements.length, 1)

  const tDel = phone.tick()
  const deleted = normalizeState({ ...stateWith(), meta: addTombstone(emptyMeta(), tombSupplement('s1'), tDel) })
  assert.equal(mergeState(deleted, withStack).supplements.length, 0)
})

test('правка дозы в стеке побеждает по времени, а не по устройству', () => {
  const base = { id: 's1', suppId: 'creatine', name: 'Креатин', unit: 'г', provides: { creatine: 1 } }
  const older = stateWith({}, { supplements: [{ ...base, dose: 3, updatedAt: phone.tick() }] })
  ms.b = 5_000
  const newer = stateWith({}, { supplements: [{ ...base, dose: 5, updatedAt: laptop.tick() }] })
  assert.equal(mergeState(older, newer).supplements[0].dose, 5)
  assert.equal(mergeState(newer, older).supplements[0].dose, 5, 'порядок аргументов не должен решать')
})

test('стек и приёмы уходят в облако и стираются при сбросе данных', () => {
  const t = phone.tick()
  const s = stateWith(
    { [DATE]: { ...blankDay(), supps: [supp('p1', 'Витамин D', t)] } },
    { supplements: [{ id: 's1', suppId: 'vitd-2000', name: 'Витамин D3', unit: 'капсула', dose: 1, provides: { vitD: 50 }, updatedAt: t }] },
  )
  const syncable = pickSyncable(s)
  assert.ok('supplements' in syncable, 'стек не переживёт переустановку приложения')
  assert.ok(syncable.days[DATE].supps.length === 1, 'приёмы не уедут в облако')

  const wiped = clearedState(s, phone.tick())
  assert.deepEqual(wiped.supplements, [])
  assert.deepEqual(wiped.days, {})
  assert.ok(wiped.meta.tombstones[tombSupp(DATE, 'p1')], 'без тумбстоуна приём вернётся с другого устройства')
  assert.ok(wiped.meta.tombstones[tombSupplement('s1')])
})

test('состояние без добавок читается без потерь', () => {
  // Данные, записанные предыдущей версией приложения, не содержат ни supps,
  // ни supplements. Они обязаны открыться, а не упасть и не обнулиться.
  const legacy = normalizeState({ days: { [DATE]: { meals: [food('m1', 'Овсянка', ZERO_TS)] } } })
  assert.deepEqual(legacy.days[DATE].supps, [])
  assert.deepEqual(legacy.supplements, [])
  assert.equal(legacy.days[DATE].meals.length, 1)
})

// ── Балл активности дня ──────────────────────────────────────────────────────
// Поле писалось стором и читалось расчётом калорий, но в DAY_SCALARS его не
// было: метка времени терялась при слиянии, а день, где человек только двинул
// ползунок, считался пустым и удалялся вместе со своей целью по калориям.

test('балл активности версионируется своей меткой, а не спредом', () => {
  const dayWith = (score, ts) => {
    const meta = setDayFieldTs(emptyMeta(), DATE, 'activityScore', ts)
    return normalizeState({ days: { [DATE]: { ...blankDay(), activityScore: score } }, meta })
  }
  const older = dayWith(30, phone.tick())
  ms.b = 9_000
  const newer = dayWith(85, laptop.tick())

  assert.equal(mergeState(older, newer).days[DATE].activityScore, 85)
  assert.equal(mergeState(newer, older).days[DATE].activityScore, 85,
    'порядок аргументов решать не должен — иначе цель по калориям скачет между устройствами')
})

test('день, где двинули только ползунок активности, не считается пустым', () => {
  const day = { ...blankDay(), activityScore: 70 }
  assert.equal(isDayEmpty(day), false)
  const merged = mergeState(stateWith(), stateWith({ [DATE]: day }))
  assert.equal(merged.days[DATE]?.activityScore, 70, 'день с одной активностью исчезал вместе с целью')
})

test('мусорный балл активности не доезжает до расчёта калорий', () => {
  const norm = (v) => normalizeState({ days: { [DATE]: { ...blankDay(), activityScore: v, note: 'x' } } }).days[DATE].activityScore
  assert.equal(norm(150), 100, 'выше сотни ползунок не уезжает')
  assert.equal(norm(-20), 0)
  assert.equal(norm('высокая'), null)
  assert.equal(norm(''), null)
  assert.equal(norm(62.4), 62)
})
