// Адрес возврата после оплаты. Вынесен отдельно и намеренно без зависимостей:
// это функция безопасности, и её проверка не должна требовать загрузки Stripe
// или Supabase SDK.

export const CANONICAL_ORIGIN = 'https://www.eataps.com'

// Список адресов, куда разрешено возвращать человека после Stripe.
// Дополнительные (превью-развёртывания) задаются переменной ALLOWED_ORIGINS
// через запятую — чтобы не править код ради нового домена.
export function allowedOrigins() {
  const extra = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return new Set([CANONICAL_ORIGIN, 'https://eataps.com', ...extra])
}

// Петлевой адрес (localhost / 127.0.0.1) — послабление ради локальной разработки,
// и в развёрнутом виде оно вредно: на боевом домене никто не возвращается после
// оплаты на свой localhost, а вот отправить туда чужую сессию Checkout можно.
// Поэтому послабление действует только там, где оно и задумано.
//
// VERCEL_ENV задан на любом развёртывании: 'production', 'preview' либо
// 'development' (это `vercel dev`, то есть локальный запуск). Если переменной
// нет вовсе — мы не на Vercel: это локальный node или прогон тестов, и тогда
// ориентируемся на NODE_ENV.
//
// Читаем окружение при каждом вызове, а не один раз при загрузке модуля: так
// функция остаётся честной в тестах и не зависит от порядка импортов.
function loopbackAllowed() {
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv) return vercelEnv === 'development'
  return process.env.NODE_ENV !== 'production'
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
      // Локальная разработка: только петлевой адрес, порт любой — и только вне
      // развёрнутого окружения (см. loopbackAllowed).
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:') {
        return loopbackAllowed() ? `${u.protocol}//${u.host}` : null
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

// Пришёл ли запрос со страницы нашего приложения. Заголовок Origin браузер
// ставит сам и подделать его со страницы нельзя — это отсекает вызовы с чужих
// сайтов. От curl не спасает: там заголовка может не быть вовсе, поэтому это
// один слой защиты, а не единственный.
export function isAllowedOrigin(value) {
  if (!value || typeof value !== 'string') return false
  try {
    const u = new URL(value)
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:') {
      return loopbackAllowed()
    }
    return allowedOrigins().has(`${u.protocol}//${u.host}`)
  } catch {
    return false
  }
}
