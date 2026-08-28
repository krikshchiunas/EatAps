// Редактор своего профиля.
//
// Полей ровно столько, сколько рисует витрина: имя, аватар, ник, био и
// guilty pleasure. Списки «да в еде» / «нет в еде», любимое блюдо и любимый
// ресторан убраны вместе со старой моделью профиля — «Я это обожаю» и «Ок»
// теперь считаются по дневнику, а не заполняются руками.
import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import { userProfile, setUsername } from '../lib/social.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

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
    guiltyPleasure: profile?.guiltyPleasure || '',
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

    // Пустое поле пишем как undefined, а не '': профиль — обычный объект в
    // синхронизируемом состоянии, и пустые ключи там ни к чему.
    //
    // Поля старой модели (любимое блюдо, ресторан, списки «да/нет в еде»)
    // затираются здесь же. Их больше нигде не видно и негде завести, а молча
    // возить их в блобе и отдавать друзьям — раздача данных без причины.
    setProfile({
      ...(profile || {}),
      name: draft.name.trim() || undefined,
      avatar: draft.avatar || undefined,
      bio: draft.bio.trim() || undefined,
      guiltyPleasure: draft.guiltyPleasure.trim() || undefined,
      favRestaurant: undefined,
      favDish: undefined,
      noGos: undefined,
      toGos: undefined,
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

        {/* Единственное поле профиля, которое человек заполняет про еду сам.
            «Я это обожаю» и «Ок» рядом с ним в профиле считаются по дневнику —
            их здесь нет и быть не должно. */}
        <div className="field">
          <label>MY guilty pleasure</label>
          <input
            className="input"
            placeholder="Напр. Шоколадный торт"
            value={draft.guiltyPleasure}
            onChange={(e) => set({ guiltyPleasure: e.target.value })}
            maxLength={60}
          />
        </div>

        <button className="btn" style={{ marginTop: 10 }} onClick={save} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
