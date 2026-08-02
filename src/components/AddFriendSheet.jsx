import { useState } from 'react'
import { useStore } from '../store.jsx'
import { sendFriendRequest } from '../lib/supabase.js'

// Только отправка заявки: вставить ID → отправить.
export default function AddFriendSheet({ onClose, onSent }) {
  const { user, profile } = useStore()
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const send = async () => {
    setBusy(true)
    setMsg(null)
    const res = await sendFriendRequest({ myId: user?.id, myName: (profile?.name || '').trim(), targetId })
    setBusy(false)
    if (res.error) setMsg({ type: 'err', text: res.error })
    else {
      setMsg({ type: 'ok', text: res.ok })
      setTargetId('')
      onSent?.()
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Добавить друга</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="field">
          <label>ID друга</label>
          <input className="input" placeholder="Вставьте ID друга" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ marginBottom: 10 }} />
          <button className="btn" disabled={busy || !targetId.trim()} onClick={send}>Отправить заявку</button>
        </div>

        {msg && (
          <p style={{ marginTop: 6, fontSize: 14, color: msg.type === 'err' ? 'var(--danger)' : 'var(--primary-strong)' }}>{msg.text}</p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Свой ID можно скопировать в «Профиль → Мой профиль».</p>
      </div>
    </div>
  )
}
