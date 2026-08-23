// Вебхук телеграм-бота: кнопки модерации под каждым обращением.
//
// Поток: под сообщением есть кнопка «🚫 Бан» → нажатие раскрывает выбор срока
// (24 часа / 7 дней / 30 дней / навсегда) → выбор записывает бан в базу.
// Двухшаговость намеренная: одиночная кнопка «Бан» рядом с обычным текстом
// слишком легко нажимается случайно, а срок — решение, которое стоит подтвердить.
//
// Безопасность. Адрес вебхука публичный, поэтому:
//   • secret_token — телеграм присылает его в заголовке, чужой POST отсекается;
//   • отправитель callback сверяется со списком администраторов: знание
//     callback_data не должно давать права банить.
//
// Установка (один раз, подставив свои значения):
//   curl -F "url=https://www.eataps.com/api/telegram/webhook" \
//        -F "secret_token=$TG_WEBHOOK_SECRET" \
//        "https://api.telegram.org/bot$TG_TOKEN/setWebhook"

import {
  db, isAdmin, answerCallback, sendMessage, editReplyMarkup,
  BAN_OPTIONS, banMenuKeyboard, banButtonKeyboard,
} from './_tg.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Проверка секрета — первое, что делаем. Если секрет не задан в окружении,
  // вебхук отключён целиком: открытый эндпоинт модерации хуже, чем нерабочий.
  const secret = process.env.TG_WEBHOOK_SECRET
  if (!secret) {
    console.error('[tg] TG_WEBHOOK_SECRET is not set — вебхук отключён')
    return res.status(503).json({ ok: false })
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(403).json({ ok: false })
  }

  const update = req.body || {}

  // Телеграм повторяет доставку, пока не получит 200. Любую свою ошибку ниже
  // мы всё равно закрываем двухсоткой: бесконечные повторы одного и того же
  // сбойного обновления забили бы функцию и лог.
  try {
    if (update.callback_query) await onCallback(update.callback_query)
    else if (update.message) await onMessage(update.message)
  } catch (e) {
    console.error('[tg] update failed', e)
  }
  return res.status(200).json({ ok: true })
}

// ── Нажатие кнопки ───────────────────────────────────────────────────────────
async function onCallback(cq) {
  const fromId = cq.from?.id
  const data = String(cq.data || '')

  if (!isAdmin(fromId)) {
    await answerCallback(cq.id, 'Недостаточно прав', true)
    return
  }

  const chatId = cq.message?.chat?.id
  const messageId = cq.message?.message_id

  // m:<uuid> — раскрыть выбор срока
  if (data.startsWith('m:')) {
    const userId = data.slice(2)
    await editReplyMarkup(chatId, messageId, banMenuKeyboard(userId))
    await answerCallback(cq.id, 'Выберите срок')
    return
  }

  // x:<uuid> — свернуть обратно, ничего не делая
  if (data.startsWith('x:')) {
    const userId = data.slice(2)
    await editReplyMarkup(chatId, messageId, banButtonKeyboard(userId))
    await answerCallback(cq.id, 'Отменено')
    return
  }

  // b:<code>:<uuid> — применить бан
  if (data.startsWith('b:')) {
    const [, code, userId] = data.split(':')
    const option = BAN_OPTIONS.find((o) => o.code === code)
    if (!option || !userId) {
      await answerCallback(cq.id, 'Не понял команду', true)
      return
    }

    const until = option.minutes > 0
      ? new Date(Date.now() + option.minutes * 60_000).toISOString()
      : null

    const { error } = await db().from('bans').upsert({
      user_id: userId,
      until,
      reason: 'Заблокирован из телеграм-бота',
      banned_by: cq.from?.username ? `@${cq.from.username}` : String(fromId),
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (error) {
      console.error('[tg] ban failed', error.message)
      await answerCallback(cq.id, 'Не удалось записать бан', true)
      return
    }

    // Кнопки убираем: бан выдан, повторные нажатия только путают.
    await editReplyMarkup(chatId, messageId, { inline_keyboard: [] })
    await answerCallback(cq.id, `Забанен: ${option.label}`)
    await sendMessage(chatId, `🚫 Бан выдан\nСрок: ${option.label}\nUUID: ${userId}`)
  }
}

// ── Обычные сообщения боту ───────────────────────────────────────────────────
// Бот не предназначен для переписки: отвечаем только администраторам и только
// на команды. Посторонним не отвечаем вовсе — молчание не даёт подтверждения,
// что бот жив, и не превращает его в мишень для перебора.
async function onMessage(msg) {
  const chatId = msg.chat?.id
  if (!isAdmin(chatId)) return

  const text = String(msg.text || '').trim()

  if (text === '/start' || text === '/help') {
    await sendMessage(chatId,
      'Бот модерации EatAps.\n\n' +
      'Сюда приходят обращения в поддержку и заявки на роль тренера — с ником и ID автора.\n' +
      'Под каждым сообщением есть кнопка «Бан»: 24 часа, 7 дней, 30 дней или навсегда.\n\n' +
      'Команды:\n' +
      '/unban <UUID> — снять бан\n' +
      '/coach <UUID> — одобрить роль тренера\n' +
      '/uncoach <UUID> — забрать роль тренера')
    return
  }

  const unban = text.match(/^\/unban\s+([0-9a-f-]{36})$/i)
  if (unban) {
    const { error } = await db().from('bans').delete().eq('user_id', unban[1])
    await sendMessage(chatId, error ? `Не удалось: ${error.message}` : `✅ Бан снят\nUUID: ${unban[1]}`)
    return
  }

  // Роль тренера выдаётся здесь же: заявка приходит в этот чат, и решение
  // принимается тут же, не переключаясь на панель Supabase.
  const coach = text.match(/^\/coach\s+([0-9a-f-]{36})$/i)
  if (coach) {
    const { error } = await db().from('coaches').upsert({
      user_id: coach[1],
      approved_by: msg.from?.username ? `@${msg.from.username}` : String(chatId),
      approved_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    await sendMessage(chatId, error ? `Не удалось: ${error.message}` : `🎓 Роль тренера выдана\nUUID: ${coach[1]}`)
    return
  }

  const uncoach = text.match(/^\/uncoach\s+([0-9a-f-]{36})$/i)
  if (uncoach) {
    const { error } = await db().from('coaches').delete().eq('user_id', uncoach[1])
    await sendMessage(chatId, error ? `Не удалось: ${error.message}` : `Роль тренера убрана\nUUID: ${uncoach[1]}`)
  }
}
