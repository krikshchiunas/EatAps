import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import { getMyPublicId } from '../lib/supabase.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

export default function MyProfileSheet({ onClose }) {
  const { user, profile, setProfile } = useStore()
  const [publicId, setPublicId] = useState(null)
  const [copied, setCopied] = useState(false)
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  useEffect(() => {
    if (user?.id) getMyPublicId(user.id).then((id) => setPublicId(id))
  }, [user?.id])

  const [draft, setDraft] = useState({
    name: profile?.name || '',
    avatar: profile?.avatar || null,
    bio: profile?.bio || '',
    favRestaurant: profile?.favRestaurant || '',
    favDish: profile?.favDish || '',
  })

  const set = (p) => setDraft((d) => ({ ...d, ...p }))

  const save = () => {
    setProfile({
      ...(profile || {}),
      name: draft.name.trim() || undefined,
      avatar: draft.avatar || undefined,
      bio: draft.bio.trim() || undefined,
      favRestaurant: draft.favRestaurant.trim() || undefined,
      favDish: draft.favDish.trim() || undefined,
    })
    onClose()
  }

  const copy = async () => {
    if (!publicId) return
    try {
      await navigator.clipboard.writeText(publicId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Мой профиль</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <AvatarPicker value={draft.avatar} onChange={(a) => set({ avatar: a })} size={110} />
        </div>

        <div className="field">
          <label>Имя / никнейм</label>
          <input className="input" placeholder="Напр. Денис" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
        </div>

        <div className="field">
          <label>О себе</label>
          <textarea
            className="input"
            placeholder="Пара слов о себе — увидят друзья"
            value={draft.bio}
            onChange={(e) => set({ bio: e.target.value })}
            maxLength={200}
            rows={3}
            style={{ resize: 'none', minHeight: 76, paddingTop: 12, lineHeight: 1.4 }}
          />
        </div>

        <div className="field">
          <label>Любимый ресторан</label>
          <input className="input" placeholder="Напр. Dodo Pizza" value={draft.favRestaurant} onChange={(e) => set({ favRestaurant: e.target.value })} maxLength={60} />
        </div>

        <div className="field">
          <label>Любимое блюдо</label>
          <input className="input" placeholder="Напр. Паста карбонара" value={draft.favDish} onChange={(e) => set({ favDish: e.target.value })} maxLength={60} />
        </div>

        <div className="field">
          <label>Ваш ID — отправьте другу, чтобы он вас добавил</label>
          <div className="row gap8" style={{ alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={publicId ?? '…'}
              style={{ flex: 1, fontSize: 18, fontWeight: 650, letterSpacing: '0.06em', textAlign: 'center' }}
              onFocus={(e) => e.target.select()}
            />
            <button className="iconbtn" onClick={copy} title="Копировать ID" aria-label="Копировать ID" disabled={!publicId} style={{ flex: '0 0 auto' }}>
              {copied ? '✓' : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <button className="btn" style={{ marginTop: 10 }} onClick={save}>Сохранить</button>
      </div>
    </div>
  )
}
