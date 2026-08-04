import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { listFriendships, acceptFriend, removeFriendship } from '../lib/supabase.js'
import AddFriendSheet from './AddFriendSheet.jsx'
import ChatView from './ChatView.jsx'

export function Avatar({ src, name, size = 44 }) {
  if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--primary-weak)', color: 'var(--primary-strong)',
      display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 600, flex: '0 0 auto',
    }}>
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
  const [query, setQuery] = useState('')
  const [chatFriend, setChatFriend] = useState(null) // { id, name, avatar, rowId }

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return lists.friends
    return lists.friends.filter((f) => (f.name || '').toLowerCase().includes(q))
  }, [lists.friends, query])

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen">
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Друзья</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Войдите в аккаунт (вкладка «Профиль»), чтобы добавлять друзей.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'center', margin: '0 0 16px' }}>
        <h1 className="h1" style={{ margin: '4px 0 0' }}>Друзья</h1>
        <button
          className="btn"
          style={{ width: 'auto', height: 40, padding: '0 16px', fontSize: 14 }}
          onClick={() => setAddOpen(true)}
        >
          ＋ Добавить
        </button>
      </div>

      {/* Поиск */}
      <div className="field" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Поиск по нику…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ height: 46, fontSize: 15 }}
        />
      </div>

      {/* Входящие заявки */}
      {lists.incoming.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Заявки · {lists.incoming.length}
          </div>
          {lists.incoming.map((r) => (
            <div key={r.rowId} className="card" style={{ marginBottom: 8, padding: '10px 14px' }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <div className="row gap12" style={{ alignItems: 'center', minWidth: 0 }}>
                  <Avatar name={r.name} />
                  <div style={{ fontWeight: 600 }}>{r.name || 'Пользователь'}</div>
                </div>
                <div className="row gap8" style={{ flex: '0 0 auto' }}>
                  <button
                    className="btn"
                    style={{ width: 'auto', height: 36, padding: '0 14px', fontSize: 13 }}
                    disabled={busy}
                    onClick={() => act(() => acceptFriend(r.rowId))}
                  >
                    Принять
                  </button>
                  <button
                    className="btn ghost"
                    style={{ width: 'auto', height: 36, padding: '0 14px', fontSize: 13 }}
                    disabled={busy}
                    onClick={() => act(() => removeFriendship(r.rowId))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Список друзей */}
      {loading ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>
            {query ? 'Никого не нашли.' : 'Пока никого нет. Нажмите «＋ Добавить» и вставьте ID друга.'}
          </p>
        </div>
      ) : (
        filtered.map((f) => (
          <button
            key={f.rowId}
            className="card"
            style={{ marginBottom: 8, padding: '12px 14px', width: '100%', textAlign: 'left' }}
            onClick={() => setChatFriend({ id: f.id, name: f.name, avatar: f.avatar, rowId: f.rowId })}
          >
            <div className="row gap12" style={{ alignItems: 'center' }}>
              <Avatar src={f.avatar} name={f.name} />
              <div style={{ fontWeight: 600, fontSize: 16 }}>{f.name || 'Друг'}</div>
            </div>
          </button>
        ))
      )}

      {addOpen && <AddFriendSheet onClose={() => setAddOpen(false)} onSent={reload} />}

      {chatFriend && (
        <ChatView
          friend={chatFriend}
          onClose={() => setChatFriend(null)}
        />
      )}
    </div>
  )
}
