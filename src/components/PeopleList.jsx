// Список людей: результаты поиска, подписчики, подписки, друзья.
//
// Строка показывает имя и под ним ник — без приставки «@»: ник в EatAps
// пишется так же, как хранится и как его вводят в поиске.
//
// Один компонент на все четыре случая намеренно — раньше каждый список рисовал
// строку человека сам, и они успели разойтись в мелочах. Отличаются списки
// только источником данных и тем, показывать ли кнопку подписки.
//
// Отношения подгружаются ОДНИМ запросом на весь список.
//
// Раньше здесь стоял Promise.all по getRelationship на каждого человека —
// пятьдесят строк означали пятьдесят запросов к базе. Параллельность делала
// это терпимым по времени ожидания, но не по нагрузке: открытая страница
// подписчиков стоила базе полсотни вызовов SECURITY DEFINER-функции. Теперь
// это один relationships_with.
import { useState, useEffect } from 'react'
import { Avatar } from './FriendsScreen.jsx'
import FollowButton from './FollowButton.jsx'
import { relationshipsWith } from '../lib/social.js'
import { EMPTY_RELATIONSHIP, relationshipLabel } from '../lib/relationship.js'

export function PersonRow({ person, myId, rel, onRelChange, onOpen, showFollow = true, onRemove }) {
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
          <div style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {person.username}{label ? ` · ${label}` : ''}
          </div>
        </div>
      </button>
      {/* «Убрать» — снять чужую подписку на себя, не блокируя человека.
          Сервер это умел с самого начала (политика follows разрешает удаление
          и объекту подписки), но в интерфейсе не было ни одной кнопки: убрать
          подписчика можно было только блокировкой, то есть гораздо более
          грубым действием, чем требовалось. */}
      {onRemove && person.user_id !== myId && (
        <button
          onClick={() => onRemove(person)}
          className="btn ghost"
          style={{
            width: 'auto', height: 32, padding: '0 12px', fontSize: 13,
            flex: '0 0 auto', color: 'var(--ink-3)',
          }}
        >
          Убрать
        </button>
      )}
      {showFollow && rel && person.user_id !== myId && (
        <FollowButton
          myId={myId}
          userId={person.user_id}
          rel={rel}
          size="small"
          onChange={(next) => onRelChange?.(person.user_id, next)}
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

export default function PeopleList({
  people, myId, onOpen, showFollow = true, empty = 'Пусто', loading = false, onRemove = null,
}) {
  const [rels, setRels] = useState({})

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

  if (loading) {
    return (
      <div>
        {[0, 1, 2, 3, 4].map((i) => <PersonRowSkeleton key={i} />)}
      </div>
    )
  }

  if (!people?.length) {
    return <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '28px 0' }}>{empty}</p>
  }

  return (
    <div>
      {people.map((p) => (
        <PersonRow
          key={p.user_id}
          person={p}
          myId={myId}
          rel={rels[p.user_id] || { ...EMPTY_RELATIONSHIP }}
          onRelChange={(id, next) => setRels((r) => ({ ...r, [id]: next }))}
          onOpen={onOpen}
          showFollow={showFollow}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}
