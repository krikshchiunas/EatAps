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
  // Три разных состояния, которые раньше сливались в одно.
  //   loading — ещё не знаем ничего;
  //   ready   — профиль пришёл;
  //   missing — сервер ответил, но профиля нет (удалённый аккаунт, блокировка);
  //   error   — не дозвонились.
  // Прежний экран рисовал полную витрину сразу: пока запрос летел, человек
  // видел «Без имени», прочерки в счётчиках и пустую ленту мыслей — то есть
  // экран утверждал то, чего ещё не знал, а при ошибке продолжал утверждать
  // это же.
  const [phase, setPhase] = useState('loading')
  const [tab, setTab] = useState('thoughts') // thoughts | followers | following | friends
  const [people, setPeople] = useState(null)
  const [peopleLoading, setPeopleLoading] = useState(false)
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
    setPhase('loading')
    try {
      // Отношение спрашиваем ВСЕГДА, даже когда карточка не пришла: именно оно
      // отвечает, почему её нет — потому что нас заблокировали или потому что
      // аккаунта больше не существует. Без него оба случая выглядят одинаково.
      const [p, r] = await Promise.all([
        userProfile(userId),
        isMe ? Promise.resolve({ ...EMPTY_RELATIONSHIP }) : getRelationship(userId),
      ])
      setCard(p)
      setRel(r)
      setPhase(p ? 'ready' : 'missing')
    } catch (e) {
      setErr(e.message || 'Не удалось открыть профиль')
      setPhase('error')
    }
  }, [userId, isMe])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    if (tab === 'thoughts') { setPeople(null); setPeopleLoading(false); return }
    setPeople(null)
    setPeopleLoading(true)
    ;(async () => {
      try {
        const list =
          tab === 'followers' ? await listFollowers(userId) :
          tab === 'following' ? await listFollowing(userId) :
          (await listFriends(userId)).map((f) => ({
            user_id: f.id, username: f.username, display_name: f.name, avatar_url: f.avatar,
          }))
        if (alive) setPeople(list)
      } catch {
        if (alive) setPeople([])
      } finally {
        if (alive) setPeopleLoading(false)
      }
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

  // Оболочка одна на все состояния: шапка с «назад» должна быть на месте и
  // тогда, когда показывать нечего. Без неё экран ошибки становится ловушкой —
  // выйти из него можно только жестом, о котором никто не предупреждал.
  const Shell = ({ children, withMenu = false }) => (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div className="chat-overlay" {...panelProps}>
        <header className="chat-header">
          <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }} aria-label="Назад">‹</button>
          <span style={{ fontSize: 16, fontWeight: 640, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card?.username || 'Профиль'}
          </span>
          {withMenu}
        </header>
        {children}
      </div>
    </>
  )

  // Человек нас заблокировал — профиля для нас нет. Показать пустую карточку
  // честнее, чем делать вид, что страница просто не загрузилась.
  if (rel.blockedBy) {
    return (
      <Shell>
        <div className="screen" style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🚫</div>
          <p className="muted" style={{ fontSize: 15 }}>Профиль недоступен.</p>
        </div>
      </Shell>
    )
  }

  // Ещё грузим. Заглушка повторяет разметку готовой витрины, поэтому в момент
  // подстановки экран не перекладывается.
  if (phase === 'loading') {
    return (
      <Shell>
        <div className="screen">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div className="skel" style={{ width: 82, height: 82, borderRadius: '50%', margin: '0 auto' }} />
            <div className="skel" style={{ width: 140, height: 18, borderRadius: 9, margin: '12px auto 8px' }} />
            <div className="skel" style={{ width: 90, height: 12, borderRadius: 6, margin: '0 auto' }} />
          </div>
          <div className="row" style={{ marginBottom: 16, gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ flex: 1 }}>
                <div className="skel" style={{ height: 20, borderRadius: 8, marginBottom: 6 }} />
                <div className="skel" style={{ height: 10, borderRadius: 5 }} />
              </div>
            ))}
          </div>
          <div className="skel skel-card" style={{ height: 120, borderRadius: 18 }} />
          <div className="skel skel-card" style={{ height: 120, borderRadius: 18 }} />
        </div>
      </Shell>
    )
  }

  // Запрос не дошёл. Это не «профиля нет» — и повторить должно быть чем.
  if (phase === 'error') {
    return (
      <Shell>
        <div className="screen" style={{ textAlign: 'center', paddingTop: 48 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📡</div>
          <p style={{ fontSize: 15, color: 'var(--danger)', marginBottom: 14, lineHeight: 1.5 }}>{err}</p>
          <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '0 auto' }} onClick={load}>
            Повторить
          </button>
        </div>
      </Shell>
    )
  }

  // Сервер ответил, а профиля нет: аккаунт удалён либо мы его заблокировали
  // (user_profile не отдаёт строку ни в ту, ни в другую сторону). Разница
  // между этими случаями человеку важна — во втором есть что нажать.
  if (phase === 'missing') {
    return (
      <Shell>
        <div className="screen" style={{ textAlign: 'center', paddingTop: 48 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>{rel.blocked ? '🚫' : '👻'}</div>
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 14 }}>
            {rel.blocked
              ? 'Вы заблокировали этого человека. Его профиль, мысли и переписка скрыты.'
              : 'Профиль недоступен — возможно, аккаунт удалён.'}
          </p>
          {rel.blocked && (
            <button
              className="btn ghost"
              style={{ width: 'auto', padding: '0 22px', margin: '0 auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => act(() => unblock(myId, userId))}
            >
              Разблокировать
            </button>
          )}
          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 12 }}>{err}</p>}
        </div>
      </Shell>
    )
  }

  return (
    <>
    <div className="nav-scrim" {...scrimProps} />
    <div className="chat-overlay" {...panelProps}>
      <header className="chat-header">
        <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }} aria-label="Назад">‹</button>
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
            rel={isMe ? null : rel}
          />
        )}
        {tab !== 'thoughts' && (
          <PeopleList
            people={people || []}
            loading={peopleLoading}
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
