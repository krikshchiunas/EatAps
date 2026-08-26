import { useState, useEffect, useCallback, useMemo } from 'react'
import { useStore } from '../store.jsx'
import {
  listChallenges, createChallenge, joinChallenge, leaveChallenge,
  deleteChallenge, pushChallengeDays, challengeBoard,
} from '../lib/supabase.js'
import { CHALLENGE_KINDS, kindMeta, myProgress, challengeStatus, validateChallenge, MAX_DAYS } from '../lib/challenges.js'
import { keyOf, addDays, fromKey } from '../lib/date.js'

// ─────────────────────────────────────────────────────────────────────────────
// Челленджи с друзьями.
//
// Живут внутри вкладки «События» социального хаба, а не отдельным экраном за
// иконкой в шапке: соревнование — это событие, и искать его человек идёт туда
// же, куда за остальными событиями. Поэтому onClose необязателен: без него
// компонент рисуется как часть чужого экрана, без собственной обёртки и без
// кнопки «закрыть».
//
// Прогресс каждый участник считает у себя из своего дневника и отправляет
// только итог по дню (см. lib/challenges.js). Поэтому лидерборд не требует
// доступа к чужой еде: участие в соревновании — не повод раскрывать всю
// историю питания.
// ─────────────────────────────────────────────────────────────────────────────

