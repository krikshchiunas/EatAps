// Ограничение частоты обращений к серверным функциям.
//
// Счётчик живёт в Postgres (rate_limit_hit), а не в памяти процесса: на
// бессерверной платформе экземпляров много, общей памяти у них нет, и
// счётчик в переменной модуля обнуляется сам собой. Подробности — в
// миграции 2026-09-12_rate_limits.
import { createClient } from '@supabase/supabase-js'

let _admin
function admin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

// Кто обратился. Порядок важен: свой пользователь надёжнее любого заголовка.
//
// ⚠ X-Forwarded-For — это СПИСОК, и клиент может дописать в него что угодно
// слева. Раньше бралcя именно ЛЕВЫЙ элемент, то есть та часть, которую
// подделывает отправитель: достаточно было менять заголовок, чтобы получать
// свежую корзину на каждый запрос.
//
// Берём ПОСЛЕДНИЙ элемент: его проставляет ближайший к нам доверенный узел
// (прокси Vercel), и подделать его со стороны клиента нельзя. Если платформа
// даёт собственный заголовок с разобранным адресом, предпочитаем его.
export function callerKey(req, userId = null) {
  if (userId) return `user:${userId}`

  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return `ip:${real.trim()}`

  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return `ip:${parts[parts.length - 1]}`
  }
  // Адреса нет вовсе — считаем всех такими одной корзиной. Это строже, чем
  // пропускать: безымянный поток не должен получать безлимитный доступ.
  return 'ip:unknown'
}

// Возвращает { allowed, retryAfter }.
//
// ПОВЕДЕНИЕ ПРИ ОТКАЗЕ БАЗЫ РЕШАЕТ ВЫЗЫВАЮЩИЙ. Для точек, которые тратят
// чужие деньги или пишут наружу, правильный ответ — «не пропускать»
// (failOpen: false). Для вспомогательных — наоборот, не ломать функцию
// из-за недоступного счётчика.
export async function rateLimit({ bucket, key, limit, windowSeconds = 60, failOpen = false }) {
  try {
    const { data, error } = await admin().rpc('rate_limit_hit', {
      p_bucket: bucket,
      p_key: key,
      p_limit: limit,
      p_window: `${windowSeconds} seconds`,
    })
    if (error) throw new Error(error.message)
    return {
      allowed: data?.allowed !== false,
      retryAfter: Number(data?.retry_after) || windowSeconds,
    }
  } catch (e) {
    console.error('[rate-limit] счётчик недоступен', { bucket, error: e.message })
    return { allowed: failOpen, retryAfter: windowSeconds }
  }
}
