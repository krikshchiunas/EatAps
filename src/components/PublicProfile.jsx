// Публичный профиль любого человека — самостоятельный экран.
//
// Раньше чужой профиль открывался только изнутри чата (Друзья → Чат → шапка →
// профиль), то есть существовал лишь у того, с кем уже есть переписка. Теперь
// он открывается напрямую: из ленты, поиска, подписчиков, подписок, друзей и
// уведомлений.
//
// Что видно, зависит от отношения, и решает это сервер:
//   • карточка, счётчики и мысли  — по правам из user_profile / list_posts;
//   • дневник питания             — только друзьям (friend_state), подписка
//                                   сюда доступа не даёт.
// Компонент ничего не фильтрует сам: он показывает то, что вернулось.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store.jsx'
import { getRelationship, userProfile, listFollowers, listFollowing, block, unblock } from '../lib/social.js'
import { EMPTY_RELATIONSHIP, canMessage, canViewDiary, relationshipLabel } from '../lib/relationship.js'
import { listFriends } from '../lib/supabase.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { Avatar } from './FriendsScreen.jsx'
import FollowButton from './FollowButton.jsx'
import PeopleList from './PeopleList.jsx'
import ThoughtsFeed from './ThoughtsFeed.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import ProfileCounts from './ProfileCounts.jsx'

export default function PublicProfile({ userId, onClose, onOpenProfile, onOpenChat }) {
  const { user } = useStore()
  const myId = user?.id || ''
  const isMe = userId === myId

  const [card, setCard] = useState(null)
  const [rel, setRel] = useState({ ...EMPTY_RELATIONSHIP })
  const [tab, setTab] = useState('thoughts') // thoughts | followers | following | friends
  const [people, setPeople] = useState(null)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const [menu, setMenu] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)

  const { panelProps, scrimProps, close: handleClose } = useSwipeBack(onClose)
  useScrollLock()

  // Счётчик оверлеев — как в FriendAccount: профиль может открыться поверх
  // другого профиля (из ленты → автор → его подписчики → ещё профиль), и
  // класс has-overlay должен сняться только с последним из них.
  useEffect(() => {
    const el = document.documentElement
    const n = Number(el.dataset.overlayCount || 0) + 1
    el.dataset.overlayCount = n
    el.classList.add('has-overlay')
    return () => {
      const next = Number(el.dataset.overlayCount || 1) - 1
      el.dataset.overlayCount = next
      if (next <= 0) el.classList.remove('has-overlay')
    }
  }, [])

  const load = useCallback(async () => {
    if (!userId) return
    setErr(null)
    try {
      const [p, r] = await Promise.all([
        userProfile(userId),
        isMe ? Promise.resolve({ ...EMPTY_RELATIONSHIP }) : getRelationship(userId),
      ])
      setCard(p)
      setRel(r)
    } catch (e) {
      setErr(e.message || 'Не удалось открыть профиль')
    }
  }, [userId, isMe])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    if (tab === 'thoughts') { setPeople(null); return }
    setPeople(null)
    ;(async () => {
      try {
        const list =
          tab === 'followers' ? await listFollowers(userId) :
          tab === 'following' ? await listFollowing(userId) :
          (await listFriends(userId)).map((f) => ({
            user_id: f.id, username: f.username, display_name: f.name, avatar_url: f.avatar,
          }))
        if (alive) setPeople(list)
      } catch { if (alive) setPeople([]) }
    })()
    return () => { alive = false }
  }, [tab, userId])

  const act = async (fn, okNote) => {
    setErr(null); setNote(null)
    const res = await fn()
    if (res?.error) { setErr(res.error); return }
    if (okNote) setNote(okNote)
    load()
  }

  const name = card?.display_name || card?.username || 'Без имени'
  const label = isMe ? null : relationshipLabel(rel)

  // Человек нас заблокировал — профиля для нас нет. Показать пустую карточку
  // честнее, чем делать вид, что страница просто не загрузилась.
  if (rel.blockedBy) {
    return (
      <>
        <div className="nav-scrim" {...scrimProps} />
        <div className="chat-overlay" {...panelProps}>
          <header className="chat-header">
            <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }}>‹</button>
          </header>
          <div className="screen" style={{ textAlign: 'center', paddingTop: 60 }}>
            <p className="muted" style={{ fontSize: 15 }}>Профиль недоступен.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
    <div className="nav-scrim" {...scrimProps} />
    <div className="chat-overlay" {...panelProps}>
      <header className="chat-header">
        <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 640, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card?.username || 'Профиль'}
        </span>
        {!isMe && (
          <div style={{ position: 'relative', flex: '0 0 auto' }}>
            <button className="iconbtn" onClick={() => setMenu((m) => !m)} aria-label="Действия">⋯</button>
            {menu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setMenu(false)} />
                <div className="friend-menu" style={{ minWidth: 190 }}>
                  <button
                    className="danger"
                    onClick={() => { setMenu(false); rel.blocked ? act(() => unblock(myId, userId)) : setConfirmBlock(true) }}
                  >
                    {rel.blocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <div className="screen">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Avatar src={card?.avatar_url} name={name} size={82} />
          <h1 className="h1" style={{ fontSize: 21, marginTop: 10 }}>{name}</h1>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {card?.username}{label ? ` · ${label}` : ''}
          </div>
        </div>

        <ProfileCounts card={card} tab={tab} onPick={setTab} />

        {!isMe && (
          <div className="row gap8" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            {/* Одна кнопка связи вместо двух. Заявок в друзья больше нет:
                подписка в ответ и есть дружба, поэтому «Добавить в друзья»
                нечему соответствовать — нажимать было бы нечего и некому
                подтверждать. */}
            <FollowButton myId={myId} userId={userId} rel={rel} onChange={setRel} />

            {/* Кнопка есть только там, где вызывающий экран умеет открыть
                чат. В профиле, открытом из своего же профиля, чата нет — и
                мёртвая кнопка «Написать» была бы хуже её отсутствия. */}
            {canMessage(rel) && onOpenChat && (
              <button className="btn soft" style={{ width: 'auto', padding: '0 18px' }}
                onClick={() => onOpenChat({ id: userId, name, avatar: card?.avatar_url, username: card?.username })}>
                Написать
              </button>
            )}
          </div>
        )}

        {note && <p style={{ fontSize: 13, color: 'var(--primary-strong)', marginBottom: 10 }}>{note}</p>}
        {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

        {!isMe && !canViewDiary(rel) && (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.45 }}>
            {rel.followedBy
              ? 'Этот человек подписан на вас. Подпишитесь в ответ — станете друзьями, откроются переписка и дневник питания.'
              : 'Дневник питания и переписка — только друзьям. Друзьями становятся те, кто подписан друг на друга.'}
          </p>
        )}

        {tab === 'thoughts' && (
          <ThoughtsFeed
            userId={userId}
            isOwnProfile={isMe}
            authorName={name}
            authorAvatar={card?.avatar_url}
          />
        )}
        {tab !== 'thoughts' && (
          <PeopleList
            people={people || []}
            myId={myId}
            onOpen={onOpenProfile}
            empty={
              tab === 'followers' ? 'Подписчиков пока нет'
                : tab === 'following' ? 'Пока ни на кого не подписан'
                : 'Друзей пока нет'
            }
          />
        )}
      </div>

      {confirmBlock && (
        <ConfirmDialog
          text={`Заблокировать ${name}? Взаимные подписки и дружба будут удалены.`}
          onYes={() => { setConfirmBlock(false); act(() => block(myId, userId)) }}
          onNo={() => setConfirmBlock(false)}
        />
      )}
    </div>
    </>
  )
}
