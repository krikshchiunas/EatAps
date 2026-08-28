// Список людей: результаты поиска, подписчики, подписки, друзья.
//
// Строка показывает имя и под ним ник — без приставки «@»: ник в EatAps
// пишется так же, как хранится и как его вводят в поиске.
//
// Один компонент на все четыре случая намеренно — раньше каждый список рисовал
// строку человека сам, и они успели разойтись в мелочах. Отличаются списки
// только источником данных и тем, показывать ли кнопку подписки.
//
// Отношения подгружаются ОДНИМ запросом на весь список, а не по одному на
// строку: список из пятидесяти человек иначе означал бы пятьдесят обращений.
import { useState, useEffect, useMemo } from 'react'
import { Avatar } from './FriendsScreen.jsx'
import FollowButton from './FollowButton.jsx'
import { getRelationships } from '../lib/social.js'
import { EMPTY_RELATIONSHIP, relationshipLabel } from '../lib/relationship.js'
import { primeCards, getCachedAvatar, onCardsChange } from '../lib/avatarCache.js'

export function PersonRow({ person, myId, rel, onRelChange, onOpen, showFollow = true, avatar }) {
  const name = person.display_name || person.username || 'Без имени'
  const label = rel ? relationshipLabel(rel) : null
  // Поиск аватар больше не присылает (он весит десятки килобайт на строку) —
  // берём его из общего кэша. Списки подписчиков присылают как раньше.
  const src = person.avatar_url ?? avatar ?? null

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
        <Avatar src={src} name={name} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {person.username}{label ? ` · ${label}` : ''}
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
  // Счётчик перерисовки по приходу карточек из общего кэша: копию карточек
  // компонент у себя не держит, иначе она разъезжалась бы между списками.
  const [, bump] = useState(0)

  // Ключ списка — строка из идентификаторов, а не сам массив.
  //
  // Это не оптимизация, а исправление цикла перерисовки. PublicProfile передаёт
  // `people={people || []}`, и пока список грузится, каждый рендер создавал
  // НОВЫЙ пустой массив. Он попадал в зависимости эффекта, эффект срабатывал,
  // звал setRels({}) с новым объектом, React перерисовывал — и так по кругу,
  // пока не придёт ответ. По строке идентификаторов такого не происходит.
  const ids = useMemo(
    () => (people || []).map((p) => p.user_id).filter((id) => id && id !== myId),
    [people, myId],
  )
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    if (!ids.length) {
      // Функциональная форма: при уже пустом объекте React делает бэйлаут и
      // лишней перерисовки не происходит даже при нестабильном props.
      setRels((cur) => (Object.keys(cur).length ? {} : cur))
      return
    }
    ;(async () => {
      try {
        const map = await getRelationships(ids)
        if (alive) setRels(map)
      } catch {
        if (alive) setRels(Object.fromEntries(ids.map((id) => [id, { ...EMPTY_RELATIONSHIP }])))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Аватары для тех, у кого их нет в ответе (поиск их больше не присылает).
  useEffect(() => {
    const missing = (people || []).filter((p) => !p.avatar_url).map((p) => p.user_id)
    if (!missing.length) return
    let alive = true
    primeCards(missing).then(() => { if (alive) bump((n) => n + 1) })
    const off = onCardsChange(() => { if (alive) bump((n) => n + 1) })
    return () => { alive = false; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

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
          avatar={getCachedAvatar(p.user_id)}
          onRelChange={(id, next) => setRels((r) => ({ ...r, [id]: next }))}
          onOpen={onOpen}
          showFollow={showFollow}
        />
      ))}
    </div>
  )
}
