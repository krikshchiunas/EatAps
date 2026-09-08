// Поиск по сообщениям — внутри одного диалога или по всем сразу.
//
// Ищет ТОЛЬКО там, где человек участник: search_messages присоединяет
// conversation_members по auth.uid(), и обойти это, подставив чужой
// conversation_id, нельзя — запрос просто вернёт пусто.
import { useState, useEffect, useRef } from 'react'
import { searchMessages } from '../../lib/messaging.js'
import { dayLabel, timeShort } from '../../lib/chatFormat.js'
import PushScreen from '../PushScreen.jsx'

export default function ConversationSearch({ conversationId = null, onClose, onPick }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const reqId = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setItems(null); setBusy(false); return }
    setBusy(true)
    const mine = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const rows = await searchMessages(q, { conversationId })
        if (mine === reqId.current) setItems(rows)
      } catch {
        if (mine === reqId.current) setItems([])
      } finally {
        if (mine === reqId.current) setBusy(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [query, conversationId])

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>
              {conversationId ? 'Поиск в переписке' : 'Поиск по сообщениям'}
            </h1>
          </div>

          <input
            className="input"
            type="search"
            autoFocus
            placeholder="Слово или фраза"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Текст для поиска"
            style={{ marginBottom: 12 }}
          />

          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              Введите хотя бы два символа
            </p>
          )}

          {busy && <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '20px 0' }}>Ищем…</p>}

          {!busy && items?.length === 0 && (
            <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 12px' }}>
              Ничего не нашли.
            </p>
          )}

          {!busy && (items || []).map((m) => (
            <button
              key={m.id}
              onClick={() => onPick?.(m)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 0,
                padding: '11px 4px', color: 'inherit', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="muted" style={{ fontSize: 12, marginBottom: 3 }}>
                {m.title || ''}{m.title ? ' · ' : ''}{dayLabel(m.created_at)} {timeShort(m.created_at)}
              </div>
              <div style={{
                fontSize: 14.5, lineHeight: 1.45,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {m.text}
              </div>
            </button>
          ))}
        </div>
      )}
    </PushScreen>
  )
}
