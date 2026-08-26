import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDoubleTap, TAP_SLOP, DOUBLE_TAP_MS } from './doubleTap.js'

// Часы под контролем: жест — это про время, и полагаться на реальные
// миллисекунды в тесте значит получить мигающие падения.
function clock(start = 1000) {
  let t = start
  return { now: () => t, tick: (ms) => { t += ms } }
}
const setup = (start) => {
  const c = clock(start)
  return { c, taps: createDoubleTap({ now: c.now }) }
}

test('два тапа подряд по одному сообщению — это двойной тап', () => {
  const { c, taps } = setup()
  assert.equal(taps.touchEnd({ id: 'm1' }), false, 'первая метка ничего не делает')
  c.tick(120)
  assert.equal(taps.touchEnd({ id: 'm1' }), true)
})

test('пауза больше окна — два отдельных нажатия, а не жест', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(DOUBLE_TAP_MS + 1)
  assert.equal(taps.touchEnd({ id: 'm1' }), false)
})

test('тапы по разным сообщениям не складываются', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(50)
  assert.equal(taps.touchEnd({ id: 'm2' }), false)
})

test('третий тап не переключает реакцию обратно', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  assert.equal(taps.touchEnd({ id: 'm1' }), true)
  c.tick(100)
  assert.equal(taps.touchEnd({ id: 'm1' }), false, 'счёт начинается заново')
})

// Ровно тот случай, из-за которого реакция «не ставилась через раз»: палец при
// быстром двойном тапе почти всегда чуть уезжает.
test('дрогнувший палец остаётся тапом', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1', drift: 9 })
  c.tick(90)
  assert.equal(taps.touchEnd({ id: 'm1', drift: TAP_SLOP }), true)
})

test('скролл тапом не считается', () => {
  const { c, taps } = setup()
  assert.equal(taps.touchEnd({ id: 'm1', drift: TAP_SLOP + 1 }), false)
  c.tick(50)
  assert.equal(taps.touchEnd({ id: 'm1', drift: TAP_SLOP + 1 }), false)
})

test('свайп не считается тапом даже без отхода пальца', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1', swipe: true })
  c.tick(50)
  assert.equal(taps.touchEnd({ id: 'm1', swipe: true }), false)
})

test('ссылки и кнопки внутри пузыря в жест не идут', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1', interactive: true })
  c.tick(50)
  assert.equal(taps.touchEnd({ id: 'm1', interactive: true }), false)
})

// Главное, ради чего оба пути живут в одном объекте.
test('dblclick, синтезированный браузером из двойного тапа, глушится', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  assert.equal(taps.touchEnd({ id: 'm1' }), true, 'реакция ставится по жесту')
  c.tick(20)
  assert.equal(taps.dblClick({ id: 'm1' }), false, 'эхо не снимает её обратно')
})

test('глушитель одноразовый: следующий двойной клик проходит', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  taps.touchEnd({ id: 'm1' })
  c.tick(20)
  taps.dblClick({ id: 'm1' })     // эхо съедено
  c.tick(20)
  assert.equal(taps.dblClick({ id: 'm1' }), true)
})

test('двойной клик мышью работает сам по себе', () => {
  const { taps } = setup()
  assert.equal(taps.dblClick({ id: 'm1' }), true)
})

test('глушитель не задевает соседнее сообщение', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  taps.touchEnd({ id: 'm1' })
  c.tick(20)
  assert.equal(taps.dblClick({ id: 'm2' }), true)
})

test('запоздавший dblclick — это уже мышь, а не эхо', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  taps.touchEnd({ id: 'm1' })
  c.tick(1500)
  assert.equal(taps.dblClick({ id: 'm1' }), true)
})

test('второй двойной тап снимает реакцию, и его эхо тоже глушится', () => {
  const { c, taps } = setup()
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  assert.equal(taps.touchEnd({ id: 'm1' }), true)
  c.tick(20)
  assert.equal(taps.dblClick({ id: 'm1' }), false)

  c.tick(400)
  taps.touchEnd({ id: 'm1' })
  c.tick(100)
  assert.equal(taps.touchEnd({ id: 'm1' }), true, 'повторный жест переключает обратно')
  c.tick(20)
  assert.equal(taps.dblClick({ id: 'm1' }), false)
})

test('пустой идентификатор игнорируется обоими путями', () => {
  const { taps } = setup()
  assert.equal(taps.touchEnd({ id: null }), false)
  assert.equal(taps.touchEnd({}), false)
  assert.equal(taps.dblClick({ id: undefined }), false)
})
