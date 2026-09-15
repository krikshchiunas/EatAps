// Проверка ручного ввода. Главное требование к ней — не мешать: человек с
// этикеткой в руках прав чаще, чем наша таблица допусков, поэтому почти всё
// здесь предупреждает, а не запрещает. Тесты закрепляют именно эту границу.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkManualFood, HUGE_PORTION } from './manualFood.js'

const check = (per100, opts) => checkManualFood(per100, opts)
const warnsAbout = (res, part) => res.warnings.some((w) => w.toLowerCase().includes(part.toLowerCase()))

test('нормальный продукт проходит без единого замечания', () => {
  const res = check({ name: 'Домашний борщ', kcal: 49, protein: 1.5, carbs: 4, fat: 2.7 })
  assert.deepEqual(res.errors, [])
  assert.deepEqual(res.warnings, [])
  assert.equal(res.ok, true)
})

test('блокируется только пустое название', () => {
  assert.equal(check({ name: '', kcal: 100, protein: 5, carbs: 10, fat: 3 }).ok, false)
  assert.equal(check({ name: '   ', kcal: 100, protein: 5, carbs: 10, fat: 3 }).ok, false)
  assert.equal(check({ name: 'Суп', kcal: 100, protein: 5, carbs: 10, fat: 3 }).ok, true)
})

test('порция в ноль — ошибка, потому что на неё делят', () => {
  const bad = check({ name: 'Суп', kcal: 100 }, { basis: 'perPortion', portion: 0 })
  assert.equal(bad.ok, false)
  assert.match(bad.errors[0], /вес порции/i)
  const ok = check({ name: 'Суп', kcal: 100, protein: 5, carbs: 10, fat: 3 }, { basis: 'perPortion', portion: 250 })
  assert.equal(ok.ok, true)
})

test('у напитка в ошибке про порцию говорится про объём', () => {
  const res = check({ name: 'Лимонад' }, { basis: 'perServing', portion: 0, unit: 'мл' })
  assert.match(res.errors[0], /объём/i)
})

test('экстремальные значения предупреждают, но сохранить дают', () => {
  // Это и есть выбранная граница: предупреждение — не запрет.
  const res = check({ name: 'Странность', kcal: 4000, protein: 5, carbs: 10, fat: 3 })
  assert.equal(res.ok, true, 'экстремальное значение не должно блокировать')
  assert.ok(res.warnings.length > 0, 'но предупредить обязано')
})

test('калорийность выше чистого масла вызывает вопрос', () => {
  assert.ok(warnsAbout(check({ name: 'X', kcal: 950, protein: 0, carbs: 0, fat: 100 }), 'чистого масла'))
  // 884 — реальное растительное масло, оно законно.
  assert.ok(!warnsAbout(check({ name: 'Масло', kcal: 884, protein: 0, carbs: 0, fat: 100 }), 'чистого масла'))
})

test('сумма макросов больше 100 г на 100 г продукта — невозможна', () => {
  assert.ok(warnsAbout(check({ name: 'X', kcal: 600, protein: 50, carbs: 50, fat: 30 }), 'больше самого продукта'))
})

test('расхождение калорий с макросами разбирается по физике, а не по модулю', () => {
  // Явная опечатка: 520 вместо 52. Спиртом такой избыток не объяснить.
  assert.ok(warnsAbout(check({ name: 'X', kcal: 520, protein: 1, carbs: 10, fat: 0.5 }), 'выходит'))
  // Калорий меньше, чем дают макросы: энергия не исчезает — это ошибка.
  assert.ok(warnsAbout(check({ name: 'X', kcal: 50, protein: 20, carbs: 40, fat: 10 }), 'выходит'))
  // Клетчатка и сахарные спирты законно занижают калорийность — не трогаем.
  assert.ok(!warnsAbout(check({ name: 'Отруби', kcal: 246, protein: 17, carbs: 50, fat: 7 }), 'выходит'))
  // Алкоголь: 7 ккал на грамм спирта, в БЖУ их нет. Вино и водка законны.
  assert.ok(!warnsAbout(check({ name: 'Вино', kcal: 68, protein: 0.1, carbs: 2.6, fat: 0 }), 'выходит'))
  assert.ok(!warnsAbout(check({ name: 'Водка', kcal: 231, protein: 0, carbs: 0.1, fat: 0 }), 'выходит'))
})

test('вложенные величины не могут превышать целое', () => {
  assert.ok(warnsAbout(check({ name: 'X', kcal: 100, protein: 1, carbs: 10, fat: 2, sugar: 25 }), 'сахара больше'))
  assert.ok(warnsAbout(check({ name: 'X', kcal: 100, protein: 1, carbs: 10, fat: 2, satFat: 9 }), 'насыщенных'))
  // Равенство законно: у сиропа все углеводы — сахар, у кокосового масла весь жир насыщенный.
  assert.ok(!warnsAbout(check({ name: 'Сироп', kcal: 260, protein: 0, carbs: 67, fat: 0, sugar: 67 }), 'сахара больше'))
  assert.ok(!warnsAbout(check({ name: 'Кокос. масло', kcal: 892, protein: 0, carbs: 0, fat: 99, satFat: 99 }), 'насыщенных'))
})

test('ноль, введённый руками, не считается за пропуск', () => {
  // Ноль сахара у масла — это факт, а не пустое поле, и ругаться на него нельзя.
  const res = check({ name: 'Масло', kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, sugar: 0 })
  assert.ok(!warnsAbout(res, 'сахара больше'))
})

test('совсем пустой продукт предупреждает, что он пустой', () => {
  assert.ok(warnsAbout(check({ name: 'Ничто', kcal: 0, protein: 0, carbs: 0, fat: 0 }), 'нулевые'))
  // А вода — законный ноль, но предупреждение всё равно уместно: человек
  // увидит его и решит сам.
  assert.equal(check({ name: 'Вода', kcal: 0 }).ok, true)
})

test('огромная порция намекает на лишний ноль', () => {
  const res = check({ name: 'Суп', kcal: 50, protein: 2, carbs: 5, fat: 2 }, { basis: 'perPortion', portion: HUGE_PORTION + 1 })
  assert.ok(warnsAbout(res, 'лишний ли ноль'))
  assert.equal(res.ok, true)
})

test('кофеин сверх физически возможного предупреждает', () => {
  assert.ok(warnsAbout(check({ name: 'Энергетик', kcal: 45, carbs: 11, caffeine: 900 }, { unit: 'мл' }), 'кофеина'))
  assert.ok(!warnsAbout(check({ name: 'Энергетик', kcal: 45, carbs: 11, caffeine: 32 }, { unit: 'мл' }), 'кофеина'))
})

test('отрицательные значения замечаются', () => {
  assert.ok(warnsAbout(check({ name: 'X', kcal: -5, protein: 1, carbs: 1, fat: 1 }), 'отрицательное'))
})

test('не падает на мусоре вместо объекта', () => {
  for (const junk of [null, undefined, {}, { name: 'X' }]) {
    assert.doesNotThrow(() => checkManualFood(junk))
  }
  assert.equal(checkManualFood(null).ok, false)
})
