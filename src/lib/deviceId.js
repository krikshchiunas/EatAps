// Стабильный идентификатор устройства (точнее — профиля браузера).
//
// Нужен для трёх вещей: тай-брейк в HLC-метках, дедупликация собственных
// realtime-эхо и диагностика. Это НЕ идентификатор пользователя: он не уходит
// в чужие руки, не участвует в авторизации и переживает смену аккаунта на
// устройстве. Живёт в отдельном ключе, который не чистится при выходе.

const KEY = 'eataps:deviceId'

function randomHex8() {
  try {
    const buf = new Uint8Array(4)
    crypto.getRandomValues(buf)
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  }
}

let cached = null

export function getDeviceId() {
  if (cached) return cached
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && /^[0-9a-f]{8}$/.test(saved)) {
      cached = saved
      return cached
    }
  } catch {
    // приватный режим / отключённое хранилище — работаем с эфемерным ID
  }
  cached = randomHex8()
  try { localStorage.setItem(KEY, cached) } catch {}
  return cached
}
