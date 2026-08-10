// Конвейер синхронизации целиком: гонки, конфликты, офлайн, смена аккаунта —
// сценарии, которые в браузере воспроизводятся долго и ненадёжно.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYNC, createSyncEngine } from './syncEngine.js'
import { emptyMeta, blankDay, normalizeState } from './syncModel.js'
import { DATE, createServer, createTimers, createDevice, serverMeals } from './syncTestKit.js'

// ═══════════════════════════════════════════════════════════════════════════
// Базовый цикл
// ═══════════════════════════════════════════════════════════════════════════

test('новый аккаунт: локальное состояние становится первой версией на сервере', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers, seed: { profile: { name: 'Аня' }, meta: emptyMeta() } })

  await dev.engine.start(dev.state)
  await timers.advance(0)

  assert.equal(server.revision, 1)
  assert.equal(server.state.profile.name, 'Аня')
  assert.equal(dev.status, SYNC.SYNCED)
})

test('вход на пустом устройстве: данные приезжают с сервера без обратной записи', async () => {
  const server = createServer()
  server.write(normalizeState({ profile: { name: 'Аня' }, days: { [DATE]: { ...blankDay(), meals: [{ id: 'm1', name: 'Овсянка', updatedAt: '000000000001000-00000-zzzzzzzz' }] } } }))
  const savesBefore = server.log.saves

  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(2000)

  assert.deepEqual(dev.mealNames(), ['Овсянка'])
  assert.equal(server.log.saves, savesBefore, 'открытие приложения не порождает запись')
  assert.equal(dev.status, SYNC.SYNCED)
})

test('серия быстрых правок схлопывается в одно сохранение', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)
  const before = server.log.saves

  dev.addMeal('m1', 'Яблоко')
  await timers.advance(100)
  dev.addMeal('m2', 'Груша')
  await timers.advance(100)
  dev.addMeal('m3', 'Слива')
  await timers.advance(1000)

  assert.equal(server.log.saves - before, 1, 'debounce объединил три правки')
  assert.deepEqual(serverMeals(server), ['Груша', 'Слива', 'Яблоко'])
})

test('повторный push того же состояния не идёт в сеть', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Яблоко')
  await timers.advance(1000)
  const after = server.log.saves

  dev.engine.push(dev.state)   // ровно то же самое — так делает React-эффект
  dev.engine.push(dev.state)
  await timers.advance(2000)

  assert.equal(server.log.saves, after, 'эхо собственного состояния не пишется')
})

// ═══════════════════════════════════════════════════════════════════════════
// Конфликты и потеря правок — главный класс прежних багов
// ═══════════════════════════════════════════════════════════════════════════

test('конфликт версий: чужая правка не затирается, обе сохраняются', async () => {
  const server = createServer()
  const timers = createTimers()
  // Realtime намеренно выключен: устройство НЕ знает о чужой записи и пойдёт
  // сохранять на устаревшей версии. Именно этот путь раньше терял данные.
  const dev = createDevice(server, { timers, realtime: false })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Яблоко')

  // Другое устройство успевает записать своё раньше.
  server.write(normalizeState({
    days: { [DATE]: { ...blankDay(), meals: [{ id: 'm2', name: 'Кофе', updatedAt: '000000000009000-00000-zzzzzzzz' }] } },
  }))

  await timers.advance(2000)

  assert.ok(server.log.conflicts >= 1, 'сервер отклонил запись на устаревшей версии')
  assert.deepEqual(serverMeals(server), ['Кофе', 'Яблоко'], 'обе правки на месте')
  assert.deepEqual(dev.mealNames(), ['Кофе', 'Яблоко'])
  assert.equal(dev.status, SYNC.SYNCED)
})

