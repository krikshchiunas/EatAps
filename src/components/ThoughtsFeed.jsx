// ─────────────────────────────────────────────────────────────────────────────
// «Мои мысли» — лента постов человека: фото и/или текст, реакции и ответы.
//
// Про 🥕 и 🥦. Морковка уже есть в языке приложения (реакция в чате), и здесь
// она значит то же самое — «мне нравится». Брокколи значит «не моё», а НЕ «ты
// плохо питаешься»: это оценка вкуса отвечающего, а не питания автора.
// Поэтому в интерфейсе нет ни рейтинга, ни доли, ни слова «дизлайк», а цифра
// рядом с 🥦 — счётчик такой же нейтральный, как у 🥕. Кто именно отреагировал,
// не показывается никому: сервер отдаёт только числа (см. миграцию).
//
// Реакция на ЕДУ здесь ни при чём — она остаётся личным сообщением в чат
// (MealReactSheet). Публично реагируют только на мысли.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store.jsx'
import {
  listPosts, createPost, updatePost, deletePost, togglePostReaction,
  listPostComments, addPostComment, deletePostComment, uploadPostImage,
} from '../lib/supabase.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { Avatar } from './FriendsScreen.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const MAX_TEXT = 2000

function timeAgo(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ── Создание и правка мысли ───────────────────────────────────────────────────
function ComposerSheet({ post, userId, onClose, onSaved }) {
  const [text, setText] = useState(post?.text || '')
  const [imageUrl, setImageUrl] = useState(post?.image_url || null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  const pickImage = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(null)
    setBusy(true)
    try {
      setImageUrl(await uploadPostImage(userId, file))
    } catch (ex) {
      setErr(ex.message || 'Не удалось загрузить фото')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setErr(null)
    const res = post
      ? await updatePost(post.id, { text, imageUrl })
      : await createPost({ userId, text, imageUrl })
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    onSaved(res.ok, Boolean(post))
    onClose()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <h2 className="h2" style={{ fontSize: 18 }}>{post ? 'Изменить мысль' : 'Новая мысль'}</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        <textarea
          className="input"
          placeholder="О чём думаете? Что сегодня ели и почему именно это…"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
          rows={4}
          style={{ resize: 'none', minHeight: 96, paddingTop: 12, lineHeight: 1.45, marginBottom: 12 }}
          autoFocus
        />

        {imageUrl && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <img src={imageUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14, display: 'block' }} />
            <button
              onClick={() => setImageUrl(null)}
              style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 15 }}
              aria-label="Убрать фото"
            >
              ✕
            </button>
          </div>
        )}

        {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

        <div className="row gap8">
          <button className="btn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '0 18px' }} disabled={busy} onClick={() => fileRef.current?.click()}>
            📷 Фото
          </button>
          <button className="btn" style={{ flex: 1 }} disabled={busy || (!text.trim() && !imageUrl)} onClick={save}>
            {busy ? 'Сохраняем…' : post ? 'Сохранить' : 'Опубликовать'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

// ── Ответы ────────────────────────────────────────────────────────────────────
function Comments({ post, myId, isPostOwner, onCountChange }) {
  // Своё имя и фото берём из своего профиля: сервер вернёт их при следующей
  // загрузке ветки, а до тех пор только что отправленный ответ не должен
  // выглядеть как чужой безымянный.
  const { profile } = useStore()
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    listPostComments(post.id)
      .then((rows) => { if (!cancelled) setItems(rows) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [post.id])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setErr(null)
    const res = await addPostComment({ postId: post.id, userId: myId, text: body })
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    setText('')
    setItems((prev) => [...(prev || []), {
      ...res.ok,
      author_name: profile?.name || null,
      author_avatar: profile?.avatar || null,
    }])
    onCountChange(+1)
  }

  const remove = async (id) => {
    const res = await deletePostComment(id)
    if (res.error) { setErr(res.error); return }
    setItems((prev) => (prev || []).filter((c) => c.id !== id))
    onCountChange(-1)
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      {items === null ? (
        <p className="muted" style={{ fontSize: 13 }}>Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Ответов пока нет.</p>
      ) : (
        items.map((c) => (
          <div key={c.id} className="row gap10" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
            <Avatar src={c.author_avatar} name={c.author_name} size={28} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row gap8" style={{ alignItems: 'baseline' }}>
                <span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.author_name || 'Пользователь'}</span>
                <span className="muted" style={{ fontSize: 11 }}>{timeAgo(c.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
            </div>
            {(c.user_id === myId || isPostOwner) && (
              <button style={{ fontSize: 12, color: 'var(--ink-3)', flex: '0 0 auto' }} onClick={() => remove(c.id)} aria-label="Удалить ответ">✕</button>
            )}
          </div>
        ))
      )}

      {myId && (
        <div className="row gap8" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder="Ответить…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            style={{ height: 42, fontSize: 14, flex: 1 }}
          />
          <button className="btn" style={{ width: 'auto', height: 42, padding: '0 16px', fontSize: 14, flex: '0 0 auto' }} disabled={busy || !text.trim()} onClick={send}>
            →
          </button>
        </div>
      )}
      {err && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
    </div>
  )
}

// ── Одна мысль ────────────────────────────────────────────────────────────────
function PostCard({ post, myId, isOwnProfile, authorName, authorAvatar, onChange, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [err, setErr] = useState(null)

  const react = async (emoji) => {
    setErr(null)
    const res = await togglePostReaction(post.id, emoji)
    if (res.error) { setErr(res.error); return }
    if (res.ok) {
      onChange({ ...post, carrots: res.ok.carrots, broccoli: res.ok.broccoli, my_reaction: res.ok.mine })
    }
  }

  const btn = (emoji, count, label) => {
    const mine = post.my_reaction === emoji
    return (
      <button
        onClick={() => react(emoji)}
        aria-label={label}
        title={label}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: 34, padding: '0 12px', borderRadius: 999,
          border: `1.5px solid ${mine ? 'var(--primary)' : 'var(--border)'}`,
          background: mine ? 'var(--primary-weak)' : 'var(--surface-2)',
          color: mine ? 'var(--primary-strong)' : 'var(--ink-2)',
          fontSize: 14, fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 16 }}>{emoji}</span>
        {count > 0 && <span className="tabular">{count}</span>}
      </button>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div className="row gap10" style={{ alignItems: 'center', minWidth: 0 }}>
          <Avatar src={authorAvatar} name={authorName} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorName}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {timeAgo(post.created_at)}{post.edited_at ? ' · изменено' : ''}
            </div>
          </div>
        </div>
        {isOwnProfile && (
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setMenu((m) => !m)} aria-label="Действия с мыслью">⋯</button>
            {menu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setMenu(false)} />
                <div className="friend-menu" style={{ minWidth: 170 }}>
                  <button onClick={() => { setMenu(false); onEdit(post) }}>✏️ Изменить</button>
                  <button className="danger" onClick={() => { setMenu(false); onDelete(post) }}>🗑️ Удалить</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {post.text && (
        <p style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: post.image_url ? 10 : 0 }}>
          {post.text}
        </p>
      )}
      {post.image_url && (
        <img src={post.image_url} alt="" loading="lazy" style={{ width: '100%', maxHeight: 380, objectFit: 'cover', borderRadius: 14, display: 'block' }} />
      )}

      <div className="row gap8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {btn('🥕', post.carrots, 'Мне нравится')}
        {btn('🥦', post.broccoli, 'Не моё')}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px',
            borderRadius: 999, border: '1.5px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--ink-2)', fontSize: 14, fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 15 }}>💬</span>
          {post.comments_count > 0 && <span className="tabular">{post.comments_count}</span>}
        </button>
      </div>

      {err && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</p>}

      {open && (
        <Comments
          post={post}
          myId={myId}
          isPostOwner={post.user_id === myId}
          onCountChange={(d) => onChange({ ...post, comments_count: Math.max(0, (post.comments_count || 0) + d) })}
        />
      )}
    </div>
  )
}

