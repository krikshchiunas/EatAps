import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import { userProfile, setUsername } from '../lib/social.js'
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
  // Ник живёт не в синхронизируемом блобе, а в profiles на сервере: он должен
  // быть уникальным на всю базу, а блоб об остальных ничего не знает. Поэтому
  // грузится и сохраняется он отдельно от всего остального в этой форме.
  const [nick, setNick] = useState('')
  const [savedNick, setSavedNick] = useState(null)
  const [nickErr, setNickErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    userProfile(user.id)
      .then((card) => {
        if (!alive || !card?.username) return
        setSavedNick(card.username)
        setNick(card.username)
      })
      .catch(() => {})
    return () => { alive = false }
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

  const save = async () => {
    // Ник сохраняем ПЕРВЫМ и только при изменении: он единственный может быть
    // отвергнут сервером (занят, короткий), и в этом случае лист закрывать
    // нельзя — иначе человек решит, что ник сменился, а он нет.
    const wanted = nick.trim().toLowerCase().replace(/^@+/, '')
    if (savedNick !== null && wanted !== savedNick) {
      setBusy(true)
      const res = await setUsername(wanted)
      setBusy(false)
      if (res.error) { setNickErr(res.error); return }
      setSavedNick(res.ok)
      setNick(res.ok)
    }

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
          <label>Имя</label>
          <input className="input" placeholder="Напр. Денис" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
        </div>

        {/* Ник — единственный способ найти человека в поиске, поэтому он не
            спрятан в настройках, а стоит сразу под именем. Приставки «@» нет
            нигде: ни здесь, ни в профиле, ни в поиске. */}
        {savedNick !== null && (
          <div className="field">
            <label>Ник — по нему вас находят в поиске</label>
            <input
              className="input"
              value={nick}
              onChange={(e) => {
                // Приводим к тому, что примет сервер, прямо во время ввода:
                // отказ после нажатия «Сохранить» из-за заглавной буквы был бы
                // придиркой, а не защитой.
                setNick(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                setNickErr(null)
              }}
              placeholder="denis"
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              От 3 до 20 символов: латиница, цифры и «_». У каждого свой — двух одинаковых не бывает.
            </p>
            {nickErr && <p style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 6 }}>{nickErr}</p>}
          </div>
        )}

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

        <button className="btn" style={{ marginTop: 10 }} onClick={save} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
