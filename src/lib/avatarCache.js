// ─────────────────────────────────────────────────────────────────────────────
// Кэш аватаров и карточек людей.
//
// Зачем он появился. Аватар в EatAps — не ссылка, а data URL: base64-JPEG
// 256×256 на десятки килобайт (src/lib/avatar.js). Ленты и поиск возвращали его
// В КАЖДОЙ СТРОКЕ: двадцать постов одного автора — двадцать копий одной
// картинки в одном ответе; тридцать карточек поиска на каждое нажатие клавиши.
//
// Теперь list_feed и search_users аватар не отдают вовсе, а картинки добираются
// отсюда — по УНИКАЛЬНЫМ людям страницы (обычно 3–7 человек на двадцать постов)
// и один раз за сессию.
//
// Устройство. Запросы за один тик собираются в пачку и уходят одним вызовом
// user_cards: десять компонентов, отрисованных одновременно, дают один запрос,
// а не десять. Уже известные люди не запрашиваются повторно.
//
// Кэш живёт в памяти вкладки и сбрасывается при смене аккаунта: карточки
// зависят от блокировок (user_cards не отдаёт заблокированных), и держать их
// между пользователями нельзя.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js'

// user_id → { user_id, username, display_name, avatar_url }
const cache = new Map()
// Люди, ожидающие ближайшей отправки.
let queue = new Set()
// Промис текущей пачки: все, кто подписался до отправки, ждут его.
let pending = null
const listeners = new Set()

// Потолок под лимит user_cards: функция берёт первые 60 идентификаторов и
// молча игнорирует хвост, поэтому большие пачки режем сами.
const BATCH = 60

export function getCachedCard(userId) {
  return userId ? cache.get(userId) || null : null
}

export function getCachedAvatar(userId) {
  return cache.get(userId)?.avatar_url || null
}

function notify() {
  for (const fn of [...listeners]) { try { fn() } catch {} }
}

async function flush() {
  const ids = [...queue].slice(0, BATCH)
  queue = new Set([...queue].slice(BATCH))
  if (!ids.length) { pending = null; return }

  try {
    const { data, error } = await supabase.rpc('user_cards', { p_user_ids: ids })
    if (!error) {
      for (const row of data || []) cache.set(row.user_id, row)
    }
    // Те, кого не вернули (заблокирован, удалён, миграция не прогнана),
    // помечаем пустой карточкой: иначе они запрашивались бы бесконечно на
    // каждой перерисовке.
    for (const id of ids) if (!cache.has(id)) cache.set(id, { user_id: id })
  } catch {
    for (const id of ids) if (!cache.has(id)) cache.set(id, { user_id: id })
  }

  pending = null
  notify()
  if (queue.size) ensureFlush()
}

function ensureFlush() {
  if (pending) return pending
  // Микрозадача, а не таймер: пачка собирается за один тик отрисовки, и
  // задержка в реальном времени не нужна.
  pending = Promise.resolve().then(flush)
  return pending
}

// Запросить карточки. Возвращает промис, который разрешается, когда пачка
// доехала. Уже известные люди не запрашиваются.
export function primeCards(ids) {
  if (!supabase || !ids?.length) return Promise.resolve()
  let added = false
  for (const id of ids) {
    if (!id || cache.has(id) || queue.has(id)) continue
    queue.add(id)
    added = true
  }
  return added || queue.size ? ensureFlush() : Promise.resolve()
}

// Подписка на «в кэше что-то появилось». Компоненты перерисовываются по ней,
// а не хранят копию карточек у себя.
export function onCardsChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Смена аккаунта. Карточки зависят от блокировок текущего пользователя, поэтому
// переносить их между сессиями нельзя.
export function clearCardCache() {
  cache.clear()
  queue = new Set()
  pending = null
  notify()
}
