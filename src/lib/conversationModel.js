// Диалоги и сообщения — ЧИСТАЯ часть: во что превращается ответ сервера и как
// из него получаются подписи для списка.
//
// Без зависимостей и без импорта supabase.js: тот читает import.meta.env при
// импорте и падает под голым `node --test`. По той же причине отдельно живут
// relationship.js, notificationModel.js и chatFormat.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ И ПОЧЕМУ ИМЕННО ЗДЕСЬ
//
// snake_case из Postgres переводится РОВНО В ОДНОМ месте. Пока перевод жил в
// компонентах, переименование колонки означало правку в пятнадцати файлах, а
// пропущенный шестнадцатый молча отдавал undefined — и это выглядело как
// «у диалога пропало имя», а не как ошибка.

// ── Быстрые реакции ──────────────────────────────────────────────────────────
// Список — зеркало проверки в set_message_reaction. Расхождение проявилось бы
// как «реакция ставится и тут же исчезает»: сервер отвечает 22023, а
// оптимистичное состояние уже нарисовано.
//
// Морковка стоит первой и осталась из прежней модели: это «палец вверх»
// EatAps, и её узнают.
export const QUICK_REACTIONS = ['🥕', '❤️', '😂', '😮', '😢', '👍']

// Реакция двойного тапа. Отдельная константа, потому что её значение —
// продуктовое решение, а не «первый элемент списка».
export const DOUBLE_TAP_REACTION = '❤️'

// Варианты заглушения. «Навсегда» — это дата за пределами обозримого будущего,
// а не отдельное значение: одно поле вместо двух состояний, и не нужен
// будильник, который однажды забудут завести.
export const MUTE_OPTIONS = [
  { key: '8h',      label: 'На 8 часов',  ms: 8 * 3600_000 },
  { key: '1w',      label: 'На неделю',   ms: 7 * 86400_000 },
  { key: 'forever', label: 'Навсегда',    ms: 100 * 365 * 86400_000 },
]

// ── Форма для приложения ─────────────────────────────────────────────────────

export function toConversation(r) {
  if (!r) return null
  const isGroup = r.kind === 'group'
  return {
    id: r.id,
    kind: r.kind || 'direct',
    // Имя диалога: у группы — название, у личного — имя собеседника. Экран не
    // должен выбирать между двумя полями сам: он бы выбрал по-разному в
    // списке, в шапке чата и в пересылке.
    title: isGroup ? (r.title || null) : (r.peer_name || r.peer_username || null),
    avatarUrl: isGroup ? (r.avatar_url || null) : (r.peer_avatar || null),
    peerId: r.peer_id || null,
    peerUsername: r.peer_username || null,
    peerPrivate: Boolean(r.peer_private),
    membersCount: r.members_count || 0,
    state: r.state || 'accepted',
    archived: Boolean(r.archived),
    mutedUntil: r.muted_until || null,
    unread: r.unread_count || 0,
    last: r.last_id ? {
      id: r.last_id,
      sender: r.last_sender,
      senderName: r.last_sender_name || null,
      text: r.last_text || null,
      imageUrl: r.last_image || null,
      media: r.last_media || null,
      hasMeal: Boolean(r.last_meal),
      unsent: Boolean(r.last_unsent),
      createdAt: r.last_at,
    } : null,
    lastAt: r.last_at || null,
  }
}

export function toMessage(r) {
  if (!r) return null
  return {
    ...r,
    // reactions приходит из базы как NULL, пока на сообщение никто не
    // реагировал. Спред `{ reactions: {}, ...row }` затирал бы значение по
    // умолчанию этим NULL, и обработчик двойного тапа получал бы null.
    reactions: r.reactions || {},
    unsent: Boolean(r.unsent_at),
  }
}

// Заглушён ли диалог ПРЯМО СЕЙЧАС. Хранится момент окончания, а не флаг.
export function isMuted(conv) {
  const until = conv?.mutedUntil
  return Boolean(until) && new Date(until).getTime() > Date.now()
}

// Строка предпросмотра в списке диалогов.
//
// Три вещи, которые она обязана различать: чьё сообщение (в группе — кто
// написал, у себя — «Вы»), какого оно рода (текст, фото, приём пищи) и не
// отозвано ли. Без последнего в списке остаётся текст сообщения, которого у
// собеседника уже нет.
export function conversationPreview(conv, myId) {
  const m = conv?.last
  if (!m) return conv?.kind === 'group' ? 'Группа создана' : 'Нет сообщений'
  if (m.unsent) return 'Сообщение удалено'

  const mine = m.sender === myId
  const who = conv.kind === 'group' && !mine && m.senderName
    ? `${m.senderName}: `
    : (mine ? 'Вы: ' : '')

  if (m.text) return who + m.text
  if (m.imageUrl || m.media?.kind === 'image') return who + '📷 Фото'
  if (m.media?.kind === 'video') return who + '🎬 Видео'
  if (m.media?.kind === 'audio') return who + '🎤 Голосовое'
  if (m.hasMeal) return who + '🍽 Приём пищи'
  return who + 'Сообщение'
}

// Счётчики бейджей из ответа unread_totals. Отдельная функция, потому что
// нулевой ответ («раздела ещё нет») и настоящие нули должны выглядеть
// одинаково для интерфейса, но приходят по-разному.
export const EMPTY_TOTALS = {
  messages: 0, messageRequests: 0, followRequests: 0, notifications: 0,
}

export function toTotals(row) {
  if (!row) return { ...EMPTY_TOTALS }
  return {
    messages: row.messages || 0,
    messageRequests: row.message_requests || 0,
    followRequests: row.follow_requests || 0,
    notifications: row.notifications || 0,
  }
}

// Что показывать на бейдже. Больше 99 не показываем числом: «127» в кружке
// диаметром 20 пикселей не читается, а разница между 100 и 127 непрочитанных
// никому ничего не говорит.
export function badgeText(n) {
  if (!n || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}