test('realtime успевает раньше — конфликта не возникает, результат тот же', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Яблоко')
  server.write(normalizeState({
    days: { [DATE]: { ...blankDay(), meals: [{ id: 'm2', name: 'Кофе', updatedAt: '000000000009000-00000-zzzzzzzz' }] } },
  }))
  await timers.advance(2000)

  assert.equal(server.log.conflicts, 0, 'событие пришло до отправки — база версии уже актуальна')
  assert.deepEqual(serverMeals(server), ['Кофе', 'Яблоко'])
})

test('устройство со старым снимком не откатывает сервер', async () => {
  const server = createServer()
  const timers = createTimers()

  // Устройство A вошло и сохранило.
  const a = createDevice(server, { timers, name: 'aaaa' })
  await a.engine.start(a.state)
  a.addMeal('m1', 'Овсянка')
  await timers.advance(1000)

  // Устройство B много раз писало, пока A спало.
  const b = createDevice(server, { timers, name: 'bbbb', cacheStore: new Map() })
  await b.engine.start(b.state)
  await timers.advance(0)
  b.addMeal('m2', 'Обед')
  await timers.advance(1000)
  b.addMeal('m3', 'Ужин')
  await timers.advance(1000)

  // A просыпается со своей устаревшей копией и что-то дописывает.
  a.addMeal('m4', 'Перекус')
  await timers.advance(3000)

  assert.deepEqual(serverMeals(server), ['Обед', 'Овсянка', 'Перекус', 'Ужин'])
})

// ═══════════════════════════════════════════════════════════════════════════
// Офлайн
// ═══════════════════════════════════════════════════════════════════════════

test('правки офлайн не теряются и уезжают после возвращения сети', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.setOnline(false)
  dev.addMeal('m1', 'Ужин офлайн')
  await timers.advance(5000)

  assert.equal(dev.status, SYNC.OFFLINE)
  assert.deepEqual(serverMeals(server), [], 'на сервере пока пусто')
  assert.deepEqual(dev.mealNames(), ['Ужин офлайн'], 'в интерфейсе правка на месте')
  assert.deepEqual(dev.cacheStore.get('u1').state.days[DATE].meals.length, 1, 'и в локальном кэше тоже')

  dev.setOnline(true)
  dev.engine.retryNow()
  await timers.advance(1000)

  assert.deepEqual(serverMeals(server), ['Ужин офлайн'])
  assert.equal(dev.status, SYNC.SYNCED)
})

test('после долгого офлайна старая копия не уничтожает свежие данные сервера', async () => {
  const server = createServer()
  const timers = createTimers()

  const a = createDevice(server, { timers, name: 'aaaa' })
  await a.engine.start(a.state)
  a.addMeal('m1', 'Завтрак A')
  await timers.advance(1000)

  a.setOnline(false)

  // Пока A офлайн, B много работает.
  const b = createDevice(server, { timers, name: 'bbbb', cacheStore: new Map() })
  await b.engine.start(b.state)
  await timers.advance(0)
  b.addMeal('m2', 'Обед B')
  await timers.advance(1000)
  b.addMeal('m3', 'Ужин B')
  await timers.advance(1000)

  // A тоже что-то меняет — вслепую.
  a.addMeal('m4', 'Перекус A')
  await timers.advance(3000)

  a.setOnline(true)
  await a.engine.refresh()
  await timers.advance(3000)

  assert.deepEqual(serverMeals(server), ['Завтрак A', 'Обед B', 'Перекус A', 'Ужин B'])
  assert.deepEqual(a.mealNames(), ['Завтрак A', 'Обед B', 'Перекус A', 'Ужин B'])
})

test('удаление офлайн не откатывается при возвращении в сеть', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  dev.addMeal('m1', 'Ошибочная запись')
  await timers.advance(1000)

  dev.setOnline(false)
  dev.removeMeal('m1')
  await timers.advance(5000)

  dev.setOnline(true)
  dev.engine.retryNow()
  await timers.advance(2000)

  assert.deepEqual(serverMeals(server), [], 'удаление доехало и не воскресло')
})

