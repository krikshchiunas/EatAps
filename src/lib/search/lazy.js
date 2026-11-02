// ─────────────────────────────────────────────────────────────────────────────
// Ленивая загрузка поискового движка.
//
// Движок (engine, index, синонимы, ключевые слова) и названия на всех языках
// нужны только тогда, когда человек что-то ищет, — в стартовый бандл они не
// входят. Чанк грузится в простое сразу после запуска (main.jsx) или при
// первом открытии поиска и кэшируется service worker'ом для офлайна
// (scripts/inject-precache.mjs). Пока он едет, поиск работает упрощённо —
// подстрокой по названию (см. basicSearch в foods.js), а когда приезжает,
// подписчики (useSearchNames) перерисовывают выдачу.
// ─────────────────────────────────────────────────────────────────────────────
let mod = null
let pending = null
const listeners = new Set()

export function loadSearch() {
  if (mod) return Promise.resolve(true)
  if (!pending) {
    pending = import('./index.js')
      .then(async (m) => {
        // Нет сети и нет кэша для названий других языков — движок всё равно
        // работает: по русскому и языку интерфейса.
        await m.loadSearchNames().catch(() => false)
        mod = m
        for (const fn of listeners) fn()
        return true
      })
      .catch(() => {
        pending = null
        return false
      })
  }
  return pending
}

export const searchModule = () => mod
export const searchReady = () => !!mod
export function onSearchReady(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
