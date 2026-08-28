// Социальная лента — центральная часть социального опыта.
//
// Показывает мысли тех, на кого человек подписан, своих друзей и свои
// собственные. Что именно попадает в выборку и по каким правам — решает
// list_feed в базе, а не этот компонент: приватность обеспечивает RLS, UI
// не является слоем безопасности и ничего не фильтрует у себя.
//
// Пагинация — курсором (created_at, id), а не страницами: пока человек
// листает, сверху приезжают новые посты, и нумерованные страницы начали бы
// показывать дубли.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../store.jsx'
import { listFeed } from '../lib/social.js'
import { PostCard, ComposerSheet } from './ThoughtsFeed.jsx'
import { deletePost } from '../lib/supabase.js'
import { primeCards, getCachedAvatar, onCardsChange } from '../lib/avatarCache.js'
import ConfirmDialog from './ConfirmDialog.jsx'

export default function FeedScreen({ onOpenProfile }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [posts, setPosts] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState(null)
  const [composer, setComposer] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const sentinel = useRef(null)

  const load = useCallback(async () => {
    if (!supabaseEnabled || !myId) { setPosts([]); return }
    setErr(null)
    try {
      const res = await listFeed({ limit: 20 })
      setUnavailable(Boolean(res.unavailable))
      setPosts(res.posts)
      setCursor(res.cursor)
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить ленту')
      setPosts([])
    }
  }, [supabaseEnabled, myId])

  useEffect(() => { load() }, [load])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listFeed({ limit: 20, cursor })
      setPosts((prev) => {
        // Защита от дублей: между запросами страница могла сдвинуться.
        const seen = new Set((prev || []).map((p) => p.id))
        return [...(prev || []), ...res.posts.filter((p) => !seen.has(p.id))]
      })
      setCursor(res.cursor)
    } catch (e) {
      setErr(e.message || 'Не удалось догрузить')
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore])

  // Бесконечная прокрутка. IntersectionObserver, а не onScroll: обработчик
  // прокрутки на длинной ленте срабатывает десятки раз в секунду.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, loadMore])

  // Аватары авторов. Лента их больше не присылает: аватар в EatAps — это
  // base64-картинка на десятки килобайт, и двадцать постов одного человека
  // означали двадцать её копий в одном ответе. Добираем по УНИКАЛЬНЫМ авторам
  // страницы — обычно это три-семь человек на двадцать постов.
  const [, bumpAvatars] = useState(0)
  useEffect(() => {
    if (!posts?.length) return
    let alive = true
    primeCards([...new Set(posts.map((p) => p.user_id))])
      .then(() => { if (alive) bumpAvatars((n) => n + 1) })
    const off = onCardsChange(() => { if (alive) bumpAvatars((n) => n + 1) })
    return () => { alive = false; off() }
  }, [posts])

  const replace = (next) => setPosts((prev) => (prev || []).map((p) => (p.id === next.id ? next : p)))

  const doDelete = async (post) => {
    setConfirmDelete(null)
    const before = posts
    setPosts((prev) => (prev || []).filter((p) => p.id !== post.id))
    const res = await deletePost(post.id)
    if (res.error) { setErr(res.error); setPosts(before) }
  }

  if (!supabaseEnabled) {
    return <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '32px 16px' }}>
      Лента доступна после входа в аккаунт.
    </p>
  }

  if (unavailable) {
    return <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '32px 16px' }}>
      Раздел пока недоступен — база ещё не обновлена.
    </p>
  }

  return (
    <div>
      <button
        className="btn"
        style={{ marginBottom: 14 }}
        onClick={() => setComposer({ post: null })}
      >
        Поделиться мыслью
      </button>

      {posts === null && (
        <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 0' }}>Загружаем…</p>
      )}

      {posts?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 8px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🥗</div>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Пока пусто. Подпишитесь на кого-нибудь через поиск —<br />их мысли появятся здесь.
          </p>
        </div>
      )}

      {posts?.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          myId={myId}
          authorName={p.display_name || p.username || 'Без имени'}
          authorAvatar={getCachedAvatar(p.user_id)}
          onChange={replace}
          onEdit={(post) => setComposer({ post })}
          onDelete={(post) => setConfirmDelete(post)}
          onOpenProfile={onOpenProfile}
        />
      ))}

      <div ref={sentinel} />
      {loadingMore && <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Загружаем…</p>}
      {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>{err}</p>}

      {composer && (
        <ComposerSheet
          post={composer.post}
          userId={myId}
          onClose={() => setComposer(null)}
          onSaved={(saved, wasEdit) => {
            if (wasEdit) replace(saved)
            else load() // новый пост мог не попасть в текущее окно курсора
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          text="Удалить эту мысль? Ответы и реакции на неё тоже исчезнут."
          onYes={() => doDelete(confirmDelete)}
          onNo={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
