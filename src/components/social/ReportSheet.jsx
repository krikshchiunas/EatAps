// Жалоба на человека, запись или сообщение.
//
// Уходит в ту же поддержку, что и обычное обращение (api/support): у неё уже
// есть вход, проверка бана и ограничение частоты. Вторая система модерации
// рядом с существующей означала бы два места, куда владельцу надо смотреть, и
// два набора правил, которые разойдутся.
//
// Честность формулировок: не обещаем «мы рассмотрим в течение 24 часов» —
// такого обязательства у проекта нет. Обещаем ровно то, что происходит:
// сообщение уходит владельцу приложения.
import { useState } from 'react'
import { useSheetDrag } from '../../lib/useSheetDrag.js'
import { reportContent, REPORT_REASONS } from '../../lib/social.js'

const KIND_LABEL = {
  user: 'на профиль',
  post: 'на запись',
  message: 'на сообщение',
  conversation: 'на переписку',
}

export default function ReportSheet({ kind = 'user', targetId, name, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  const send = async () => {
    if (!reason || busy) return
    setBusy(true); setErr(null)
    const res = await reportContent({ kind, targetId, reason, note })
    setBusy(false)
    if (res?.error) { setErr(res.error); return }
    setDone(true)
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 90 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {done ? (
          <div style={{ textAlign: 'center', padding: '10px 0 20px' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>✓</div>
            <p style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 18 }}>
              Жалоба отправлена владельцу приложения.
            </p>
            <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={close}>
              Закрыть
            </button>
          </div>
        ) : (
          <>
            <h2 className="h1" style={{ fontSize: 20, margin: '0 0 4px' }}>
              Пожаловаться {KIND_LABEL[kind] || ''}
            </h2>
            {name && <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>{name}</p>}

            <div className="row gap8 wrap" style={{ marginBottom: 16 }}>
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.key}
                  className={`pill${reason === r.key ? ' on' : ''}`}
                  aria-pressed={reason === r.key}
                  onClick={() => setReason(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <textarea
              className="input"
              rows={3}
              maxLength={500}
              placeholder="Что произошло? (необязательно)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ resize: 'none', marginBottom: 12 }}
              aria-label="Подробности жалобы"
            />

            {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

            <button className="btn" disabled={!reason || busy} onClick={send}>
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
            <p className="set-note" style={{ textAlign: 'center' }}>
              Жалоба уходит владельцу приложения. Человек об этом не узнаёт.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
