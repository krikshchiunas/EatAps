// ─────────────────────────────────────────────────────────────────────────────
// Клиент AI-эндпоинтов.
//
// Текст ошибки берём из своего словаря по коду, а не из ответа сервера: сервер
// не знает языка интерфейса. Его message — запасной вариант для кода, которого
// фронт ещё не знает.
//
// Ключ Anthropic живёт только на сервере, поэтому фронт ходит в /api/ai/*,
// а не в api.anthropic.com. Токен пользователя передаём Bearer-заголовком —
// по нему сервер сам определит тариф и остаток бюджета; ничего из этого
// клиент не сообщает и сообщить не может.
// ─────────────────────────────────────────────────────────────────────────────
import { t, getLang } from './i18n.js'

export class AIError extends Error {
  constructor(message, { code, status, usage } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.usage = usage
  }
  // Лимит исчерпан — фронт показывает апгрейд, а не «ошибка сети».
  get isBudget() { return this.code === 'budget_exhausted' }
}

const KNOWN = ['unauthorized', 'bad_image', 'image_too_large', 'too_many_images', 'empty_request', 'upstream', 'accounting_unavailable']

function messageFor(code, path, fallback) {
  // Сбой распознавания фото и сбой чата — разные ситуации для человека:
  // в первом случае помогает переснять, во втором — подождать.
  if (code === 'upstream' && path.endsWith('/vision')) return t('ai.err.upstream_photo')
  if (KNOWN.includes(code)) return t(`ai.err.${code}`)
  return fallback || t('ai.genericError')
}

async function post(path, body, session) {
  const token = session?.access_token
  if (!token) throw new AIError(t('ai.err.unauthorized'), { code: 'unauthorized' })

  let res
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      // Язык интерфейса — чтобы ассистент ответил на нём, когда сообщение само
      // его не подсказывает (фото без подписи).
      body: JSON.stringify({ ...body, lang: getLang() }),
    })
  } catch {
    throw new AIError(t('ai.err.offline'), { code: 'offline' })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AIError(
      messageFor(data.error, path, data.message),
      { code: data.error, status: res.status, usage: data },
    )
  }
  return data
}

// history: [{ role: 'user'|'assistant', text }]
export function sendChat({ history, context, prefs, session }) {
  return post('/api/ai/chat', { messages: history, context, prefs }, session)
}

// images: [{ media_type, data }] — data без префикса data:...;base64,
// Одно фото или несколько (сколько разрешает тариф) — одним запросом с текстом.
export function sendPhoto({ images, note, context, prefs, session }) {
  return post('/api/ai/vision', { images, note, context, prefs }, session)
}

// Декодирование с запасными путями: старые Safari не знают параметров
// createImageBitmap (или самой функции) — тогда берём обычный <img>, который
// в iOS 13.4+ и так поворачивает снимок по EXIF.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch {}
    try { return await createImageBitmap(file) } catch {}
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

// File → { media_type, data }. Ужимаем до 1024px по длинной стороне: модель
// всё равно не видит больше, а трафик и время загрузки на мобильном заметны.
export async function fileToImage(file, maxSide = 1024, quality = 0.85) {
  const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  // imageOrientation задаём явно: без него снимок с телефона, сделанный боком,
  // уезжает в модель повёрнутым — и она уверенно опознаёт не то блюдо.
  const bitmap = await decodeImage(file)
  const bw = bitmap.naturalWidth || bitmap.width
  const bh = bitmap.naturalHeight || bitmap.height
  const scale = Math.min(1, maxSide / Math.max(bw, bh))
  const w = Math.round(bw * scale)
  const h = Math.round(bh * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL(type, quality)
  return { media_type: type, data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl }
}

// Весь запрос (все фото вместе) должен влезть в потолок тела serverless-функции
// (4,5 МБ). Делим общий бюджет на число фото, которое разрешает тариф, и ужимаем
// каждое, пока не влезет в свою долю: 10 фото по 1024px в него не помещаются.
export const PHOTO_PAYLOAD_BUDGET = 3.4 * 1024 * 1024

export async function fileToImageWithin(file, maxChars) {
  let side = maxChars < 400_000 ? 896 : 1024
  let quality = 0.85
  let image = await fileToImage(file, side, quality)
  while (image.data.length > maxChars && side > 480) {
    side = Math.round(side * 0.8)
    quality = Math.max(0.6, quality - 0.08)
    image = await fileToImage(file, side, quality)
  }
  return image
}
