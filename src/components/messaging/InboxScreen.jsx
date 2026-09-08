// Входящие — главный экран переписки.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЕСТЬ И ПОЧЕМУ ИМЕННО ЭТО
//
// Сверху: поиск, «Запросы» с числом, «Написать». Ниже — список диалогов,
// отсортированный по времени последнего сообщения. Всё, что не помещается в
// строку (заглушить, архив, удалить, заблокировать), лежит в меню строки:
// список из тридцати переписок не может нести по четыре кнопки в каждой.
//
// Диалоги в АРХИВЕ показываются отдельной кнопкой, а не вперемешку: архив
// затем и нужен, чтобы переписка ушла с глаз. Новое сообщение возвращает её
// обратно — иначе архив превращается в чёрную дыру, куда пропадают ответы.
//
// ─────────────────────────────────────────────────────────────────────────────
// REALTIME
//
// Список слушает два потока: свои строки участия (появился новый диалог,
// сменилось состояние, пришло прочтение) и входящие сообщения. Оба идут через
// общий хаб, оба снимаются при размонтировании. Отдельного канала на каждую
// строку списка нет и быть не должно — тридцать подписок на один экран это
// тридцать каналов на одном сокете.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../store.jsx'
import {
  listConversations, subscribeToInbox, isMuted, conversationPreview, badgeText,
  setConversationArchived, setConversationMuted, clearConversation,
  MUTE_OPTIONS,
} from '../../lib/messaging.js'
import { block } from '../../lib/social.js'
import { Avatar } from '../Avatar.jsx'
import ActionSheet, { ICONS } from '../social/ActionSheet.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import ReportSheet from '../social/ReportSheet.jsx'

const PAGE = 40

