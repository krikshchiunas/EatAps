// Правки дневника как чистые функции. Раньше эта логика жила внутри store.jsx
// вперемешку с эффектами, и проверить её можно было только подняв React вместе
// с провайдером — то есть на практике никак.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeEntry, withEntries, withoutEntry, withEditedEntry,
  copiesOfDay, copiesOfMeal, withRecents, recentSnapshot,
  withUpsertedSection, withoutSection,
  withDayField, withMood, withToggledWellbeing, withConfirmedStats,
  MAX_RECENTS,
} from './diaryActions.js'
import { emptyMeta, blankDay } from './syncModel.js'

const TS = '2026-09-12T10:00:00.000Z-0001-aaaaaaaa'
const TS2 = '2026-09-12T11:00:00.000Z-0001-aaaaaaaa'
const DATE = '2026-09-12'

const base = (day = {}) => ({
  days: { [DATE]: { ...blankDay(), ...day } },
  recents: [],
  meta: emptyMeta(),
})

const food = (over = {}) => ({
  name: 'Банан', emoji: '🍌', unit: 'г', grams: 100,
  kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, ...over,
})

// ── Добавление ───────────────────────────────────────────────────────────────
test('добавление кладёт запись в день и поднимает её в недавние', () => {
  const entry = makeEntry(food(), { id: 'e1', createdAt: 'now', ts: TS })
  const s = withEntries(base(), DATE, [entry])

  assert.equal(s.days[DATE].meals.length, 1)
  assert.equal(s.days[DATE].meals[0].id, 'e1')
  assert.equal(s.days[DATE].meals[0].updatedAt, TS)
  assert.equal(s.recents.length, 1)
  assert.equal(s.recents[0].name, 'Банан')
  assert.equal(s.recents[0].count, 1)
})

test('повторное добавление того же продукта увеличивает счётчик, а не плодит строки', () => {
  let s = withEntries(base(), DATE, [makeEntry(food(), { id: 'e1', createdAt: 'n', ts: TS })])
  s = withEntries(s, DATE, [makeEntry(food(), { id: 'e2', createdAt: 'n', ts: TS2 })])

  assert.equal(s.days[DATE].meals.length, 2, 'обе записи должны попасть в день')
  assert.equal(s.recents.length, 1, 'в недавних появился дубликат')
  assert.equal(s.recents[0].count, 2)
})

test('недавние различают продукты по имени И единице', () => {
  // «Молоко 200 г» и «Молоко 200 мл» — разные записи; по одному имени они
  // слились бы, и при нормализации перед отправкой одна исчезла бы со счётчиком.
  const s = withRecents([], [food({ name: 'Молоко', unit: 'г' }), food({ name: 'Молоко', unit: 'мл' })])
  assert.equal(s.length, 2)
})

test('регистр имени не плодит разные строки в недавних', () => {
  const s = withRecents([], [food({ name: 'Банан' }), food({ name: 'банан' })])
  assert.equal(s.length, 1, '«Банан» и «банан» разъехались в две строки')
  assert.equal(s[0].count, 2)
})

test('список недавних не растёт бесконечно', () => {
  const many = Array.from({ length: MAX_RECENTS + 15 }, (_, i) => food({ name: `Продукт ${i}` }))
  assert.equal(withRecents([], many).length, MAX_RECENTS)
})

test('в недавние не попадает порция — только сам продукт', () => {
  // Список хранит продукт; привычное количество приходит из журнала приёмов.
  const snap = recentSnapshot(food({ grams: 250 }))
  assert.equal(snap.grams, 250, 'снимок хранит граммы для подстановки')
  assert.equal(snap.name, 'Банан')
  assert.ok(!('id' in snap) && !('mealId' in snap), 'в снимок попали поля записи дневника')
})

