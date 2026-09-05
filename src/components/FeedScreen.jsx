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
import ConfirmDialog from './ConfirmDialog.jsx'

const PAGE = 20

export default function FeedScreen({ onOpenProfile }) {
  const { user, supabaseEnabled } = useStore()
  const myId = user?.id || ''

  const [posts, setPosts] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState(null)
  // Ошибка ПЕРВОЙ загрузки и ошибка догрузки — разные вещи: первая означает
  // пустой экран и требует кнопки «Повторить», вторая лишь останавливает
  // бесконечную прокрутку, а уже показанное остаётся на месте.
  const [fatal, setFatal] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [composer, setComposer] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const sentinel = useRef(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!supabaseEnabled || !myId) { setPosts([]); return }
    setErr(null)
    setFatal(null)
    if (!silent) setPosts(null)
    try {
      const res = await listFeed({ limit: PAGE })
      setUnavailable(Boolean(res.unavailable))
      setPosts(res.posts)
      setCursor(res.cursor)
    } catch (e) {
      // Пустая лента и не загрузившаяся лента выглядели одинаково — «Пока
      // пусто. Подпишитесь на кого-нибудь». То есть экран советовал человеку
      // подписаться на людей в момент, когда просто отвалилась сеть.
      setFatal(e.message || 'Не удалось загрузить ленту')
      setPosts([])
    }
  }, [supabaseEnabled, myId])

  useEffect(() => { load() }, [load])

  // Потянуть вниз, чтобы обновить. Жест нативный для ленты, и без него
  // единственным способом увидеть новое было закрыть и открыть вкладку.
  //
  // Своя реализация, а не browser pull-to-refresh: страница живёт внутри
  // приложения-оболочки, у которой прокрутка своя, а перезагрузка документа
  // означала бы потерю всего состояния.
  const pull = useRef(null)
  useEffect(() => {
    const onStart = (e) => {
      // Жест начинается только у самого верха, одним пальцем и только когда
      // поверх ленты ничего не открыто. Под открытым листом (композер, профиль,
      // чат) прокрутка страницы заблокирована и scrollY всегда 0 — без этой
      // проверки жест по содержимому листа обновлял бы ленту у него за спиной.
      const overlay = document.querySelector('.sheet-backdrop, .chat-overlay')
      if (overlay || e.touches.length !== 1 || window.scrollY > 4) { pull.current = null; return }
      pull.current = { y: e.touches[0].clientY, dist: 0 }
    }
    const onMove = (e) => {
      const g = pull.current
      if (!g) return
      g.dist = e.touches[0].clientY - g.y
    }
    const onEnd = () => {
      const g = pull.current
      pull.current = null
      if (!g || g.dist < 90 || refreshing) return
      setRefreshing(true)
      // silent: список остаётся на экране, пока едет обновление. Заменить его
      // на заглушку в ответ на «обновить» значило бы забрать то, что человек
      // уже читает.
      load({ silent: true }).finally(() => setRefreshing(false))
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [load, refreshing])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listFeed({ limit: PAGE, cursor })
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

      {refreshing && (
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '0 0 10px' }}>Обновляем…</p>
      )}

      {/* Заглушка держит высоту будущих карточек — лента не прыгает, когда
          данные приезжают. */}
      {posts === null && [0, 1, 2].map((i) => (
        <div key={i} className="card skel-card" style={{ marginBottom: 12 }}>
          <div className="row gap10" style={{ alignItems: 'center', marginBottom: 12 }}>
            <div className="skel" style={{ width: 34, height: 34, borderRadius: '50%', flex: '0 0 auto' }} />
            <div style={{ flex: 1 }}>
              <div className="skel" style={{ width: '38%', height: 12, borderRadius: 6, marginBottom: 6 }} />
              <div className="skel" style={{ width: '22%', height: 10, borderRadius: 5 }} />
            </div>
          </div>
          <div className="skel" style={{ width: '92%', height: 13, borderRadius: 6, marginBottom: 7 }} />
          <div className="skel" style={{ width: '64%', height: 13, borderRadius: 6, marginBottom: 14 }} />
          <div className="row gap8">
            <div className="skel" style={{ width: 64, height: 38, borderRadius: 999 }} />
            <div className="skel" style={{ width: 64, height: 38, borderRadius: 999 }} />
          </div>
        </div>
      ))}

      {/* Не дозвонились. Это НЕ «лента пуста»: советовать человеку подписаться
          на кого-нибудь, когда просто отвалилась сеть, — вводить в заблуждение
          и отправлять чинить не то. */}
      {fatal && posts?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 8px' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📡</div>
          <p style={{ fontSize: 14, color: 'var(--danger)', lineHeight: 1.5, marginBottom: 14 }}>{fatal}</p>
          <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={() => load()}>
            Повторить
          </button>
        </div>
      )}

      {!fatal && posts?.length === 0 && (
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
          authorAvatar={p.avatar_url}
          onChange={replace}
          onEdit={(post) => setComposer({ post })}
          onDelete={(post) => setConfirmDelete(post)}
          onOpenProfile={onOpenProfile}
        />
      ))}

      <div ref={sentinel} />
      {loadingMore && <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Загружаем…</p>}
      {err && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 8 }}>{err}</p>
          {cursor && (
            <button className="btn ghost" style={{ width: 'auto', padding: '0 18px', margin: '0 auto' }} onClick={loadMore}>
              Попробовать ещё раз
            </button>
          )}
        </div>
      )}

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
