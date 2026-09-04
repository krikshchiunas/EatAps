// Тесты разбора еды на микронутриенты.
//
// Главный риск этой таблицы — не арифметика, а СОПОСТАВЛЕНИЕ: основа слова
// молча забирает чужой продукт, и никто этого не видит. «Кетчуп» становится
// кетой, «сельдерей» — сельдью, «оливье» — оливковым маслом, «мёд» —
// медовиком. Каждый такой случай здесь закреплён тестом, потому что каждый из
// них уже случался при сборке этого файла.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { microProfileFor, microsForEntry, sumFoodMicros, massOf, topSourcesFor } from './foodMicros.js'
import { MICRO_BY_KEY } from './micronutrients.js'
import { FOODS } from './foods.js'

const profileOf = (name, cat) => microProfileFor({ name, cat })?.id ?? null

// ── Целостность таблицы ───────────────────────────────────────────────────────

test('в профилях нет ключей, которых нет в справочнике', () => {
  // Опечатка в ключе («vitB6» вместо «b6») не падает и не видна: вещество
  // просто перестаёт считаться. Ловим её единственным способом — сверкой.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'foodMicros.js'), 'utf8')
  const unknown = new Set()
  for (const m of src.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*):\s*[\d.]+/gm)) {
    if (!MICRO_BY_KEY[m[1]]) unknown.add(m[1])
  }
  assert.deepEqual([...unknown], [])
})

test('вся встроенная база продуктов получает профиль', () => {
  // Не «желательно», а обязательно: продукт без профиля не приносит ни одного
  // витамина, и день из таких продуктов покажет пустые полоски.
  const orphans = FOODS.filter((f) => !microProfileFor(f)).map((f) => f.name)
  assert.deepEqual(orphans, [])
})

// ── Ловушки сопоставления по названию ─────────────────────────────────────────

test('субпродукты находятся раньше мяса и птицы', () => {
  assert.equal(profileOf('Печень куриная'), 'печень куриная')
  assert.equal(profileOf('Печень говяжья'), 'печень говяжья')
  assert.equal(profileOf('Печень трески'), 'печень трески')
  // Витамина A в печени в десять раз больше нормы — перепутать её с курицей
  // значит потерять всю картину дня.
  assert.ok(microsForEntry({ name: 'Печень куриная', grams: 100, unit: 'г' }).values.vitA > 3000)
})

test('слова, которые забирали чужое, закреплены отдельно', () => {
  assert.equal(profileOf('Кетчуп'), 'томатная паста', 'кетчуп уезжал в кету')
  assert.equal(profileOf('Сельдерей'), 'сельдерей', 'сельдерей уезжал в сельдь')
  assert.equal(profileOf('Медовик'), 'сладости и выпечка', 'медовик уезжал в мёд')
  assert.equal(profileOf('Нутелла'), 'сладости и выпечка', 'нутелла уезжала в нут')
  assert.equal(profileOf('Оливье'), null, 'оливье уезжал в оливковое масло')
  assert.equal(profileOf('Зелёный горошек'), 'зелёный горошек', 'горошек уезжал в зелень')
  assert.equal(profileOf('Яйцо перепелиное'), 'яйцо', 'перепелиное яйцо уезжало в дичь')
  assert.equal(profileOf('Виноград'), 'виноград', 'виноград уезжал в вино')
  assert.equal(profileOf('Соевый соус'), 'соевый соус', 'соевый соус уезжал в сою')
  assert.equal(profileOf('Луковые кольца'), null, 'кольца уезжали в лук')
})

test('выпечка сильнее того, с чем она сделана', () => {
  assert.equal(profileOf('Печенье овсяное'), 'сладости и выпечка')
  assert.equal(profileOf('Пирожок с картошкой'), 'сладости и выпечка')
  assert.equal(profileOf('Пирожок с яблоком'), 'сладости и выпечка')
  assert.equal(profileOf('Сырники'), 'сладости и выпечка')
})

test('вид мяса определяется точнее, чем способ приготовления', () => {
  // «Стейк» есть и у свинины, и у говядины; побеждает тот, кто назван.
  assert.equal(profileOf('Стейк свиной'), 'свинина')
  assert.equal(profileOf('Стейк говяжий'), 'говядина')
  assert.equal(profileOf('Стейк рибай'), 'говядина')
  assert.equal(profileOf('Грудка индейки'), 'индейка')
  assert.equal(profileOf('Куриная грудка'), 'курица')
})

test('кофеин важнее молока в кофе с молоком', () => {
  assert.equal(profileOf('Кофе с молоком'), 'кофе')
  assert.equal(profileOf('Чай с молоком'), 'чай')
  assert.ok(microsForEntry({ name: 'Кофе с молоком', grams: 200, unit: 'мл' }).values.caffeine > 0)
})

test('бульон не считается за мясо', () => {
  // 100 г куриного бульона — это почти вода, а не 100 г курицы.
  const broth = microsForEntry({ name: 'Куриный бульон', grams: 300, unit: 'мл' }).values
  const meat = microsForEntry({ name: 'Куриная грудка', grams: 300, unit: 'г' }).values
  assert.ok(broth.se * 5 < meat.se, `бульон ${broth.se} мкг селена против ${meat.se} у мяса`)
})

