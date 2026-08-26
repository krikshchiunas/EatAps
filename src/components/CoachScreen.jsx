import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store.jsx'
import {
  amICoach, inviteCoach, listCoachLinks, acceptCoachLink, removeCoachLink,
  pullFriendState, listDayComments, addDayComment, deleteDayComment,
} from '../lib/supabase.js'
import { projectFriendState } from '../lib/friendView.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { sumDay } from '../lib/nutrition.js'
import { getMealSections, foodsForMeal } from '../lib/meals.js'
import { targetsForDay } from '../lib/body.js'

// ─────────────────────────────────────────────────────────────────────────────
// Тренер и клиент.
//
// Доступ к дневнику отдаёт ТОЛЬКО клиент: он приглашает тренера по нику, тренер
// принимает. Обратный порядок (тренер подписывается сам) означал бы, что чужой
// человек читает ваш дневник, пока вы не заметили.
//
// Клиент может забрать доступ в любой момент — кнопка «Отозвать» рядом с
// каждым тренером, без подтверждений и уговоров.
// ─────────────────────────────────────────────────────────────────────────────

function Avatar({ src, name, size = 40 }) {
  if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--primary-weak)',
      display: 'grid', placeItems: 'center', color: 'var(--primary-strong)',
      fontWeight: 600, fontSize: size * 0.42, flex: '0 0 auto',
    }}>
      {(name || '?').trim().slice(0, 1).toUpperCase()}
    </div>
  )
}

export default function CoachScreen({ onClose }) {
  const { user } = useStore()
  const myId = user?.id
  const [isCoach, setIsCoach] = useState(false)
  const [links, setLinks] = useState({ coaches: [], clients: [], invites: [] })
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState(null) // клиент, чей дневник открыт

  const reload = useCallback(async () => {
    if (!myId) return
    setLoading(true)
    try {
      const [coach, l] = await Promise.all([amICoach(myId), listCoachLinks(myId)])
      setIsCoach(coach)
      setLinks(l)
    } catch {
      // Сеть могла отвалиться — оставляем то, что уже показано.
    }
    setLoading(false)
  }, [myId])

  useEffect(() => { reload() }, [reload])

  if (viewing) {
    return <ClientDiary client={viewing} myId={myId} onClose={() => setViewing(null)} />
  }

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Совместная работа</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Тренер</h1>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
      </div>

      {loading && <p className="muted" style={{ fontSize: 14 }}>Загружаем…</p>}

      {isCoach && (
        <>
          <CoachInvites invites={links.invites} onDone={reload} />
          <ClientList clients={links.clients} onOpen={setViewing} onDone={reload} />
        </>
      )}

      <MyCoaches coaches={links.coaches} myId={myId} onDone={reload} />

      {!isCoach && (
        <p className="set-note" style={{ marginTop: 22 }}>
          Вы тренер или нутрициолог? Подайте заявку в разделе «Поддержка» → «Стать тренером».
          После одобрения клиенты смогут приглашать вас по вашему нику.
        </p>
      )}
    </div>
  )
}

// ── Приглашения, ждущие моего решения (я тренер) ──────────────────────────────
function CoachInvites({ invites, onDone }) {
  const [busy, setBusy] = useState(null)
  if (!invites.length) return null

  const act = async (rowId, accept) => {
    setBusy(rowId)
    await (accept ? acceptCoachLink(rowId) : removeCoachLink(rowId))
    setBusy(null)
    onDone()
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Новые клиенты</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Эти люди открыли вам доступ к своему дневнику.
      </p>
      {invites.map((c) => (
        <div key={c.rowId} className="row gap12" style={{ alignItems: 'center', marginBottom: 12 }}>
          <Avatar src={c.avatar} name={c.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name || 'Без имени'}</div>
          </div>
          <button className="btn soft" style={{ width: 'auto', height: 36, fontSize: 13 }} disabled={busy === c.rowId} onClick={() => act(c.rowId, true)}>Принять</button>
          <button className="btn ghost" style={{ width: 'auto', height: 36, fontSize: 13 }} disabled={busy === c.rowId} onClick={() => act(c.rowId, false)}>Отклонить</button>
        </div>
      ))}
    </div>
  )
}