const fmtDate = (key) => {
  const d = fromKey(key)
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_LABEL = { upcoming: 'скоро', active: 'идёт', finished: 'завершён' }

export default function ChallengesScreen({ onClose = null }) {
  const { user, days, profile } = useStore()
  const myId = user?.id
  const today = keyOf()
  // Встроенный режим: своей обёртки-экрана нет, её даёт вкладка. Именно
  // className, а не компонент-обёртка: компонент, объявленный внутри рендера,
  // на каждом обновлении получал бы новую идентичность, и React размонтировал
  // бы всё поддерево — форма создания теряла бы введённый текст.
  const shell = onClose ? 'screen' : ''

  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [joinId, setJoinId] = useState('')
  const [msg, setMsg] = useState(null)

  const reload = useCallback(async () => {
    if (!myId) return
    setLoading(true)
    try { setList(await listChallenges(myId)) } catch { /* показываем что было */ }
    setLoading(false)
  }, [myId])

  useEffect(() => { reload() }, [reload])

  if (!myId) {
    return (
      <div className={shell}>
        <Header onClose={onClose} />
        <p className="set-note">Челленджи работают только с аккаунтом: соревноваться не с кем, пока данные лежат на одном устройстве.</p>
      </div>
    )
  }

  const join = async () => {
    const id = joinId.trim()
    if (!id) return
    const res = await joinChallenge({ challengeId: id, myId })
    setMsg(res)
    if (res.ok) { setJoinId(''); reload() }
  }

  return (
    <div className={shell}>
      <Header onClose={onClose} />

      {loading && <p className="muted" style={{ fontSize: 14 }}>Загружаем…</p>}

      {!loading && list.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 14 }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🏁</div>
          <div className="h2" style={{ fontSize: 17, marginBottom: 6 }}>Пока ни одного челленджа</div>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Создайте свой и отправьте код друзьям в чат — или вставьте код, который прислали вам.
          </p>
        </div>
      )}

      {list.map((ch) => (
        <ChallengeCard
          key={ch.id}
          challenge={ch}
          myId={myId}
          days={days}
          profile={profile}
          today={today}
          onChanged={reload}
        />
      ))}

      {creating ? (
        <CreateForm myId={myId} today={today} onDone={() => { setCreating(false); reload() }} onCancel={() => setCreating(false)} />
      ) : (
        <button className="btn" style={{ marginTop: 6 }} onClick={() => setCreating(true)}>＋ Новый челлендж</button>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Присоединиться</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Вставьте код челленджа, который прислал друг.</p>
        <input
          className="input"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="код челленджа"
          style={{ marginBottom: 10 }}
        />
        <button className="btn ghost" disabled={!joinId.trim()} onClick={join}>Участвовать</button>
        {msg && (
          <p className="set-note" style={{ color: msg.error ? 'var(--danger)' : 'var(--good)', marginBottom: 0 }}>
            {msg.error || 'Вы в челлендже'}
          </p>
        )}
      </div>
    </div>
  )
}

function Header({ onClose }) {
  // Во встроенном режиме заголовок экрана не нужен: над ним уже стоит
  // «Общение» и полоска вкладок, и второй крупный заголовок только съедал бы
  // первый экран прокрутки.
  if (!onClose) return null
  return (
    <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
      <div>
        <div className="eyebrow">Вместе с друзьями</div>
        <h1 className="h1" style={{ margin: '4px 0 0' }}>Челленджи</h1>
      </div>
      <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
    </div>
  )
}

// ── Карточка челленджа с лидербордом ──────────────────────────────────────────
function ChallengeCard({ challenge, myId, days, profile, today, onChanged }) {
  const [board, setBoard] = useState([])
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const meta = kindMeta(challenge.kind)
  const status = challengeStatus(challenge, today)
  const mine = challenge.owner === myId

  // Пересчитываем свой прогресс из дневника при каждом его изменении.
  const progress = useMemo(
    () => myProgress(challenge, days, profile, today),
    [challenge, days, profile, today],
  )

  // Отправляем свои итоги и забираем лидерборд. Отправка идемпотентна (upsert),
  // поэтому лишний вызов ничего не портит.
  const sync = useCallback(async () => {
    const elapsed = []
    let k = challenge.starts_on
    while (k <= challenge.ends_on && k <= today) { elapsed.push(k); k = addDays(k, 1) }
    await pushChallengeDays({ challengeId: challenge.id, myId, elapsedDays: elapsed, scoredDays: progress.scoredDays })
    setBoard(await challengeBoard(challenge.id))
  }, [challenge.id, challenge.starts_on, challenge.ends_on, myId, progress.scoredDays, today])

  useEffect(() => { sync() }, [sync])

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(challenge.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* буфер недоступен — код всё равно виден на экране */ }
  }

  const leave = async () => {
    if (mine) await deleteChallenge(challenge.id)
    else await leaveChallenge({ challengeId: challenge.id, myId })
    onChanged()
  }

  const pct = progress.rate == null ? 0 : Math.round(progress.rate * 100)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row gap8" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 18 }}>{meta.emoji}</span>
            <span className="h2" style={{ fontSize: 17 }}>{challenge.title}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>
            {meta.title} · {fmtDate(challenge.starts_on)}–{fmtDate(challenge.ends_on)} · {STATUS_LABEL[status]}
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{meta.desc}</p>

      {/* Свой прогресс */}
      <div className="row between" style={{ alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 550 }}>Ваш результат</span>
        <span className="tabular" style={{ fontSize: 14, fontWeight: 650, color: 'var(--primary)' }}>
          {progress.scored} / {progress.elapsed}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--primary)', borderRadius: 5, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
        {progress.notStarted
          ? 'Ещё не начался'
          : progress.finished
            ? `Завершён · зачтено ${progress.scored} из ${progress.total} дней`
            : `${pct}% прошедших дней · впереди ещё ${progress.remaining}`}
      </div>

      {/* Лидерборд */}
      {board.length > 1 && (
        <>
          <div className="divider" />
          <div style={{ fontSize: 13, fontWeight: 550, marginBottom: 10 }}>Лидерборд</div>
          {board.map((row, i) => (
            <div key={row.user_id} className="row between" style={{ fontSize: 14, padding: '5px 0' }}>
              <span className="row gap8" style={{ alignItems: 'center', minWidth: 0 }}>
                <span style={{ width: 20, color: 'var(--ink-3)', fontSize: 12.5 }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                </span>
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: row.user_id === myId ? 650 : 400,
                }}>
                  {row.user_id === myId ? 'Вы' : (row.name || 'Без имени')}
                </span>
              </span>
              <span className="tabular" style={{ color: 'var(--ink-2)', flex: '0 0 auto' }}>{row.scored}</span>
            </div>
          ))}
        </>
      )}

      <div className="divider" />
      <div className="row gap8">
        <button className="btn soft" style={{ width: 'auto', flex: 1, height: 38, fontSize: 13 }} onClick={copyCode}>
          {copied ? 'Код скопирован ✓' : 'Скопировать код'}
        </button>
        <button
          className="btn ghost"
          style={{ width: 'auto', flex: 1, height: 38, fontSize: 13, color: 'var(--danger)' }}
          onClick={() => setOpen(true)}
        >
          {mine ? 'Удалить' : 'Выйти'}
        </button>
      </div>

      {open && (
        <ConfirmLeave
          mine={mine}
          title={challenge.title}
          onYes={() => { setOpen(false); leave() }}
          onNo={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function ConfirmLeave({ mine, title, onYes, onNo }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: '0 24px' }}
      onClick={onNo}
    >
      <div className="card" style={{ maxWidth: 360, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 18, textAlign: 'center' }}>
          {mine
            ? `Удалить «${title}»? Челлендж исчезнет у всех участников.`
            : `Выйти из «${title}»? Ваш результат перестанет показываться остальным.`}
        </p>
        <div className="row gap12">
          <button className="btn ghost" style={{ flex: 1, width: 'auto' }} onClick={onNo}>Отмена</button>
          <button
            className="btn"
            style={{ flex: 1, width: 'auto', background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
            onClick={onYes}
          >
            {mine ? 'Удалить' : 'Выйти'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Создание ──────────────────────────────────────────────────────────────────
function CreateForm({ myId, today, onDone, onCancel }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('log_streak')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(addDays(today, 6))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const check = validateChallenge({ title, kind, starts_on: start, ends_on: end })
    if (check.error) { setError(check.error); return }
    setBusy(true)
    const res = await createChallenge({ myId, title, kind, starts_on: start, ends_on: end })
    setBusy(false)
    if (res.error) { setError(res.error); return }
    onDone()
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Новый челлендж</div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label className="label">Название</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Неделя без сахара" maxLength={80} style={{ marginTop: 6 }} />
      </div>

      <div style={{ fontSize: 14, fontWeight: 550, marginBottom: 8 }}>Что считаем</div>
      <div className="stack" style={{ marginBottom: 14 }}>
        {CHALLENGE_KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            style={{
              width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 12,
              border: `1.5px solid ${kind === k.key ? 'var(--primary)' : 'var(--border)'}`,
              background: kind === k.key ? 'var(--primary-weak)' : 'transparent',
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{k.emoji} {k.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{k.desc}</div>
          </button>
        ))}
      </div>

      <div className="row gap12" style={{ marginBottom: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Начало</label>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ marginTop: 6 }} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Конец</label>
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ marginTop: 6 }} />
        </div>
      </div>

      {error && <p className="set-note" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="row gap12">
        <button className="btn ghost" style={{ flex: 1, width: 'auto' }} onClick={onCancel}>Отмена</button>
        <button className="btn" style={{ flex: 1, width: 'auto' }} disabled={busy} onClick={submit}>
          {busy ? 'Создаём…' : 'Создать'}
        </button>
      </div>
      <p className="set-note" style={{ marginBottom: 0 }}>
        Не длиннее {MAX_DAYS} дней. После создания скопируйте код и отправьте друзьям в чат.
      </p>
    </div>
  )
}
