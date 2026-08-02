import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import {
  sendFriendRequest,
  listFriendships,
  acceptFriend,
  removeFriendship,
  pullFriendState,
} from '../lib/supabase.js'

const shortId = (id) => (id ? id.slice(0, 8) + '…' : '')

export default function FriendsSheet({ onClose }) {
  const { user, profile, setProfile } = useStore()
  const myId = user?.id || ''

  const [lists, setLists] = useState({ friends: [], incoming: [], outgoing: [] })
  const [loading, setLoading] = useState(true)
  const [targetId, setTargetId] = useState('')
  const [name, setName] = useState(profile?.name || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {type, text}
  const [copied, setCopied] = useState(false)
  const [viewing, setViewing] = useState(null) // {id, name}

  const reload = async () => {
    try {
      setLoading(true)
      setLists(await listFriendships(myId))
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Не удалось загрузить' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (myId) reload()
  }, [myId])

  const saveName = (v) => {
    setName(v)
    setProfile({ ...(profile || {}), name: v })
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(myId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setMsg({ type: 'err', text: 'Не удалось скопировать' })
    }
  }

  const send = async () => {
    setBusy(true)
    setMsg(null)
    const res = await sendFriendRequest({ myId, myName: name.trim(), targetId })
    setBusy(false)
    if (res.error) setMsg({ type: 'err', text: res.error })
    else {
      setMsg({ type: 'ok', text: res.ok })
      setTargetId('')
      reload()
    }
  }

  const act = async (fn) => {
    setBusy(true)
    await fn()
    setBusy(false)
    reload()
  }

  if (viewing) {
    return <FriendView friend={viewing} onBack={() => setViewing(null)} onClose={onClose} />
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Друзья</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {/* Ваше имя */}
        <div className="field">
          <label>Ваше имя (видно друзьям)</label>
          <input className="input" placeholder="Напр. Денис" value={name} onChange={(e) => saveName(e.target.value)} />
        </div>

        {/* Мой ID */}
        <div className="field">
          <label>Мой ID — отправьте его другу</label>
          <div className="row gap8">
            <input className="input" readOnly value={myId} style={{ flex: 1, fontSize: 13 }} onFocus={(e) => e.target.select()} />
            <button className="btn ghost" style={{ flex: '0 0 auto' }} onClick={copyId}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
          </div>
        </div>

        {/* Добавить по ID */}
        <div className="field">
          <label>Добавить друга по ID</label>
          <div className="row gap8">
            <input className="input" placeholder="Вставьте ID друга" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" style={{ flex: '0 0 auto' }} disabled={busy || !targetId.trim()} onClick={send}>Запрос</button>
          </div>
        </div>

        {msg && (
          <p style={{ margin: '4px 0 14px', fontSize: 14, color: msg.type === 'err' ? 'var(--danger)' : 'var(--primary-strong)' }}>{msg.text}</p>
        )}

        {loading ? (
          <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
        ) : (
          <>
            {/* Входящие запросы */}
            {lists.incoming.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className="h2" style={{ fontSize: 15, margin: '10px 0 8px' }}>Входящие запросы</div>
                {lists.incoming.map((r) => (
                  <div key={r.rowId} className="card" style={{ marginBottom: 8, padding: 12 }}>
                    <div className="row between" style={{ alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{r.name || 'Пользователь'}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{shortId(r.id)}</div>
                      </div>
                      <div className="row gap8">
                        <button className="btn" style={{ padding: '8px 14px' }} disabled={busy} onClick={() => act(() => acceptFriend(r.rowId))}>Принять</button>
                        <button className="btn ghost" style={{ padding: '8px 14px' }} disabled={busy} onClick={() => act(() => removeFriendship(r.rowId))}>Отклонить</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Друзья */}
            <div className="h2" style={{ fontSize: 15, margin: '10px 0 8px' }}>Мои друзья {lists.friends.length > 0 && `(${lists.friends.length})`}</div>
            {lists.friends.length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>Пока никого. Отправьте другу свой ID или добавьте его по ID.</p>
            ) : (
              lists.friends.map((f) => (
                <div key={f.rowId} className="card" style={{ marginBottom: 8, padding: 12 }}>
                  <div className="row between" style={{ alignItems: 'center' }}>
                    <button style={{ minWidth: 0, textAlign: 'left', flex: 1 }} onClick={() => setViewing({ id: f.id, name: f.name })}>
                      <div style={{ fontWeight: 600 }}>{f.name || 'Друг'}</div>
                      <div style={{ fontSize: 12, color: 'var(--primary)' }}>посмотреть, что ест →</div>
                    </button>
                    <button className="iconbtn" title="Удалить" disabled={busy} onClick={() => act(() => removeFriendship(f.rowId))}>✕</button>
                  </div>
                </div>
              ))
            )}

            {/* Исходящие */}
            {lists.outgoing.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="h2" style={{ fontSize: 15, margin: '10px 0 8px' }}>Ожидают ответа</div>
                {lists.outgoing.map((r) => (
                  <div key={r.rowId} className="row between" style={{ alignItems: 'center', padding: '6px 2px' }}>
                    <span className="muted" style={{ fontSize: 13 }}>{shortId(r.id)} · ждёт подтверждения</span>
                    <button className="iconbtn" title="Отменить" disabled={busy} onClick={() => act(() => removeFriendship(r.rowId))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Просмотр дня друга (только чтение).
function FriendView({ friend, onBack, onClose }) {
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const [date, setDate] = useState(keyOf())
  const today = keyOf()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await pullFriendState(friend.id)
        if (!cancelled) setState(res?.state || { days: {}, profile: null })
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Не удалось загрузить')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [friend.id])

  const day = state?.days?.[date] || { meals: [] }
  const totals = sumDay(day.meals || [])
  const target = state?.profile?.targets?.calories
  const name = state?.profile?.name || friend.name || 'Друг'

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← друзья</button>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <h2 className="h2" style={{ marginBottom: 4 }}>{name}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Что ест друг</p>

        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</p>
        ) : !state ? (
          <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
        ) : (
          <>
            <div className="row between" style={{ alignItems: 'center', marginBottom: 14 }}>
              <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Раньше">‹</button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600 }}>{humanDay(date, today)}</div>
                <div className="muted" style={{ fontSize: 12 }}>{humanDow(date)}</div>
              </div>
              <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Позже">›</button>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="row gap8" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
                <Stat label="ккал" v={totals.kcal} />
                <Stat label="белки" v={totals.protein} />
                <Stat label="угл." v={totals.carbs} />
                <Stat label="жиры" v={totals.fat} />
              </div>
              {target ? (
                <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Цель: {target} ккал</p>
              ) : null}
            </div>

            <div className="h2" style={{ fontSize: 15, marginBottom: 8 }}>Приёмы пищи</div>
            {(day.meals || []).length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>В этот день ничего не записано.</p>
            ) : (
              (day.meals || []).map((m) => (
                <div key={m.id} className="row between" style={{ alignItems: 'center', padding: '8px 2px', borderBottom: '1px solid var(--border)' }}>
                  <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
                    <span style={{ fontSize: 20 }}>{m.emoji || '🍽️'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      {m.grams != null && <div className="muted" style={{ fontSize: 12 }}>{m.grams} {m.unit || 'г'}</div>}
                    </div>
                  </div>
                  <span className="tabular" style={{ fontWeight: 600 }}>{m.kcal} ккал</span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, v }) {
  return (
    <div>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(v || 0)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}
