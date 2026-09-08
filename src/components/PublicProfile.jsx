// Публичный профиль любого человека — самостоятельный экран.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ВИДНО И КТО ЭТО РЕШАЕТ
//
// Шапка — имя, аватар, ник, счётчики — видна ВСЕГДА, кроме блокировки. Иначе
// на закрытый аккаунт нельзя даже попроситься: человек не поймёт, к кому
// обращается.
//
// Содержимое — записи, подписчики, подписки — у закрытого аккаунта видно
// только одобренным подписчикам. Дневник питания — по отдельной настройке
// владельца, и подписка сама по себе туда доступа не даёт.
//
// Решает всё это СЕРВЕР: экран показывает то, что вернулось, и ничего не
// фильтрует сам. Замок на месте содержимого — это объяснение человеку, а не
// граница доступа: граница стоит в RLS.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store.jsx'
import {
  getRelationship, userProfile, listFollowers, listFollowing, listMutuals,
  unblock, acceptFollowRequest, declineFollowRequest, removeFollower,
} from '../lib/social.js'
import {
  EMPTY_RELATIONSHIP, canMessage, canViewDiary, relationshipLabel,
  isLocked, messageGoesToRequests,
} from '../lib/relationship.js'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { Avatar, LockBadge } from './Avatar.jsx'
import FollowButton from './FollowButton.jsx'
import PeopleList from './PeopleList.jsx'
import ThoughtsFeed from './ThoughtsFeed.jsx'
import ProfileCounts from './ProfileCounts.jsx'
import RelationshipSheet from './social/RelationshipSheet.jsx'

const PAGE = 50

