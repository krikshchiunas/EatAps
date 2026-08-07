// ─────────────────────────────────────────────────────────────────────────────
// Гибридные логические часы (HLC) — метки времени для слияния данных.
//
// Зачем не Date.now(): устройства расходятся по часам. Телефон, отставший на
// 10 минут, при обычном last-write-wins проигрывал бы любую правку с ноутбука,
// даже сделанную раньше — и молча терял бы свои изменения. HLC берёт максимум
// из настенных часов и всех уже увиденных чужих меток, поэтому метка НИКОГДА не
// уезжает назад: каждое новое изменение гарантированно «новее» всего, что
// устройство успело увидеть. Скачок чужих часов вперёд подтягивает наши, но
// порядок причинно-следственных правок сохраняется.
//
// Формат метки — строка `<ms:15>-<counter:5>-<deviceId>`. Она сортируется
// лексикографически ровно так же, как хронологически, поэтому сравнение — это
// обычное сравнение строк, а тай-брейк по deviceId делает результат слияния
// детерминированным: два устройства из одинаковых входных данных всегда
// получат одинаковый результат.
// ─────────────────────────────────────────────────────────────────────────────

const MS_DIGITS = 15 // хватает до 33658 года
const COUNTER_DIGITS = 5
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1

export const ZERO_TS = format(0, 0, '00000000')

function format(ms, counter, deviceId) {
  return `${String(ms).padStart(MS_DIGITS, '0')}-${String(counter).padStart(COUNTER_DIGITS, '0')}-${deviceId}`
}

// Метка → миллисекунды. Нужен для сборки мусора тумбстоунов, не для сравнения.
export function tsMillis(ts) {
  const ms = Number(String(ts || '').slice(0, MS_DIGITS))
  return Number.isFinite(ms) ? ms : 0
}

function tsCounter(ts) {
  const c = Number(String(ts || '').slice(MS_DIGITS + 1, MS_DIGITS + 1 + COUNTER_DIGITS))
  return Number.isFinite(c) ? c : 0
}

// Сравнение меток. Всё, что не похоже на метку (undefined, легаси-записи без
// времени), считается нулём — то есть проигрывает любой настоящей метке.
export function compareTs(a, b) {
  const x = isTs(a) ? a : ZERO_TS
  const y = isTs(b) ? b : ZERO_TS
  return x < y ? -1 : x > y ? 1 : 0
}

export function isTs(v) {
  return typeof v === 'string' && v.length === MS_DIGITS + 1 + COUNTER_DIGITS + 1 + 8
}

export function maxTs(a, b) {
  return compareTs(a, b) >= 0 ? (isTs(a) ? a : ZERO_TS) : b
}

export function newerTs(a, b) {
  return compareTs(a, b) > 0
}

// Часы одного устройства. now/load/save вынесены в параметры, чтобы тесты
// гоняли детерминированное время и не трогали localStorage.
export function createClock({ deviceId, now = () => Date.now(), load = () => null, save = () => {} } = {}) {
  const id = String(deviceId || '00000000').slice(0, 8).padEnd(8, '0')
  let lastMs = 0
  let counter = 0

  const restored = load()
  if (isTs(restored)) {
    lastMs = tsMillis(restored)
    counter = tsCounter(restored)
  }

  const persist = () => {
    try { save(format(lastMs, counter, id)) } catch {}
  }

  return {
    deviceId: id,

    // Метка для нового локального изменения.
    tick() {
      const wall = now()
      if (wall > lastMs) {
        lastMs = wall
        counter = 0
      } else if (counter < MAX_COUNTER) {
        counter += 1
      } else {
        // Переполнение счётчика в пределах одной миллисекунды — двигаем ms
        // вперёд. Часы уйдут на 1 мс в будущее, что безопасно.
        lastMs += 1
        counter = 0
      }
      persist()
      return format(lastMs, counter, id)
    },

    // Увидели чужую метку (из облака, от другой вкладки) — подтягиваем часы,
    // чтобы наши следующие правки заведомо считались более новыми.
    observe(ts) {
      if (!isTs(ts)) return
      const ms = tsMillis(ts)
      const c = tsCounter(ts)
      if (ms > lastMs) {
        lastMs = ms
        counter = c
        persist()
      } else if (ms === lastMs && c > counter) {
        counter = c
        persist()
      }
    },

    // Текущее значение без выдачи новой метки — для диагностики и тестов.
    peek() {
      return format(lastMs, counter, id)
    },
  }
}

// Пройтись по чужому состоянию и подтянуть часы под все встреченные метки.
export function observeAll(clock, value, depth = 0) {
  if (!clock || depth > 8 || value == null) return
  if (typeof value === 'string') {
    if (isTs(value)) clock.observe(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) observeAll(clock, v, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const k in value) observeAll(clock, value[k], depth + 1)
  }
}
