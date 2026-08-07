// Слияние состояния: сценарии, из-за которых раньше пропадали данные.
// Каждый тест назван по симптому, который он предотвращает.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClock, ZERO_TS } from './hlc.js'
import {
  mergeState, normalizeState, pickSyncable, sameSyncable, clearedState,
  addTombstone, setDayFieldTs, setPrefTs, emptyMeta, blankDay,
  tombMeal, tombSection, tombCustomFood,
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
