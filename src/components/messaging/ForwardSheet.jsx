// Пересылка сообщения в другие диалоги.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ МОЖНО ВЫБРАТЬ НЕСКОЛЬКО
//
// Пересылают обычно «показать вот это» сразу двоим-троим, и заставлять
// повторять путь по разу на каждого — лишняя работа там, где она не несёт
// смысла. Отправка идёт одним вызовом, права на каждый диалог сервер
// проверяет по отдельности: выбор в интерфейсе не является разрешением.
//
// Каждое пересланное сообщение — НОВАЯ строка в целевом диалоге, а не ссылка
// на исходную. Отдать чужой conversation_id значило бы впустить получателя в
// переписку, к которой он отношения не имеет.
import { useState, useEffect } from 'react'
import { useSheetDrag } from '../../lib/useSheetDrag.js'
import { listConversations, forwardMessage } from '../../lib/messaging.js'
import { Avatar } from '../Avatar.jsx'

export default function ForwardSheet({ messageId, exceptId, onClose, onDone }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [items, setItems] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    listConversations({ limit: 60 })
      .then((res) => { if (alive) setItems(res.items.filter((c) => c.id !== exceptId && c.state === 'accepted')) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [exceptId])

  const toggle = (id) => setPicked((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const send = async () => {
    if (!picked.size || busy) return
    setBusy(true); setErr(null)
    const res = await forwardMessage(messageId, [...picked])
    setBusy(false)
    if (res?.error) { setErr(res.error); return }
    close()
    onDone?.(res.ok || picked.size)
  }

  const q = query.trim().toLowerCase()
  const shown = (items || []).filter((c) => !q || (c.title || '').toLowerCase().includes(q))

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 88 }}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}
           style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="grabber" />
        <h2 className="h1" style={{ fontSize: 20, margin: '0 0 12px' }}>Переслать</h2>

        <input
          className="input"
          type="search"
          placeholder="Кому…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск диалога"
          style={{ marginBottom: 10, flex: '0 0 auto' }}
        />

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {items === null && <p className="muted" style={{ fontSize: 14, padding: '20px 0', textAlign: 'center' }}>Загружаем…</p>}
          {items?.length === 0 && (
            <p className="muted" style={{ fontSize: 14, padding: '20px 0', textAlign: 'center', lineHeight: 1.5 }}>
              Переслать пока некуда — нет ни одной открытой переписки.
            </p>
          )}
          {shown.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className="row gap12"
              style={{
                width: '100%', alignItems: 'center', textAlign: 'left', padding: '9px 4px',
                background: 'none', border: 0, color: 'inherit', cursor: 'pointer', minHeight: 52,
              }}
              aria-pressed={picked.has(c.id)}
            >
              <Avatar src={c.avatarUrl} name={c.title || 'Диалог'} size={40} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || (c.kind === 'group' ? 'Группа' : 'Без имени')}
              </span>
              <span
                aria-hidden
                style={{
                  width: 22, height: 22, borderRadius: '50%', flex: '0 0 auto',
                  border: `2px solid ${picked.has(c.id) ? 'var(--primary)' : 'var(--border-strong)'}`,
                  background: picked.has(c.id) ? 'var(--primary)' : 'transparent',
                  color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontSize: 13,
                }}
              >
                {picked.has(c.id) ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>

        {err && <p style={{ fontSize: 13, color: 'var(--danger)', margin: '10px 0 0' }}>{err}</p>}

        <button className="btn" disabled={!picked.size || busy} onClick={send} style={{ marginTop: 12, flex: '0 0 auto' }}>
          {busy ? 'Отправляем…' : picked.size ? `Переслать (${picked.size})` : 'Выберите, кому'}
        </button>
      </div>
    </div>
  )
}
