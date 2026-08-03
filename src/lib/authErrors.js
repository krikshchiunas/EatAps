// Перевод ошибок Supabase Auth на русский. Supabase возвращает английские
// сообщения — наружу показываем понятный текст, незнакомые оставляем как есть.
const RULES = [
  [/invalid login credentials/i, 'Неверный email или пароль'],
  [/email not confirmed/i, 'Почта не подтверждена — откройте ссылку из письма'],
  [/user already registered/i, 'Такой аккаунт уже есть — попробуйте войти'],
  [/password should be at least/i, 'Пароль слишком короткий — минимум 6 символов'],
  [/new password should be different/i, 'Новый пароль должен отличаться от старого'],
  [/unable to validate email|invalid email|invalid format/i, 'Некорректный email'],
  [/signups not allowed/i, 'Регистрация сейчас отключена'],
  [/email link is invalid|otp.{0,10}expired|token.{0,10}expired/i, 'Ссылка недействительна или устарела — запросите новую'],
  [/security purposes|rate limit|too many requests/i, 'Слишком много попыток — подождите минуту и повторите'],
  [/failed to fetch|network|fetch failed/i, 'Нет соединения с сервером — проверьте интернет'],
  [/same_password/i, 'Новый пароль должен отличаться от старого'],
]

export function ruAuthError(message) {
  const m = String(message || '')
  for (const [re, text] of RULES) if (re.test(m)) return text
  return m || 'Что-то пошло не так'
}
