// Тесты стека добавок и записей о приёме.
//
// Две формы легко перепутать, и цена путаницы — молчаливая: состав элемента
// стека хранится НА ОДНУ единицу, а состав приёма — уже умноженным на дозу.
// Перепутать их значит недосчитать (или насчитать вдвое) всё подряд.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_STACK, normalizeSuppEntry, normalizeStackItem, stackItemFromSupplement,
  suppEntryFromStack, perUnitOf, stackKey, findStackSlot, takenMap, takenCount,
  stackMicroKeys, suppTotals,
} from './suppStack.js'
import { supplementById } from './supplements.js'

// ── Нормализация записи о приёме ──────────────────────────────────────────────

test('запись о приёме чистится, но не выдумывает', () => {
  const e = normalizeSuppEntry({ suppId: 'creatine', name: '  Креатин  ', dose: 5, unit: 'г', provides: { creatine: 5 } })
  assert.equal(e.name, 'Креатин')
  assert.equal(e.dose, 5)
  assert.deepEqual(e.provides, { creatine: 5 })
})

test('без имени записи о приёме не бывает', () => {
  assert.equal(normalizeSuppEntry(null), null)
  assert.equal(normalizeSuppEntry({ name: '   ' }), null)
})

test('приём без состава всё равно сохраняется', () => {
  // «Выпил витамины» без расшифровки состава — это по-прежнему факт приёма,
  // и терять его нельзя: человек отмечал его именно чтобы помнить.
  const e = normalizeSuppEntry({ name: 'Аптечная банка' })
  assert.ok(e)
  assert.deepEqual(e.provides, {})
  assert.equal(e.dose, 1)
})

test('чужие ключи и мусорные числа в составе выбрасываются', () => {
  const e = normalizeSuppEntry({ name: 'Смесь', provides: { vitC: 100, выдумка: 5, zn: -1, mg: 'много', fe: Infinity } })
  assert.deepEqual(e.provides, { vitC: 100 })
})

test('бессмысленная доза заменяется единицей, а не сохраняется как есть', () => {
  assert.equal(normalizeSuppEntry({ name: 'X', dose: -5 }).dose, 1)
  assert.equal(normalizeSuppEntry({ name: 'X', dose: 0 }).dose, 1)
  assert.equal(normalizeSuppEntry({ name: 'X', dose: 99999 }).dose, 1, 'опечатка в разряде не должна доехать до расчёта')
  assert.equal(normalizeSuppEntry({ name: 'X', dose: '2,5' }).dose, 1, 'запятую разбирает поле ввода, сюда приходит число')
})

test('слишком длинное имя обрезается, а не ломает вёрстку', () => {
  const e = normalizeSuppEntry({ name: 'я'.repeat(500) })
  assert.equal(e.name.length, 60)
})

// ── Стек ──────────────────────────────────────────────────────────────────────

test('элемент стека из каталожной добавки помнит привычную дозу', () => {
  const item = stackItemFromSupplement(supplementById('omega3'))
  assert.equal(item.suppId, 'omega3')
  assert.equal(item.dose, 2)
  assert.equal(item.provides.omega3, 300, 'в стеке состав хранится НА ОДНУ капсулу')
  assert.equal(item.custom, false)
})

test('добавка без id считается своей', () => {
  const item = normalizeStackItem({ name: 'Моя банка', provides: { vitC: 250 } })
  assert.equal(item.custom, true)
})

test('приём из стека умножает состав на дозу ровно один раз', () => {
  const item = stackItemFromSupplement(supplementById('omega3')) // 300 мг × 2 капсулы
  const entry = suppEntryFromStack(item)
  assert.equal(entry.dose, 2)
  assert.equal(entry.provides.omega3, 600)
})

test('дозу приёма можно переопределить, не трогая стек', () => {
  const item = stackItemFromSupplement(supplementById('omega3'))
  const entry = suppEntryFromStack(item, 3)
  assert.equal(entry.provides.omega3, 900)
  assert.equal(item.provides.omega3, 300, 'сам стек остался нетронутым')
})

test('предел размера стека объявлен и разумен', () => {
  assert.ok(MAX_STACK >= 20 && MAX_STACK <= 100)
})

// ── Сопоставление стека и дня ─────────────────────────────────────────────────

test('каталожные добавки сопоставляются по id, свои — по имени', () => {
  assert.equal(stackKey({ suppId: 'creatine', name: 'Что угодно' }), 'id:creatine')
  assert.equal(stackKey({ name: 'Моя  Банка' }), stackKey({ name: 'моя банка' }))
  assert.equal(stackKey({ name: 'Ёлка' }), stackKey({ name: 'елка' }))
})

test('день знает, что из стека уже отмечено', () => {
  const day = { supps: [{ id: 'a', suppId: 'creatine', name: 'Креатин', provides: { creatine: 5 } }] }
  const map = takenMap(day)
  assert.ok(map.has('id:creatine'))
  assert.equal(map.get('id:creatine').id, 'a')
  assert.equal(map.has('id:omega3'), false)
})

test('повторный приём за день считается, но галочка снимает только один', () => {
  const day = {
    supps: [
      { id: 'a', suppId: 'mg-citrate', name: 'Магний', provides: { mg: 200 } },
      { id: 'b', suppId: 'mg-citrate', name: 'Магний', provides: { mg: 200 } },
    ],
  }
  assert.equal(takenCount(day, { suppId: 'mg-citrate' }), 2)
  assert.equal(takenMap(day).get('id:mg-citrate').id, 'a', 'снимаем первый приём, а не весь день')
})

