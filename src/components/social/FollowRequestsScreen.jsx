// Просьбы о подписке — экран владельца закрытого аккаунта.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ОДОБРЕНИЕ — ОДИН ВЫЗОВ, А НЕ ДВА
//
// Одобрить просьбу значит СНЯТЬ строку просьбы и СОЗДАТЬ подписку. Двумя
// клиентскими запросами это делать нельзя: обрыв связи между ними оставляет
// человека без подписки и без просьбы — то есть без возможности повторить, и
// без всякого следа, что он вообще просился. Поэтому accept_follow_request —
// одна транзакция на сервере, а здесь только кнопка.
//
// Оптимистично убираем строку из списка сразу: решение уже принято, и держать
// её на экране «до подтверждения» значит предлагать нажать второй раз.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { listFollowRequests, acceptFollowRequest, declineFollowRequest } from '../../lib/social.js'
import { Avatar, LockBadge } from '../Avatar.jsx'
import { PersonRowSkeleton } from '../PeopleList.jsx'

const PAGE = 30

export default function FollowRequestsScreen({ onOpenProfile, onChanged }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!supabaseEnabled || !myId) { setItems([]); return }
    setErr(null)
    try {
      const rows = await listFollowRequests({ limit: PAGE })
      setItems(rows)
      setMore(rows.length === PAGE)
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить запросы')
      setItems([])
    }
  }, [supabaseEnabled, myId])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (!items?.length) return
    try {
      const rows = await listFollowRequests({ limit: PAGE, offset: items.length })
      const seen = new Set(items.map((x) => x.user_id))
      setItems([...items, ...rows.filter((r) => !seen.has(r.user_id))])
      setMore(rows.length === PAGE)
    } catch (e) { setErr(e.message || 'Не удалось догрузить') }
  }

  const decide = async (person, accept) => {
    if (busyId) return
    setBusyId(person.user_id)
    const prev = items
    setItems((list) => (list || []).filter((x) => x.user_id !== person.user_id))
    const res = accept
      ? await acceptFollowRequest(person.user_id)
      : await declineFollowRequest(person.user_id)
    setBusyId(null)
    if (res?.error) {
      setErr(res.error)
      setItems(prev) // откат: строка возвращается на место
      return
    }
    onChanged?.()
  }

  if (items === null) {
    return <div>{[0, 1, 2].map((i) => <PersonRowSkeleton key={i} />)}</div>
  }

  if (err && items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 8px' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
        <p style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 14 }}>{err}</p>
        <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={load}>
          Повторить
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 12px' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          Запросов нет. Сюда попадают те, кто хочет подписаться на ваш закрытый аккаунт.
        </p>
      </div>
    )
  }

  return (
    <div>
      {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

      {items.map((p) => {
        const name = p.display_name || p.username || 'Без имени'
        return (
          <div key={p.user_id} className="row between" style={{ alignItems: 'center', gap: 10, padding: '10px 0' }}>
            <button
              onClick={() => onOpenProfile?.(p.user_id)}
              className="row gap10"
              style={{
                alignItems: 'center', minWidth: 0, flex: 1, background: 'none', border: 0,
                padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer', minHeight: 48,
              }}
            >
              <Avatar src={p.avatar_url} name={name} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {p.is_private && <LockBadge />}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{p.username}</div>
              </div>
            </button>

            <div className="row gap8" style={{ flex: '0 0 auto' }}>
              <button
                className="btn"
                style={{ width: 'auto', height: 32, padding: '0 14px', fontSize: 13.5 }}
                disabled={busyId === p.user_id}
                onClick={() => decide(p, true)}
              >
                Принять
              </button>
              <button
                className="btn ghost"
                style={{ width: 'auto', height: 32, padding: '0 14px', fontSize: 13.5 }}
                disabled={busyId === p.user_id}
                onClick={() => decide(p, false)}
              >
                Удалить
              </button>
            </div>
          </div>
        )
      })}

      {more && (
        <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '12px auto 0' }} onClick={loadMore}>
          Показать ещё
        </button>
      )}
    </div>
  )
}
