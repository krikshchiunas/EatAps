import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { listFriendships, listConversations } from '../lib/supabase.js'
import { Avatar } from './FriendsScreen.jsx'
import ChatView from './ChatView.jsx'

function preview(m) {
  if (!m) return ''
  if (m.image_url && !m.text) return '📷 Фото'
  if (m.image_url && m.text) return `📷 ${m.text}`
  return m.text || ''
}

function timeShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const diff = (now - d) / 86400000
  if (diff < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' })
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export default function ChatsScreen() {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''
  const [friends, setFriends] = useState([])
  const [convs, setConvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [openFriend, setOpenFriend] = useState(null)

  const reload = async () => {
    try {
      setLoading(true)
      const [f, c] = await Promise.all([listFriendships(myId), listConversations(myId)])
      setFriends(f.friends || [])
      setConvs(c || [])
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

  // Список чатов = друзья, отсортированные по времени последнего сообщения.
  const rows = useMemo(() => {
    const lastById = new Map(convs.map((c) => [c.id, c.last]))
    return [...friends]
      .map((f) => ({ ...f, last: lastById.get(f.id) || null }))
      .sort((a, b) => {
        const ta = a.last ? Date.parse(a.last.created_at) : 0
        const tb = b.last ? Date.parse(b.last.created_at) : 0
        if (ta !== tb) return tb - ta
        return (a.name || '').localeCompare(b.name || '')
      })
  }, [friends, convs])

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen">
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Чаты</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Войдите в аккаунт (вкладка «Профиль»), чтобы переписываться с друзьями.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <h1 className="h1" style={{ margin: '4px 0 18px' }}>Чаты</h1>

      {loading ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>Пока нет друзей — добавьте кого-нибудь во вкладке «Друзья», чтобы начать переписку.</p>
        </div>
      ) : (
        rows.map((f) => (
          <button
            key={f.id}
            className="card"
            style={{ marginBottom: 8, padding: 12, width: '100%', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'center' }}
            onClick={() => setOpenFriend({ id: f.id, name: f.name, avatar: f.avatar })}
          >
            <Avatar src={f.avatar} name={f.name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || 'Друг'}</div>
                {f.last && <div className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>{timeShort(f.last.created_at)}</div>}
              </div>
              <div className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.last ? (f.last.sender === myId ? 'Вы: ' : '') + preview(f.last) : 'Начните переписку'}
              </div>
            </div>
          </button>
        ))
      )}

      {openFriend && (
        <ChatView friend={openFriend} onClose={() => { setOpenFriend(null); reload() }} />
      )}
    </div>
  )
}
