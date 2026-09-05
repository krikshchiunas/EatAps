// Realtime-хаб проверяется на фальшивом клиенте, который ведёт себя как
// настоящий supabase-js в двух неприятных местах:
//
//   • channel(topic) на одну и ту же тему отдаёт ОДИН И ТОТ ЖЕ объект;
//   • on('postgres_changes'|'presence') БРОСАЕТ, если канал уже подписан.
//
// Оба поведения — не выдумка для теста, а то, что записано в исходниках
// realtime-js 2.111 (RealtimeClient.channel и RealtimeChannel.on). Именно
// сочетание этих двух и роняло приложение, когда два компонента подписывались
// на одну тему.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRealtimeHub } from './realtime.js'

function fakeClient() {
  const channels = new Map()
  const removed = []
  let created = 0

  const make = (topic) => {
    let joined = false
    const handlers = []
    const ch = {
      topic,
      sent: [],
      on(type, _filter, cb) {
        if (joined && (type === 'postgres_changes' || type === 'presence')) {
          throw new Error(`cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`)
        }
        handlers.push(cb)
        return ch
      },
      subscribe(onStatus) {
        if (joined) throw new Error('tried to subscribe multiple times')
        joined = true
        ch.statusCb = onStatus || null
        onStatus?.('SUBSCRIBED')
        return ch
      },
      send(p) { ch.sent.push(p); return ch },
      fire(payload) { for (const h of [...handlers]) h(payload) },
      get joined() { return joined },
    }
    return ch
  }

  return {
    created: () => created,
    removed,
    channel(topic) {
      const exists = channels.get(topic)
      if (exists) return exists
      created += 1
      const ch = make(topic)
      channels.set(topic, ch)
      return ch
    },
    // Как в supabase-js: снятие асинхронно, объект какое-то время ещё жив.
    removeChannel(ch) { removed.push(ch.topic); return Promise.resolve('ok') },
    _channels: channels,
  }
}

// Таймеры под контролем теста: реальная пауза сделала бы тест медленным и
// плавающим.
function fakeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    setTimer: (fn, ms) => { const id = ++seq; pending.set(id, fn); return id },
    clearTimer: (id) => pending.delete(id),
    flush() { for (const fn of [...pending.values()]) fn(); pending.clear() },
    size: () => pending.size,
  }
}

const bindPg = (channel, emit) => channel.on('postgres_changes', {}, emit)

test('два слушателя одной темы — один канал, а не исключение', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const seenA = []
  const seenB = []
  // Раньше вторая подписка бросала «cannot add postgres_changes callbacks
  // after subscribe()» и уносила приложение в RootErrorBoundary.
  assert.doesNotThrow(() => {
    hub.subscribe('notifications:u1', bindPg, (p) => seenA.push(p))
    hub.subscribe('notifications:u1', bindPg, (p) => seenB.push(p))
  })
  assert.equal(client.created(), 1, 'должен быть ровно один канал на тему')

  const [ch] = [...client._channels.values()]
  ch.fire({ event: 'INSERT' })
  assert.deepEqual(seenA, [{ event: 'INSERT' }])
  assert.deepEqual(seenB, [{ event: 'INSERT' }], 'событие получают все слушатели')
  hub.reset()
})

test('десять компонентов не превращаются в десять подписок', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const counts = []
  const offs = []
  for (let i = 0; i < 10; i++) {
    counts.push(0)
    offs.push(hub.subscribe('chat:u1:u2', bindPg, () => { counts[i] += 1 }))
  }
  assert.equal(client.created(), 1)
  const [ch] = [...client._channels.values()]
  ch.fire({ n: 1 })
  // Одно сообщение — одно событие каждому, а не десять одному.
  assert.deepEqual(counts, Array(10).fill(1))
  offs.forEach((off) => off())
  hub.reset()
})

test('канал живёт, пока есть хоть один слушатель', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const offA = hub.subscribe('presence:user:u2', bindPg, () => {})
  const offB = hub.subscribe('presence:user:u2', bindPg, () => {})
  offA()
  t.flush()
  assert.deepEqual(client.removed, [], 'ушёл один из двух — канал остаётся')
  offB()
  t.flush()
  assert.equal(client.removed.length, 1, 'ушёл последний — канал снят')
  hub.reset()
})

test('быстрое пере-монтирование не снимает канал и не создаёт второй', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  // Ровно то, что делает StrictMode: смонтировал, размонтировал, смонтировал.
  const off1 = hub.subscribe('chat:u1:u2', bindPg, () => {})
  off1()
  const off2 = hub.subscribe('chat:u1:u2', bindPg, () => {})
  t.flush()

  assert.equal(client.created(), 1, 'второй канал не создан')
  assert.deepEqual(client.removed, [], 'канал не снят: слушатель вернулся до паузы')
  off2()
  t.flush()
  assert.equal(client.removed.length, 1)
  hub.reset()
})

