// Адрес возврата после оплаты. Вынесен отдельно и намеренно без зависимостей:
// это функция безопасности, и её проверка не должна требовать загрузки Stripe
// или Supabase SDK.

export const CANONICAL_ORIGIN = 'https://www.eataps.com'

// Список адресов, куда разрешено возвращать человека после Stripe.
// Дополнительные (превью-развёртывания) задаются переменной ALLOWED_ORIGINS
// через запятую — чтобы не править код ради нового домена.
function allowedOrigins() {
  const extra = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return new Set([CANONICAL_ORIGIN, 'https://eataps.com', ...extra])
}

// ВАЖНО: returnUrl приходит из тела запроса, то есть полностью под контролем
// вызывающего. Прежняя проверка требовала лишь https — под неё подходил ЛЮБОЙ
// чужой домен. Практический риск: человек создаёт у себя сессию оплаты с
// возвратом на свой сайт и рассылает получившуюся ссылку checkout.stripe.com
// как настоящую — жертва видит доверенный домен Stripe, платит и попадает на
// чужую страницу. Поэтому здесь белый список, а не проверка формата.
export function safeOrigin(req, fallbackFromBody) {
  const allowed = allowedOrigins()

  const normalize = (raw) => {
    if (!raw || typeof raw !== 'string') return null
    try {
      const u = new URL(raw)
      // Локальная разработка: только петлевой адрес, порт любой.
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:') {
        return `${u.protocol}//${u.host}`
      }
      if (u.protocol !== 'https:') return null
      const origin = `${u.protocol}//${u.host}`
      return allowed.has(origin) ? origin : null
    } catch {
      return null
    }
  }

  // Сначала то, что попросил клиент, но только если оно в списке. Затем — хост
  // самого запроса, тоже сверенный со списком. Иначе канонический адрес.
  return normalize(fallbackFromBody)
    || normalize(req?.headers?.host ? `https://${req.headers.host}` : null)
    || CANONICAL_ORIGIN
}
