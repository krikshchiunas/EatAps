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
  AI_PREMIUM: process.env.STRIPE_PRICE_AI_PREMIUM,
}

export const TIER_BY_PRICE = {
  [process.env.STRIPE_PRICE_AI]: 'AI',
  [process.env.STRIPE_PRICE_AI_PLUS]: 'AI_PLUS',
  [process.env.STRIPE_PRICE_AI_PREMIUM]: 'AI_PREMIUM',
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

// Проверка адреса возврата живёт в origin.js — без зависимостей, чтобы её
// можно было прогонять тестами без установленных SDK.
export { safeOrigin, CANONICAL_ORIGIN } from './origin.js'