// Время в списке: сегодня — часы, на этой неделе — день недели, дальше —
// дата. Полная дата у сегодняшнего сообщения не несёт информации, а «14:32» у
// прошлогоднего — вводит в заблуждение. Живёт здесь, а не в chatFormat: это
// формат СПИСКА, и в самой переписке он не используется.
function shortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (Date.now() - d.getTime() < 7 * 86400_000) {
    return d.toLocaleDateString('ru-RU', { weekday: 'short' })
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function InboxScreen({
  onOpenConversation, onOpenRequests, onOpenNew, onOpenSearch,
  requestCount = 0, onChanged,
}) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [items, setItems] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [archived, setArchived] = useState(false)
  const [err, setErr] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [menu, setMenu] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [report, setReport] = useState(null)
  const sentinel = useRef(null)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!myId) { setItems([]); return }
    if (!silent) { setItems(null); setErr(null) }
    try {
      const res = await listConversations({ archived, limit: PAGE })
      setItems(res.items)
      setCursor(res.cursor)
      // «Раздела нет в базе» и «переписок нет» — разные вещи, и говорить о
      // втором, когда верно первое, значит утверждать неправду.
      setUnavailable(Boolean(res.unavailable))
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить переписки')
      setItems([])
    }
  }, [myId, archived])

  useEffect(() => { load() }, [load])

  // Realtime: список пересобирается по любому изменению своего участия или
  // входящему сообщению. Перечитываем ПЕРВУЮ страницу — диалог с новым
  // сообщением по определению поднимается наверх.
  useEffect(() => {
    if (!myId) return
    return subscribeToInbox(myId, () => { load({ silent: true }); onChanged?.() })
  }, [myId, load, onChanged])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listConversations({ archived, limit: PAGE, before: cursor })
      setItems((prev) => {
        const seen = new Set((prev || []).map((c) => c.id))
        return [...(prev || []), ...res.items.filter((c) => !seen.has(c.id))]
      })
      setCursor(res.cursor)
    } catch (e) { setErr(e.message || 'Не удалось догрузить') }
    finally { setLoadingMore(false) }
  }, [cursor, loadingMore, archived])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, loadMore])

  // Пункт меню, открывающий подтверждение, обязан СНАЧАЛА снять меню — иначе
  // запоздавший onClose шторки (200–400 мс на анимацию выезда) закроет и
  // подтверждение вместе с ним.
  const holdMenu = (dialog) => { setMenu(null); setConfirm(dialog) }

  const act = async (fn) => {
    setMenu(null)
    const res = await fn()
    if (res?.error) { setErr(res.error); return }
    load({ silent: true })
    onChanged?.()
  }

  const menuItems = (c) => {
    const muted = isMuted(c)
    return [
      {
        key: 'mute',
        label: muted ? 'Включить уведомления' : 'Заглушить',
        icon: muted ? ICONS.unmute : ICONS.mute,
        run: () => (muted
          ? act(() => setConversationMuted(c.id, null))
          : setMenu({ conv: c, mode: 'mute' })),
      },
      {
        key: 'archive',
        label: c.archived ? 'Вернуть из архива' : 'В архив',
        hint: c.archived ? null : 'Новое сообщение вернёт переписку сюда',
        icon: ICONS.archive,
        run: () => act(() => setConversationArchived(c.id, !c.archived)),
      },
      {
        key: 'clear',
        label: 'Удалить переписку',
        hint: 'Только у вас — у собеседника история останется',
        icon: ICONS.trash,
        danger: true,
        run: () => holdMenu({
          text: `Удалить переписку${c.title ? ` с «${c.title}»` : ''}? История исчезнет только у вас — у собеседника она останется.`,
          yes: () => act(() => clearConversation(c.id)),
        }),
      },
      c.kind === 'direct' && c.peerId ? {
        key: 'block',
        label: 'Заблокировать',
        icon: ICONS.block,
        danger: true,
        run: () => holdMenu({
          text: `Заблокировать ${c.title || 'этого человека'}? Подписки в обе стороны будут удалены, писать он больше не сможет.`,
          yes: () => act(() => block(c.peerId)),
        }),
      } : null,
      {
        key: 'report',
        label: 'Пожаловаться',
        icon: ICONS.report,
        danger: true,
        run: () => { setMenu(null); setReport(c) },
      },
    ].filter(Boolean)
  }

  return (
    <div>
      <div className="row gap8" style={{ marginBottom: 14 }}>
        <button
          className="btn soft"
          style={{ flex: 1, height: 42, fontSize: 14.5 }}
          onClick={onOpenSearch}
        >
          Поиск людей и сообщений
        </button>
        <button
          className="btn"
          style={{ width: 'auto', height: 42, padding: '0 16px', fontSize: 14.5, flex: '0 0 auto' }}
          onClick={onOpenNew}
          aria-label="Новое сообщение"
        >
          Написать
        </button>
      </div>

      <div className="row gap8" style={{ marginBottom: 14 }}>
        <button
          className={`pill${!archived ? ' on' : ''}`}
          onClick={() => setArchived(false)}
        >
          Чаты
        </button>
        <button
          className={`pill${archived ? ' on' : ''}`}
          onClick={() => setArchived(true)}
        >
          Архив
        </button>
        <button className="pill" onClick={onOpenRequests} style={{ marginLeft: 'auto' }}>
          Запросы
          {requestCount > 0 && (
            <span style={{
              marginLeft: 6, minWidth: 18, height: 18, borderRadius: 999,
              background: 'var(--danger)', color: 'var(--on-danger)',
              fontSize: 11, fontWeight: 700, padding: '0 5px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {badgeText(requestCount)}
            </span>
          )}
        </button>
      </div>

      {err && (
        <div className="card" style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 14, color: 'var(--danger)', lineHeight: 1.5 }}>{err}</p>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => load()}>Повторить</button>
        </div>
      )}

      {items === null && [0, 1, 2, 3].map((i) => (
        <div key={i} className="row gap12" style={{ alignItems: 'center', padding: '12px 4px' }}>
          <div className="skel" style={{ width: 48, height: 48, borderRadius: '50%', flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ width: '42%', height: 13, borderRadius: 7, marginBottom: 7 }} />
            <div className="skel" style={{ width: '70%', height: 11, borderRadius: 6 }} />
          </div>
        </div>
      ))}

      {unavailable && (
        <div className="card">
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
            Переписка пока недоступна — база ещё не обновлена.
          </p>
        </div>
      )}

      {items?.length === 0 && !err && !unavailable && (
        <div className="card">
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
            {archived
              ? 'В архиве пусто. Убранная сюда переписка вернётся в чаты, как только придёт новое сообщение.'
              : 'Переписок пока нет. Нажмите «Написать» и найдите человека по имени или нику.'}
          </p>
        </div>
      )}

      {(items || []).map((c) => (
        <ConversationRow
          key={c.id}
          conv={c}
          myId={myId}
          onOpen={() => onOpenConversation(c)}
          onMenu={() => setMenu({ conv: c, mode: 'main' })}
        />
      ))}

      {cursor && (
        <div ref={sentinel} style={{ padding: '12px 0', textAlign: 'center' }}>
          {loadingMore && <span className="muted" style={{ fontSize: 13 }}>Загружаем…</span>}
        </div>
      )}

      {menu?.mode === 'main' && (
        <ActionSheet
          title={menu.conv.title || 'Диалог'}
          items={menuItems(menu.conv)}
          /* Закрываем ТОЛЬКО если всё ещё показываем главное меню. Шторка
             сообщает о закрытии через 200–400 мс после нажатия, и к этому
             моменту пункт «Заглушить» уже открыл подменю — глухое
             setMenu(null) закрыло бы его следом. */
          onClose={() => setMenu((m) => (m?.mode === 'main' ? null : m))}
        />
      )}

      {menu?.mode === 'mute' && (
        <ActionSheet
          title="Заглушить"
          subtitle="Сообщения продолжат приходить, но без уведомлений"
          items={MUTE_OPTIONS.map((o) => ({
            key: o.key,
            label: o.label,
            icon: ICONS.mute,
            run: () => act(() => setConversationMuted(menu.conv.id, Date.now() + o.ms)),
          }))}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          text={confirm.text}
          yesLabel="Подтвердить"
          noLabel="Отмена"
          onYes={() => { const y = confirm.yes; setConfirm(null); y() }}
          onNo={() => setConfirm(null)}
        />
      )}

      {report && (
        <ReportSheet
          kind="conversation"
          targetId={report.id}
          name={report.title}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  )
}