// ── Мои клиенты (я тренер) ────────────────────────────────────────────────────
function ClientList({ clients, onOpen, onDone }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Мои клиенты</div>
      {clients.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>Пока никого. Клиент приглашает вас сам — по вашему нику.</p>
      ) : clients.map((c) => (
        <div key={c.rowId} className="row gap12" style={{ alignItems: 'center', marginBottom: 12 }}>
          <Avatar src={c.avatar} name={c.name} />
          <button style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => onOpen(c)}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name || 'Без имени'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Открыть дневник →</div>
          </button>
          <button
            className="iconbtn"
            aria-label="Прекратить работу"
            onClick={async () => { await removeCoachLink(c.rowId); onDone() }}
          >✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Мои тренеры (я клиент) ────────────────────────────────────────────────────
function MyCoaches({ coaches, myId, onDone }) {
  const [id, setId] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const invite = async () => {
    setBusy(true)
    setMsg(null)
    const res = await inviteCoach({ myId, targetId: id })
    setBusy(false)
    setMsg(res)
    if (res.ok) { setId(''); onDone() }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Мой тренер</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Тренер увидит ваш дневник питания и сможет оставлять комментарии к дням.
        Доступ можно забрать в любой момент.
      </p>

      {coaches.map((c) => (
        <div key={c.rowId} className="row gap12" style={{ alignItems: 'center', marginBottom: 12 }}>
          <Avatar src={c.avatar} name={c.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name || 'Без имени'}</div>
            <div style={{ fontSize: 12.5, color: c.status === 'accepted' ? 'var(--good)' : 'var(--ink-3)' }}>
              {c.status === 'accepted' ? 'видит ваш дневник' : 'приглашение отправлено'}
            </div>
          </div>
          <button
            className="btn ghost"
            style={{ width: 'auto', height: 36, fontSize: 13, color: 'var(--danger)' }}
            onClick={async () => { await removeCoachLink(c.rowId); onDone() }}
          >
            Отозвать
          </button>
        </div>
      ))}

      <div className="field" style={{ marginTop: coaches.length ? 8 : 0 }}>
        <label className="label">Ник тренера</label>
        <input
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="denis"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ marginTop: 6 }}
        />
      </div>
      <button className="btn" style={{ marginTop: 10 }} disabled={busy || !id.trim()} onClick={invite}>
        {busy ? 'Отправляем…' : 'Пригласить тренера'}
      </button>
      {msg && (
        <p className="set-note" style={{ color: msg.error ? 'var(--danger)' : 'var(--good)', marginBottom: 0 }}>
          {msg.error || msg.ok}
        </p>
      )}
    </div>
  )
}