// ═══════════════════════════════════════════════════════════════════════════
// Realtime
// ═══════════════════════════════════════════════════════════════════════════

test('изменение с другого устройства приезжает без перезагрузки', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  server.write(normalizeState({ days: { [DATE]: { ...blankDay(), meals: [{ id: 'm9', name: 'С ноутбука', updatedAt: '000000000009000-00000-zzzzzzzz' }] } } }))
  await timers.advance(1500)

  assert.deepEqual(dev.mealNames(), ['С ноутбука'])
})

test('собственное эхо не порождает цикл сохранений', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Яблоко')
  await timers.advance(2000)
  const saves = server.log.saves

  // Даём системе «повариться»: событие о нашей же записи уже пришло.
  await timers.advance(10_000)
  assert.equal(server.log.saves, saves, 'цикл событие → запись → событие не возник')
})

test('обрезанный realtime-payload вызывает дочитывание строки', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  const pullsBefore = server.log.pulls
  // Событие приходит без состояния — ровно как при превышении лимита размера
  // записи в Realtime. Единственный правильный ответ: сходить за строкой.
  server.writeTruncated(normalizeState({ days: { [DATE]: { ...blankDay(), meals: [{ id: 'm7', name: 'Большое состояние', updatedAt: '000000000009000-00000-zzzzzzzz' }] } } }))
  await timers.advance(0)

  assert.equal(server.log.pulls, pullsBefore + 1, 'движок дочитал строку сам')
  assert.deepEqual(dev.mealNames(), ['Большое состояние'])
})

// ═══════════════════════════════════════════════════════════════════════════
// Смена пользователя и жизненный цикл
// ═══════════════════════════════════════════════════════════════════════════

test('после остановки движка ответы сервера не применяются', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Яблоко')
  dev.engine.stop()
  await timers.advance(5000)

  assert.equal(dev.status, SYNC.IDLE)
  // Сервер мог получить запись или нет — важно, что движок больше не трогает UI.
  const snapshot = dev.mealNames()
  server.write(normalizeState({ days: { [DATE]: { ...blankDay(), meals: [{ id: 'zz', name: 'Чужое', updatedAt: '000000000009000-00000-zzzzzzzz' }] } } }))
  await timers.advance(5000)
  assert.deepEqual(dev.mealNames(), snapshot, 'состояние UI после stop() не меняется')
})

test('данные прошлого пользователя не попадают в кэш нового', async () => {
  const server = createServer()
  const timers = createTimers()
  const shared = new Map() // одно устройство — общее хранилище кэшей

  const a = createDevice(server, { timers, name: 'aaaa', userId: 'userA', cacheStore: shared })
  await a.engine.start(a.state)
  a.addMeal('m1', 'Еда пользователя A')
  await timers.advance(1000)
  a.engine.stop()

  const serverB = createServer()
  const b = createDevice(serverB, { timers, name: 'bbbb', userId: 'userB', cacheStore: shared })
  await b.engine.start(b.state)
  await timers.advance(1000)

  assert.deepEqual(b.mealNames(), [], 'у B нет ничего от A')
  assert.ok(shared.has('userA') && shared.has('userB'), 'кэши разделены по пользователю')
  assert.equal(shared.get('userB').state.days[DATE], undefined)
})

test('flush отправляет накопленное немедленно (сценарий выхода из аккаунта)', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.addMeal('m1', 'Последняя правка')
  const ok = await dev.engine.flush()

  assert.equal(ok, true)
  assert.deepEqual(serverMeals(server), ['Последняя правка'])
})

test('flush в офлайне честно сообщает, что данные не уехали', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  dev.setOnline(false)
  dev.addMeal('m1', 'Не уедет')
  const ok = await dev.engine.flush()

  assert.equal(ok, false, 'вызывающий узнает, что кэш чистить нельзя')
  assert.equal(dev.engine.hasPendingChanges, true)
})

