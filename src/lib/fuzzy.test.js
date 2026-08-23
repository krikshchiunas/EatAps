import test from 'node:test'
import assert from 'node:assert/strict'
import { editDistance, maxDistanceFor, fuzzyWordDistance, scoreEntry, rankedSearch } from './fuzzy.js'
import { searchLocal, getPortions, inferCat } from './foods.js'

// ── Расстояние ────────────────────────────────────────────────────────────────

test('editDistance: базовые правки', () => {
  assert.equal(editDistance('молоко', 'молоко'), 0)
  assert.equal(editDistance('малоко', 'молоко'), 1) // замена
  assert.equal(editDistance('молко', 'молоко'), 1) // пропуск
  assert.equal(editDistance('моллоко', 'молоко'), 1) // лишняя буква
})

test('editDistance: перестановка соседних букв — одна правка', () => {
  // Классическая опечатка быстрого набора. Без Дамерау это стоило бы 2 правки.
  assert.equal(editDistance('омлоко', 'молоко'), 1)
  assert.equal(editDistance('гречкa'.replace('a', 'а'), 'гречка'), 0)
  assert.equal(editDistance('гречак', 'гречка'), 1)
})

test('editDistance: превышение лимита обрывается рано', () => {
  assert.equal(editDistance('абвгд', 'молоко', 2), 3) // max + 1
  assert.equal(editDistance('', 'молоко', 2), 3)
  assert.equal(editDistance('молоко', '', 2), 3)
})

test('maxDistanceFor: короткие слова правок не допускают', () => {
  assert.equal(maxDistanceFor('сок'), 0)
  assert.equal(maxDistanceFor('чай'), 0)
  assert.equal(maxDistanceFor('молоко'), 1)
  assert.equal(maxDistanceFor('гречневая'), 2)
})

test('fuzzyWordDistance сравнивает начало длинного слова', () => {
  // Человек набрал часть слова с опечаткой — продукт всё равно должен найтись.
  assert.equal(fuzzyWordDistance('гречневая', 'гречнвая'), 1)
  assert.notEqual(fuzzyWordDistance('гречневая', 'гречнев'), null)
  // «сок» против «сом» — разные продукты, склеивать нельзя.
  assert.equal(fuzzyWordDistance('сом', 'сок'), null)
})

// ── Скоринг ───────────────────────────────────────────────────────────────────

test('точное совпадение названия важнее вхождения в синоним', () => {
  const exact = scoreEntry('рис', 'рис', ['рис'])
  const inside = scoreEntry('плов с рисом и мясом', 'плов с рисом и мясом', ['рис'])
  assert.ok(exact > inside)
})

test('при равном совпадении короткое название выигрывает', () => {
  const short = scoreEntry('рис отварной', 'рис отварной', ['рис'])
  const long = scoreEntry('рис отварной с овощами и курицей гриль', 'рис отварной с овощами и курицей гриль', ['рис'])
  assert.ok(short > long)
})

test('нет совпадения → отрицательный балл', () => {
  assert.equal(scoreEntry('банан', 'банан', ['стейк']), -1)
})

test('rankedSearch: строгий проход не уходит в нечёткий без нужды', () => {
  const items = ['молоко', 'молоко топлёное', 'молочный коктейль', 'мороженое']
  const res = rankedSearch(items, ['молоко'], { toText: (x) => x, toName: (x) => x, minResults: 2 })
  assert.equal(res[0], 'молоко')
  assert.ok(res.includes('молоко топлёное'))
})

// ── Интеграция с базой продуктов ──────────────────────────────────────────────

test('поиск переживает опечатку в названии продукта', () => {
  const ok = searchLocal('гречка')
  assert.ok(ok.length > 0)
  const typo = searchLocal('гречкa'.replace('a', 'а').replace('ч', 'ч')) // контроль
  assert.ok(typo.length > 0)

  // Настоящие опечатки: пропущенная и переставленная буква.
  const missing = searchLocal('гречнвая')
  assert.ok(missing.length > 0, 'пропущенная буква должна прощаться')

  const swapped = searchLocal('малоко')
  assert.ok(swapped.length > 0, 'замена гласной должна прощаться')
  assert.ok(/молок/i.test(swapped[0].name), `ожидали молоко первым, получили ${swapped[0]?.name}`)
})

test('точный запрос выдаёт сам продукт первым, а не составное блюдо', () => {
  const res = searchLocal('рис')
  assert.ok(res.length > 0)
  assert.ok(res[0].name.toLowerCase().startsWith('рис'), `первым пришёл ${res[0].name}`)
})

test('пустой запрос возвращает всю базу', () => {
  assert.ok(searchLocal('').length > 100)
  assert.ok(searchLocal('   ').length > 100)
})

test('бессмысленный запрос ничего не находит', () => {
  assert.equal(searchLocal('щщщxyzщщщ').length, 0)
})

// ── Бытовые меры ──────────────────────────────────────────────────────────────

test('inferCat определяет категорию по названию', () => {
  assert.equal(inferCat('Молоко Простоквашино 3.2%'), 'dairy')
  assert.equal(inferCat('Сыр Чеддер'), 'cheese')
  assert.equal(inferCat('Хлеб бородинский'), 'bread')
  assert.equal(inferCat('Coca-Cola Zero'), 'drink')
  assert.equal(inferCat('Шоколад молочный'), 'sweet')
  assert.equal(inferCat('Кревет­ки'.replace('­', '')), 'sea')
  assert.equal(inferCat('нечто неопознанное'), null)
})

test('товар из Open Food Facts получает человеческие меры, а не «порция/половина»', () => {
  const off = { name: 'Молоко Простоквашино 3.2%', kcal: 60, source: 'off' }
  const labels = getPortions(off).map((p) => p.label)
  assert.ok(labels.includes('стакан'), `получили: ${labels.join(', ')}`)
  assert.ok(!labels.includes('двойная'))
})

test('собственные порции товара идут первыми, наши усреднённые — следом', () => {
  const off = {
    name: 'Кола', kcal: 42, unit: 'мл', source: 'off',
    portions: [{ label: 'порция с упаковки', grams: 250 }, { label: 'вся бутылка', grams: 500 }],
  }
  const p = getPortions(off)
  assert.equal(p[0].label, 'порция с упаковки')
  assert.equal(p[0].grams, 250)
  assert.equal(p[1].label, 'вся бутылка')
  // Дальше — наши меры для напитков, а не бесполезные «половина / двойная».
  assert.ok(p.some((x) => x.label === 'стакан'), `получили: ${p.map((x) => x.label).join(', ')}`)
})

test('продукт без категории и без подсказок откатывается на общие меры', () => {
  const labels = getPortions({ name: 'Нечто', kcal: 100 }).map((p) => p.label)
  assert.deepEqual(labels, ['порция', 'половина', 'двойная'])
})

test('getPortions не падает на пустом входе', () => {
  assert.deepEqual(getPortions(null), [])
  assert.deepEqual(getPortions(undefined), [])
})