export default function PublicProfile({ userId, onClose, onOpenProfile, onOpenChat }) {
  const { user } = useStore()
  const myId = user?.id || ''
  const isMe = userId === myId

  const [card, setCard] = useState(null)
  const [rel, setRel] = useState({ ...EMPTY_RELATIONSHIP })
  // Четыре разных состояния, которые раньше сливались в одно.
  //   loading — ещё не знаем ничего;
  //   ready   — профиль пришёл;
  //   missing — сервер ответил, но профиля нет (удалённый аккаунт, блокировка);
  //   error   — не дозвонились.
  // Прежний экран рисовал полную витрину сразу: пока запрос летел, человек
  // видел «Без имени», прочерки в счётчиках и пустую ленту — то есть экран
  // утверждал то, чего ещё не знал.
  const [phase, setPhase] = useState('loading')
  const [tab, setTab] = useState('thoughts') // thoughts | followers | following | friends
  const [people, setPeople] = useState(null)
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleMore, setPeopleMore] = useState(false)
  const [peopleBusy, setPeopleBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const [menu, setMenu] = useState(false)

  const { panelProps, scrimProps, close: handleClose } = useSwipeBack(onClose)
  useScrollLock()

  // Счётчик оверлеев: профиль может открыться поверх другого профиля (из
  // ленты → автор → его подписчики → ещё профиль), и класс has-overlay должен
  // сняться только с последним из них.
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
        isMe ? Promise.resolve({ ...EMPTY_RELATIONSHIP, isSelf: true }) : getRelationship(userId),
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

  const loadPeople = useCallback(async (which, offset = 0) => {
    const fetcher = which === 'followers' ? listFollowers
      : which === 'following' ? listFollowing : listMutuals
    return fetcher(userId, { limit: PAGE, offset })
  }, [userId])

  useEffect(() => {
    let alive = true
    if (tab === 'thoughts') { setPeople(null); setPeopleLoading(false); return }
    setPeople(null)
    setPeopleLoading(true)
    ;(async () => {
      try {
        const list = await loadPeople(tab)
        if (alive) { setPeople(list); setPeopleMore(list.length === PAGE) }
      } catch {
        if (alive) { setPeople([]); setPeopleMore(false) }
      } finally {
        if (alive) setPeopleLoading(false)
      }
    })()
    return () => { alive = false }
  }, [tab, loadPeople])

  const morePeople = async () => {
    if (peopleBusy || !people) return
    setPeopleBusy(true)
    try {
      const rows = await loadPeople(tab, people.length)
      const seen = new Set(people.map((p) => p.user_id))
      setPeople([...people, ...rows.filter((r) => !seen.has(r.user_id))])
      setPeopleMore(rows.length === PAGE)
    } catch { setPeopleMore(false) }
    finally { setPeopleBusy(false) }
  }

  const act = async (fn, okNote) => {
    setErr(null); setNote(null)
    const res = await fn()
    if (res?.error) { setErr(res.error); return }
    if (okNote) setNote(okNote)
    load()
  }

  const openChat = async () => {
    if (!onOpenChat) return
    onOpenChat({
      id: userId,
      name,
      display_name: card?.display_name,
      username: card?.username,
      avatar: card?.avatar_url,
      avatar_url: card?.avatar_url,
    })
  }

  // Поделиться профилем: системный лист там, где он есть (телефон), иначе
  // копирование ссылки. Ссылка ведёт на приложение с ником в адресе —
  // отдельной публичной страницы у профиля нет, и делать вид, что есть,
  // нельзя.
  const shareProfile = async () => {
    const link = `${window.location.origin}/?u=${card?.username || ''}`
    const text = `${card?.display_name || card?.username} в EatAps`
    try {
      if (navigator.share) { await navigator.share({ title: text, url: link }); return }
      await navigator.clipboard.writeText(link)
      setNote('Ссылка скопирована')
    } catch {
      // Отказ от системного листа — не ошибка: человек просто передумал.
    }
  }

  const name = card?.display_name || card?.username || 'Без имени'
  const label = isMe ? null : relationshipLabel(rel)
  const locked = !isMe && isLocked(rel)

  // Оболочка одна на все состояния: шапка с «назад» должна быть на месте и
  // тогда, когда показывать нечего. Без неё экран ошибки становится ловушкой —
  // выйти из него можно только жестом, о котором никто не предупреждал.
  const Shell = ({ children }) => (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div className="chat-overlay" {...panelProps}>
        <header className="chat-header">
          <button className="iconbtn" onClick={handleClose} style={{ fontSize: 22 }} aria-label="Назад">‹</button>
          <span style={{ fontSize: 16, fontWeight: 640, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card?.username || 'Профиль'}
          </span>
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
  // (user_profile не отдаёт строку ни в ту, ни в другую сторону).
  if (phase === 'missing') {
    return (
      <Shell>
        <div className="screen" style={{ textAlign: 'center', paddingTop: 48 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>{rel.blocked ? '🚫' : '👻'}</div>
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 14 }}>
            {rel.blocked
              ? 'Вы заблокировали этого человека. Его профиль, записи и переписка скрыты.'
              : 'Профиль недоступен — возможно, аккаунт удалён.'}
          </p>
          {rel.blocked && (
            <button
              className="btn ghost"
              style={{ width: 'auto', padding: '0 22px', margin: '0 auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => act(() => unblock(userId))}
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
        <span className="row gap8" style={{ fontSize: 16, fontWeight: 640, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card?.username || 'Профиль'}
          </span>
          {card?.is_private && <LockBadge size={13} />}
        </span>
        {!isMe && (
          <button className="iconbtn" onClick={() => setMenu(true)} aria-label="Действия с этим человеком">⋯</button>
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

        <ProfileCounts card={card} tab={tab} onPick={locked ? null : setTab} />

        {/* Входящая просьба о подписке разбирается прямо здесь: человек
            открыл профиль того, кто к нему просится, и уходить ради решения
            на другой экран незачем. */}
        {!isMe && rel.requestReceived && (
          <div className="card" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 12 }}>
              {name} просится к вам в подписчики.
            </p>
            <div className="row gap8">
              <button className="btn" style={{ flex: 1 }} onClick={() => act(() => acceptFollowRequest(userId), 'Запрос принят')}>
                Принять
              </button>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => act(() => declineFollowRequest(userId))}>
                Удалить
              </button>
            </div>
          </div>
        )}

        {!isMe && (
          <div className="row gap8" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <FollowButton
              myId={myId}
              userId={userId}
              rel={rel}
              name={name}
              onChange={setRel}
              onRefresh={load}
              onOpenChat={onOpenChat ? openChat : null}
            />

            {/* Кнопка есть только там, где вызывающий экран умеет открыть
                чат. В профиле, открытом из своего же профиля, чата нет — и
                мёртвая кнопка «Написать» была бы хуже её отсутствия. */}
            {canMessage(rel) && onOpenChat && (
              <button className="btn soft" style={{ width: 'auto', padding: '0 18px' }} onClick={openChat}>
                Написать
              </button>
            )}
          </div>
        )}

        {note && <p style={{ fontSize: 13, color: 'var(--primary-strong)', marginBottom: 10 }}>{note}</p>}
        {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

        {/* Честное объяснение того, что человек НЕ видит, вместо пустоты. */}
        {!isMe && !locked && !canViewDiary(rel) && (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.45 }}>
            Дневник питания открыт по настройке владельца.
            {canMessage(rel) && messageGoesToRequests(rel)
              ? ' Первое сообщение попадёт к нему в «Запросы».'
              : ''}
          </p>
        )}

        {locked ? (
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12, color: 'var(--ink-3)' }}>
              <LockBadge size={30} />
            </div>
            <p style={{ fontSize: 15.5, fontWeight: 620, marginBottom: 6 }}>Это закрытый аккаунт</p>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
              {rel.requestSent
                ? 'Запрос отправлен. Записи, дневник и списки откроются, когда владелец его одобрит.'
                : 'Подпишитесь, чтобы видеть записи. Владелец сам решает, кого впустить.'}
            </p>
          </div>
        ) : tab === 'thoughts' ? (
          <ThoughtsFeed
            userId={userId}
            isOwnProfile={isMe}
            authorName={name}
            authorAvatar={card?.avatar_url}
            rel={isMe ? null : rel}
          />
        ) : (
          <PeopleList
            people={people || []}
            loading={peopleLoading}
            myId={myId}
            onOpen={onOpenProfile}
            onRefresh={load}
            searchable
            hasMore={peopleMore}
            loadingMore={peopleBusy}
            onLoadMore={morePeople}
            context={isMe && tab === 'followers' ? 'followers' : 'profile'}
            actions={isMe && tab === 'followers'
              ? (p) => (
                <button
                  className="btn ghost"
                  style={{ width: 'auto', height: 32, padding: '0 12px', fontSize: 13, flex: '0 0 auto', color: 'var(--ink-3)' }}
                  onClick={async () => {
                    const res = await removeFollower(p.user_id)
                    if (res?.error) { setErr(res.error); return }
                    setPeople((cur) => (cur || []).filter((x) => x.user_id !== p.user_id))
                    load()
                  }}
                >
                  Убрать
                </button>
              )
              : null}
            empty={
              tab === 'followers' ? 'Подписчиков пока нет'
                : tab === 'following' ? 'Пока ни на кого не подписан'
                : 'Взаимных подписок пока нет'
            }
          />
        )}
      </div>

      {menu && (
        <RelationshipSheet
          userId={userId}
          name={name}
          rel={rel}
          context="profile"
          onOpenChat={onOpenChat ? openChat : null}
          onShare={shareProfile}
          onClose={() => setMenu(false)}
          onChanged={() => { setMenu(false); load() }}
        />
      )}
    </div>
    </>
  )
}
