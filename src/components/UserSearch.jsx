// Поиск людей — по нику и по имени.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ
//
// Раньше искали ТОЛЬКО по нику, от трёх символов. Имя из условия убрали
// намеренно: оно неуникально, и по запросу «Денис» выбирать было бы не из
// чего. Но это довод против имени как АДРЕСА, а не против поиска по нему —
// человек ищет «Аня», а не «anya_k», и не находил ничего вовсе.
//
// Теперь сервер ищет по обоим полям, точное совпадение ника идёт первым, а за
// ним те, с кем уже есть связь. Порог снижен до двух символов: ники бывают
// короткие, и «ая» — законный запрос.
//
// ─────────────────────────────────────────────────────────────────────────────
// НЕДАВНИЕ ЗАПРОСЫ ЖИВУТ ЛОКАЛЬНО
//
// Это удобство одного устройства, а не данные аккаунта: возить историю поиска
// на сервер значило бы завести ещё один список того, что человек искал, и
// хранить его там, откуда он не сможет его стереть одним движением.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store.jsx'
import { searchUsers, MIN_SEARCH, userCards } from '../lib/social.js'
import PeopleList from './PeopleList.jsx'

const RECENT_KEY = 'eataps:search:recent'
const RECENT_MAX = 8

// В приватном режиме iOS Safari доступ к localStorage бросает — тогда
// недавние просто не сохраняются, но экран работает.
function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function writeRecent(ids) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX))) } catch {}
}

export function rememberSearched(userId) {
  if (!userId) return
  const next = [userId, ...readRecent().filter((x) => x !== userId)]
  writeRecent(next)
}

export default function UserSearch({ onOpenProfile }) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [recent, setRecent] = useState([])
  // Счётчик ручных повторов: меняясь, он перезапускает эффект поиска с тем же
  // запросом. Дописывать пробел к запросу ради перезапуска было бы фокусом,
  // который потом никто не объяснит.
  const [attempt, setAttempt] = useState(0)
  const reqId = useRef(0)

  // Недавние — это id, а карточки к ним подтягиваются одним запросом. Хранить
  // локально имя и аватар нельзя: человек сменит их, и список будет врать.
  const loadRecent = useCallback(async () => {
    const ids = readRecent()
    if (!ids.length) { setRecent([]); return }
    try {
      const cards = await userCards(ids)
      // Порядок сохраняем свой: сервер отдаёт как попало, а «недавние»
      // упорядочены по времени.
      setRecent(ids.map((id) => cards[id]).filter(Boolean))
    } catch { setRecent([]) }
  }, [])

  useEffect(() => { loadRecent() }, [loadRecent])

  // Debounce обязателен: без него каждая буква — отдельный запрос к базе.
  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_SEARCH) { setResults(null); setBusy(false); return }

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

  const open = (id) => {
    rememberSearched(id)
    loadRecent()
    onOpenProfile?.(id)
  }

  const clearRecent = () => { writeRecent([]); setRecent([]) }

  const short = query.trim().length > 0 && query.trim().length < MIN_SEARCH
  const idle = query.trim().length === 0

  return (
    <div>
      <input
        className="input"
        type="search"
        inputMode="search"
        placeholder="Имя или ник"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск людей по имени или нику"
        style={{ marginBottom: 12 }}
      />

      {short && (
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          Введите ещё {MIN_SEARCH - query.trim().length} символ
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

      {idle && recent.length > 0 && (
        <>
          <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.3 }}>
              НЕДАВНИЕ
            </span>
            <button
              className="btn ghost"
              style={{ width: 'auto', height: 28, padding: '0 10px', fontSize: 12.5 }}
              onClick={clearRecent}
            >
              Очистить
            </button>
          </div>
          <PeopleList people={recent} myId={myId} onOpen={open} empty="" />
        </>
      )}

      {idle && recent.length === 0 && (
        <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 12px', lineHeight: 1.5 }}>
          Найдите человека по имени или нику — и подпишитесь, чтобы видеть их записи в ленте.
        </p>
      )}

      {!short && !err && !idle && (busy || results) && (
        <PeopleList
          people={results || []}
          loading={busy}
          myId={myId}
          onOpen={open}
          empty="Никого не нашли. Проверьте написание — поиск ищет с начала имени или ника."
        />
      )}
    </div>
  )
}
