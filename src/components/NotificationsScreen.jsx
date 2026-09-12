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
import { acceptFollowRequest, declineFollowRequest, follow } from '../lib/social.js'
import {
  notificationText, notificationTarget, notificationActions,
  groupNotifications, groupByTime, NOTIFICATION_GROUPS, TIME_BUCKETS,
} from '../lib/notificationModel.js'
import { Avatar } from './Avatar.jsx'
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
  const [busyId, setBusyId] = useState(null)
  // Кому уже ответили подпиской. Объявлено ЗДЕСЬ, вместе с остальными
  // состояниями, а не ниже по телу компонента, где оно стояло раньше: там
  // объявление оказалось ПОСЛЕ раннего return для недоступного раздела. Хук,
  // который на одних отрисовках вызывается, а на других нет, ломает порядок
  // хуков — React связывает состояние с позицией вызова, и после первой же
  // отрисовки с недоступным разделом состояния разъезжаются между собой.
  const [followed, setFollowed] = useState(() => new Set())

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

  // Решение по просьбе прямо в строке. Строка исчезает оптимистично: решение
  // уже принято, и держать её на экране «до подтверждения» значит предлагать
  // нажать второй раз.
  // «Подписаться в ответ» показываем только там, где это ещё имеет смысл:
  // после нажатия строка остаётся, и вторая кнопка на ней была бы обманом.
  // Отношение здесь не спрашиваем — это стоило бы запроса на каждую строку
  // списка; вместо этого кнопка исчезает после нажатия.
  const rowActions = (n) => notificationActions(n)
    .filter((a) => !(a.key === 'follow' && followed.has(n.actor_id)))

  const decide = async (n, what) => {
    if (busyId) return
    setBusyId(n.id)
    const prev = items
    // Просьба разобрана — строка уходит. Подписка в ответ строку НЕ убирает:
    // событие «на вас подписались» осталось правдой.
    if (what !== 'follow') setItems((list) => (list || []).filter((x) => x.id !== n.id))
    const res = what === 'accept' ? await acceptFollowRequest(n.actor_id)
      : what === 'decline' ? await declineFollowRequest(n.actor_id)
      : await follow(n.actor_id)
    setBusyId(null)
    if (res?.error) { setErr(res.error); if (what !== 'follow') setItems(prev); return }
    if (what === 'follow') setFollowed((s) => new Set(s).add(n.actor_id))
    onChanged?.()
  }

  const grouped = groupNotifications(items || [])
  const shown = filter === 'all'
    ? (items || [])
    : (grouped[filter] || [])
  const unread = (items || []).filter((n) => !n.read_at).length
  // Внутри выбранного фильтра события разложены по давности. Это единственная
  // группировка, которая не требует от человека ничего выбирать: свежее всегда
  // сверху и всегда отделено от старого.
  const byTime = groupByTime(shown)

  const renderRow = (n) => (
    <div key={n.id} style={{ marginBottom: 2 }}>
      <button
        onClick={() => open(n)}
        className="row gap10"
        style={{
          width: '100%', alignItems: 'center', textAlign: 'left',
          padding: '11px 10px', borderRadius: 14, border: 0,
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

      {/* Решение прямо в строке — там, где событие требует ответа, а не
          просто перехода. Набор кнопок задаёт модель события, а не этот
          экран: иначе список «у каких типов есть кнопки» жил бы в двух
          местах и однажды разошёлся бы. */}
      {rowActions(n).length > 0 && (
        <div className="row gap8" style={{ padding: '0 10px 10px 60px' }}>
          {rowActions(n).map((a) => (
            <button
              key={a.key}
              className={`btn${a.tone === 'primary' ? '' : ' ghost'}`}
              style={{ width: 'auto', height: 32, padding: '0 14px', fontSize: 13.5 }}
              disabled={busyId === n.id}
              onClick={() => decide(n, a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

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

      {err && items?.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>
      )}

      {TIME_BUCKETS.map((b) => (
        byTime[b.key].length > 0 && (
          <div key={b.key}>
            <div className="muted" style={{
              fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
              textTransform: 'uppercase', margin: '14px 10px 6px',
            }}>
              {b.label}
            </div>
            {byTime[b.key].map(renderRow)}
          </div>
        )
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
    </div>
  )
}
