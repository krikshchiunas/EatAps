// Запросы на переписку.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОТКРЫТЬ ЗАПРОС — НЕ ЗНАЧИТ СОГЛАСИТЬСЯ
//
// Человек читает сообщение и только потом решает. Это принципиально: если бы
// открытие означало согласие, единственным безопасным способом посмотреть, что
// прислал незнакомый человек, было бы не смотреть вовсе.
//
// Решений три, и они разной силы:
//   Разрешить  — диалог переезжает в чаты, дальше переписка как обычно;
//   Удалить    — писать больше нельзя, но человек остаётся подписчиком, видит
//                профиль и записи. Это НЕ блокировка;
//   Заблокировать — полный разрыв, отдельная кнопка с подтверждением.
//
// Отказ от навязчивого сообщения не должен стоить человеку так же дорого, как
// блокировка, — поэтому «Удалить» и «Заблокировать» разведены.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import { listConversations, acceptRequest, declineRequest } from '../../lib/messaging.js'
import { block } from '../../lib/social.js'
import { Avatar, LockBadge } from '../Avatar.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import PushScreen from '../PushScreen.jsx'

export default function MessageRequestsScreen({ onClose, onOpenConversation, onChanged }) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!myId) { setItems([]); return }
    setErr(null)
    try {
      const res = await listConversations({ state: 'pending', limit: 50 })
      setItems(res.items)
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить запросы')
      setItems([])
    }
  }, [myId])

  useEffect(() => { load() }, [load])

  const decide = async (conv, what) => {
    if (busyId) return
    setBusyId(conv.id)
    const prev = items
    setItems((list) => (list || []).filter((c) => c.id !== conv.id))
    const res = what === 'accept' ? await acceptRequest(conv.id)
      : what === 'decline' ? await declineRequest(conv.id)
      : await block(conv.peerId)
    setBusyId(null)
    if (res?.error) { setErr(res.error); setItems(prev); return }
    onChanged?.()
  }

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 8 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>Запросы</h1>
          </div>

          <p className="set-note" style={{ margin: '0 4px 16px' }}>
            Сюда попадают сообщения от тех, кому вы не разрешали писать сразу.
            Человек не знает, что его сообщение ждёт решения.
          </p>

          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

          {items === null && [0, 1].map((i) => (
            <div key={i} className="card" style={{ marginBottom: 8 }}>
              <div className="skel" style={{ height: 46, borderRadius: 12 }} />
            </div>
          ))}

          {items?.length === 0 && !err && (
            <div className="card">
              <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
                Запросов нет.
              </p>
            </div>
          )}

          {(items || []).map((c) => {
            const name = c.title || 'Без имени'
            return (
              <div key={c.id} className="card" style={{ padding: 14, marginBottom: 8 }}>
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0 }}
                  onClick={() => onOpenConversation(c)}
                >
                  <div className="row gap12" style={{ alignItems: 'center' }}>
                    <Avatar src={c.avatarUrl} name={name} size={44} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </span>
                        {c.peerPrivate && <LockBadge />}
                      </div>
                      {c.peerUsername && <div className="muted" style={{ fontSize: 13 }}>{c.peerUsername}</div>}
                    </div>
                  </div>
                  {c.last?.text && (
                    <p className="muted" style={{
                      fontSize: 14, lineHeight: 1.45, margin: '10px 0 0',
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {c.last.text}
                    </p>
                  )}
                  {!c.last?.text && (c.last?.imageUrl || c.last?.media) && (
                    <p className="muted" style={{ fontSize: 14, margin: '10px 0 0' }}>Вложение</p>
                  )}
                </button>

                <div className="row gap8" style={{ marginTop: 12 }}>
                  <button className="btn" style={{ flex: 1 }} disabled={busyId === c.id} onClick={() => decide(c, 'accept')}>
                    Разрешить
                  </button>
                  <button
                    className="btn ghost"
                    style={{ flex: 1 }}
                    disabled={busyId === c.id}
                    onClick={() => setConfirm({
                      conv: c, what: 'decline',
                      text: `Запретить ${name} писать вам? Переписка закроется, но подписки и доступ к вашим записям не изменятся.`,
                    })}
                  >
                    Удалить
                  </button>
                </div>
                {c.peerId && (
                  <button
                    className="btn ghost"
                    style={{ marginTop: 8, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    disabled={busyId === c.id}
                    onClick={() => setConfirm({
                      conv: c, what: 'block',
                      text: `Заблокировать ${name}? Подписки в обе стороны будут удалены, найти вас и написать он больше не сможет.`,
                    })}
                  >
                    Заблокировать
                  </button>
                )}
              </div>
            )
          })}

          {confirm && (
            <ConfirmDialog
              text={confirm.text}
              yesLabel="Подтвердить"
              noLabel="Отмена"
              onYes={() => { const c = confirm; setConfirm(null); decide(c.conv, c.what) }}
              onNo={() => setConfirm(null)}
            />
          )}
        </div>
      )}
    </PushScreen>
  )
}
