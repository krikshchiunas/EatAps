import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// Ленивая инициализация: если env не задан, ошибка вылезет только на первом
// вызове, а не при холодном старте пустой функции.
let _stripe
export function stripe() {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  _stripe = new Stripe(key)
  return _stripe
}

let _admin
export function admin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

export const PRICE_BY_TIER = {
  AI: process.env.STRIPE_PRICE_AI,
  AI_PLUS: process.env.STRIPE_PRICE_AI_PLUS,
}

export const TIER_BY_PRICE = {
  [process.env.STRIPE_PRICE_AI]: 'AI',
  [process.env.STRIPE_PRICE_AI_PLUS]: 'AI_PLUS',
}

// Достаём пользователя по Bearer-JWT из фронта. Возвращает объект юзера или null.
export async function getUserFromRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  const token = String(auth).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await admin().auth.getUser(token)
  if (error) return null
  return data?.user || null
}

export function safeOrigin(req, fallbackFromBody) {
  // Разрешаем только https://www.eataps.com, https://eataps.com или свой Vercel-домен —
  // иначе returnUrl можно подменить и увести пользователя.
  const raw = fallbackFromBody || `https://${req.headers.host || 'www.eataps.com'}`
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return 'https://www.eataps.com'
    return `${u.protocol}//${u.host}`
  } catch {
    return 'https://www.eataps.com'
  }
}
