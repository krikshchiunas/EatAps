const CHAT_IDS = [571138125, 938539456]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text } = req.body || {}
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Missing text' })
  }

  const token = process.env.TG_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'Bot not configured' })
  }

  const msg = `💬 Совет от пользователя EatAps:\n\n${String(text).trim()}`

  const results = await Promise.all(
    CHAT_IDS.map((chat_id) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: msg }),
      }).then((r) => r.ok)
    )
  )

  if (!results.some(Boolean)) {
    return res.status(502).json({ error: 'Telegram delivery failed' })
  }

  return res.status(200).json({ ok: true })
}