test('пакетное и одиночное добавление ведут себя одинаково', () => {
  // Раньше эта логика была написана дважды слово в слово — и именно такие
  // копии со временем расходятся.
  const two = [food({ name: 'Рис' }), food({ name: 'Рис' })]
  const batch = withEntries(base(), DATE, two.map((f, i) => makeEntry(f, { id: `b${i}`, createdAt: 'n', ts: TS })))

  let one = base()
  two.forEach((f, i) => { one = withEntries(one, DATE, [makeEntry(f, { id: `b${i}`, createdAt: 'n', ts: TS })]) })

  assert.deepEqual(
    batch.recents.map((r) => [r.name, r.count]),
    one.recents.map((r) => [r.name, r.count]),
  )
})

test('пустой список ничего не меняет', () => {
  const s = base()
  assert.equal(withEntries(s, DATE, []), s, 'состояние пересоздано на пустом добавлении')
})

// ── Удаление и правка ────────────────────────────────────────────────────────
test('удаление оставляет тумбстоун — иначе запись воскреснет при слиянии', () => {
  const s0 = withEntries(base(), DATE, [makeEntry(food(), { id: 'e1', createdAt: 'n', ts: TS })])
  const s1 = withoutEntry(s0, DATE, 'e1', TS2)

  assert.equal(s1.days[DATE].meals.length, 0)
  const tombs = JSON.stringify(s1.meta.tombstones)
  assert.match(tombs, /e1/, 'тумбстоун не выставлен')
})

test('правка записи обновляет метку времени', () => {
  const s0 = withEntries(base(), DATE, [makeEntry(food(), { id: 'e1', createdAt: 'n', ts: TS })])
  const s1 = withEditedEntry(s0, DATE, { ...s0.days[DATE].meals[0], grams: 200 }, TS2)

  assert.equal(s1.days[DATE].meals[0].grams, 200)
  assert.equal(s1.days[DATE].meals[0].updatedAt, TS2, 'без новой метки правка не доедет до другого устройства')
})

test('правка не трогает чужие записи', () => {
  let s = withEntries(base(), DATE, [
    makeEntry(food({ name: 'А' }), { id: 'e1', createdAt: 'n', ts: TS }),
    makeEntry(food({ name: 'Б' }), { id: 'e2', createdAt: 'n', ts: TS }),
  ])
  s = withEditedEntry(s, DATE, { id: 'e1', name: 'А+', grams: 1 }, TS2)
  assert.equal(s.days[DATE].meals.find((m) => m.id === 'e2').name, 'Б')
})

// ── Повтор дня и приёма ──────────────────────────────────────────────────────
test('повтор копирует снимки без полей синхронизации', () => {
  const s = withEntries(base(), DATE, [makeEntry(food(), { id: 'e1', createdAt: 'n', ts: TS })])
  const [copy] = copiesOfDay(s, DATE)

  // Унеси копия чужой id — слияние сочло бы её тем же самым продуктом, и
  // правка копии задним числом изменила бы прошлый день.
  assert.ok(!('id' in copy), 'копия унесла id оригинала')
  assert.ok(!('updatedAt' in copy), 'копия унесла метку оригинала')
  assert.ok(!('createdAt' in copy), 'копия унесла время создания оригинала')
  assert.equal(copy.name, 'Банан')
})

test('повтор приёма берёт только его продукты и умеет менять приём', () => {
  const s = withEntries(base(), DATE, [
    makeEntry(food({ name: 'Каша', mealId: 'std:breakfast' }), { id: 'e1', createdAt: 'n', ts: TS }),
    makeEntry(food({ name: 'Суп', mealId: 'std:lunch' }), { id: 'e2', createdAt: 'n', ts: TS }),
  ])
  const copies = copiesOfMeal(s, DATE, 'std:breakfast', 'std:dinner')

  assert.equal(copies.length, 1)
  assert.equal(copies[0].name, 'Каша')
  assert.equal(copies[0].mealId, 'std:dinner', 'перенос «завтрак → ужин» не сработал')
})

