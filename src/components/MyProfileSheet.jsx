import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import { getMyPublicId } from '../lib/supabase.js'
import { formatPublicId } from '../lib/publicId.js'
import { addProfileListItem, removeProfileListItem, normalizeProfileList, MAX_LEN } from '../lib/profileLists.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

// Редактор списка «да в еде» / «нет в еде». Пункты добавляются по Enter или кнопкой,
// удаляются крестиком на чипе — отдельного режима редактирования нет: список
// короткий, и лишний экран здесь только мешал бы.
function ListEditor({ label, hint, placeholder, items, onChange, tone }) {
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState(null)

  const add = () => {
    const res = addProfileListItem(items, draft)
    setErr(res.error)
    if (!res.error) setDraft('')
    onChange(res.list)
  }

  return (
    <div className="field">
      <label>{label}{hint ? <span className="muted" style={{ fontWeight: 400 }}> — {hint}</span> : null}</label>
      {items.length > 0 && (
        <div className="row wrap gap8" style={{ marginBottom: 10 }}>
          {items.map((x) => (
            <span
              key={x}
              className="chip"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                ...(tone === 'no'
                  ? { background: 'var(--surface-2)', color: 'var(--ink-2)' }
                  : { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' }),
              }}
            >
              {x}
              <button
                onClick={() => onChange(removeProfileListItem(items, x))}
                aria-label={`Убрать «${x}»`}
                style={{ fontSize: 13, opacity: 0.65, lineHeight: 1 }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row gap8">
        <input
          className="input"
          placeholder={placeholder}
          value={draft}
          maxLength={MAX_LEN}
          onChange={(e) => { setDraft(e.target.value); setErr(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          style={{ flex: 1 }}
        />
        <button
          className="btn ghost"
          style={{ width: 'auto', flex: '0 0 auto', padding: '0 18px' }}
          onClick={add}
          disabled={!draft.trim()}
        >
          ＋
        </button>
      </div>
      {err && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{err}</p>}
    </div>
  )
}

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
    noGos: normalizeProfileList(profile?.noGos),
    toGos: normalizeProfileList(profile?.toGos),
  })

  const set = (p) => setDraft((d) => ({ ...d, ...p }))

  const save = () => {
    // Пустой список пишем как undefined, а не []: профиль — обычный объект в
    // синхронизируемом состоянии, и пустые ключи там ни к чему.
    const noGos = normalizeProfileList(draft.noGos)
    const toGos = normalizeProfileList(draft.toGos)
    setProfile({
      ...(profile || {}),
      name: draft.name.trim() || undefined,
      avatar: draft.avatar || undefined,
      bio: draft.bio.trim() || undefined,
      favRestaurant: draft.favRestaurant.trim() || undefined,
      favDish: draft.favDish.trim() || undefined,
      noGos: noGos.length ? noGos : undefined,
      toGos: toGos.length ? toGos : undefined,
    })
    onClose()
  }

  // В базе код лежит без разделителей, человеку показываем и копируем
  // сгруппированный вид — его проще перенабрать и продиктовать. Обратно
  // normalizePublicId снимает дефисы, поэтому вставить можно любой из двух.
  const shownId = publicId ? formatPublicId(publicId) : null

  const copy = async () => {
    if (!shownId) return
    try {
      await navigator.clipboard.writeText(shownId)
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

        {/* Порядок полей — тот же, что в профиле: человек правит их сверху вниз
            ровно в том виде, в каком они потом стоят на витрине. */}
        <div className="field">
          <label>Био</label>
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
          <label>Любимое блюдо</label>
          <input className="input" placeholder="Напр. Паста карбонара" value={draft.favDish} onChange={(e) => set({ favDish: e.target.value })} maxLength={60} />
        </div>

        <div className="field">
          <label>Любимый ресторан</label>
          <input className="input" placeholder="Напр. Dodo Pizza" value={draft.favRestaurant} onChange={(e) => set({ favRestaurant: e.target.value })} maxLength={60} />
        </div>

        <ListEditor
          label="Да в еде"
          hint="увидят друзья"
          placeholder="Напр. Суши"
          items={draft.toGos}
          onChange={(toGos) => set({ toGos })}
          tone="yes"
        />

        <ListEditor
          label="Нет в еде"
          hint="увидят друзья"
          placeholder="Напр. Молоко"
          items={draft.noGos}
          onChange={(noGos) => set({ noGos })}
          tone="no"
        />

        <div className="field">
          <label>Ваш ID — отправьте другу, чтобы он вас добавил</label>
          <div className="row gap8" style={{ alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={shownId ?? '…'}
              style={{ flex: 1, fontSize: 17, fontWeight: 650, letterSpacing: '0.04em', textAlign: 'center' }}
              onFocus={(e) => e.target.select()}
            />
            <button className="iconbtn" onClick={copy} title="Копировать ID" aria-label="Копировать ID" disabled={!shownId} style={{ flex: '0 0 auto' }}>
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
