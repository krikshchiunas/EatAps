// ─────────────────────────────────────────────────────────────────────────────
// Клиент AI-эндпоинтов.
//
// Ключ Anthropic живёт только на сервере, поэтому фронт ходит в /api/ai/*,
// а не в api.anthropic.com. Токен пользователя передаём Bearer-заголовком —
// по нему сервер сам определит тариф и остаток бюджета; ничего из этого
// клиент не сообщает и сообщить не может.
// ─────────────────────────────────────────────────────────────────────────────

export class AIError extends Error {
  constructor(message, { code, status, usage } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.usage = usage
  }
  // Месячный лимит исчерпан — фронт показывает апгрейд, а не «ошибка сети».
  get isBudget() { return this.code === 'budget_exhausted' }
  // Суточный подпотолок — отдельный случай: доступ вернётся завтра сам, и
  // предлагать здесь апгрейд неуместно.
  get isDailyLimit() { return this.code === 'daily_limit' }
  // Слишком часто. Ошибка временная и лечится ожиданием, а не действием.
  get isRateLimited() { return this.code === 'rate_limited' }
}

const MESSAGES = {
  unauthorized: 'Нужно войти в аккаунт.',
  banned: 'Доступ к ассистенту закрыт.',
  rate_limited: 'Слишком часто. Подождите минуту.',
  daily_limit: 'На сегодня лимит ассистента исчерпан. Он обновится завтра.',
  bad_image: 'Нужен JPEG, PNG или WebP.',
  image_too_large: 'Фото больше 5 МБ — сожмите его.',
  empty_request: 'Пустой запрос.',
  upstream: 'Ассистент сейчас недоступен. Попробуйте через минуту.',
  accounting_unavailable: 'Ассистент временно недоступен. Попробуйте позже.',
}

async function post(path, body, session) {
  const token = session?.access_token
  if (!token) throw new AIError(MESSAGES.unauthorized, { code: 'unauthorized' })

  let res
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AIError('Нет связи. Проверьте интернет.', { code: 'offline' })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new AIError(
      data.message || MESSAGES[data.error] || 'Не получилось. Попробуйте ещё раз.',
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
