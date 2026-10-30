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
import { visibilityLabel, VISIBILITY, DEFAULT_VISIBILITY } from '../lib/relationship.js'
import { setPostVisibility } from '../lib/social.js'
import { t, fmtDate, locale, isRtl } from '../lib/i18n.js'

const MAX_TEXT = 2000

export function timeAgo(iso) {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('time.justNow')
  const ago = (n, unit) => new Intl.RelativeTimeFormat(locale(), { style: 'short' }).format(-n, unit)
  if (mins < 60) return ago(mins, 'minute')
  const hours = Math.floor(mins / 60)
  if (hours < 24) return ago(hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return ago(days, 'day')
  return fmtDate(ts, { day: 'numeric', month: 'short' })
}

// ── Создание и правка мысли ───────────────────────────────────────────────────
export function ComposerSheet({ post, userId, onClose, onSaved }) {
  const [text, setText] = useState(post?.text || '')
  const [imageUrl, setImageUrl] = useState(post?.image_url || null)
  const [visibility, setVisibility] = useState(post?.visibility || DEFAULT_VISIBILITY)
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
      setErr(ex.message || t('thought.photoFailed'))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setErr(null)
    const res = post
      ? await updatePost(post.id, { text, imageUrl })
      : await createPost({ userId, text, imageUrl, visibility })
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    // Видимость у существующего поста меняется отдельным запросом: updatePost
    // намеренно правит только текст и фото, а guard-триггер в базе следит,
    // чтобы через него нельзя было переписать ничего другого.
    if (post && visibility !== post.visibility) {
      const v = await setPostVisibility(post.id, visibility)
      if (v.error) { setErr(v.error); return }
    }
    onSaved({ ...res.ok, visibility }, Boolean(post))
    onClose()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <h2 className="h2" style={{ fontSize: 18 }}>{post ? t('thought.editTitle') : t('thought.newTitle')}</h2>
          <button className="iconbtn" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>

        <textarea
          className="input"
          placeholder={t('thought.placeholder')}
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
              style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 15 }}
              aria-label={t('thought.removePhoto')}
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{t('thought.whoSees')}</div>
          <div className="row gap8" style={{ flexWrap: 'wrap' }}>
            {VISIBILITY.map((v) => (
              <button
                key={v.value}
                className={`pill${visibility === v.value ? ' on' : ''}`}
                onClick={() => setVisibility(v.value)}
                title={v.hint}
                type="button"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

        <div className="row gap8">
          <button className="btn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '0 18px' }} disabled={busy} onClick={() => fileRef.current?.click()}>
            📷 {t('chat.photo')}
          </button>
          <button className="btn" style={{ flex: 1 }} disabled={busy || (!text.trim() && !imageUrl)} onClick={save}>
            {busy ? t('thought.saving') : post ? t('common.save') : t('thought.publish')}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

// ── Ответы ────────────────────────────────────────────────────────────────────
export function Comments({ post, myId, isPostOwner, onCountChange }) {
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
        <p className="muted" style={{ fontSize: 13 }}>{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>{t('thought.noReplies')}</p>
      ) : (
        items.map((c) => (
          <div key={c.id} className="row gap10" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
            <Avatar src={c.author_avatar} name={c.author_name} size={28} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row gap8" style={{ alignItems: 'baseline' }}>
                <span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.author_name || t('common.user')}</span>
                <span className="muted" style={{ fontSize: 11 }}>{timeAgo(c.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
            </div>
            {(c.user_id === myId || isPostOwner) && (
              <button style={{ fontSize: 12, color: 'var(--ink-3)', flex: '0 0 auto' }} onClick={() => remove(c.id)} aria-label={t('thought.deleteReply')}>✕</button>
            )}
          </div>
        ))
      )}

      {myId && (
        <div className="row gap8" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder={t('thought.replyPh')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            style={{ height: 42, fontSize: 14, flex: 1 }}
          />
          <button className="btn" style={{ width: 'auto', height: 42, padding: '0 16px', fontSize: 14, flex: '0 0 auto' }} disabled={busy || !text.trim()} onClick={send} aria-label={t('common.send')}>
            {isRtl() ? '←' : '→'}
          </button>
        </div>
      )}
      {err && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
    </div>
  )
}

// ── Одна мысль ────────────────────────────────────────────────────────────────
export function PostCard({ post, myId, authorName, authorAvatar, onChange, onEdit, onDelete, onOpenProfile }) {
  // Владелец определяется по самому посту, а не по тому, чей экран открыт:
  // в ленте на одном экране соседствуют свои и чужие мысли.
  const isMine = post.user_id === myId
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
          <button
            onClick={onOpenProfile ? () => onOpenProfile(post.user_id) : undefined}
            disabled={!onOpenProfile}
            className="row gap10"
            style={{
              alignItems: 'center', minWidth: 0, background: 'none', border: 0,
              padding: 0, textAlign: 'start', color: 'inherit',
              cursor: onOpenProfile ? 'pointer' : 'default',
            }}
          >
            <Avatar src={authorAvatar} name={authorName} size={34} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{authorName}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {timeAgo(post.created_at)}{post.edited_at ? ` · ${t('thought.edited')}` : ''}
                {isMine && post.visibility && post.visibility !== 'followers'
                  ? ' · ' + visibilityLabel(post.visibility)
                  : ''}
              </div>
            </div>
          </button>
        </div>
        {isMine && (
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setMenu((m) => !m)} aria-label={t('thought.actions')}>⋯</button>
            {menu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setMenu(false)} />
                <div className="friend-menu" style={{ minWidth: 170 }}>
                  <button onClick={() => { setMenu(false); onEdit(post) }}>✏️ {t('common.edit')}</button>
                  <button className="danger" onClick={() => { setMenu(false); onDelete(post) }}>🗑️ {t('common.delete')}</button>
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
        {btn('🥕', post.carrots, t('thought.like'))}
        {btn('🥦', post.broccoli, t('thought.notMine'))}
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
      setErr(t('thought.loadFailed'))
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
          {t('thought.loginPrompt')}
        </p>
      </div>
    )
  }

  if (unavailable) {
    return (
      <div className="card">
        <p className="muted" style={{ fontSize: 14 }}>{t('thought.unavailable')}</p>
      </div>
    )
  }

  return (
    <>
      {isOwnProfile && (
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => setComposer({ post: null })}>
          ＋ {t('thought.newTitle')}
        </button>
      )}

      {posts === null ? (
        <p className="muted" style={{ fontSize: 14 }}>{t('common.loading')}</p>
      ) : posts.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 14 }}>
            {isOwnProfile
              ? t('thought.emptyOwn')
              : t('thought.emptyOther')}
          </p>
        </div>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            myId={myId}
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
          text={t('thought.confirmDelete')}
          onYes={() => { const p = confirmDelete; setConfirmDelete(null); remove(p) }}
          onNo={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
