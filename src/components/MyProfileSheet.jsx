import { useState } from 'react'
import { useStore } from '../store.jsx'
import AvatarPicker from './AvatarPicker.jsx'

// Мой профиль: фото, имя/никнейм, ID с копированием.
export default function MyProfileSheet({ onClose }) {
  const { user, profile, setProfile } = useStore()
  const myId = user?.id || ''
  const [copied, setCopied] = useState(false)

  const setName = (name) => setProfile({ ...(profile || {}), name })
  const setAvatar = (avatar) => setProfile({ ...(profile || {}), avatar: avatar || undefined })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(myId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Мой профиль</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <AvatarPicker value={profile?.avatar || null} onChange={setAvatar} size={110} />
        </div>

        <div className="field">
          <label>Имя / никнейм</label>
          <input className="input" placeholder="Напр. Денис" value={profile?.name || ''} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>

        <div className="field">
          <label>ID — отправьте другу, чтобы он вас добавил</label>
          <div className="row gap8" style={{ alignItems: 'center' }}>
            <input className="input" readOnly value={myId} style={{ flex: 1, fontSize: 13 }} onFocus={(e) => e.target.select()} />
            <button className="iconbtn" onClick={copy} title="Копировать ID" aria-label="Копировать ID" style={{ flex: '0 0 auto' }}>
              {copied ? '✓' : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
