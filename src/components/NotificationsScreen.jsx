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
  subscribeToNotifications,
} from '../lib/social.js'
import {
  notificationText, notificationTarget, groupNotifications,
  NOTIFICATION_GROUPS,
} from '../lib/notificationModel.js'
import { Avatar } from './FriendsScreen.jsx'
import { timeAgo } from './ThoughtsFeed.jsx'

const PAGE = 40

export default function NotificationsScreen({ onNavigate, onChanged }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [items, setItems] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [filter, setFilter] = useState('all')
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)      // есть ли что догружать
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    if (!supabaseEnabled || !myId) { setItems([]); return }
    setErr(null)
    try {
      const res = await listNotifications({ limit: PAGE })
      setUnavailable(Boolean(res.unavailable))
      setItems(res.items)
      setMore(res.items.length === PAGE)
    } catch (e) {
      // Сбой загрузки — не «событий пока нет». Раньше оба случая показывали
      // колокольчик и «Событий пока нет», то есть экран уверял, что ничего не
      // произошло, когда на самом деле не смог спросить.
      setErr(e.message || 'Не удалось загрузить события')
      setItems([])
    }
  }, [supabaseEnabled, myId])

  useEffect(() => { load() }, [load])

  // Догрузка более ранних. Раньше список обрывался на шестидесятом событии
  // без всякого признака, что дальше что-то есть.
  const loadMore = async () => {
    if (loadingMore || !items?.length) return
    setLoadingMore(true)
    try {
      const before = items[items.length - 1]?.created_at
      const res = await listNotifications({ limit: PAGE, before })
      setItems((prev) => {
        const seen = new Set((prev || []).map((n) => n.id))
        return [...(prev || []), ...res.items.filter((n) => !seen.has(n.id))]
      })
      setMore(res.items.length === PAGE)
    } catch (e) {
      setErr(e.message || 'Не удалось догрузить')
    } finally {
      setLoadingMore(false)
    }
  }

  // Новое событие приезжает по realtime — список обновляется, пока экран
  // открыт. Без этого человек смотрел на «События» и не видел того, о чём в
  // ту же секунду загорался бейдж в навигации.
  //
  // Перечитываем ТОЛЬКО первую страницу и подмешиваем её к уже показанному.
  // Полная перезагрузка выбросила бы догруженные страницы, и список схлопнулся
  // бы под пальцем у того, кто как раз до них долистал.
  useEffect(() => {
    if (!myId) return
    return subscribeToNotifications(myId, async () => {
      try {
        const res = await listNotifications({ limit: PAGE })
        setItems((prev) => {
          if (!prev) return res.items
          const fresh = new Map(res.items.map((n) => [n.id, n]))
          // Уже показанные строки обновляем на месте (могло смениться read_at),
          // новые добавляем сверху — порядок «сначала новые» сохраняется.
          const updated = prev.map((n) => fresh.get(n.id) || n)
          const known = new Set(prev.map((n) => n.id))
          return [...res.items.filter((n) => !known.has(n.id)), ...updated]
        })
      } catch { /* обновление не приехало — список остаётся прежним */ }
    })
  }, [myId])

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

      {items === null && [0, 1, 2, 3].map((i) => (
        <div key={i} className="row gap10" style={{ alignItems: 'center', padding: '11px 10px' }}>
          <div className="skel" style={{ width: 40, height: 40, borderRadius: '50%', flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ width: '68%', height: 12, borderRadius: 6, marginBottom: 6 }} />
            <div className="skel" style={{ width: '24%', height: 10, borderRadius: 5 }} />
          </div>
        </div>
      ))}

      {err && items?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 8px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📡</div>
          <p style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 14 }}>{err}</p>
          <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={load}>
            Повторить
          </button>
        </div>
      )}

      {!err && items?.length === 0 && (
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

      {/* Догрузка только в общем списке: фильтр показывает уже загруженное, и
          кнопка «показать ещё» под ним обещала бы не то, что делает. */}
      {filter === 'all' && more && items?.length > 0 && (
        <button
          className="btn ghost"
          style={{ width: 'auto', padding: '0 22px', margin: '12px auto 0' }}
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}

      {err && items?.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>{err}</p>
      )}
    </div>
  )
}
