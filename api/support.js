// Обращение в поддержку и заявка на роль тренера.
//
// В отличие от api/feedback.js (анонимный «совет по сайту») здесь требуется
// вход: владелец бота должен видеть, КТО написал — ник и ID, — чтобы иметь
// возможность забанить нарушителя. Анонимные обращения банить не за что.
//
// Три заслона по порядку: origin → вход → бан → частота. Все проверки на
// сервере: у клиента можно отключить что угодно.

import { isAllowedOrigin } from './stripe/origin.js'
import { getUserFromRequest } from './stripe/_shared.js'
import { db, ADMIN_CHAT_IDS, sendMessage, banButtonKeyboard, formatReport } from './telegram/_tg.js'

const MAX_LEN = 2000
const MIN_LEN = 10

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const origin = req.headers.origin || req.headers.referer || ''
  if (!isAllowedOrigin(origin)) return res.status(403).json({ error: 'Forbidden' })

  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Войдите в аккаунт, чтобы написать в поддержку' })

  const body = req.body || {}
  const kind = body.kind === 'coach_application' ? 'coach_application' : 'support'
  const text = String(body.text ?? '').trim()

  if (text.length < MIN_LEN) return res.status(400).json({ error: 'Опишите вопрос подробнее — хотя бы несколько слов' })
  if (text.length > MAX_LEN) return res.status(413).json({ error: 'Слишком длинное сообщение' })

  let supabase
  try {
    supabase = db()
  } catch (e) {
    console.error('[support] db not configured', e.message)
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  // 1. Бан. Проверяем ДО записи: забаненный не должен даже засорять таблицу.
  const { data: ban } = await supabase
    .from('bans')
    .select('until, reason')
    .eq('user_id', user.id)
    .maybeSingle()

  if (ban && (ban.until === null || new Date(ban.until) > new Date())) {
    return res.status(403).json({
      error: ban.until
        ? `Вы временно не можете писать в поддержку — до ${new Date(ban.until).toLocaleString('ru-RU')}`
        : 'Вы лишены возможности писать в поддержку',
      bannedUntil: ban.until,
    })
  }

  // 2. Частота: не чаще одного обращения в час. Считаем по последней записи в
  // базе, а не по счётчику в памяти процесса: на бессерверной платформе
  // экземпляров много и память между ними не общая — лимит был бы фиктивным.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { data: recent } = await supabase
    .from('support_messages')
    .select('created_at')
    .eq('user_id', user.id)
    .gt('created_at', hourAgo)
    .order('created_at', { ascending: false })
    .limit(1)

  if (recent?.length) {
    const nextAt = new Date(new Date(recent[0].created_at).getTime() + 3600_000)
    const minutes = Math.max(1, Math.ceil((nextAt - Date.now()) / 60000))
    return res.status(429).json({
      error: `Писать можно раз в час. Попробуйте через ${minutes} мин.`,
      nextAllowedAt: nextAt.toISOString(),
    })
  }

  // 3. Записываем обращение. Если запись не удалась — не отправляем в телеграм:
  // иначе лимит «раз в час» перестал бы работать (он опирается на эту таблицу).
  const { error: insErr } = await supabase
    .from('support_messages')
    .insert({ user_id: user.id, kind, text })
  if (insErr) {
    console.error('[support] insert failed', insErr.message)
    return res.status(500).json({ error: 'Не удалось отправить' })
  }

  // 4. Кто написал — ник и имя для владельца бота.
  const [{ data: profile }, { data: stateRow }] = await Promise.all([
    supabase.from('profiles').select('username').eq('user_id', user.id).maybeSingle(),
    supabase.from('app_state').select('name:state->profile->>name').eq('user_id', user.id).maybeSingle(),
  ])

  const report = formatReport({
    kind,
    username: profile?.username,
    name: stateRow?.name,
    userId: user.id,
    text,
  })

  const sent = await Promise.all(
    ADMIN_CHAT_IDS.map((chatId) =>
      sendMessage(chatId, report, { reply_markup: banButtonKeyboard(user.id) }),
    ),
  )

  // Обращение уже в базе — оно не потеряно, даже если телеграм недоступен.
  // Поэтому человеку отвечаем успехом, а сбой доставки пишем в лог.
  if (!sent.some(Boolean)) console.error('[support] telegram delivery failed')

  return res.status(200).json({ ok: true })
}