test('повтор пустого дня ничего не возвращает', () => {
  assert.deepEqual(copiesOfDay(base(), '2020-01-01'), [])
  assert.deepEqual(copiesOfDay(base(), DATE), [])
})

// ── Приёмы пищи ──────────────────────────────────────────────────────────────
test('удаление своего приёма уносит и его продукты, и тумбстоуны на всё', () => {
  let s = withUpsertedSection(base(), DATE, { id: 'custom:1', customName: 'Полдник' }, TS)
  s = withEntries(s, DATE, [makeEntry(food({ mealId: 'custom:1' }), { id: 'e1', createdAt: 'n', ts: TS })])

  const after = withoutSection(s, DATE, 'custom:1', TS2)
  assert.equal(after.days[DATE].meals.length, 0, 'продукты удалённого приёма остались')

  const tombs = JSON.stringify(after.meta.tombstones)
  assert.match(tombs, /custom:1/, 'нет тумбстоуна на сам приём')
  assert.match(tombs, /e1/, 'нет тумбстоуна на продукт удалённого приёма')
})

// ── Скаляры дня ──────────────────────────────────────────────────────────────
test('поле дня получает СВОЮ метку времени', () => {
  // Ради этого dayFieldTs и существует: взвешивание на телефоне не должно
  // конфликтовать с добавлением еды на компьютере.
  const s = withDayField(base(), DATE, 'weight', 80, TS)
  assert.equal(s.days[DATE].weight, 80)
  assert.equal(s.meta.dayFieldTs[DATE].weight, TS)
})

test('запись того же значения не жжёт метку', () => {
  const s0 = withDayField(base(), DATE, 'weight', 80, TS)
  const s1 = withDayField(s0, DATE, 'weight', 80, TS2)
  assert.equal(s1, s0, 'состояние пересоздано без изменения — лишний конфликт при слиянии')
})

test('самочувствие переключается в обе стороны', () => {
  const on = withToggledWellbeing(base(), DATE, 'сон', TS)
  assert.deepEqual(on.days[DATE].wellbeing, ['сон'])
  const off = withToggledWellbeing(on, DATE, 'сон', TS2)
  assert.deepEqual(off.days[DATE].wellbeing, [])
  assert.equal(off.meta.dayFieldTs[DATE].wellbeing, TS2)
})

test('настроение версионируется отдельным полем', () => {
  const s = withMood(base(), DATE, 'good', TS)
  assert.equal(s.days[DATE].mood, 'good')
  assert.equal(s.meta.dayFieldTs[DATE].mood, TS)
})

test('«учитывать всё равно» помечает ОБА поля', () => {
  // Иначе с другого устройства вернётся половина решения: день снова исключён,
  // но уже «подтверждён».
  const s0 = withDayField(base(), DATE, 'statsExcluded', true, TS)
  const s1 = withConfirmedStats(s0, DATE, TS2)

  assert.equal(s1.days[DATE].statsExcluded, false)
  assert.equal(s1.days[DATE].statsConfirmed, true)
  assert.equal(s1.meta.dayFieldTs[DATE].statsConfirmed, TS2)
  assert.equal(s1.meta.dayFieldTs[DATE].statsExcluded, TS2, 'метка на снятие исключения не выставлена')
})

// ── Неизменяемость ───────────────────────────────────────────────────────────
test('исходное состояние не мутируется', () => {
  const s0 = withEntries(base(), DATE, [makeEntry(food(), { id: 'e1', createdAt: 'n', ts: TS })])
  const snapshot = JSON.stringify(s0)

  withoutEntry(s0, DATE, 'e1', TS2)
  withEditedEntry(s0, DATE, { id: 'e1', name: 'X' }, TS2)
  withDayField(s0, DATE, 'weight', 90, TS2)
  withEntries(s0, DATE, [makeEntry(food(), { id: 'e2', createdAt: 'n', ts: TS2 })])

  assert.equal(JSON.stringify(s0), snapshot,
    'чистая функция изменила переданное состояние — React не увидит обновления')
})
