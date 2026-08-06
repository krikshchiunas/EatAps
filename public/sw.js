const CACHE = 'eataps-v9'
// Стартовые ассеты ядра (entry-скрипт + css) подставляются при сборке скриптом
// scripts/inject-precache.mjs вместо маркера ниже.
const BUILD_ASSETS = /* __BUILD_ASSETS__ */ []
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  ...BUILD_ASSETS,
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

// Клик по уведомлению — сфокусировать уже открытую вкладку или открыть новую.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of clientsList) {
      if ('focus' in c) return c.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow('/')
  })())
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return

  // Навигация (HTML) — network-first: всегда берём свежий index из сети, чтобы
  // хэши ленивых чанков совпадали с задеплоенными (иначе после деплоя старый
  // кэш ссылается на исчезнувший чанк → «зелёный экран»). Офлайн — из кэша.
  if (request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        } catch {
          return (await caches.match('/')) || (await caches.match('/index.html')) || Response.error()
        }
      })()
    )
    return
  }

  // Остальное (хэшированные ассеты, иконки) — cache-first: они неизменяемы.
  e.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      try {
        const res = await fetch(request)
        if (res && res.status === 200 && request.url.startsWith(self.location.origin)) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
        }
        return res
      } catch {
        return Response.error()
      }
    })()
  )
})
