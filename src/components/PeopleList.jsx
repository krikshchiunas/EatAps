// Список людей: результаты поиска, подписчики, подписки, друзья, близкие
// друзья, заблокированные, просьбы о подписке.
//
// Один компонент на все случаи намеренно — раньше каждый список рисовал строку
// человека сам, и они успели разойтись в мелочах. Отличаются списки только
// источником данных и набором действий в строке.
//
// ─────────────────────────────────────────────────────────────────────────────
// ДВА ПРАВИЛА, БЕЗ КОТОРЫХ СПИСОК ЛЮДЕЙ НЕ РАБОТАЕТ
//
// 1. ОТНОШЕНИЯ ПОДГРУЖАЮТСЯ ОДНИМ ЗАПРОСОМ. Раньше здесь стоял Promise.all по
//    getRelationship на каждого человека: пятьдесят строк означали пятьдесят
//    запросов к базе. Параллельность делала это терпимым по времени ожидания,
//    но не по нагрузке.
//
// 2. СПИСОК ГРУЗИТСЯ СТРАНИЦАМИ. У аккаунта с тысячей подписчиков «показать
//    всех сразу» — это мегабайты аватаров в одном ответе.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Avatar, LockBadge } from './Avatar.jsx'
import FollowButton from './FollowButton.jsx'
import { relationshipsWith } from '../lib/social.js'
import { EMPTY_RELATIONSHIP, relationshipLabel } from '../lib/relationship.js'

export function PersonRow({
  person, myId, rel, onRelChange, onOpen, showFollow = true,
  actions = null, context = 'profile', onRefresh,
}) {
  const name = person.display_name || person.username || 'Без имени'
  const label = rel ? relationshipLabel(rel) : null

  return (
    <div className="row between" style={{ alignItems: 'center', gap: 10, padding: '10px 0' }}>
      <button
        onClick={() => onOpen?.(person.user_id)}
        className="row gap10"
        style={{
          alignItems: 'center', minWidth: 0, flex: 1, background: 'none',
          border: 0, padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer',
          // Ряд — основная цель нажатия в списке, и по высоте он обязан
          // дотягивать до минимального размера сенсорной цели.
          minHeight: 48,
        }}
      >
        <Avatar src={person.avatar_url} name={name} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            {(person.is_private || rel?.targetIsPrivate) && <LockBadge />}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {person.username}{label ? ` · ${label}` : ''}
          </div>
        </div>
      </button>

      {/* Особые действия строки (принять просьбу, убрать подписчика, снять
          блокировку). Их набор задаёт вызывающий экран: он один знает, ЧЕЙ
          это список и что в нём уместно. */}
      {actions?.(person)}

      {showFollow && rel && person.user_id !== myId && (
        <FollowButton
          myId={myId}
          userId={person.user_id}
          rel={rel}
          name={name}
          size="small"
          context={context}
          onChange={(next) => onRelChange?.(person.user_id, next)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

// Заглушка строки на время загрузки. Пустой экран и «загрузка…» текстом
// одинаково честны, но полоски держат высоту списка, и он не прыгает под
// пальцем, когда данные приезжают.
export function PersonRowSkeleton() {
  return (
    <div className="row gap10" style={{ alignItems: 'center', padding: '10px 0' }}>
      <div className="skel" style={{ width: 44, height: 44, borderRadius: '50%', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="skel" style={{ width: '46%', height: 13, borderRadius: 7, marginBottom: 7 }} />
        <div className="skel" style={{ width: '28%', height: 11, borderRadius: 6 }} />
      </div>
    </div>
  )
}

// searchable — фильтр по УЖЕ загруженному списку; включается сам, когда людей
// много: искать глазами в списке на двести имён нельзя, а на пяти — не нужно.
// onLoadMore — догрузка следующей страницы; null означает «догружать нечего».
export default function PeopleList({
  people, myId, onOpen, showFollow = true, empty = 'Пусто', loading = false,
  actions = null, context = 'profile', onRefresh = null,
  searchable = false, searchPlaceholder = 'Поиск по списку…',
  onLoadMore = null, hasMore = false, loadingMore = false,
  error = null, onRetry = null,
}) {
  const [rels, setRels] = useState({})
  const [query, setQuery] = useState('')
  const sentinel = useRef(null)

  useEffect(() => {
    let alive = true
    const ids = (people || []).map((p) => p.user_id).filter((id) => id && id !== myId)
    if (!ids.length) { setRels({}); return }
    ;(async () => {
      try {
        const map = await relationshipsWith(ids)
        if (alive) setRels(map)
      } catch {
        // Отношения не приехали — список всё равно показываем. Кнопка подписки
        // при этом покажет «Подписаться» для всех, и нажатие либо сработает,
        // либо вернёт ошибку с сервера. Прятать людей из-за этого хуже.
        if (alive) setRels({})
      }
    })()
    return () => { alive = false }
  }, [people, myId])

  // Бесконечная прокрутка. Кнопка «Показать ещё» осталась бы запасным путём,
  // но на телефоне долистывать и нажимать — лишнее движение.
  const loadMore = useCallback(() => {
    if (onLoadMore && hasMore && !loadingMore) onLoadMore()
  }, [onLoadMore, hasMore, loadingMore])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    }, { rootMargin: '240px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadMore])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@+/, '')
    if (!q) return people || []
    return (people || []).filter((p) =>
      (p.display_name || '').toLowerCase().includes(q) || (p.username || '').includes(q))
  }, [people, query])

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 8px' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>📡</div>
        <p style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 14 }}>{error}</p>
        {onRetry && (
          <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={onRetry}>
            Повторить
          </button>
        )}
      </div>
    )
  }

  if (loading) {
    return <div>{[0, 1, 2, 3, 4].map((i) => <PersonRowSkeleton key={i} />)}</div>
  }

  if (!people?.length) {
    return <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 0' }}>{empty}</p>
  }

  return (
    <div>
      {searchable && people.length > 8 && (
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          style={{ marginBottom: 10, height: 42, fontSize: 14.5 }}
        />
      )}

      {shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
          В этом списке никого не нашли.
        </p>
      ) : shown.map((p) => (
        <PersonRow
          key={p.user_id}
          person={p}
          myId={myId}
          rel={rels[p.user_id] || { ...EMPTY_RELATIONSHIP }}
          onRelChange={(id, next) => setRels((r) => ({ ...r, [id]: next }))}
          onOpen={onOpen}
          showFollow={showFollow}
          actions={actions}
          context={context}
          onRefresh={onRefresh}
        />
      ))}

      {/* Догрузка идёт только по полному списку: под фильтром «показать ещё»
          обещало бы не то, что делает. */}
      {hasMore && !query && (
        <div ref={sentinel} style={{ padding: '10px 0' }}>
          {loadingMore
            ? <PersonRowSkeleton />
            : <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={loadMore}>
                Показать ещё
              </button>}
        </div>
      )}
    </div>
  )
}
