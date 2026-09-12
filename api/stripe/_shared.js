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

// Цены тарифов. Читаются из окружения при КАЖДОМ обращении, а не один раз при
// загрузке модуля: так функция остаётся честной в тестах и не зависит от
// порядка импортов (тот же приём, что в origin.js).
export function priceByTier() {
  return {
    AI: process.env.STRIPE_PRICE_AI,
    AI_PLUS: process.env.STRIPE_PRICE_AI_PLUS,
    AI_PREMIUM: process.env.STRIPE_PRICE_AI_PREMIUM,
  }
}

// Обратное отображение: идентификатор цены → тариф.
//
// ⚠ ЗДЕСЬ БЫЛА ДЫРА, И ОНА НЕОЧЕВИДНА. Карта строилась вычисляемыми ключами:
//
//     { [process.env.STRIPE_PRICE_AI]: 'AI', ..., [process.env.STRIPE_PRICE_AI_PREMIUM]: 'AI_PREMIUM' }
//
// Незаданная переменная окружения даёт ключ — СТРОКУ "undefined". А в вебхуке
// тариф искался как TIER_BY_PRICE[priceId]; когда priceId равен undefined,
// JavaScript приводит ключ к той же строке "undefined" и НАХОДИТ запись.
// Последней в объекте стояла AI_PREMIUM — то есть невозможность определить
// цену подписки выдавала человеку ВЫСШИЙ тариф с безлимитным расходом.
// Отказ обязан вести к FREE, а не к максимуму.
//
// Поэтому: в карту попадают только реально заданные цены, а пустой priceId
// отсекается до обращения к ней (см. tierForPrice).
export function tierByPrice() {
  const entries = [
    [process.env.STRIPE_PRICE_AI, 'AI'],
    [process.env.STRIPE_PRICE_AI_PLUS, 'AI_PLUS'],
    [process.env.STRIPE_PRICE_AI_PREMIUM, 'AI_PREMIUM'],
  ].filter(([id]) => typeof id === 'string' && id.length > 0)
  return Object.fromEntries(entries)
}

// Единственное место, где цена превращается в тариф. Всё, что не опознано, —
// FREE: в учёте денег отказ обязан быть в сторону меньших прав.
export function tierForPrice(priceId) {
  if (typeof priceId !== 'string' || !priceId) return 'FREE'
  return tierByPrice()[priceId] || 'FREE'
}

// Живые статусы подписки. Всё остальное (canceled, incomplete, incomplete_expired,
// unpaid, paused) закрывает платный доступ.
export const LIVE_STATUSES = Object.freeze(['active', 'trialing', 'past_due'])

export function tierForSubscription(subscription) {
  const priceId = subscription?.items?.data?.[0]?.price?.id
  const mapped = tierForPrice(priceId)
  return LIVE_STATUSES.includes(subscription?.status) ? mapped : 'FREE'
}

// Проверка токена живёт в api/_auth.js — без зависимости от SDK Stripe.
export { getUserFromRequest } from '../_auth.js'

// Кому принадлежит клиент Stripe. Ищем по своей таблице: метаданные клиента
// ставит наш же checkout, но событие может прийти и по клиенту, созданному
// вручную в панели Stripe.
export async function getStripeUserId(customerId, db = null) {
  if (!customerId) return null
  const { data, error } = await (db || admin())
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (error) {
    console.error('[stripe] поиск пользователя по клиенту не удался:', error.message)
    return null
  }
  return data?.user_id || null
}

// Проверка адреса возврата живёт в origin.js — без зависимостей, чтобы её
// можно было прогонять тестами без установленных SDK.
export { safeOrigin, CANONICAL_ORIGIN } from './origin.js'
