// Форматирование в переписке — ЧИСТАЯ часть, без React.
//
// Вынесено из чата, потому что теми же правилами пользуются список диалогов,
// экран запросов и общие вложения. Пока это жило внутри экрана чата, каждый новый
// экран переписки заводил свою копию «сегодня / вчера / дата».

export function timeShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yest.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

// «Был(а) в сети»: свежие отметки — человеческим языком, старые — датой.
// Пол собеседника нам неизвестен, поэтому нейтральное «Был(а)».
export function lastSeenLabel(iso) {
  if (!iso) return ''
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1) return 'Был(а) только что'
  if (mins < 60) return `Был(а) ${mins} мин назад`
  const today = new Date()
  if (then.toDateString() === today.toDateString()) return `Был(а) в ${timeShort(iso)}`
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (then.toDateString() === yest.toDateString()) return `Был(а) вчера в ${timeShort(iso)}`
  return `Был(а) ${then.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}

// Короткое описание сообщения — для цитаты, предпросмотра и пересылки.
// Отозванное сообщение описывается словами, а не пустотой: пустая цитата
// выглядит как ошибка отрисовки.
export function previewOf(m, mealLabel) {
  if (!m) return ''
  if (m.unsent_at || m.unsent) return 'Сообщение удалено'
  if (m.text) return m.text
  if (m.image_url || m.media?.kind === 'image') return '📷 Фото'
  if (m.media?.kind === 'video') return '🎬 Видео'
  if (m.media?.kind === 'audio') return '🎤 Голосовое'
  if (m.meal_ref) return '🍽 ' + (mealLabel || 'Блюдо')
  return ''
}
