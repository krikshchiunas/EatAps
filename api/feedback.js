// «Совет по приложению» — короткое анонимное сообщение владельцу.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО БЫЛО НЕ ТАК
//
// Точка не требовала входа, а единственным заслоном служил заголовок Origin.
// Против чужой СТРАНИЦЫ это работает: браузер ставит Origin сам и подделать
// его из JavaScript нельзя. Против curl не работает вовсе — там заголовок
// пишется рукой. То есть заслона не было.
//
// Ограничение частоты жило в `const hits = new Map()` — в памяти экземпляра
// функции. Экземпляров на бессерверной платформе много, общей памяти у них
// нет, и параллельные запросы просто попадали в разные счётчики. Ключом при
// этом был ЛЕВЫЙ элемент X-Forwarded-For, то есть значение, которое клиент
// дописывает сам: достаточно было менять заголовок, чтобы всегда начинать
// с нуля.
//
// Итог: личный телеграм владельца затапливался одной командой в цикле.
//
// ─────────────────────────────────────────────────────────────────────────────
// КАК СДЕЛАНО СЕЙЧАС
//
// Анонимность сохранена намеренно: это «совет по приложению», и требовать
// ради него регистрации значит не получить ни одного совета. Вместо этого:
//
//   • счётчик переехал в Postgres — он общий для всех экземпляров;
//   • ключом служит адрес от доверенного узла, а не от отправителя;
//   • у вошедшего пользователя ключ — его идентификатор: смена адреса не
//     даёт новой корзины;
//   • при недоступном счётчике запрос НЕ проходит: писать наружу без
//     работающего лимита нельзя;
//   • Origin остался как дополнительный слой против чужих страниц.
import { isAllowedOrigin } from './stripe/origin.js'
import { rateLimit, callerKey } from './_ratelimit.js'
import { getUserFromRequest } from './_auth.js'
import { ADMIN_CHAT_IDS, sendMessage } from './telegram/_tg.js'

const MAX_LEN = 2000
const MIN_LEN = 2

// Три сообщения в минуту и двадцать в сутки с одного источника. Живому
// человеку, которому есть что сказать, этого с запасом; потоку — нет.
const PER_MINUTE = 3
const PER_DAY = 20

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const origin = req.headers.origin || req.headers.referer || ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const text = String((req.body || {}).text ?? '').trim()
  if (text.length < MIN_LEN) {
    return res.status(400).json({ error: 'Напишите пару слов' })
  }
  if (text.length > MAX_LEN) {
    return res.status(413).json({ error: 'Слишком длинное сообщение' })
  }

  // Вход не обязателен, но если он есть — ключом становится пользователь:
  // это честнее адреса (общий Wi-Fi не наказывает соседей) и надёжнее
  // (смена сети не обнуляет счётчик).
  const user = await getUserFromRequest(req).catch(() => null)
  const key = callerKey(req, user?.id)

  for (const [bucket, limit, windowSeconds, message] of [
    ['feedback:min', PER_MINUTE, 60, 'Слишком часто — попробуйте через минуту'],
    ['feedback:day', PER_DAY, 86400, 'На сегодня достаточно. Спасибо за советы!'],
  ]) {
    // failOpen: false — недоступный счётчик закрывает точку. Это осознанно:
    // единственное, что здесь происходит, — отправка сообщения владельцу, и
    // временно не отправить его безопаснее, чем временно снять лимит.
    const { allowed, retryAfter } = await rateLimit({ bucket, key, limit, windowSeconds })
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ error: message, retryAfter })
    }
  }

  if (!process.env.TG_TOKEN) {
    // Наружу не сообщаем, что именно не настроено.
    console.error('[feedback] TG_TOKEN не задан')
    return res.status(500).json({ error: 'Не удалось отправить' })
  }
  if (!ADMIN_CHAT_IDS.length) {
    console.error('[feedback] TG_ADMIN_CHAT_IDS не задан — отправлять некому')
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  // parse_mode не задаём намеренно: текст уходит как есть, и разметку из
  // пользовательского ввода телеграм не интерпретирует.
  const header = user ? '💬 Совет от пользователя EatAps (вошёл)' : '💬 Совет от пользователя EatAps'
  const msg = `${header}:\n\n${text}`

  const results = await Promise.all(ADMIN_CHAT_IDS.map((id) => sendMessage(id, msg)))
  if (!results.some(Boolean)) {
    return res.status(502).json({ error: 'Не удалось отправить' })
  }

  return res.status(200).json({ ok: true })
}
