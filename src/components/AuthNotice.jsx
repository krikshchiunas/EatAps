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
    <div className="sync-chip warn" role="status">
      <span>{authError.message}</span>
      <button type="button" className="sync-chip-retry" onClick={dismissAuthError}>Понятно</button>
    </div>
  )
}