test('пере-подписка после закрытия берёт НОВУЮ тему', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const off = hub.subscribe('chat:u1:u2', bindPg, () => {})
  off()
  t.flush()
  // Настоящий removeChannel асинхронен, и старый канал ещё числится у клиента.
  // Если бы тема совпадала, client.channel() вернул бы уже подписанный объект,
  // и .on() бросил бы. Поколение в теме убирает этот промежуток.
  assert.doesNotThrow(() => hub.subscribe('chat:u1:u2', bindPg, () => {}))
  assert.equal(client.created(), 2)
  const topics = [...client._channels.keys()]
  assert.notEqual(topics[0], topics[1], 'темы должны различаться поколением')
  hub.reset()
})

test('упавший слушатель не лишает события остальных', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const seen = []
  hub.subscribe('x', bindPg, () => { throw new Error('сломался') })
  hub.subscribe('x', bindPg, (p) => seen.push(p))
  const [ch] = [...client._channels.values()]
  assert.doesNotThrow(() => ch.fire({ ok: true }))
  assert.deepEqual(seen, [{ ok: true }])
  hub.reset()
})

test('слушатель может отписаться прямо из обработчика', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const seen = []
  let off = null
  off = hub.subscribe('x', bindPg, (p) => { seen.push(p); off() })
  hub.subscribe('x', bindPg, (p) => seen.push(p))
  const [ch] = [...client._channels.values()]
  assert.doesNotThrow(() => ch.fire(1))
  assert.equal(seen.length, 2)
  ch.fire(2)
  assert.equal(seen.length, 3, 'отписавшийся больше не получает')
  hub.reset()
})

test('двойная отписка безопасна', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  const off = hub.subscribe('x', bindPg, () => {})
  const other = hub.subscribe('x', bindPg, () => {})
  off(); off(); off()
  t.flush()
  assert.deepEqual(client.removed, [], 'второй слушатель на месте — канал жив')
  other()
  t.flush()
  assert.equal(client.removed.length, 1)
  hub.reset()
})

test('сбой при создании канала не бросает наружу', () => {
  const client = fakeClient()
  const broken = { ...client, channel: () => { throw new Error('websocket заблокирован') } }
  const hub = createRealtimeHub(broken, fakeTimers())
  hub.reset()
  let off
  assert.doesNotThrow(() => { off = hub.subscribe('x', bindPg, () => {}) })
  assert.doesNotThrow(() => off())
  hub.reset()
})

test('reset снимает все каналы — смена аккаунта не тащит чужие события', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  hub.subscribe('notifications:u1', bindPg, () => {})
  hub.subscribe('incoming:u1', bindPg, () => {})
  assert.equal(hub.stats().length, 2)
  hub.reset()
  assert.equal(hub.stats().length, 0)
  assert.equal(client.removed.length, 2)
})

test('send уходит в открытый канал и молчит для закрытого', () => {
  const client = fakeClient()
  const t = fakeTimers()
  const hub = createRealtimeHub(client, t)
  hub.reset()

  hub.subscribe('typing:a_b', (ch, emit) => ch.on('broadcast', {}, emit), () => {})
  assert.equal(hub.send('typing:a_b', { type: 'broadcast' }), true)
  assert.equal(hub.send('typing:нет-такой', { type: 'broadcast' }), false)
  hub.reset()
})

test('bind может вернуть обработчик статуса — подписку зовёт хаб, и ровно раз', () => {
  const client = fakeClient()
  const hub = createRealtimeHub(client, fakeTimers())
  hub.reset()

  // Присутствие устроено именно так: трекать себя можно только после
  // SUBSCRIBED. Раньше bind звал subscribe() сам, а хаб звал его второй раз —
  // это «tried to subscribe multiple times».
  const statuses = []
  assert.doesNotThrow(() => {
    hub.subscribe('presence:self:u1', () => (status) => statuses.push(status), () => {})
  })
  assert.deepEqual(statuses, ['SUBSCRIBED'])
  hub.reset()
})

// ─────────────────────────────────────────────────────────────────────────────
// Сторож: ни один модуль приложения не заводит канал в обход реестра.
//
// Прямой supabase.channel() — это ровно та ловушка, ради которой реестр и
// написан: на одну тему клиент отдаёт один и тот же объект, а второй
// .on('postgres_changes') по нему бросает исключение. Один такой вызов,
// добавленный «по образцу соседнего кода», возвращает старую ошибку.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(jsx|js)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p)
    }
  }
  walk(SRC)
  return out
}

test('каналы создаются только внутри realtime.js', () => {
  const offenders = []
  for (const file of sourceFiles()) {
    if (file.endsWith(`${'/'}realtime.js`)) continue
    const src = readFileSync(file, 'utf8')
    // Комментарии не считаем: в supabase.js и social.js устройство ловушки
    // описано словами, и упоминание вызова там уместно.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    if (/supabase\s*\.\s*channel\s*\(/.test(code)) offenders.push(relative(SRC, file))
  }
  assert.deepEqual(offenders, [],
    'эти файлы создают realtime-канал мимо реестра — используйте realtime.subscribe()')
})
