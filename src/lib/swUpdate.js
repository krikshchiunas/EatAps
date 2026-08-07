// ─────────────────────────────────────────────────────────────────────────────
// Обновление PWA без потери данных и без циклов перезагрузки.
//
// Раньше service worker вызывал skipWaiting() сразу при установке: новая версия
// активировалась под работающей вкладкой, стирала старые чанки, и ленивый
// импорт падал на 404. Плюс перезагрузка могла случиться прямо во время
// сохранения.
//
// Теперь порядок такой:
//   1. Новая версия скачалась и ждёт (waiting).
//   2. Мы ждём безопасного момента: вкладка ушла в фон И нет неотправленных
//      изменений. Так перезагрузка не прерывает ни ввод, ни сохранение.
//   3. Отправляем SKIP_WAITING, ловим controllerchange и перезагружаемся —
//      ровно один раз (флаг reloading), поэтому цикл невозможен.
// ─────────────────────────────────────────────────────────────────────────────

let reloading = false
let waitingWorker = null
let isSafe = () => true

// Приложение сообщает, можно ли сейчас перезагружаться (нет pending-сохранений).
export function setUpdateSafetyCheck(fn) {
  isSafe = typeof fn === 'function' ? fn : () => true
  maybeApply()
}

function maybeApply() {
  if (!waitingWorker || reloading) return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
  if (!isSafe()) return
  reloading = true
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Первая установка контроллера на непроконтролированной странице — это не
    // обновление, перезагружаться незачем.
    if (!reloading) return
    window.location.reload()
  })

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const track = (worker) => {
      if (!worker) return
      const check = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = worker
          maybeApply()
        }
      }
      worker.addEventListener('statechange', check)
      check()
    }

    track(reg.waiting)
    reg.addEventListener('updatefound', () => track(reg.installing))

    // Проверяем обновления при возврате на вкладку: PWA живёт неделями без
    // перезапуска, и без этого пользователь остаётся на старой сборке.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {})
      else maybeApply()
    })
  }).catch(() => {})
}
