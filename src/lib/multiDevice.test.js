// ─────────────────────────────────────────────────────────────────────────────
// Сценарии «один аккаунт — несколько устройств».
//
// Здесь проверяется главное обещание переработки: вход на одном устройстве не
// мешает другому, а правки, сделанные параллельно, складываются, а не
// затирают друг друга. Каждое «устройство» — независимый движок со своими
// часами, своим локальным кэшем и своим подключением к общему серверу.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYNC } from './syncEngine.js'
import { DATE, createServer, createTimers, createDevice, serverMeals } from './syncTestKit.js'

test('три устройства одного аккаунта работают одновременно и не мешают друг другу', async () => {
  const server = createServer()
  const timers = createTimers()

  const phone = createDevice(server, { timers, name: 'phone', cacheStore: new Map() })
  const laptop = createDevice(server, { timers, name: 'laptop', cacheStore: new Map() })
  const tablet = createDevice(server, { timers, name: 'tablet', cacheStore: new Map() })

  await phone.engine.start(phone.state)
  await laptop.engine.start(laptop.state)
  await tablet.engine.start(tablet.state)
  await timers.advance(1000)

  phone.addMeal('m1', 'Завтрак с телефона')
  laptop.addMeal('m2', 'Обед с ноутбука')
  tablet.addMeal('m3', 'Ужин с планшета')
  await timers.advance(5000)

  const expected = ['Завтрак с телефона', 'Обед с ноутбука', 'Ужин с планшета']
  assert.deepEqual(serverMeals(server), expected, 'на сервере все три правки')
  assert.deepEqual(phone.mealNames(), expected)
  assert.deepEqual(laptop.mealNames(), expected)
  assert.deepEqual(tablet.mealNames(), expected)
})

// Сценарий из технического задания, шаг за шагом.
test('полный цикл: параллельные правки → локальный выход A → B продолжает → A возвращается', async () => {
  const server = createServer()
  const timers = createTimers()
  const cacheA = new Map()
  const cacheB = new Map()

  // 1. Оба входят под одним аккаунтом.
  const a = createDevice(server, { timers, name: 'devA', cacheStore: cacheA })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: cacheB })
  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(1000)

  // 2. Клиент A меняет день питания. 3. Клиент B меняет профиль.
  a.addMeal('m1', 'Овсянка')
  b.setProfile({ name: 'Аня', weight: 58 })

  // 4. Оба изменения сохраняются. 5. Ни одно не потеряно.
  await timers.advance(5000)
  assert.deepEqual(serverMeals(server), ['Овсянка'], 'день A сохранён')
  assert.equal(server.state.profile.weight, 58, 'профиль B сохранён')
  assert.equal(a.state.profile.weight, 58, 'A видит профиль, изменённый на B')
  assert.deepEqual(b.mealNames(), ['Овсянка'], 'B видит день, изменённый на A')

  // 6. A выходит локально: движок остановлен, кэш устройства A стёрт.
  await a.engine.flush()
  a.engine.stop()
  cacheA.clear()

  // 7. B остаётся авторизованным. 8. B продолжает сохранять данные.
  b.addMeal('m2', 'Ужин после выхода A')
  await timers.advance(2000)
  assert.equal(b.status, SYNC.SYNCED, 'выход на A никак не задел сессию B')
  assert.deepEqual(serverMeals(server), ['Овсянка', 'Ужин после выхода A'])

  // 9. A входит повторно и получает актуальное состояние.
  const a2 = createDevice(server, { timers, name: 'devA', cacheStore: cacheA })
  await a2.engine.start(a2.state)
  await timers.advance(1000)

  assert.deepEqual(a2.mealNames(), ['Овсянка', 'Ужин после выхода A'])
  assert.equal(a2.state.profile.weight, 58)
})

test('офлайн A + правки B: изменения объединяются, старый снимок ничего не уничтожает', async () => {
  const server = createServer()
  const timers = createTimers()
  const a = createDevice(server, { timers, name: 'devA', cacheStore: new Map() })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: new Map() })

  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(500)

  a.addMeal('m0', 'Общий завтрак')
  await timers.advance(2000)

  // A уходит в офлайн.
  a.setOnline(false)

  // B меняет данные, пока A недоступно.
  b.addMeal('m1', 'Обед B')
  b.setProfile({ name: 'Аня', weight: 57 })
  await timers.advance(3000)

  // A меняет другие данные офлайн.
  a.addMeal('m2', 'Перекус A офлайн')
  await timers.advance(5000)
  assert.equal(a.status, SYNC.OFFLINE)

  // A возвращается в сеть.
  a.setOnline(true)
  a.engine.retryNow()
  await a.engine.refresh()
  await timers.advance(5000)

  const expected = ['Общий завтрак', 'Обед B', 'Перекус A офлайн']
  assert.deepEqual(serverMeals(server), expected.slice().sort(), 'обе ветки правок на сервере')
  assert.deepEqual(a.mealNames(), expected.slice().sort())
  assert.equal(server.state.profile.weight, 57, 'профиль, изменённый на B, не откатился')
  assert.equal(a.status, SYNC.SYNCED)
})

