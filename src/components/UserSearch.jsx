// Поиск людей — по нику и только по нику.
//
// Заменил собой два прежних способа: ручной ввод 12-символьного публичного
// кода (кодов больше нет) и поиск по отображаемому имени. Имя выпало из
// условия намеренно: оно неуникально, и по запросу «Денис» выбирать было бы
// не из чего. Обоснование целиком — в search_users, миграция
// 2026-08-26_nickname_identity.
//
// Debounce обязателен: без него каждая буква — отдельный запрос к базе.
// Меньше трёх символов сервер не обслуживает, и такой запрос не отправляется
// вовсе.
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store.jsx'
import { searchUsers } from '../lib/social.js'
import PeopleList from './PeopleList.jsx'

const MIN_QUERY = 3

export default function UserSearch({ onOpenProfile }) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Счётчик ручных повторов: меняясь, он перезапускает эффект поиска с тем же
  // запросом. Дописывать пробел к запросу ради перезапуска было бы фокусом,
  // который потом никто не объяснит.
  const [attempt, setAttempt] = useState(0)
  const reqId = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) { setResults(null); setBusy(false); return }

    setBusy(true)
    const mine = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const found = await searchUsers(q)
        // Ответы на устаревшие запросы игнорируем: без этого более медленный
        // ранний запрос мог бы перезаписать результат более позднего.
        if (mine !== reqId.current) return
        setResults(found)
        setErr(null)
      } catch (e) {
        if (mine === reqId.current) setErr(e.message || 'Поиск недоступен')
      } finally {
        if (mine === reqId.current) setBusy(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [query, attempt])

  const short = query.trim().length > 0 && query.trim().length < MIN_QUERY

  return (
    <div>
      <input
        className="input"
        type="search"
        inputMode="search"
        placeholder="Ник, например denis"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск людей по нику"
        style={{ marginBottom: 12 }}
      />

      {short && (
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          Введите ещё {MIN_QUERY - query.trim().length} символ(а)
        </p>
      )}

      {/* Ошибка поиска — с кнопкой повтора: сеть моргнула, а человек уже
          набрал ник и не должен набирать его заново. */}
      {err && !busy && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>
          <button
            className="btn ghost"
            style={{ width: 'auto', padding: '0 20px', margin: '0 auto' }}
            onClick={() => { setErr(null); setAttempt((n) => n + 1) }}
          >
            Повторить
          </button>
        </div>
      )}

      {!short && !err && (busy || results) && (
        <PeopleList
          people={results || []}
          loading={busy}
          myId={myId}
          onOpen={onOpenProfile}
          empty="Никого не нашли. Ник нужно ввести целиком или с начала — по имени поиск не ищет."
        />
      )}
    </div>
  )
}
