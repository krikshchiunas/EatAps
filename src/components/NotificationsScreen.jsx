// Центр событий: заявки, подписки, реакции, ответы, сообщения.
//
// Источник истины — таблица notifications на сервере, а не localStorage.
// Разница видна сразу: событие, прочитанное на телефоне, считается прочитанным
// и на ноутбуке, а список переживает и перезагрузку, и повторный вход.
//
// Нажатие ведёт ПРЯМО к объекту события — за это отвечает notificationTarget.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store.jsx'
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
} from '../lib/social.js'
import {
  notificationText, notificationTarget, groupNotifications,
  NOTIFICATION_GROUPS,
} from '../lib/notificationModel.js'
import { Avatar } from './FriendsScreen.jsx'
import { timeAgo } from './ThoughtsFeed.jsx'

export default function NotificationsScreen({ onNavigate, onChanged }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [items, setItems] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [filter, setFilter] = useState('all')
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    if (!supabaseEnabled || !myId) { setItems([]); return }
    try {
      const res = await listNotifications({ limit: 60 })
      setUnavailable(Boolean(res.unavailable))
      setItems(res.items)
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить события')
      setItems([])
    }
  }, [supabaseEnabled, myId])

  useEffect(() => { load() }, [load])

  const open = async (n) => {
    // Помечаем прочитанным оптимистично: человек уже увидел событие в тот
    // момент, когда по нему нажал, и ждать сервера, чтобы убрать точку,
    // незачем.
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      markNotificationRead(n.id).then(() => onChanged?.())
    }
    const target = notificationTarget(n)
    if (target) onNavigate?.(target)
  }

  const readAll = async () => {
    setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })))
    await markAllNotificationsRead()
    onChanged?.()
  }

  if (unavailable) {
    return <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '32px 16px' }}>
      Раздел пока недоступен — база ещё не обновлена.
    </p>
  }

  const grouped = groupNotifications(items || [])
  const shown = filter === 'all'
    ? (items || [])
    : (grouped[filter] || [])
  const unread = (items || []).filter((n) => !n.read_at).length

  return (
    <div>
      <div className="row between" style={{ alignItems: 'center', marginBottom: 12, gap: 10 }}>
        <div className="row gap8" style={{ flexWrap: 'wrap', minWidth: 0 }}>
          <button className={`pill${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            Все{unread > 0 ? ` · ${unread}` : ''}
          </button>
          {NOTIFICATION_GROUPS.map((g) => (
            grouped[g.key].length > 0 && (
              <button key={g.key} className={`pill${filter === g.key ? ' on' : ''}`} onClick={() => setFilter(g.key)}>
                {g.label}
              </button>
            )
          ))}
        </div>
        {unread > 0 && (
          <button className="btn ghost" style={{ width: 'auto', height: 32, padding: '0 12px', fontSize: 13, flex: '0 0 auto' }} onClick={readAll}>
            Прочитать всё
          </button>
        )}
      </div>

      {items === null && <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 0' }}>Загружаем…</p>}

      {items?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 8px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🔔</div>
          <p className="muted" style={{ fontSize: 14 }}>Событий пока нет.</p>
        </div>
      )}

      {shown.map((n) => (
        <button
          key={n.id}
          onClick={() => open(n)}
          className="row gap10"
          style={{
            width: '100%', alignItems: 'center', textAlign: 'left',
            padding: '11px 10px', marginBottom: 2, borderRadius: 14, border: 0,
            background: n.read_at ? 'transparent' : 'var(--primary-weak)',
            color: 'inherit', cursor: 'pointer',
          }}
        >
          <Avatar src={n.actor_avatar} name={n.actor_name || n.actor_username} size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 640 }}>{n.actor_name || n.actor_username || 'Кто-то'}</span>
              {' '}
              <span style={{ color: 'var(--ink-2)' }}>{notificationText(n)}</span>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>{timeAgo(n.created_at)}</div>
          </div>
          {!n.read_at && (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flex: '0 0 auto' }} />
          )}
        </button>
      ))}

      {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>{err}</p>}
    </div>
  )
}
