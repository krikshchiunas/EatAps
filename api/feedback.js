// POST /api/feedback — «написать разработчику» из раздела «О приложении».
//
// В отличие от api/support.js вход НЕ требуется: форма живёт в «О приложении»,
// куда попадает и человек без аккаунта (приложение работает офлайн). Поэтому
// защита строится иначе.
//
// Что здесь было и почему это не работало. Единственным заслоном стоял заголовок
// Origin — а он подделывается одной строкой curl. Ограничение частоты жило в
// `new Map()` в памяти процесса: на бессерверной платформе экземпляров много,
// они множатся под нагрузкой и умирают между запросами, поэтому счётчик слабел
// ровно по мере роста потока. То есть при настоящем флуде он не считал ничего,
// и канал модерации топился вместе с настоящими обращениями из /api/support —
// они приходят в те же чаты.
//
// Теперь три заслона, и все три считает база:
//   1. по отправителю (хэш IP или id вошедшего) — 3 сообщения за 10 минут;
//   2. по нему же в сутки — 10 сообщений;
//   3. общий на всё приложение — 60 сообщений в час.
// Третий существует потому, что первые два обходятся сменой IP. Он не мешает
// живым людям (шестьдесят советов в час проект не получает) и ограничивает
// худший случай независимо от того, сколько адресов у отправителя.
//
// Обращение сначала пишется в support_messages и только потом уходит в телеграм:
// иначе лимит, который на эту таблицу опирается, обходился бы недоступностью
// телеграма.
import { createHash } from 'node:crypto'
import { isAllowedOrigin } from './stripe/origin.js'
import { getUserFromRequest } from './stripe/_shared.js'
import { db, ADMIN_CHAT_IDS, sendMessage } from './telegram/_tg.js'

const MAX_LEN = 2000
const MIN_LEN = 3

// Лимиты: [бакет, максимум, окно]
const LIMITS = [
  ['feedback', 3, '00:10:00'],
  ['feedback_day', 10, '24:00:00'],
]
const GLOBAL_LIMIT = ['feedback_global', 60, '01:00:00']

// Сырой IP не хранится: для счётчика достаточно его хэша, а сам адрес —
// персональные данные (см. docs/compliance). Соль — секрет окружения; без неё
// хэш от IPv4 перебирается за секунды, потому что адресов всего четыре
// миллиарда.
function senderKey(req, userId) {
  if (userId) return `u:${userId}`
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  if (!ip) return ''
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return 'ip:' + createHash('sha256').update(salt + ip).digest('hex').slice(0, 32)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Заголовок Origin браузер ставит сам и со страницы чужого сайта его не
  // подделать. Это отсекает вызовы «со стороны», но не curl — поэтому он
  // остаётся первым слоем, а не единственным.
  //
  // Отсутствие заголовка тоже отклоняем: иначе проверка обходилась бы простым
  // его удалением. Браузеры шлют Origin на любом POST, включая свой же
  // источник, поэтому кнопку в приложении это не задевает.
  const origin = req.headers.origin || req.headers.referer || ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const text = String(body.text ?? '').trim()
  if (!text || text.length < MIN_LEN) {
    return res.status(400).json({ error: 'Напишите чуть подробнее' })
  }
  if (text.length > MAX_LEN) {
    return res.status(413).json({ error: 'Слишком длинное сообщение' })
  }

  let supabase
  try {
    supabase = db()
  } catch (e) {
    console.error('[feedback] db not configured', e.message)
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  // Вход не обязателен, но если он есть — обращение подписано, и владелец
  // сможет ответить или забанить. Токен, который не разобрался, не ошибка:
  // просто отправитель остаётся анонимным.
  let user = null
  try { user = await getUserFromRequest(req) } catch { user = null }

  // Забаненный не пишет и сюда — иначе бан обходится соседней формой.
  if (user) {
    const { data: ban } = await supabase
      .from('bans').select('until').eq('user_id', user.id).maybeSingle()
    if (ban && (ban.until === null || new Date(ban.until) > new Date())) {
      return res.status(403).json({ error: 'Отправка сообщений недоступна' })
    }
  }

  const key = senderKey(req, user?.id)
  const take = (bucket, max, window, k = key) =>
    supabase.rpc('rate_limit_take', { p_bucket: bucket, p_key: k, p_max: max, p_window: window })

  for (const [bucket, max, window] of LIMITS) {
    const { data, error } = await take(bucket, max, window)
    // Сбой счётчика не должен закрывать обратную связь совсем: это
    // единственный способ сообщить о проблеме, в том числе о проблеме с базой.
    // Но общий лимит ниже сработает в любом случае.
    if (error) { console.error('[feedback] rate_limit_take failed', error.message); break }
    if (data === false) {
      return res.status(429).json({ error: 'Слишком часто — попробуйте позже' })
    }
  }

  const [gBucket, gMax, gWindow] = GLOBAL_LIMIT
  const { data: globalOk } = await take(gBucket, gMax, gWindow, 'all')
  if (globalOk === false) {
    return res.status(429).json({ error: 'Слишком много сообщений сейчас — попробуйте позже' })
  }

  // Пишем в базу ДО телеграма: лимиты и история обращений опираются на таблицу,
  // а телеграм может быть недоступен.
  const { error: insErr } = await supabase
    .from('support_messages')
    .insert({ user_id: user?.id ?? null, kind: 'feedback', text })
  if (insErr) {
    console.error('[feedback] insert failed', insErr.message)
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  const who = user ? `от ${user.email || user.id}` : 'анонимно'
  // parse_mode не задаём намеренно: текст уходит как есть, разметку из
  // пользовательского ввода телеграм не интерпретирует.
  const msg = `💬 Совет от пользователя EatAps (${who}):\n\n${text}`

  const sent = await Promise.all(ADMIN_CHAT_IDS.map((chatId) => sendMessage(chatId, msg)))

  // Обращение уже в базе — оно не потеряно, даже если телеграм недоступен.
  if (!sent.some(Boolean)) console.error('[feedback] telegram delivery failed')

  return res.status(200).json({ ok: true })
}