test('день без добавок не ломает сопоставление', () => {
  assert.equal(takenMap({}).size, 0)
  assert.equal(takenMap(null).size, 0)
  assert.equal(takenCount(null, { suppId: 'x' }), 0)
})

// ── Производные ───────────────────────────────────────────────────────────────

test('стек сообщает, какие вещества человеку вообще интересны', () => {
  const keys = stackMicroKeys([
    stackItemFromSupplement(supplementById('creatine')),
    stackItemFromSupplement(supplementById('vitd-2000')),
  ])
  assert.ok(keys.has('creatine'))
  assert.ok(keys.has('vitD'))
  assert.equal(keys.has('ashwagandha'), false)
})

test('итог по добавкам дня складывается по веществам', () => {
  const day = {
    supps: [
      { provides: { vitD: 50, mg: 200 } },
      { provides: { vitD: 25 } },
    ],
  }
  assert.deepEqual(suppTotals(day), { vitD: 75, mg: 200 })
  assert.deepEqual(suppTotals(null), {})
})

// ── Обратный пересчёт: приём → состав единицы ────────────────────────────────
// Ошибка тут не видна глазами: она умножает или делит дозу втрое и всплывает
// только в цифрах свода.

test('состав единицы восстанавливается из записи о приёме', () => {
  const entry = { name: 'Магний', unit: 'таблетка', dose: 3, provides: { mg: 600 } }
  assert.deepEqual(perUnitOf(entry), { mg: 200 })
})

test('закрепление приёма в стеке не умножает дозу саму на себя', () => {
  // «3 таблетки по 200 мг» уезжали в стек как «1 таблетка по 600», и первая же
  // галочка записывала втрое больше, чем человек выпил.
  const entry = suppEntryFromStack({ name: 'Магний', unit: 'таблетка', dose: 1, provides: { mg: 200 } }, 3)
  assert.equal(entry.provides.mg, 600)

  const backToStack = normalizeStackItem({ ...entry, dose: entry.dose, provides: perUnitOf(entry) })
  assert.equal(backToStack.dose, 3)
  assert.deepEqual(backToStack.provides, { mg: 200 })

  // Круг замкнулся: отметка галочкой снова даёт ровно 600, а не 1800.
  assert.equal(suppEntryFromStack(backToStack).provides.mg, 600)
})

test('правка дозы считается от единицы, а не от прежней дозы', () => {
  const entry = { name: 'Магний', unit: 'таблетка', dose: 3, provides: { mg: 600 } }
  const perUnit = perUnitOf(entry)
  assert.equal(suppEntryFromStack({ ...entry, provides: perUnit }, 2).provides.mg, 400)
  assert.equal(suppEntryFromStack({ ...entry, provides: perUnit }, 1).provides.mg, 200)
})

test('пересчёт единицы не падает на пустом и битом входе', () => {
  assert.deepEqual(perUnitOf(null), {})
  assert.deepEqual(perUnitOf({ dose: 0, provides: { mg: 100 } }), { mg: 100 })
  assert.deepEqual(perUnitOf({ dose: 2 }), {})
})

// ── Куда класть добавку в стеке ──────────────────────────────────────────────

const row = (id, suppId, name) => ({ id, suppId, name, unit: 'капсула', dose: 1, provides: { vitD: 50 } })

test('та же добавка не заводится в стеке второй раз', () => {
  // «Записать и добавить в мой стек», нажатое дважды, давало две одинаковые
  // строки: обе с одним ключом, обе «выпито», а снятие галочки убирало приём
  // только у одной.
  const list = [row('a', 'omega3', 'Омега-3')]
  const { existing, full } = findStackSlot(list, { suppId: 'omega3', name: 'Омега-3 другое имя' })
  assert.equal(existing?.id, 'a', 'каталожная добавка узнаётся по id каталога')
  assert.equal(full, false)
})

test('своя добавка узнаётся по имени, а не по регистру', () => {
  const list = [row('a', null, 'Моя банка')]
  assert.equal(findStackSlot(list, { name: 'моя  БАНКА' }).existing?.id, 'a')
  assert.equal(findStackSlot(list, { name: 'Другая банка' }).existing, null)
})

test('правка по id сильнее совпадения по имени', () => {
  const list = [row('a', null, 'Магний'), row('b', null, 'Цинк')]
  assert.equal(findStackSlot(list, { name: 'Магний' }, 'b').existing?.id, 'b')
})

test('полный стек не принимает новое, но правку принимает', () => {
  const list = [...Array(40)].map((_, i) => row('f' + i, null, 'Строка ' + i))
  assert.equal(findStackSlot(list, { name: 'Ещё одна' }).full, true, 'новую класть некуда')
  assert.equal(findStackSlot(list, { name: 'Строка 3' }).full, false, 'существующую править можно всегда')
  assert.equal(findStackSlot(list, { name: 'Строка 3' }).existing?.id, 'f3')
})

test('пустой и битый список не ломают выбор места', () => {
  assert.deepEqual(findStackSlot(null, { name: 'X' }), { existing: null, full: false })
  assert.deepEqual(findStackSlot([], { name: 'X' }), { existing: null, full: false })
})
