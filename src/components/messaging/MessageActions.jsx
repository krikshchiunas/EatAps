// Меню действий над сообщением и выбор реакции.
//
// Открывается свайпом влево по пузырю (жест живёт в ChatScreen). Долгого
// нажатия здесь нет намеренно: оно конфликтовало с нативным меню iOS и с
// выделением текста, и его убрали ещё до этой переработки.
//
// ─────────────────────────────────────────────────────────────────────────────
// «ОТОЗВАТЬ» И «УДАЛИТЬ У СЕБЯ» — РАЗНЫЕ ПУНКТЫ, И ЭТО ВАЖНО
//
// Отзыв убирает сообщение У ВСЕХ и доступен только автору. Удаление у себя
// прячет его только на моей стороне; у собеседника оно остаётся, и обещать
// иное нельзя. Пункты стоят рядом, поэтому у каждого есть подпись, а у
// отзыва — подтверждение: перепутать их значит либо оставить у чужого
// человека то, что хотел стереть, либо стереть у себя то, что хотел стереть
// у всех.
import { useState, useRef } from 'react'
import { useSheetDrag } from '../../lib/useSheetDrag.js'
import { ICONS } from '../social/ActionSheet.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import ReportSheet from '../social/ReportSheet.jsx'
import { QUICK_REACTIONS } from '../../lib/messaging.js'
import { previewOf } from '../../lib/chatFormat.js'

// Быстрые реакции строкой поверх меню. Отдельного экрана выбора нет: шесть
// эмодзи помещаются в одну строку, и лишний переход к ним не нужен.
function ReactionRow({ mine, onPick }) {
  return (
    <div className="react-row" role="group" aria-label="Реакция">
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          className={`react-btn${mine === e ? ' on' : ''}`}
          aria-pressed={mine === e}
          aria-label={`Реакция ${e}`}
          onClick={() => onPick(mine === e ? null : e)}
        >
          {e}
        </button>
      ))}
    </div>
  )
}

export default function MessageActions({
  m, mine, myId, canReact,
  onClose, onReply, onCopy, onForward, onReact,
  onUnsend, onDeleteForMe, onRetry,
}) {
  const [confirmUnsend, setConfirmUnsend] = useState(false)
  const [report, setReport] = useState(false)

  // useSheetDrag сообщает о закрытии ПОСЛЕ анимации выезда — через 200–400 мс.
  // Пункт «Отозвать» успевал показать подтверждение, а запоздавший onClose
  // размонтировал вместе со шторкой и его: диалог мигал и исчезал, сообщение
  // оставалось на месте. Флаг гасит опоздавшее закрытие.
  const handedOff = useRef(false)
  const handOff = (fn) => { handedOff.current = true; fn() }
  const { sheetProps, backdropProps, close } = useSheetDrag(
    () => { if (!handedOff.current) onClose() },
    { openMs: 190 },
  )

  const myReaction = (m.reactions || {})[myId] || null
  const failed = m.status === 'failed'
  const pending = m.status === 'sending' || failed
  const unsent = Boolean(m.unsent_at || m.unsent)

  const items = [
    failed ? { key: 'retry', label: 'Повторить отправку', icon: ICONS.reply, run: onRetry } : null,
    !unsent && !pending ? { key: 'reply', label: 'Ответить', icon: ICONS.reply, run: onReply } : null,
    !unsent && m.text ? { key: 'copy', label: 'Копировать текст', icon: ICONS.copy, run: onCopy } : null,
    !unsent && !pending ? { key: 'forward', label: 'Переслать', icon: ICONS.forward, run: onForward } : null,
    mine && !unsent && !pending
      ? {
        key: 'unsend',
        label: 'Отозвать у всех',
        hint: 'Исчезнет и у собеседника',
        icon: ICONS.unsend,
        danger: true,
        run: () => handOff(() => setConfirmUnsend(true)),
      }
      : null,
    {
      key: 'delete-me',
      label: 'Удалить у себя',
      hint: 'У собеседника останется',
      icon: ICONS.hide,
      danger: true,
      run: onDeleteForMe,
    },
    !mine && !unsent
      ? { key: 'report', label: 'Пожаловаться', icon: ICONS.report, danger: true, run: () => handOff(() => setReport(true)) }
      : null,
  ].filter(Boolean)

  if (confirmUnsend) {
    return (
      <ConfirmDialog
        text="Отозвать сообщение? Оно исчезнет у всех участников — на его месте останется пометка «Сообщение удалено»."
        yesLabel="Отозвать"
        noLabel="Отмена"
        onYes={() => { setConfirmUnsend(false); onClose(); onUnsend() }}
        onNo={() => { setConfirmUnsend(false); onClose() }}
      />
    )
  }

  if (report) {
    return <ReportSheet kind="message" targetId={m.id} onClose={() => { setReport(false); onClose() }} />
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 80 }}>
      <div className="sheet ctx-sheet" {...sheetProps} onClick={(e) => e.stopPropagation()} role="menu">
        <div className="grabber" />

        {canReact && !unsent && !pending && (
          <ReactionRow mine={myReaction} onPick={(e) => { close(); onReact(e) }} />
        )}

        <div className="ctx-preview">{previewOf(m)}</div>

        {items.map((a, i) => (
          <button
            key={a.key}
            role="menuitem"
            className={`ctx-item${a.danger ? ' danger' : ''}`}
            style={{ '--i': i, ...(a.danger ? { color: 'var(--danger)' } : null) }}
            onClick={() => { close(); a.run?.() }}
          >
            <ActionIcon d={a.icon} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block' }}>{a.label}</span>
              {a.hint && (
                <span className="muted" style={{ fontSize: 12.5, display: 'block', marginTop: 1 }}>{a.hint}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ActionIcon({ d }) {
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  )
}
