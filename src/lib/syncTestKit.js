// Общий стенд для тестов синхронизации: фальшивый сервер с той же семантикой
// compare-and-swap, что и RPC save_app_state, управляемые таймеры и модель
// «устройства». Файл не импортируется приложением и в сборку не попадает.
import { createSyncEngine } from './syncEngine.js'
import { createClock } from './hlc.js'
import { blankDay, normalizeState, addTombstone, tombMeal } from './syncModel.js'

export const DATE = '2026-08-06'

export const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

// ── Фальшивый сервер: повторяет контракт save_app_state ─────────────────────
export function createServer() {
  let row = null // { state, revision }
  let subscribers = []
  const log = { saves: 0, conflicts: 0, pulls: 0 }
  let failNext = null // ошибка, которую вернуть на следующий запрос

  const notify = () => {
    const evt = { revision: row.revision, state: clone(row.state), updatedAt: new Date().toISOString() }
    for (const cb of [...subscribers]) cb(evt)
  }

  return {
    log,
    get revision() { return row?.revision || 0 },
    get state() { return clone(row?.state) },
    failOnce(err) { failNext = err },
    // Прямая запись «другим устройством», мимо клиента под тестом.
    write(state) {
      row = { state: clone(state), revision: (row?.revision || 0) + 1 }
      notify()
    },
    // То же самое, но событие приходит БЕЗ состояния: Realtime обрезает
    // крупные строки (лимит размера записи), и подписчик обязан дочитать
    // строку сам. Отдельный метод нужен потому, что это единственный путь,
    // на котором движок ходит в pull из обработчика события.
    writeTruncated(state) {
      row = { state: clone(state), revision: (row?.revision || 0) + 1 }
      const evt = { revision: row.revision, state: null, updatedAt: new Date().toISOString() }
      for (const cb of [...subscribers]) cb(evt)
    },
    async pull() {
      log.pulls += 1
      if (failNext) { const e = failNext; failNext = null; throw e }
      return row ? { state: clone(row.state), revision: row.revision, updatedAt: new Date().toISOString() } : null
    },
    async save(state, base) {
      if (failNext) { const e = failNext; failNext = null; throw e }
      log.saves += 1
      const noRow = base == null || base <= 0
      if (noRow) {
        if (!row) {
          row = { state: clone(state), revision: 1 }
          notify()
          // При успехе RPC не возвращает состояние (экономия трафика) —
          // повторяем контракт точно, чтобы движок на него не опирался.
          return { revision: 1, state: null, conflict: false }
        }
        log.conflicts += 1
        return { revision: row.revision, state: clone(row.state), conflict: true }
      }
      if (row && row.revision === base) {
        row = { state: clone(state), revision: base + 1 }
        notify()
        return { revision: row.revision, state: null, conflict: false }
      }
      log.conflicts += 1
      return { revision: row?.revision || 0, state: clone(row?.state) || null, conflict: true }
    },
    subscribe(_uid, cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter((s) => s !== cb) }
    },
  }
}

// ── Управляемые таймеры ─────────────────────────────────────────────────────
export function createTimers() {
  let now = 0
  let seq = 1
  const tasks = new Map()
  const flush = () => new Promise((r) => setImmediate(r))

  return {
    api: {
      setTimeout(fn, ms) { const id = seq++; tasks.set(id, { fn, at: now + (ms || 0) }); return id },
      clearTimeout(id) { tasks.delete(id) },
    },
    // Время идёт вперёд шагами по ближайшей задаче, а не одним прыжком:
    // иначе повтор, запланированный с backoff уже ВНУТРИ окна, не успевал
    // сработать, и тест врал про поведение движка.
    async advance(ms = 0) {
      const target = now + ms
      for (let guard = 0; guard < 1000; guard++) {
        await flush()
        await flush()
        const due = [...tasks.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)
        if (!due.length) break
        const [id, t] = due[0]
        tasks.delete(id)
        now = Math.max(now, t.at)
        t.fn()
      }
      now = target
      await flush()
      await flush()
    },
  }
}

// ── Устройство ──────────────────────────────────────────────────────────────
let deviceSeq = 0
export function createDevice(server, { name = `dev${++deviceSeq}`, userId = 'u1', timers, seed = null, cacheStore = new Map(), realtime = true } = {}) {
  const clockMs = { value: 1000 + deviceSeq * 10 }
  const clock = createClock({ deviceId: name.padEnd(8, '0').slice(0, 8), now: () => (clockMs.value += 1) })
  const statuses = []
  let state = seed ? normalizeState(seed) : normalizeState({})
  let fatal = null
  let online = true

  const guardOffline = (fn) => async (...args) => {
    if (!online) throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })
    return fn(...args)
  }

  const engine = createSyncEngine({
    userId,
    transport: {
      pull: guardOffline((uid) => server.pull(uid)),
      save: guardOffline((s, b) => server.save(s, b)),
      // realtime: false — эмуляция «событие не дошло» (вкладка спала, сокет
      // отвалился). Тогда единственная защита от потери правок — CAS на сервере.
      subscribe: (uid, cb) => (realtime ? server.subscribe(uid, (evt) => { if (online) cb(evt) }) : () => {}),
    },
    clock,
    cache: {
      read: () => cacheStore.get(userId) || null,
      write: (rec) => cacheStore.set(userId, clone(rec)),
      clear: () => cacheStore.delete(userId),
    },
    onState: (next) => { state = next },
    onStatus: (st) => statuses.push(st),
    onFatal: (err) => { fatal = err },
    debounceMs: 800,
    timers: timers.api,
  })

  return {
    name, engine, clock, cacheStore,
    get state() { return state },
    get status() { return statuses[statuses.length - 1] },
    get statuses() { return statuses },
    get fatal() { return fatal },
    setOnline(v) { online = v },
    // Пользовательская правка: добавить продукт в день.
    addMeal(id, mealName) {
      const day = state.days[DATE] || blankDay()
      state = {
        ...state,
        days: { ...state.days, [DATE]: { ...day, meals: [...day.meals, { id, name: mealName, kcal: 100, updatedAt: clock.tick() }] } },
      }
      engine.push(state)
    },
    removeMeal(id) {
      const day = state.days[DATE] || blankDay()
      state = {
        ...state,
        days: { ...state.days, [DATE]: { ...day, meals: day.meals.filter((m) => m.id !== id) } },
        meta: addTombstone(state.meta, tombMeal(DATE, id), clock.tick()),
      }
      engine.push(state)
    },
    setProfile(profile) {
      state = { ...state, profile, meta: { ...state.meta, profileTs: clock.tick() } }
      engine.push(state)
    },
    mealNames() {
      return (state.days[DATE]?.meals || []).map((m) => m.name).sort()
    },
  }
}

export const serverMeals = (server) => ((server.state?.days?.[DATE]?.meals) || []).map((m) => m.name).sort()
