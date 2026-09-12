// ─────────────────────────────────────────────────────────────────────────────
// Подписанные ссылки на вложения из закрытых бакетов.
//
// ЗАЧЕМ ЭТОТ МОДУЛЬ
//
// Бакеты chat-images и post-images были публичными: в сообщении и в записи
// лежал готовый постоянный URL, и его хватало, чтобы открыть файл кому угодно.
// Теперь бакеты закрыты (миграция 2026-09-12_private_media), и тот же URL сам
// по себе ничего не открывает — по нему нужно получить подписанную ссылку,
// а её выдаёт только тот, кого пустила политика хранилища.
//
// Старые сообщения при этом продолжают хранить ПОЛНЫЙ публичный URL: менять
// уже записанные строки миграция не стала, это лишний риск. Поэтому здесь
// живёт разбор такого URL обратно в путь внутри бакета.
//
// ПОЧЕМУ РАЗБОР ВЫНЕСЕН ОТДЕЛЬНО И ПОКРЫТ ТЕСТАМИ
//
// Это граница доверия. В строку, которая пришла из базы, теоретически может
// попасть что угодно, и наивный `split('/chat-images/')[1]` на адресе вида
// `https://evil.example/chat-images/../../other` вернул бы путь с выходом
// вверх. Подписывать такой путь нельзя. Проверки ниже — не перестраховка:
// имя объекта уходит прямо в запрос на подпись.
// ─────────────────────────────────────────────────────────────────────────────

// Так выглядит адрес, который отдавал getPublicUrl:
//   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
const PUBLIC_OBJECT_RE = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([a-z0-9-]+)\/(.+)$/i

// Путь внутри бакета: сегменты из безопасных символов, без пустых, без «..».
// Ровно то, что генерирует само приложение: `<uuid>/<uuid>.jpg` либо
// `<uuid>/<uuid>/<uuid>.ext` для dm-media.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

export function isSafeObjectPath(path) {
  if (typeof path !== 'string' || !path || path.length > 512) return false
  const segments = path.split('/')
  if (segments.length < 1 || segments.length > 6) return false
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..' && SAFE_SEGMENT.test(s))
}

// URL (или уже готовый путь) → путь внутри указанного бакета, либо null.
//
// Возвращает null и для чужого бакета: подписывать объект не того бакета, из
// которого его ждут, нельзя — это дало бы обойти политику чтения, подсунув
// в поле картинки записи путь к вложению переписки.
export function objectPathFrom(value, bucket) {
  if (typeof value !== 'string' || !value) return null

  // Уже путь, а не адрес (так хранит вложения dm-media).
  if (!value.includes('://')) {
    return isSafeObjectPath(value) ? value : null
  }

  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const m = PUBLIC_OBJECT_RE.exec(url.pathname)
  if (!m) return null
  if (m[1] !== bucket) return null

  let path
  try { path = decodeURIComponent(m[2]) } catch { return null }
  return isSafeObjectPath(path) ? path : null
}

// ── Кэш подписей ─────────────────────────────────────────────────────────────
// Подпись живёт час, и запрашивать её заново на каждый рендер ленты незачем:
// прокрутка вверх-вниз по двадцати записям давала бы двадцать лишних запросов.
// Держим чуть меньше срока жизни, чтобы ссылка не протухла прямо в момент
// показа.
const TTL_SECONDS = 3600
const REFRESH_BEFORE_MS = 5 * 60 * 1000
const cache = new Map()

export function clearSignedUrlCache() {
  cache.clear()
}

// Возвращает подписанную ссылку либо null. Ошибку наружу не бросаем: вызов
// идёт из отрисовки, и единственная разумная реакция — показать заглушку.
export async function signedUrl(client, bucket, value, { ttl = TTL_SECONDS } = {}) {
  const path = objectPathFrom(value, bucket)
  if (!client || !path) return null

  const key = `${bucket}/${path}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt - Date.now() > REFRESH_BEFORE_MS) return hit.url
  if (hit?.pending) return hit.pending

  const pending = (async () => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttl)
    if (error || !data?.signedUrl) {
      cache.delete(key)
      return null
    }
    cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + ttl * 1000 })
    return data.signedUrl
  })()

  cache.set(key, { ...(hit || {}), pending })
  return pending
}
