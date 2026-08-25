// Список людей: результаты поиска, подписчики, подписки, друзья.
//
// Один компонент на все четыре случая намеренно — раньше каждый список рисовал
// строку человека сам, и они успели разойтись в мелочах. Отличаются списки
// только источником данных и тем, показывать ли кнопку подписки.
//
// Отношения подгружаются ОДНИМ запросом на весь список, а не по одному на
// строку: список из пятидесяти человек иначе означал бы пятьдесят обращений.
import { useState, useEffect } from 'react'
import { Avatar } from './FriendsScreen.jsx'
import FollowButton from './FollowButton.jsx'
import { getRelationship } from '../lib/social.js'
import { EMPTY_RELATIONSHIP, relationshipLabel } from '../lib/relationship.js'

export function PersonRow({ person, myId, rel, onRelChange, onOpen, showFollow = true }) {
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
        }}
      >
        <Avatar src={person.avatar_url} name={name} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{person.username}{label ? ` · ${label}` : ''}
          </div>
        </div>
      </button>
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

export default function PeopleList({ people, myId, onOpen, showFollow = true, empty = 'Пусто' }) {
  const [rels, setRels] = useState({})

  useEffect(() => {
    let alive = true
    const ids = (people || []).map((p) => p.user_id).filter((id) => id && id !== myId)
    if (!ids.length) { setRels({}); return }
    ;(async () => {
      // get_relationship отвечает на одного человека, поэтому запросы идут
      // параллельно, а не последовательно: это один круг ожидания вместо N.
      const pairs = await Promise.all(
        ids.map(async (id) => {
          try { return [id, await getRelationship(id)] }
          catch { return [id, { ...EMPTY_RELATIONSHIP }] }
        })
      )
      if (alive) setRels(Object.fromEntries(pairs))
    })()
    return () => { alive = false }
  }, [people, myId])

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
        />
      ))}
    </div>
  )
}