// ── Дневник клиента глазами тренера ───────────────────────────────────────────
// Только чтение + комментарии. Менять чужую еду тренер не может: дневник
// принадлежит клиенту, и правки «за него» сделали бы данные недостоверными.
function ClientDiary({ client, myId, onClose }) {
  const [date, setDate] = useState(keyOf())
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    pullFriendState(client.id)
      .then((res) => { if (alive) setState(projectFriendState(res?.state)) })
      .catch(() => { if (alive) setError('Не удалось загрузить дневник') })
    return () => { alive = false }
  }, [client.id])

  const day = state?.days?.[date] || { meals: [], mealSections: [] }
  const totals = sumDay(day.meals)
  const targets = state ? targetsForDay(state.days, date, state.profile) : null
  const goal = Number(targets?.calories) || 0
  const sections = getMealSections(day)
  const today = keyOf()

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'center', marginBottom: 16 }}>
        <button className="iconbtn" onClick={onClose} aria-label="Назад">‹</button>
        <div className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
          <Avatar src={client.avatar} name={client.name} size={32} />
          <span style={{ fontSize: 16, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {client.name || 'Клиент'}
          </span>
        </div>
        <div style={{ width: 40 }} />
      </div>

      <div className="row between" style={{ alignItems: 'center', marginBottom: 14 }}>
        <button className="iconbtn" onClick={() => setDate((d) => addDays(d, -1))} aria-label="Предыдущий день">‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 620 }}>{humanDay(date, today)}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{humanDow(date)}</div>
        </div>
        <button
          className="iconbtn"
          onClick={() => setDate((d) => addDays(d, 1))}
          disabled={date >= today}
          style={{ opacity: date >= today ? 0.4 : 1 }}
          aria-label="Следующий день"
        >›</button>
      </div>

      {error && <p className="muted" style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</p>}
      {!state && !error && <p className="muted" style={{ fontSize: 14 }}>Загружаем дневник…</p>}

      {state && (
        <>
          <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
            <div className="tabular" style={{ fontSize: 34, fontWeight: 700 }}>{totals.kcal}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              ккал{goal > 0 ? ` из ${goal}` : ''}
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 18, marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
              <span>Б {totals.protein}</span>
              <span>Ж {totals.fat}</span>
              <span>У {totals.carbs}</span>
            </div>
            {day.statsExcluded && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}>
                🚫 Клиент пометил день как неучитываемый
              </div>
            )}
          </div>

          {sections.map((section) => {
            const foods = foodsForMeal(day, section.id)
            if (!foods.length) return null
            const t = sumDay(foods)
            return (
              <div key={section.id} className="card" style={{ marginBottom: 12 }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 620 }}>{section.emoji} {section.label}</span>
                  <span className="tabular" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{t.kcal} ккал</span>
                </div>
                {foods.map((f) => (
                  <div key={f.id} className="row between" style={{ fontSize: 14, padding: '4px 0' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.emoji || '🍽️'} {f.name}
                      {f.grams ? <span style={{ color: 'var(--ink-3)' }}> · {f.grams} {f.unit || 'г'}</span> : null}
                    </span>
                    <span className="tabular" style={{ color: 'var(--ink-3)', flex: '0 0 auto', marginLeft: 10 }}>{f.kcal}</span>
                  </div>
                ))}
              </div>
            )
          })}

          {sections.every((s) => foodsForMeal(day, s.id).length === 0) && (
            <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
              В этот день записей нет.
            </p>
          )}

          <DayComments clientId={client.id} authorId={myId} day={date} />
        </>
      )}
    </div>
  )
}

// ── Комментарии к дню ─────────────────────────────────────────────────────────
// Видны обеим сторонам: это диалог о конкретном дне, а не заметки «про себя».
function DayComments({ clientId, authorId, day }) {
  const [list, setList] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listDayComments(clientId, day).then(setList).catch(() => setList([]))
  }, [clientId, day])

  useEffect(() => { reload() }, [reload])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    const res = await addDayComment({ clientId, authorId, day, text: body })
    setBusy(false)
    if (res.ok) { setText(''); reload() }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 12 }}>Комментарии к дню</div>
      {list.map((c) => (
        <div key={c.id} style={{ marginBottom: 12 }}>
          <div className="row between" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 3 }}>
            <span>{c.author === authorId ? 'Вы' : 'Клиент'}</span>
            <span className="row gap8" style={{ alignItems: 'center' }}>
              {new Date(c.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {c.author === authorId && (
                <button
                  style={{ color: 'var(--ink-3)' }}
                  aria-label="Удалить комментарий"
                  onClick={async () => { await deleteDayComment(c.id); reload() }}
                >✕</button>
              )}
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      ))}
      {list.length === 0 && <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>Пока нет комментариев.</p>}

      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Что посоветуете по этому дню?"
        rows={3}
        maxLength={2000}
        style={{ resize: 'vertical', minHeight: 70, paddingTop: 10, lineHeight: 1.45, marginBottom: 10 }}
      />
      <button className="btn" disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Отправляем…' : 'Оставить комментарий'}
      </button>
    </div>
  )
}
