import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store.jsx'
import { listMessagesWith, sendChatMessage, subscribeToChat, uploadChatImage } from '../lib/supabase.js'
import { Avatar } from './FriendsScreen.jsx'

function timeShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.toDateString() === db.toDateString()
}

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === y.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export default function ChatView({ friend, onClose }) {
  const { user } = useStore()
  const myId = user?.id || ''
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)
  const [preview, setPreview] = useState(null) // { url, file }
  const listRef = useRef(null)
  const fileRef = useRef(null)

  const scrollToBottom = (smooth = false) => {
    const el = listRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listMessagesWith(myId, friend.id)
        if (!cancelled) {
          setMessages(rows)
          scrollToBottom()
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Не удалось загрузить сообщения')
      }
    })()
    const unsub = subscribeToChat(myId, friend.id, (m) => {
      setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
      scrollToBottom(true)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [myId, friend.id])

  const pickPhoto = () => fileRef.current?.click()

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type?.startsWith('image/')) { setErr('Это не изображение'); return }
    setPreview({ url: URL.createObjectURL(f), file: f })
  }

  const clearPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const send = async () => {
    if (sending) return
    const t = text.trim()
    if (!t && !preview) return
    setSending(true)
    setErr(null)
    try {
      let imageUrl = null
      if (preview?.file) imageUrl = await uploadChatImage(myId, preview.file)
      const res = await sendChatMessage({ sender: myId, recipient: friend.id, text: t, imageUrl })
      if (res.error) {
        setErr(res.error)
      } else {
        setMessages((cur) => (cur.some((x) => x.id === res.ok.id) ? cur : [...cur, res.ok]))
        setText('')
        clearPreview()
        scrollToBottom(true)
      }
    } catch (e) {
      setErr(e.message || 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat-overlay">
      <header className="chat-header">
        <button className="iconbtn" onClick={onClose} aria-label="Назад">‹</button>
        <div className="row gap12" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
          <Avatar src={friend.avatar} name={friend.name} size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{friend.name || 'Друг'}</div>
          </div>
        </div>
      </header>

      <div className="chat-list" ref={listRef}>
        {err && <div className="chat-error">{err}</div>}
        {messages.length === 0 && !err && (
          <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '32px 12px' }}>Сообщений пока нет. Напишите первым 👋</p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender === myId
          const prev = messages[i - 1]
          const showDay = !prev || !isSameDay(prev.created_at, m.created_at)
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
              <div className={mine ? 'chat-bubble mine' : 'chat-bubble theirs'}>
                {m.image_url && (
                  <a href={m.image_url} target="_blank" rel="noreferrer" className="chat-img-wrap">
                    <img src={m.image_url} alt="" className="chat-img" />
                  </a>
                )}
                {m.text && <div className="chat-text">{m.text}</div>}
                <div className="chat-time">{timeShort(m.created_at)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="chat-inputbar">
        {preview && (
          <div className="chat-preview">
            <img src={preview.url} alt="" />
            <button className="chat-preview-x" onClick={clearPreview} aria-label="Убрать фото">✕</button>
          </div>
        )}
        <div className="row gap8" style={{ width: '100%' }}>
          <button className="iconbtn" onClick={pickPhoto} disabled={sending} aria-label="Фото">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="15" rx="3" />
              <circle cx="12" cy="12.5" r="3.5" />
              <path d="M8 5 9.5 3h5L16 5" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            style={{ display: 'none' }}
          />
          <input
            className="input chat-input"
            placeholder="Сообщение…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={sending}
          />
          <button
            className="btn"
            style={{ width: 'auto', height: 44, padding: '0 18px' }}
            disabled={sending || (!text.trim() && !preview)}
            onClick={send}
          >
            {sending ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}