export function ConversationRow({ conv, myId, onOpen, onMenu }) {
  const muted = isMuted(conv)
  const name = conv.title || (conv.kind === 'group' ? 'Группа' : 'Без имени')
  const unread = conv.unread || 0

  return (
    <div style={{ position: 'relative', marginBottom: 2 }}>
      <button
        onClick={onOpen}
        style={{
          display: 'block', width: '100%', textAlign: 'left', background: 'none',
          border: 0, padding: '11px 44px 11px 4px', borderRadius: 16, color: 'inherit',
          cursor: 'pointer',
        }}
      >
        <div className="row gap12" style={{ alignItems: 'center' }}>
          <Avatar src={conv.avatarUrl} name={name} size={48} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
              <span style={{
                fontWeight: unread > 0 ? 700 : 600, fontSize: 15.5,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}
              </span>
              {conv.kind === 'group' && (
                <span className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>
                  · {conv.membersCount}
                </span>
              )}
              {muted && (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--ink-3)"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                     style={{ flex: '0 0 auto' }} aria-label="Заглушено">
                  <path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                </svg>
              )}
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto', flex: '0 0 auto' }}>
                {shortTime(conv.lastAt)}
              </span>
            </div>
            <div className="row gap8" style={{ alignItems: 'center', marginTop: 2 }}>
              <span
                className={unread > 0 ? '' : 'muted'}
                style={{
                  fontSize: 13.5, minWidth: 0, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontStyle: conv.last?.unsent ? 'italic' : 'normal',
                }}
              >
                {conversationPreview(conv, myId)}
              </span>
              {unread > 0 && (
                <span style={{
                  minWidth: 20, height: 20, borderRadius: 999,
                  background: muted ? 'var(--ink-3)' : 'var(--primary)',
                  color: 'var(--on-primary)',
                  fontSize: 11.5, fontWeight: 700, padding: '0 6px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flex: '0 0 auto',
                }}>
                  {badgeText(unread)}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      <button
        className="friend-more"
        onClick={(e) => { e.stopPropagation(); onMenu() }}
        aria-label={`Действия с диалогом ${name}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
    </div>
  )
}
