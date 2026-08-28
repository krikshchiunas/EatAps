import { useStore } from '../store.jsx'

// Сообщение о проблеме с аккаунтом — например, что сессия истекла.
//
// Без него автоматический выход выглядел бы как необъяснимая пропажа данных:
// приложение молча переставало считать человека вошедшим. Спецификация прямо
// это запрещает — «внезапный logout без объяснения».
//
// Текст берётся из нормализованной ошибки, поэтому наружу не попадают ни коды,
// ни названия таблиц, ни JWT.
export default function AuthNotice() {
  const { authError, dismissAuthError } = useStore()
  if (!authError) return null

  return (
    <div className="auth-notice" role="status">
      <span>{authError.message}</span>
      <button type="button" className="auth-notice__ok" onClick={dismissAuthError}>Понятно</button>
    </div>
  )
}