// ── Лента ─────────────────────────────────────────────────────────────────────
export default function ThoughtsFeed({ userId, isOwnProfile, authorName, authorAvatar }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [posts, setPosts] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState(null)
  const [composer, setComposer] = useState(null) // null | { post } | { post: null }
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    if (!userId) { setPosts([]); return }
    try {
      const res = await listPosts(userId)
      setPosts(res.posts)
      setUnavailable(Boolean(res.unavailable))
    } catch {
      setPosts([])
      setErr('Не удалось загрузить мысли')
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const replace = (next) => setPosts((prev) => (prev || []).map((p) => (p.id === next.id ? next : p)))

  const remove = async (post) => {
    const res = await deletePost(post.id)
    if (res.error) { setErr(res.error); return }
    setPosts((prev) => (prev || []).filter((p) => p.id !== post.id))
  }

  // Без аккаунта мысли не существуют: они живут в облаке и адресованы друзьям.
  if (!supabaseEnabled || !myId) {
    return (
      <div className="card">
        <p className="muted" style={{ fontSize: 14 }}>
          Войдите в аккаунт, чтобы публиковать мысли и отвечать друзьям.
        </p>
      </div>
    )
  }

  if (unavailable) {
    return (
      <div className="card">
        <p className="muted" style={{ fontSize: 14 }}>Раздел пока недоступен.</p>
      </div>
    )
  }

  return (
    <>
      {isOwnProfile && (
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => setComposer({ post: null })}>
          ＋ Новая мысль
        </button>
      )}

      {posts === null ? (
        <p className="muted" style={{ fontSize: 14 }}>Загрузка…</p>
      ) : posts.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 14 }}>
            {isOwnProfile
              ? 'Здесь появятся ваши мысли — фото и заметки, которые видят друзья.'
              : 'Пока ни одной мысли.'}
          </p>
        </div>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            myId={myId}
            isOwnProfile={isOwnProfile}
            authorName={authorName}
            authorAvatar={authorAvatar}
            onChange={replace}
            onEdit={(post) => setComposer({ post })}
            onDelete={(post) => setConfirmDelete(post)}
          />
        ))
      )}

      {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>{err}</p>}

      {composer && (
        <ComposerSheet
          post={composer.post}
          userId={myId}
          onClose={() => setComposer(null)}
          onSaved={(row, edited) => {
            if (edited) replace({ ...row, carrots: composer.post.carrots, broccoli: composer.post.broccoli, my_reaction: composer.post.my_reaction, comments_count: composer.post.comments_count })
            else setPosts((prev) => [row, ...(prev || [])])
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          text="Удалить эту мысль? Ответы и реакции на неё тоже исчезнут."
          onYes={() => { const p = confirmDelete; setConfirmDelete(null); remove(p) }}
          onNo={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
