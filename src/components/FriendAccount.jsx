// Профиль друга = оболочка (панель, свайп-назад, шапка с ⋯) вокруг общего
// UserProfileView. Всё, что рисуется внутри, — тот же компонент, что рисует
// собственный профиль: свой и чужой профиль обязаны совпадать визуально, иначе
// человек не понимает, что именно видят о нём другие.
//
// Здесь остаётся только то, что специфично для чужого аккаунта: загрузка
// friend_state, меню «заглушить / удалить из друзей» и реакция на конкретную
// еду, которая уходит ЛИЧНЫМ сообщением в чат (MealReactSheet).
import { useState, useEffect, useRef } from 'react'
import { pullFriendState, removeFriendship, sendChatMessage } from '../lib/supabase.js'
import { normalizeError } from '../lib/authErrors.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { mealCardFromMeal } from '../lib/mealCard.js'
import { Avatar } from './FriendsScreen.jsx'
import UserProfileView from './UserProfileView.jsx'
import { useStore } from '../store.jsx'

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

function MealReactSheet({ meal, mealDate, friend, myId, onClose }) {
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
      // Единый формат карточки (v2) — тот же, что у «отправить приём пищи».
      // Раньше здесь строился плоский {name, emoji, kcal}, из-за чего в чате
      // жили две несовместимые карточки и две ветки отрисовки.
      mealRef: mealCardFromMeal(meal, mealDate),
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
        style={{ background: 'var(--surface-solid)', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', maxHeight: '80vh', overflowY: 'auto' }}
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [reacting, setReacting] = useState(null) // { meal, date }
  const menuRef = useRef(null)

  const { panelProps, scrimProps, close: handleClose } = useSwipeBack(onClose)
  useScrollLock()

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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await pullFriendState(friend.id)
        if (!cancelled) setState(res?.state || { days: {}, profile: null })
      } catch (e) {
        // Сырой текст Supabase наружу не показываем: там встречаются имена
        // таблиц и формулировки политик доступа.
        if (!cancelled) setErr(normalizeError(e).message)
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
    await removeFriendship(friend.rowId)
    onRemoved()
  }

  const handleMute = () => {
    // TODO: mute feature (placeholder)
    alert('Скоро появится!')
  }

  const p = state?.profile || {}
  const name = p.name || friend.name || 'Друг'
  const avatar = p.avatar || friend.avatar

  return (
    <>
    <div className="nav-scrim" {...scrimProps} />
    <div className="chat-overlay" {...panelProps}>
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
          <UserProfileView
            isOwnProfile={false}
            userId={friend.id}
            profile={{ ...p, name, avatar }}
            // Друг присылает дни без своих приёмов пищи — groupDayByMeal об
            // этом знает и ничего не теряет.
            dayOf={(date) => state.days?.[date] || { meals: [] }}
            // Вся история друга — из неё считаются «чаще/реже всего ем».
            // Отдельного запроса нет: friend_state и так присылает дни целиком.
            days={state.days}
            customFoods={state.customFoods || []}
            onReactToMeal={(meal, date) => setReacting({ meal, date })}
          />
        )}
      </div>
    </div>

    {reacting && (
      <MealReactSheet
        meal={reacting.meal}
        mealDate={reacting.date}
        friend={friend}
        myId={myId}
        onClose={() => setReacting(null)}
      />
    )}
    </>
  )
}
