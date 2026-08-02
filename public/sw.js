const CACHE = 'eataps-v6'
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

// Cache-first: если ресурс уже в кэше — отдаём его и НЕ ходим в сеть
// (иначе фоновый сетевой запрос офлайн падает и шумит). Промах кэша — идём
// в сеть и кладём копию в кэш; при офлайне для навигации отдаём главную.
self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
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
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        return Response.error()
      }
    })()
  )
})
