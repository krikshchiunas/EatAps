import { isAllowedOrigin } from './stripe/origin.js'

const CHAT_IDS = [571138125, 938539456]
const MAX_LEN = 2000
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 3

// Ограничение частоты в памяти процесса. Оговорка честная: на бессерверной
// платформе экземпляров несколько и они перезапускаются, поэтому это не
// строгая квота, а заслон от простого перебора в один поток. Строгий лимит
// требует общего хранилища (Vercel Firewall, Upstash) — вынесено в задачи.
const hits = new Map()

function tooOften(key) {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(key, list)
    return true
  }
  list.push(now)
  hits.set(key, list)
  // Не даём карте расти бесконечно на долгоживущем экземпляре.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k)
    }
  }
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Точка была полностью открытой: любой мог слать неограниченное число
  // сообщений в телеграм владельца проекта. Заголовок Origin ставит браузер,
  // и со страницы чужого сайта его не подделать — это отсекает вызовы
  // «со стороны», не мешая обычной кнопке в приложении.
  //
  // Отсутствие заголовка тоже отклоняем. Раньше проверка пропускала запрос без
  // Origin — то есть обходилась простым удалением заголовка, и единственный
  // слой защиты становился необязательным. Браузеры шлют Origin на любом POST,
  // включая свой же источник, поэтому кнопку в приложении это не задевает.
  const origin = req.headers.origin || req.headers.referer || ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const raw = (req.body || {}).text
  const text = String(raw ?? '').trim()
  if (!text) {
    return res.status(400).json({ error: 'Missing text' })
  }
  if (text.length > MAX_LEN) {
    return res.status(413).json({ error: 'Слишком длинное сообщение' })
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (tooOften(ip)) {
    return res.status(429).json({ error: 'Слишком часто — попробуйте через минуту' })
  }

  const token = process.env.TG_TOKEN
  if (!token) {
    // Наружу не сообщаем, что именно не настроено.
    console.error('[feedback] TG_TOKEN is not set')
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  const msg = `💬 Совет от пользователя EatAps:\n\n${text}`

  const results = await Promise.all(
    CHAT_IDS.map((chat_id) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // parse_mode не задаём намеренно: текст уходит как есть, разметку из
        // пользовательского ввода телеграм не интерпретирует.
        body: JSON.stringify({ chat_id, text: msg, disable_web_page_preview: true }),
      }).then((r) => r.ok).catch(() => false)
    )
  )

  if (!results.some(Boolean)) {
    return res.status(502).json({ error: 'Не удалось отправить' })
  }

  return res.status(200).json({ ok: true })
}
