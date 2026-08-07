// Шина между вкладками одного браузера.
//
// supabase-js синхронизирует между вкладками только обновление токена (через
// navigator.locks). Вход и выход он не рассылает: вкладка, открытая рядом,
// держит сессию в памяти и продолжает считать пользователя вошедшим после
// выхода в соседней вкладке. Здесь это чинится явным сообщением.
//
// Состояние приложения между вкладками не пересылается: они пишут в один и тот
// же ключ localStorage, и события storage дают то же самое бесплатно (см.
// store.jsx). Здесь — только события аккаунта.

const CHANNEL = 'eataps:tabs'

let channel = null
try {
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL)
} catch {
  channel = null
}

// Фолбэк для браузеров без BroadcastChannel: короткая запись в localStorage,
// которую соседние вкладки видят как событие storage.
const FALLBACK_KEY = 'eataps:tabs:signal'

export function postAuthSignal(kind) {
  const msg = { kind, at: Date.now() }
  if (channel) {
    try { channel.postMessage(msg); return } catch {}
  }
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(msg)) } catch {}
}

// onSignal(kind) — 'signed-in' | 'signed-out'. Возвращает функцию отписки.
export function onAuthSignal(handler) {
  const viaChannel = (e) => {
    if (e?.data?.kind) handler(e.data.kind)
  }
  const viaStorage = (e) => {
    if (e.key !== FALLBACK_KEY || !e.newValue) return
    try {
      const msg = JSON.parse(e.newValue)
      if (msg?.kind) handler(msg.kind)
    } catch {}
  }

  if (channel) channel.addEventListener('message', viaChannel)
  if (typeof window !== 'undefined') window.addEventListener('storage', viaStorage)

  return () => {
    if (channel) channel.removeEventListener('message', viaChannel)
    if (typeof window !== 'undefined') window.removeEventListener('storage', viaStorage)
  }
}
