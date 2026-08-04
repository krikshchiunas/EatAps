import { useState, useEffect, useRef } from 'react'
import { pullFriendState, removeFriendship, sendChatMessage } from '../lib/supabase.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { Avatar } from './FriendsScreen.jsx'
import { useStore } from '../store.jsx'

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
        Заглушить
      </button>
      <button
        style={{ width: '100%', textAlign: 'left', padding: '14px 18px', fontSize: 15, color: 'var(--danger)' }}
        onClick={() => { onRemove(); onClose() }}
      >
        Удалить из друзей
      </button>
    </div>
  )
}

const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '💪']

function MealReactSheet({ meal, friend, myId, onClose }) {
  const [picked, setPicked] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)

  const send = async () => {
    const emoji = picked || ''
    const message = [emoji, text.trim()].filter(Boolean).join(' ')
    if (!message) return
    setSending(true)
    setErr(null)
    const res = await sendChatMessage({
      sender: myId,
      recipient: friend.id,
      text: message,
      mealRef: { emoji: meal.emoji || '🍽️', name: meal.name, kcal: meal.kcal },
    })
    setSending(false)
    if (res.error) { setErr(res.error); return }
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Meal preview card */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 14, padding: '12px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{meal.emoji || '🍽️'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meal.name}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{meal.kcal} ккал{meal.grams ? ` · ${meal.grams} ${meal.unit || 'г'}` : ''}</div>
          </div>
        </div>

        {/* Quick emoji reactions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              onClick={() => setPicked(picked === e ? null : e)}
              style={{
                fontSize: 28, width: 50, height: 50, borderRadius: '50%',
                background: picked === e ? 'var(--primary-weak)' : 'var(--surface-2)',
                border: picked === e ? '2px solid var(--primary)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Text input */}
        <div style={{ marginBottom: 14 }}>
          <input
            className="input"
            placeholder="Написать комментарий…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            style={{ height: 46, fontSize: 15 }}
            autoFocus
          />
        </div>

        {err && <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</div>}

        <button
          className="btn"
          disabled={sending || (!picked && !text.trim())}
          onClick={send}
        >
          {sending ? 'Отправляю…' : 'Отправить в чат'}
        </button>
      </div>
    </div>
  )
}

export default function FriendAccount({ friend, onClose, onRemoved }) {
  const { user } = useStore()
  const myId = user?.id || ''
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const [date, setDate] = useState(keyOf())
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState(null)
  const [reactingMeal, setReactingMeal] = useState(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef(null)

  const { bind, style: swipeStyle, close: handleClose } = useSwipeBack(onClose)

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
    onRemoved()
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
    <>
    <div className="chat-overlay" style={swipeStyle} {...bind}>
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
                      <div className="row gap10" style={{ alignItems: 'center', flex: '0 0 auto' }}>
                        <span className="tabular" style={{ fontWeight: 600 }}>{m.kcal} ккал</span>
                        <button
                          onClick={() => setReactingMeal(m)}
                          style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}
                          aria-label="Отреагировать"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                        </button>
                      </div>
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

    {reactingMeal && (
      <MealReactSheet
        meal={reactingMeal}
        friend={friend}
        myId={myId}
        onClose={() => setReactingMeal(null)}
      />
    )}
    </>
  )
}
