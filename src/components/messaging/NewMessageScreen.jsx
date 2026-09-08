// Новое сообщение: кому написать.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОДИН ЧЕЛОВЕК — ЛИЧНЫЙ ДИАЛОГ, НЕСКОЛЬКО — ГРУППА
//
// Отдельной кнопки «создать группу» нет: она означала бы два пути к одному
// действию и вопрос «а что если я выбрал одного?». Здесь путь один — выбираешь
// людей, и тип диалога следует из их числа. Это и понятнее, и короче.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПРАВА ПРОВЕРЯЕТ СЕРВЕР
//
// Кого-то может быть нельзя добавить в группу (он это запретил настройкой),
// кому-то нельзя написать вовсе. Экран об этом не гадает: он отправляет выбор
// на сервер и показывает то, что тот ответил. Прятать людей заранее значило бы
// повторить правило доступа на клиенте — а оно уже есть в базе.
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store.jsx'
import { searchUsers, MIN_SEARCH, listMutuals, listFollowing } from '../../lib/social.js'
import { openDirect, createGroup } from '../../lib/messaging.js'
import { Avatar, LockBadge } from '../Avatar.jsx'
import { PersonRowSkeleton } from '../PeopleList.jsx'
import PushScreen from '../PushScreen.jsx'

// onPickMany превращает экран в ЧИСТЫЙ ВЫБОР людей: он не создаёт диалог, а
// отдаёт список выбранных наружу. Так «Добавить людей» в группу пользуется тем
// же экраном, что и «Написать», — второй такой же список разошёлся бы с первым
// на первой же правке.
export default function NewMessageScreen({ onClose, onOpenConversation, onPickMany = null }) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [picked, setPicked] = useState([])   // массив, а не Set: порядок выбора виден в чипсах
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const reqId = useRef(0)

  // Подсказка по умолчанию — взаимные подписки, а за ними просто подписки:
  // чаще всего пишут именно им, и заставлять набирать имя ради этого незачем.
  useEffect(() => {
    if (!myId) return
    let alive = true
    ;(async () => {
      try {
        const mutual = await listMutuals(myId, { limit: 30 })
        if (!alive) return
        if (mutual.length >= 5) { setSuggested(mutual); return }
        const following = await listFollowing(myId, { limit: 30 })
        if (!alive) return
        const seen = new Set(mutual.map((m) => m.user_id))
        setSuggested([...mutual, ...following.filter((f) => !seen.has(f.user_id))])
      } catch { if (alive) setSuggested([]) }
    })()
    return () => { alive = false }
  }, [myId])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_SEARCH) { setResults(null); return }
    const mine = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const found = await searchUsers(q)
        if (mine === reqId.current) setResults(found)
      } catch {
        if (mine === reqId.current) setResults([])
      }
    }, 260)
    return () => clearTimeout(t)
  }, [query])

  const toggle = (p) => {
    setErr(null)
    setPicked((cur) => (cur.some((x) => x.user_id === p.user_id)
      ? cur.filter((x) => x.user_id !== p.user_id)
      : [...cur, p]))
  }

  const start = async () => {
    if (!picked.length || busy) return
    if (onPickMany) { onPickMany(picked.map((p) => p.user_id)); return }
    setBusy(true); setErr(null)
    const res = picked.length === 1
      ? await openDirect(picked[0].user_id)
      : await createGroup({ title: title.trim() || null, members: picked.map((p) => p.user_id) })
    setBusy(false)
    if (res?.error) { setErr(res.error); return }
    onOpenConversation?.(res.ok, picked.length === 1 ? picked[0] : null)
  }

  const list = query.trim().length >= MIN_SEARCH ? results : suggested
  const loading = list === null

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>
              {onPickMany ? 'Добавить людей' : 'Новое сообщение'}
            </h1>
          </div>

          {/* Выбранные — чипсами над полем: так видно, кому пойдёт сообщение,
              не прокручивая список обратно. */}
          {picked.length > 0 && (
            <div className="row gap8 wrap" style={{ marginBottom: 10 }}>
              {picked.map((p) => (
                <button
                  key={p.user_id}
                  className="pill on"
                  onClick={() => toggle(p)}
                  aria-label={`Убрать ${p.display_name || p.username}`}
                >
                  {p.display_name || p.username} ✕
                </button>
              ))}
            </div>
          )}

          <input
            className="input"
            type="search"
            placeholder="Кому: имя или ник"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Кому написать"
            style={{ marginBottom: 12 }}
          />

          {picked.length > 1 && !onPickMany && (
            <input
              className="input"
              placeholder="Название группы (необязательно)"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Название группы"
              style={{ marginBottom: 12 }}
            />
          )}

          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

          {loading && [0, 1, 2, 3].map((i) => <PersonRowSkeleton key={i} />)}

          {!loading && list.length === 0 && (
            <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 12px', lineHeight: 1.5 }}>
              {query.trim().length >= MIN_SEARCH
                ? 'Никого не нашли. Проверьте написание — поиск ищет с начала имени или ника.'
                : 'Найдите человека по имени или нику.'}
            </p>
          )}

          {!loading && list.map((p) => {
            const on = picked.some((x) => x.user_id === p.user_id)
            const name = p.display_name || p.username || 'Без имени'
            return (
              <button
                key={p.user_id}
                onClick={() => toggle(p)}
                className="row gap10"
                style={{
                  width: '100%', alignItems: 'center', textAlign: 'left', padding: '9px 0',
                  background: 'none', border: 0, color: 'inherit', cursor: 'pointer', minHeight: 52,
                }}
                aria-pressed={on}
              >
                <Avatar src={p.avatar_url} name={name} size={44} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    {p.is_private && <LockBadge />}
                  </span>
                  <span className="muted" style={{ fontSize: 12.5, display: 'block' }}>{p.username}</span>
                </span>
                <span
                  aria-hidden
                  style={{
                    width: 22, height: 22, borderRadius: '50%', flex: '0 0 auto',
                    border: `2px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`,
                    background: on ? 'var(--primary)' : 'transparent',
                    color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontSize: 13,
                  }}
                >
                  {on ? '✓' : ''}
                </span>
              </button>
            )
          })}

          {picked.length > 0 && (
            <div style={{
              position: 'sticky', bottom: 0, paddingTop: 12, paddingBottom: 8,
              background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
            }}>
              <button className="btn" disabled={busy} onClick={start}>
                {busy ? 'Открываем…'
                  : onPickMany ? `Добавить (${picked.length})`
                  : picked.length === 1 ? 'Написать'
                  : `Создать группу (${picked.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </PushScreen>
  )
}