test('удаление на одном устройстве доезжает до второго и не возвращается', async () => {
  const server = createServer()
  const timers = createTimers()
  const a = createDevice(server, { timers, name: 'devA', cacheStore: new Map() })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: new Map() })

  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(500)

  a.addMeal('m1', 'Лишнее')
  a.addMeal('m2', 'Нужное')
  await timers.advance(2000)
  assert.deepEqual(b.mealNames(), ['Лишнее', 'Нужное'])

  // B удаляет запись; A в этот момент офлайн со старой копией.
  a.setOnline(false)
  b.removeMeal('m1')
  await timers.advance(2000)

  a.setOnline(true)
  a.engine.retryNow()
  await a.engine.refresh()
  await timers.advance(3000)

  assert.deepEqual(serverMeals(server), ['Нужное'], 'удалённое не воскресло из копии A')
  assert.deepEqual(a.mealNames(), ['Нужное'])
})

test('одновременное редактирование одной записи: побеждает более поздняя правка, данные целы', async () => {
  const server = createServer()
  const timers = createTimers()
  const a = createDevice(server, { timers, name: 'devA', cacheStore: new Map() })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: new Map() })

  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(500)

  a.addMeal('m1', 'Каша')
  await timers.advance(2000)

  // Оба правят один и тот же продукт, не зная друг о друге.
  a.setOnline(false)
  b.setOnline(false)
  a.removeMeal('m1')
  a.addMeal('m1', 'Каша 150 г')
  b.removeMeal('m1')
  b.addMeal('m1', 'Каша 300 г')

  a.setOnline(true)
  a.engine.retryNow()
  await timers.advance(2000)
  b.setOnline(true)
  b.engine.retryNow()
  await b.engine.refresh()
  await timers.advance(3000)
  await a.engine.refresh()
  await timers.advance(3000)

  // Устройства сходятся к одному и тому же — вот главное требование.
  assert.deepEqual(a.mealNames(), b.mealNames(), 'устройства сошлись к одному состоянию')
  assert.deepEqual(a.mealNames(), serverMeals(server), 'и совпадают с сервером')
  assert.equal(a.mealNames().length, 1, 'дубликат не появился')
})

test('быстрая последовательность правок на двух устройствах сходится', async () => {
  const server = createServer()
  const timers = createTimers()
  const a = createDevice(server, { timers, name: 'devA', cacheStore: new Map() })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: new Map() })
  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(500)

  for (let i = 0; i < 10; i++) {
    a.addMeal(`a${i}`, `A-${i}`)
    b.addMeal(`b${i}`, `B-${i}`)
    await timers.advance(120)
  }
  await timers.advance(10_000)
  await a.engine.refresh()
  await b.engine.refresh()
  await timers.advance(5000)

  assert.equal(serverMeals(server).length, 20, 'ни одна из двадцати правок не потерялась')
  assert.deepEqual(a.mealNames(), b.mealNames())
  assert.deepEqual(a.mealNames(), serverMeals(server))
})

test('обновление токена на одном устройстве не влияет на данные другого', async () => {
  // Обновление токена в движке синхронизации не участвует вовсе: транспорт
  // берёт токен у общего клиента supabase. Проверяем главное следствие —
  // непрерывность потока сохранений на соседнем устройстве.
  const server = createServer()
  const timers = createTimers()
  const a = createDevice(server, { timers, name: 'devA', cacheStore: new Map() })
  const b = createDevice(server, { timers, name: 'devB', cacheStore: new Map() })
  await a.engine.start(a.state)
  await b.engine.start(b.state)
  await timers.advance(500)

  // Устройство A «переживает» обновление токена: один запрос отваливается,
  // следующий проходит. Данные B при этом не должны пострадать.
  b.addMeal('m1', 'До обновления')
  await timers.advance(2000)

  server.failOnce(Object.assign(new TypeError('Failed to fetch'), {}))
  a.addMeal('m2', 'Во время обновления')
  await timers.advance(3000)

  assert.deepEqual(serverMeals(server).sort(), ['Во время обновления', 'До обновления'])
  assert.equal(b.status, SYNC.SYNCED, 'сессия B не задета')
})

test('вход другого аккаунта на устройстве не смешивает данные', async () => {
  const timers = createTimers()
  const serverA = createServer()
  const serverB = createServer()
  const deviceCache = new Map() // одно физическое устройство

  const a = createDevice(serverA, { timers, name: 'shared', userId: 'userA', cacheStore: deviceCache })
  await a.engine.start(a.state)
  a.addMeal('m1', 'Секрет A')
  a.setProfile({ name: 'Аня' })
  await timers.advance(2000)

  // Локальный выход: движок остановлен, кэш этого пользователя стёрт.
  await a.engine.flush()
  a.engine.stop()
  deviceCache.delete('userA')

  // Входит другой человек.
  const b = createDevice(serverB, { timers, name: 'shared', userId: 'userB', cacheStore: deviceCache })
  await b.engine.start(b.state)
  await timers.advance(2000)

  assert.deepEqual(b.mealNames(), [], 'дневник A не виден B')
  assert.equal(b.state.profile, null, 'профиль A не подставился B')
  assert.equal(serverB.state?.profile ?? null, null, 'и не уехал в облако B')
  assert.deepEqual(serverMeals(serverA), ['Секрет A'], 'данные A остались у A')
})
