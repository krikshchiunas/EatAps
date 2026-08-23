// Общая работа с Telegram Bot API + доступ к базе от имени сервера.
// Вынесено отдельно, чтобы эндпоинт поддержки и вебхук бота не расходились
// в форматах сообщений и в списке администраторов.

import { createClient } from '@supabase/supabase-js'

// Кому уходят обращения и кто вправе нажимать кнопки модерации.
// Здесь же ответ на вопрос «почему не любой, кто нашёл бота»: кнопка «Бан»
// приходит в конкретный чат, но callback может прислать кто угодно, кто добыл
// её данные, — поэтому на нажатии мы ещё раз сверяем отправителя со списком.
export const ADMIN_CHAT_IDS = String(process.env.TG_ADMIN_CHAT_IDS || '571138125,938539456')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite)

export function isAdmin(chatId) {
  return ADMIN_CHAT_IDS.includes(Number(chatId))
}

let _admin
// Клиент с service_role: RLS для него не действует. Нужен именно здесь —
// таблицы bans и support_messages закрыты от клиента полностью.
export function db() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

function token() {
  const t = process.env.TG_TOKEN
  if (!t) throw new Error('TG_TOKEN is not set')
  return t
}

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) {
    console.error(`[tg] ${method} failed`, data?.description || res.status)
    return null
  }
  return data.result
}

// parse_mode не задаём НИГДЕ, где в текст попадает пользовательский ввод:
// иначе присланное человеком «*жирное*» или незакрытый `_` либо сломают
// отправку, либо подделают оформление служебного сообщения.
export function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra })
}

export function answerCallback(id, text, alert = false) {
  return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert })
}

export function editReplyMarkup(chatId, messageId, markup) {
  return call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup })
}

// ── Кнопки модерации ─────────────────────────────────────────────────────────
// Варианты срока. Значение в минутах; 0 = навсегда.
export const BAN_OPTIONS = [
  { code: '1d', label: '24 часа', minutes: 60 * 24 },
  { code: '7d', label: '7 дней', minutes: 60 * 24 * 7 },
  { code: '30d', label: '30 дней', minutes: 60 * 24 * 30 },
  { code: 'inf', label: 'Навсегда', minutes: 0 },
]

// callback_data ограничен 64 байтами — uuid (36) + префикс влезают, но с
// запасом на один короткий код срока, не больше. Поэтому формат минимальный.
export const banMenuKeyboard = (userId) => ({
  inline_keyboard: [
    BAN_OPTIONS.map((o) => ({ text: o.label, callback_data: `b:${o.code}:${userId}` })),
    [{ text: '‹ Отмена', callback_data: `x:${userId}` }],
  ],
})

export const banButtonKeyboard = (userId) => ({
  inline_keyboard: [[{ text: '🚫 Бан', callback_data: `m:${userId}` }]],
})

// Заголовок обращения. ID и ник — обязательные поля: по ним владелец бота
// понимает, кого банить, не переспрашивая.
export function formatReport({ kind, publicId, name, userId, text }) {
  const title = kind === 'coach_application'
    ? '🎓 Заявка на роль тренера'
    : '🆘 Обращение в поддержку'
  const who = name ? `${name}` : 'без имени'
  return [
    title,
    '',
    `Ник: ${who}`,
    `ID: ${publicId || '—'}`,
    `UUID: ${userId}`,
    '',
    text,
  ].join('\n')
}
