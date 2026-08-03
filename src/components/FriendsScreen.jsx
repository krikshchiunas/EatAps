import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { listFriendships, acceptFriend, removeFriendship, pullFriendState } from '../lib/supabase.js'
import AddFriendSheet from './AddFriendSheet.jsx'

const shortId = (id) => (id ? id.slice(0, 8) + '…' : '')

export function Avatar({ src, name, size = 44 }) {
  if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--primary-weak)', color: 'var(--primary-strong)', display: 'grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 600, flex: '0 0 auto' }}>
      {(name || '?').trim().slice(0, 1).toUpperCase()}
    </div>
  )
}

export default function FriendsScreen() {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [lists, setLists] = useState({ friends: [], incoming: [], outgoing: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [viewing, setViewing] = useState(null)

  const reload = async () => {
    try {
      setLoading(true)
      setLists(await listFriendships(myId))
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (myId) reload()
    else setLoading(false)
  }, [myId])

  const act = async (fn) => {
    setBusy(true)
    await fn()
    setBusy(false)
    reload()
  }

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen">
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Друзья</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Войдите в аккаунт (вкладка «Профиль»), чтобы добавлять друзей и следить за питанием друг друга.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'center', margin: '0 0 18px' }}>
        <h1 className="h1" style={{ margin: '4px 0 0' }}>Друзья</h1>
        <button className="btn" style={{ width: 'auto', height: 44, padding: '0 18px' }} onClick={() => setAddOpen(true)}>＋ Добавить</button>
      </div>

      {loading ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : (
        <>
          {lists.incoming.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="h2" style={{ fontSize: 15, margin: '4px 0 8px' }}>Входящие запросы</div>
              {lists.incoming.map((r) => (
                <div key={r.rowId} className="card" style={{ marginBottom: 8, padding: 12 }}>
                  <div className="row between" style={{ alignItems: 'center' }}>
                    <div className="row gap12" style={{ alignItems: 'center', minWidth: 0 }}>
                      <Avatar name={r.name} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{r.name || 'Пользователь'}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{shortId(r.id)}</div>
                      </div>
                    </div>
                    <div className="row gap8" style={{ flex: '0 0 auto' }}>
                      <button className="btn" style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 14 }} disabled={busy} onClick={() => act(() => acceptFriend(r.rowId))}>Принять</button>
                      <button className="btn ghost" style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 14 }} disabled={busy} onClick={() => act(() => removeFriendship(r.rowId))}>Отклонить</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {lists.friends.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ fontSize: 15 }}>Пока никого. Нажмите «＋ Добавить» и вставьте ID друга, либо отправьте другу свой ID (Профиль → Мой профиль).</p>
            </div>
          ) : (
            lists.friends.map((f) => (
              <div key={f.rowId} className="card" style={{ marginBottom: 8, padding: 12 }}>
                <div className="row between" style={{ alignItems: 'center' }}>
                  <button className="row gap12" style={{ alignItems: 'center', minWidth: 0, flex: 1, textAlign: 'left' }} onClick={() => setViewing({ id: f.id, name: f.name, avatar: f.avatar })}>
                    <Avatar src={f.avatar} name={f.name} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{f.name || 'Друг'}</div>
                      <div style={{ fontSize: 12, color: 'var(--primary)' }}>посмотреть, что ест →</div>
                    </div>
                  </button>
                  <button className="iconbtn" title="Удалить из друзей" disabled={busy} onClick={() => act(() => removeFriendship(f.rowId))}>✕</button>
                </div>
              </div>
            ))
          )}

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

      {addOpen && <AddFriendSheet onClose={() => setAddOpen(false)} onSent={reload} />}
      {viewing && <FriendView friend={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// Просмотр дня друга (только чтение), как нижний лист.
function FriendView({ friend, onClose }) {
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const [date, setDate] = useState(keyOf())
  const [tab, setTab] = useState('diary') // diary | profile
  const [expandedMeal, setExpandedMeal] = useState(null)
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
  const p = state?.profile || {}
  const name = p.name || friend.name || 'Друг'
  const avatar = p.avatar || friend.avatar

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <div className="row gap12" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
            <Avatar src={avatar} name={name} size={40} />
            <div style={{ minWidth: 0 }}>
              <div className="h2" style={{ fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
              <button
                onClick={() => setTab(tab === 'diary' ? 'profile' : 'diary')}
                style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 550 }}
              >
                {tab === 'diary' ? 'Посмотреть профиль →' : '← Что ест друг'}
              </button>
            </div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
        </div>

        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</p>
        ) : !state ? (
          <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
        ) : tab === 'profile' ? (
          <FriendProfile p={p} />
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
              {target ? <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Цель: {target} ккал</p> : null}
            </div>

            <div className="h2" style={{ fontSize: 15, marginBottom: 8 }}>Приёмы пищи</div>
            {(day.meals || []).length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>В этот день ничего не записано.</p>
            ) : (
              (day.meals || []).map((m) => {
                const customFood = (state.customFoods || []).find(
                  (f) => f.name === m.name && f.kind === 'composite' && f.recipe
                )
                const isExpanded = expandedMeal === m.id
                return (
                  <div key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="row between" style={{ alignItems: 'center', padding: '8px 2px' }}>
                      <div className="row gap8" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 20 }}>{m.emoji || '🍽️'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                          <div className="row gap8" style={{ alignItems: 'center' }}>
                            {m.grams != null && <span className="muted" style={{ fontSize: 12 }}>{m.grams} {m.unit || 'г'}</span>}
                            {customFood && (
                              <button
                                style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 550 }}
                                onClick={() => setExpandedMeal(isExpanded ? null : m.id)}
                              >
                                {isExpanded ? 'Скрыть ▲' : 'Состав ▼'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="tabular" style={{ fontWeight: 600 }}>{m.kcal} ккал</span>
                    </div>
                    {isExpanded && customFood && (
                      <div style={{ padding: '6px 8px 10px 36px', background: 'var(--surface-2)', borderRadius: 10, marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Состав блюда:</div>
                        <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 4 }}>
                          🍞 {customFood.recipe.base} × {customFood.recipe.slices} шт.
                        </div>
                        {(customFood.recipe.items || []).filter((i) => i.count > 0).map((i) => (
                          <div key={i.name} style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 2 }}>
                            · {i.name} × {i.count}
                          </div>
                        ))}
                        {(customFood.recipe.items || []).filter((i) => i.count > 0).length === 0 && (
                          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Только основа</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Профиль друга: «о себе», любимый ресторан и блюдо (только чтение).
function FriendProfile({ p }) {
  const rows = [
    { label: 'Любимый ресторан', value: p.favRestaurant, emoji: '🍴' },
    { label: 'Любимое блюдо', value: p.favDish, emoji: '🍲' },
  ].filter((r) => r.value)

  if (!p.bio && rows.length === 0) {
    return <p className="muted" style={{ fontSize: 14, padding: '8px 0 4px' }}>Друг пока не заполнил профиль.</p>
  }

  return (
    <div style={{ paddingBottom: 4 }}>
      {p.bio && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>О себе</div>
          <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{p.bio}</div>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.label} className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>{r.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12 }}>{r.label}</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{r.value}</div>
          </div>
        </div>
      ))}
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