// ═══════════════════════════════════════════════════════════════════════════
// Ошибки
// ═══════════════════════════════════════════════════════════════════════════

test('мёртвая сессия останавливает попытки и сообщает наверх', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  server.failOnce(Object.assign(new Error('Invalid Refresh Token: Already Used'), { status: 400 }))
  dev.addMeal('m1', 'Яблоко')
  await timers.advance(2000)

  assert.ok(dev.fatal, 'store получил сигнал о недействительной сессии')
  assert.equal(dev.fatal.category, 'session')
  const saves = server.log.saves
  await timers.advance(60_000)
  assert.equal(server.log.saves, saves, 'бесконечных повторов нет')
})

test('недоступный сервер при старте не мешает работать на кэше', async () => {
  const server = createServer()
  const timers = createTimers()
  const cacheStore = new Map([['u1', { state: normalizeState({ profile: { name: 'Аня' } }), revision: 3, dirty: false }]])
  const dev = createDevice(server, { timers, cacheStore, seed: cacheStore.get('u1').state })

  server.failOnce(Object.assign(new TypeError('Failed to fetch'), {}))
  const res = await dev.engine.start(dev.state)

  assert.equal(res.offline, true)
  assert.equal(dev.status, SYNC.OFFLINE)
  assert.equal(dev.state.profile.name, 'Аня', 'кэш показан, приложение работает')
})

test('ошибка прав не приводит к бесконечному долблению сервера', async () => {
  const server = createServer()
  const timers = createTimers()
  const dev = createDevice(server, { timers })
  await dev.engine.start(dev.state)
  await timers.advance(0)

  server.failOnce(Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }))
  dev.addMeal('m1', 'Яблоко')
  await timers.advance(1000)

  assert.equal(dev.status, SYNC.ERROR)
  assert.ok(!/row-level|policy|42501/i.test(JSON.stringify(dev.statuses)), 'наружу не течёт техническая формулировка')
})

// ═══════════════════════════════════════════════════════════════════════════
// Совместимость с WebKit
// ═══════════════════════════════════════════════════════════════════════════

test('таймеры вызываются с правильным получателем — иначе Safari падает', () => {
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout

  // WebKit требует, чтобы this у Window.setTimeout был самим Window. Вызов
  // через объект (timers.setTimeout(...)) передаёт this = timers, и Safari
  // бросает «Can only call Window.setTimeout on instances of Window».
  // Chrome и Firefox это прощают — поэтому баг ловится только здесь.
  const strict = (name, real) => function (...args) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError(`Can only call Window.${name} on instances of Window`)
    }
    return real.apply(globalThis, args)
  }
  globalThis.setTimeout = strict('setTimeout', realSet)
  globalThis.clearTimeout = strict('clearTimeout', realClear)

  try {
    const cache = new Map()
    const engine = createSyncEngine({
      userId: 'u1',
      // Движок создаётся БЕЗ параметра timers — проверяем ровно те, что по умолчанию.
      transport: { pull: async () => null, save: async () => ({ revision: 1, conflict: false }), subscribe: () => () => {} },
      clock: { tick: () => '000000000001000-00000-aaaaaaaa', observe: () => {}, deviceId: 'aaaaaaaa' },
      cache: { read: () => null, write: (r) => cache.set('u1', r), clear: () => cache.delete('u1') },
    })

    // Ввод еды приводит сюда: правка → отложенное сохранение → таймер.
    assert.doesNotThrow(
      () => engine.push({ profile: { name: 'Аня' }, days: {} }),
      'здесь Safari выбрасывал человека из приложения при вводе еды',
    )
    // Повторная правка перезапускает таймер — задействуется clearTimeout.
    assert.doesNotThrow(() => engine.push({ profile: { name: 'Аня Б' }, days: {} }))
    assert.doesNotThrow(() => engine.stop())
  } finally {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
  }
})
