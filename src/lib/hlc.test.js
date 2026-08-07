// Гибридные логические часы: монотонность, устойчивость к расхождению часов,
// детерминированный порядок. Всё время подаётся явно — тесты не зависят от
// реальных часов машины.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ZERO_TS, compareTs, createClock, isTs, maxTs, newerTs, observeAll, tsMillis } from './hlc.js'

const clockAt = (msRef, deviceId = 'aaaaaaaa') =>
  createClock({ deviceId, now: () => msRef.value })

test('метки растут даже внутри одной миллисекунды', () => {
  const ms = { value: 1000 }
  const c = clockAt(ms)
  const a = c.tick()
  const b = c.tick()
  const d = c.tick()
  assert.ok(newerTs(b, a))
  assert.ok(newerTs(d, b))
})

test('метки сортируются лексикографически в хронологическом порядке', () => {
  const ms = { value: 1000 }
  const c = clockAt(ms)
  const t1 = c.tick()
  ms.value = 5000
  const t2 = c.tick()
  ms.value = 900000000
  const t3 = c.tick()
  assert.deepEqual([t3, t1, t2].sort(), [t1, t2, t3])
})

test('часы не едут назад при отставших системных часах', () => {
  const ms = { value: 10_000 }
  const c = clockAt(ms)
  const before = c.tick()
  ms.value = 1_000 // системное время «прыгнуло» назад на 9 секунд
  const after = c.tick()
  assert.ok(newerTs(after, before), 'новая метка обязана быть больше предыдущей')
})

test('observe подтягивает часы под чужую метку из будущего', () => {
  const slow = { value: 1_000 }
  const fast = { value: 60_000 }
  const laptop = clockAt(fast, 'bbbbbbbb')
  const phone = clockAt(slow, 'aaaaaaaa')

  const fromLaptop = laptop.tick()      // сделано на «убежавшем» устройстве
  phone.observe(fromLaptop)
  const fromPhone = phone.tick()        // правка телефона по времени позже

  assert.ok(
    newerTs(fromPhone, fromLaptop),
    'правка, сделанная позже, должна выиграть, даже если часы устройства отстают',
  )
})

test('одинаковое время на разных устройствах разводится детерминированно', () => {
  const ms = { value: 777 }
  const a = clockAt(ms, 'aaaaaaaa').tick()
  const b = clockAt(ms, 'bbbbbbbb').tick()
  assert.notEqual(a, b)
  assert.equal(compareTs(a, b), -compareTs(b, a))
  assert.equal(maxTs(a, b), b) // 'b' > 'a' — порядок один и тот же на всех устройствах
})

test('легаси-значения без метки проигрывают любой настоящей метке', () => {
  const t = clockAt({ value: 1 }).tick()
  assert.ok(newerTs(t, undefined))
  assert.ok(newerTs(t, null))
  assert.ok(newerTs(t, 'мусор'))
  assert.equal(compareTs(undefined, null), 0)
  assert.equal(maxTs(undefined, null), ZERO_TS)
})

test('часы восстанавливаются из хранилища и не откатываются после перезапуска', () => {
  let saved = null
  const ms = { value: 50_000 }
  const first = createClock({ deviceId: 'aaaaaaaa', now: () => ms.value, load: () => saved, save: (v) => { saved = v } })
  const before = first.tick()

  ms.value = 10 // «телефон перезагрузили, часы сбросились»
  const second = createClock({ deviceId: 'aaaaaaaa', now: () => ms.value, load: () => saved, save: (v) => { saved = v } })
  const after = second.tick()

  assert.ok(newerTs(after, before))
})

test('tsMillis и isTs корректно разбирают метку', () => {
  const t = clockAt({ value: 1234567 }).tick()
  assert.ok(isTs(t))
  assert.equal(tsMillis(t), 1234567)
  assert.equal(isTs('коротко'), false)
  assert.equal(tsMillis(undefined), 0)
})

test('observeAll обходит вложенную структуру и подтягивает часы', () => {
  const remote = clockAt({ value: 900_000 }, 'bbbbbbbb').tick()
  const local = clockAt({ value: 1_000 }, 'aaaaaaaa')
  observeAll(local, { meta: { tombstones: { 'd:1:m:2': remote } } })
  assert.ok(newerTs(local.tick(), remote))
})
