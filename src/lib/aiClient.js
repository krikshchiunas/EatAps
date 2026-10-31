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

const KNOWN = ['unauthorized', 'bad_image', 'image_too_large', 'empty_request', 'upstream', 'accounting_unavailable']

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

// image: { media_type, data } — data без префикса data:...;base64,
export function sendPhoto({ image, note, context, prefs, session }) {
  return post('/api/ai/vision', { image, note, context, prefs }, session)
}

// File → { media_type, data }. Ужимаем до 1024px по длинной стороне: модель
// всё равно не видит больше, а трафик и время загрузки на мобильном заметны.
export async function fileToImage(file, maxSide = 1024) {
  const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
  // imageOrientation задаём явно: без него снимок с телефона, сделанный боком,
  // уезжает в модель повёрнутым — и она уверенно опознаёт не то блюдо.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL(type, 0.85)
  return { media_type: type, data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl }
}
