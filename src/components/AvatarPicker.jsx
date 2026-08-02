import { useRef, useState } from 'react'
import { fileToAvatar } from '../lib/avatar.js'

// Круглый выбор фото профиля. value — data URL или null. onChange(dataUrl|null).
export default function AvatarPicker({ value, onChange, size = 96 }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(null)
    setBusy(true)
    try {
      onChange(await fileToAvatar(file))
    } catch (ex) {
      setErr(ex.message || 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'var(--surface-2)',
          border: '2px solid var(--border-strong)',
          display: 'grid',
          placeItems: 'center',
        }}
        aria-label="Выбрать фото"
      >
        {value ? (
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: Math.round(size * 0.34), opacity: 0.6 }}>📷</span>
        )}
      </button>
      <div className="row gap8" style={{ justifyContent: 'center' }}>
        <button type="button" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 550 }} onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Загрузка…' : value ? 'Изменить фото' : 'Добавить фото'}
        </button>
        {value && (
          <button type="button" style={{ fontSize: 13, color: 'var(--ink-3)' }} onClick={() => onChange(null)}>
            Убрать
          </button>
        )}
      </div>
      {err && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</p>}
      <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
    </div>
  )
}
