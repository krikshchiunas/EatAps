// Списки «не ем» / «люблю». Тесты названы по тому, что они предотвращают:
// не «функция вернула массив», а «в профиль не попало то, что сломает экран
// или уедет другу».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProfileList, addProfileListItem, removeProfileListItem, MAX_ITEMS, MAX_LEN,
} from './profileLists.js'

test('мусор вместо списка не роняет профиль', () => {
  for (const junk of [null, undefined, 0, 'молоко', {}, NaN]) {
    assert.deepEqual(normalizeProfileList(junk), [])
  }
})

test('нестроковые элементы отбрасываются поэлементно, остальное выживает', () => {
  assert.deepEqual(
    normalizeProfileList(['Молоко', 42, null, { name: 'Грибы' }, 'Свинина']),
    ['Молоко', 'Свинина'],
  )
})

test('пробелы схлопываются, пустые пункты не сохраняются', () => {
  const src = ['  Молоко  ', '   ', '\n\t', 'Красная  рыба']
  assert.deepEqual(normalizeProfileList(src), ['Молоко', 'Красная рыба'])
})

test('дубликаты схлопываются без учёта регистра', () => {
  assert.deepEqual(normalizeProfileList(['Молоко', 'молоко', 'МОЛОКО']), ['Молоко'])
})

test('длина пункта ограничена — в профиль нельзя вписать абзац', () => {
  const long = 'а'.repeat(200)
  const [item] = normalizeProfileList([long])
  assert.equal(item.length, MAX_LEN)
})

test('количество пунктов ограничено — список не превращается в базу продуктов', () => {
  const many = Array.from({ length: 500 }, (_, i) => `Продукт ${i}`)
  assert.equal(normalizeProfileList(many).length, MAX_ITEMS)
})

test('добавление пункта: пустой ввод ничего не меняет и не считается ошибкой', () => {
  const r = addProfileListItem(['Молоко'], '   ')
  assert.deepEqual(r.list, ['Молоко'])
  assert.equal(r.error, null)
})

test('добавление пункта: повтор не дублируется и объясняется человеку', () => {
  const r = addProfileListItem(['Молоко'], 'молоко')
  assert.deepEqual(r.list, ['Молоко'])
  assert.equal(r.error, 'Уже в списке')
})

test('добавление пункта сверх лимита отказывает явно, а не молча', () => {
  const full = Array.from({ length: MAX_ITEMS }, (_, i) => `П${i}`)
  const r = addProfileListItem(full, 'Ещё один')
  assert.equal(r.list.length, MAX_ITEMS)
  assert.match(r.error, /Не больше/)
})

test('удаление убирает ровно один пункт', () => {
  assert.deepEqual(removeProfileListItem(['Молоко', 'Грибы'], 'Молоко'), ['Грибы'])
})
