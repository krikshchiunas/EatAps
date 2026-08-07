// ─────────────────────────────────────────────────────────────────────────────
// Нормализация ошибок: единая точка, где сырой ответ Supabase/сети превращается
// в понятный русский текст + категорию, по которой решается поведение.
//
// Наружу никогда не уходят названия таблиц, JWT, коды PostgREST и слово «RLS» —
// это внутренняя кухня. Внутрь (в лог для разработки) уходит код без секретов.
// ─────────────────────────────────────────────────────────────────────────────

export const ERR = Object.freeze({
  AUTH: 'auth',               // неверные данные входа, протухшая ссылка
  SESSION: 'session',         // сессия мертва — нужен повторный вход
  VALIDATION: 'validation',   // ввод не проходит проверку
  NETWORK: 'network',         // нет сети / сервер недоступен
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  PERMISSION: 'permission',   // доступ запрещён политикой
  CONFLICT: 'conflict',       // параллельная запись
  SERVER: 'server',
  UNKNOWN: 'unknown',
})

// Категории, для которых повтор имеет смысл (сам по себе, без действий человека).
const RETRYABLE = new Set([ERR.NETWORK, ERR.TIMEOUT, ERR.RATE_LIMIT, ERR.CONFLICT, ERR.SERVER])

const RULES = [
  [/invalid login credentials|invalid_credentials/i, ERR.AUTH, 'Неверный email или пароль'],
  [/email not confirmed|email_not_confirmed/i, ERR.AUTH, 'Почта не подтверждена — откройте ссылку из письма'],
  [/user already registered|user_already_exists/i, ERR.VALIDATION, 'Такой аккаунт уже есть — попробуйте войти'],
  [/password should be at least|weak_password/i, ERR.VALIDATION, 'Пароль слишком короткий — минимум 6 символов'],
  [/new password should be different|same_password/i, ERR.VALIDATION, 'Новый пароль должен отличаться от старого'],
  [/unable to validate email|invalid email|invalid format/i, ERR.VALIDATION, 'Некорректный email'],
  [/signups not allowed|signup_disabled/i, ERR.AUTH, 'Регистрация сейчас отключена'],
  [/email link is invalid|otp.{0,10}expired|token.{0,10}expired|flow_state_expired|bad_code_verifier/i, ERR.AUTH,
    'Ссылка недействительна или устарела — запросите новую'],
  [/refresh.?token.{0,20}(not found|expired|revoked|already used)|session_not_found|invalid.{0,10}refresh/i, ERR.SESSION,
    'Сессия истекла — войдите снова'],
  [/security purposes|rate limit|over_email_send_rate|too many requests|429/i, ERR.RATE_LIMIT,
    'Слишком много попыток — подождите минуту и повторите'],
  [/failed to fetch|networkerror|network request failed|fetch failed|load failed|err_internet/i, ERR.NETWORK,
    'Нет соединения с сервером — проверьте интернет'],
  [/timeout|timed out|aborted/i, ERR.TIMEOUT, 'Сервер не ответил — попробуйте ещё раз'],
  [/row-level security|permission denied|not authorized|insufficient|42501|28000/i, ERR.PERMISSION,
    'Недостаточно прав — попробуйте войти заново'],
  [/conflict|serialization failure|40001/i, ERR.CONFLICT, 'Данные изменились на другом устройстве — объединяем'],
]

const BY_STATUS = [
  [408, ERR.TIMEOUT, 'Сервер не ответил — попробуйте ещё раз'],
  [429, ERR.RATE_LIMIT, 'Слишком много попыток — подождите минуту и повторите'],
  [401, ERR.SESSION, 'Сессия истекла — войдите снова'],
  [403, ERR.PERMISSION, 'Недостаточно прав — попробуйте войти заново'],
  [409, ERR.CONFLICT, 'Данные изменились на другом устройстве — объединяем'],
]

function rawText(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return [err.message, err.error_description, err.details, err.hint, err.code].filter(Boolean).join(' ')
}

// Единственная точка перевода ошибки в решение приложения.
// Возвращает { category, message, retryable, code } — code только для логов.
export function normalizeError(err) {
  // Браузер прямо говорит, что сети нет — это надёжнее разбора текста.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { category: ERR.NETWORK, message: 'Нет подключения к интернету', retryable: true, code: 'offline' }
  }

  const text = rawText(err)
  const status = Number(err?.status ?? err?.statusCode ?? err?.originalError?.status) || 0

  for (const [re, category, message] of RULES) {
    if (re.test(text)) return { category, message, retryable: RETRYABLE.has(category), code: err?.code || category }
  }
  for (const [code, category, message] of BY_STATUS) {
    if (status === code) return { category, message, retryable: RETRYABLE.has(category), code: String(status) }
  }
  if (status >= 500) {
    return { category: ERR.SERVER, message: 'Сервер временно недоступен — повторим автоматически', retryable: true, code: String(status) }
  }

  return {
    category: ERR.UNKNOWN,
    message: 'Что-то пошло не так. Попробуйте ещё раз',
    retryable: false,
    code: err?.code ? String(err.code) : 'unknown',
  }
}

// Ошибка означает, что сессия мертва и нужен повторный вход (а не просто
// временный сбой). Только по такому признаку допустим автоматический logout.
export function isFatalSessionError(err) {
  const { category } = normalizeError(err)
  return category === ERR.SESSION
}

// Совместимость с прежним API: показать текст ошибки в форме.
export function ruAuthError(message) {
  if (!message) return 'Что-то пошло не так'
  return normalizeError(typeof message === 'string' ? { message } : message).message
}