test('тёмный шоколад узнаётся в любом порядке слов', () => {
  assert.equal(profileOf('Шоколад тёмный'), 'шоколад тёмный и какао')
  assert.equal(profileOf('Тёмный шоколад'), 'шоколад тёмный и какао')
  assert.equal(profileOf('Шоколад молочный'), 'сладости и выпечка')
})

test('«ё» и регистр не мешают', () => {
  assert.equal(profileOf('СВЁКЛА'), 'свёкла')
  assert.equal(profileOf('свекла'), 'свёкла')
  assert.equal(profileOf('Гречка, варёная'), 'гречка')
})

// ── Категория как запасной путь ───────────────────────────────────────────────

test('незнакомое название разбирается по категории', () => {
  const r = microsForEntry({ name: 'Штука с полки', cat: 'fish', grams: 100, unit: 'г' })
  assert.equal(r.confidence, 'category')
  assert.ok(r.values.omega3 > 0)
})

test('незнакомое название без категории не считается нулём', () => {
  const r = microsForEntry({ name: 'Печенюшки Барни', grams: 100, unit: 'г' })
  // Сюда попадёт «печенье»? Нет — проверяем именно неопознанное.
  const unknown = microsForEntry({ name: 'Zxqwerty', grams: 100, unit: 'г' })
  assert.equal(unknown.confidence, 'unknown')
  assert.deepEqual(unknown.values, {})
  assert.ok(r) // сама функция при этом не падает
})

// ── Масса порции ──────────────────────────────────────────────────────────────

test('масса берётся только там, где она правда масса', () => {
  assert.equal(massOf({ grams: 150, unit: 'г' }), 150)
  assert.equal(massOf({ grams: 250, unit: 'мл' }), 250)
  // «2 порции» — это две порции, а не два грамма. Умножить состав на 2 вместо
  // 500 значило бы занизить всё в двести пятьдесят раз.
  assert.equal(massOf({ grams: 2, unit: 'порция' }), null)
  assert.equal(massOf({ grams: 0, unit: 'г' }), null)
  assert.equal(massOf({ unit: 'г' }), null)
})

test('запись без массы честно помечается неразобранной', () => {
  const r = microsForEntry({ name: 'Борщ', cat: 'soups', grams: 1, unit: 'порция' })
  assert.equal(r.confidence, 'unknown')
})

// ── Масштабирование и суммы ───────────────────────────────────────────────────

test('содержание масштабируется линейно по массе', () => {
  const a = microsForEntry({ name: 'Шпинат', grams: 100, unit: 'г' }).values
  const b = microsForEntry({ name: 'Шпинат', grams: 250, unit: 'г' }).values
  assert.ok(Math.abs(b.vitK - a.vitK * 2.5) < 0.001)
})

test('сумма дня складывает продукты и считает разобранное', () => {
  const day = [
    { name: 'Шпинат', grams: 100, unit: 'г' },
    { name: 'Лосось', grams: 200, unit: 'г' },
    { name: 'Zxqwerty', grams: 100, unit: 'г' },
    { name: 'Борщ', grams: 1, unit: 'порция' },
  ]
  const r = sumFoodMicros(day)
  assert.equal(r.total, 4)
  assert.equal(r.covered, 2, 'неопознанное и запись без массы не считаются разобранными')
  assert.ok(Math.abs(r.values.omega3 - 4000) < 1, '200 г лосося — это 4000 мг омега-3')
  assert.ok(r.values.vitK > 480)
})

test('пустой день не ломает сумму', () => {
  const r = sumFoodMicros([])
  assert.deepEqual(r.values, {})
  assert.equal(r.total, 0)
  assert.equal(r.covered, 0)
  assert.equal(sumFoodMicros(null).total, 0)
  assert.equal(sumFoodMicros([null, {}, { name: '' }]).total, 0)
})

test('источники нутриента перечисляются от большего к меньшему', () => {
  const day = [
    { name: 'Апельсин', grams: 100, unit: 'г' },
    { name: 'Перец болгарский', grams: 200, unit: 'г' },
    { name: 'Лосось', grams: 100, unit: 'г' },
  ]
  const src = topSourcesFor(day, 'vitC')
  assert.equal(src[0].name, 'Перец болгарский')
  assert.equal(src[1].name, 'Апельсин')
  assert.ok(src.every((s) => s.value > 0))
})

// ── Смысловые проверки: числа должны быть похожи на правду ────────────────────

test('красное мясо приносит креатин, а курица заметно меньше', () => {
  // Это ровно тот случай, ради которого всё считается: съел стейк — креатин
  // из банки сегодня уже не так нужен.
  const beef = microsForEntry({ name: 'Говядина', grams: 300, unit: 'г' }).values.creatine
  const chicken = microsForEntry({ name: 'Куриная грудка', grams: 300, unit: 'г' }).values.creatine
  assert.ok(beef > 1, `300 г говядины должны давать больше грамма креатина, а дают ${beef}`)
  assert.ok(beef > chicken)
})

test('один бразильский орех закрывает норму селена', () => {
  const se = microsForEntry({ name: 'Бразильский орех', grams: 5, unit: 'г' }).values.se
  assert.ok(se > 55, `5 г должны давать больше 55 мкг селена, а дают ${se}`)
})

test('соль — это натрий, и его там очень много', () => {
  const na = microsForEntry({ name: 'Соль', grams: 5, unit: 'г' }).values.na
  assert.ok(na > 1800 && na < 2100, `5 г соли — около 2000 мг натрия, а вышло ${na}`)
})
