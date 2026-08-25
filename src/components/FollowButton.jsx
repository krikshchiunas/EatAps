// Кнопка подписки. Единственное место, где решение «что нарисовать» берётся из
// relationship.js — сама она ничего не выводит из отдельных флагов.
//
// Оптимистичное переключение: подписка — действие без последствий, и ждать
// ответа сервера, чтобы перекрасить кнопку, значит показывать задержку там,
// где её не должно быть. При ошибке состояние откатывается.
import { useState } from 'react'
import { follow, unfollow, unblock } from '../lib/social.js'
import { followAction } from '../lib/relationship.js'

export default function FollowButton({ myId, userId, rel, onChange, size = 'normal' }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const action = followAction(rel)
  if (!action) return null

  const run = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)

    const optimistic =
      action.kind === 'follow'   ? { ...rel, following: true,  mutualFollow: rel.followedBy } :
      action.kind === 'unfollow' ? { ...rel, following: false, mutualFollow: false } :
      action.kind === 'unblock'  ? { ...rel, blocked: false } : rel
    onChange?.(optimistic)

    const res =
      action.kind === 'follow'   ? await follow(myId, userId) :
      action.kind === 'unfollow' ? await unfollow(myId, userId) :
                                   await unblock(myId, userId)

    setBusy(false)
    if (res?.error) {
      setErr(res.error)
      onChange?.(rel) // откат
    }
  }

  const quiet = action.tone === 'quiet'
  const danger = action.tone === 'danger'

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <button
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className={`btn${quiet ? ' ghost' : danger ? ' ghost' : ''}`}
        style={{
          height: size === 'small' ? 32 : 40,
          padding: size === 'small' ? '0 14px' : '0 18px',
          fontSize: size === 'small' ? 13.5 : 15,
          whiteSpace: 'nowrap',
          ...(danger ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : null),
        }}
      >
        {busy ? '…' : action.label}
      </button>
      {err && <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{err}</span>}
    </div>
  )
}
