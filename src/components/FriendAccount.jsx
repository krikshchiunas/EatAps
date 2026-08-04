import { useState, useEffect, useRef } from 'react'
import { pullFriendState, removeFriendship } from '../lib/supabase.js'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { Avatar } from './FriendsScreen.jsx'

function Stat({ label, v }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(v || 0)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}

function DotsMenu({ onMute, onRemove, onClose }) {
  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 6,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, boxShadow: 'var(--shadow-float)',
      minWidth: 180, zIndex: 10, overflow: 'hidden',
    }}>
      <button
        style={{ width: '100%', textAlign: 'left', padding: '14px 18px', fontSize: 15, borderBottom: '1px solid var(--border)' }}
        onClick={() => { onMute(); onClose() }}
      >
        🔕 Заглушить
      </button>
      <button
        style={{ width: '100%', textAlign: 'left', padding: '14px 18px', fontSize: 15, color: 'var(--danger)' }}
        onClick={() => { onRemove(); onClose() }}
      >
        🗑 Удалить из друзей
      </button>
    </div>
  )
}

export default function FriendAccount({ friend, onClose, onRemoved }) {
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const [date, setDate] = useState(keyOf())
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const el = document.documentElement
    const n = Number(el.dataset.overlayCount || 0) + 1
    el.dataset.overlayCount = n
    el.classList.add('has-overlay')
    return () => {
      const next = Number(el.dataset.overlayCount || 1) - 1
      el.dataset.overlayCount = next
      if (next <= 0) el.classList.remove('has-overlay')
    }
  }, [])

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 240)
  }
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
    return () => { cancelled = true }
  }, [friend.id])

  // Закрыть меню по клику вне
  useEffect(() => {
    if (!menuOpen) return
    const handle = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [menuOpen])

  const handleRemove = async () => {
    setBusy(true)
    await removeFriendship(friend.rowId)
    setBusy(false)
    setClosing(true)
    setTimeout(onRemoved, 240)
  }

  const handleMute = () => {
    // TODO: mute feature (placeholder)
    alert('Скоро появится!')
  }

  const p = state?.profile || {}
  const name = p.name || friend.name || 'Друг'
  const avatar = p.avatar || friend.avatar
  const day = state?.days?.[date] || { meals: [] }
  const totals = sumDay(day.meals || [])
  const target = p.targets?.calories

  return (
    <div className={closing ? 'chat-overlay closing' : 'chat-overlay'}>
      {/* Header */}
      <header className="chat-header">
        <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }}>‹</button>

        <div className="row gap10" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
          <Avatar src={avatar} name={name} size={36} />
          <div style={{ fontWeight: 620, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
        </div>

        {/* ⋯ меню */}
        <div ref={menuRef} style={{ position: 'relative', flex: '0 0 auto' }}>
          <button
            className="iconbtn"
            aria-label="Действия"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <DotsMenu
              onMute={handleMute}
              onRemove={handleRemove}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 20px 32px' }}>
        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</p>
        ) : !state ? (
          <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
        ) : (
          <>
            {/* Профиль */}
            {(p.bio || p.favRestaurant || p.favDish) && (
              <div className="card" style={{ marginBottom: 16 }}>
                {p.bio && (
                  <p style={{ fontSize: 14, lineHeight: 1.45, marginBottom: p.favRestaurant || p.favDish ? 10 : 0, whiteSpace: 'pre-wrap' }}>{p.bio}</p>
                )}
                {p.favRestaurant && (
                  <div className="row gap8" style={{ alignItems: 'center', marginTop: p.bio ? 8 : 0 }}>
                    <span>🍴</span>
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>Любимый ресторан</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.favRestaurant}</div>
                    </div>
                  </div>
                )}
                {p.favDish && (
                  <div className="row gap8" style={{ alignItems: 'center', marginTop: 8 }}>
                    <span>🍲</span>
                    <div>
                      <div className="muted" style={{ fontSize: 11 }}>Любимое блюдо</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{p.favDish}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Навигация по дням */}
            <div className="row between" style={{ alignItems: 'center', marginBottom: 14 }}>
              <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Раньше">‹</button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600 }}>{humanDay(date, today)}</div>
                <div className="muted" style={{ fontSize: 12 }}>{humanDow(date)}</div>
              </div>
              <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Позже">›</button>
            </div>

            {/* Нутриенты */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="row gap8" style={{ justifyContent: 'space-around' }}>
                <Stat label="ккал" v={totals.kcal} />
                <Stat label="белки" v={totals.protein} />
                <Stat label="угл." v={totals.carbs} />
                <Stat label="жиры" v={totals.fat} />
              </div>
              {target && (
                <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Цель: {target} ккал</p>
              )}
            </div>

            {/* Приёмы пищи */}
            <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Приёмы пищи
            </div>
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
                    <div className="row between" style={{ alignItems: 'center', padding: '10px 2px' }}>
                      <div className="row gap10" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 22 }}>{m.emoji || '🍽️'}</span>
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
                      <span className="tabular" style={{ fontWeight: 600, flex: '0 0 auto' }}>{m.kcal} ккал</span>
                    </div>
                    {isExpanded && customFood && (
                      <div style={{ padding: '6px 8px 10px 36px', background: 'var(--surface-2)', borderRadius: 10, marginBottom: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Состав блюда:</div>
                        <div style={{ fontSize: 13, marginBottom: 4 }}>🍞 {customFood.recipe.base} × {customFood.recipe.slices} шт.</div>
                        {(customFood.recipe.items || []).filter((i) => i.count > 0).map((i) => (
                          <div key={i.name} style={{ fontSize: 13, marginBottom: 2 }}>· {i.name} × {i.count}</div>
                        ))}
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
