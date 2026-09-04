import { useState } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { microDef, rdaFor, formatMicro } from '../lib/micronutrients.js'
import { sanitizeAmount } from '../lib/foods.js'

// ─────────────────────────────────────────────────────────────────────────────
// Личная норма по одному веществу.
//
// Зачем вообще давать её менять. Справочная норма — это «сколько нужно, чтобы
// не было дефицита», а люди осознанно пьют больше: 500 мг витамина C вместо 90,
// 5 г креатина вместо трёх. Заставлять такого человека смотреть на полоску
// «556% нормы» бессмысленно — он всё равно считает от своей цифры. Пусть
// назовёт её, и приложение будет мерить от неё.
//
// Что при этом НЕ меняется: верхний предел. Он не про цели, а про безопасность,
// и передвинуть его человек не может. Об этом здесь сказано прямо — иначе
// личная норма выглядела бы как способ отключить предупреждения.
// ─────────────────────────────────────────────────────────────────────────────

export default function MicroGoalSheet({ microKey, profile, current, onSave, onClose }) {
  const def = microDef(microKey)
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [value, setValue] = useState(current != null ? String(current) : '')

  if (!def) return null

  const reference = rdaFor(def, profile)
  const isLimit = def.kind === 'limit'

  const submit = (raw) => {
    onSave(def.key, raw)
    close()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="h2">{def.label}</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 16px' }}>{def.about}</p>

        <div className="field">
          <label>{isLimit ? `Мой предел на день, ${def.unit}` : `Моя норма на день, ${def.unit}`}</label>
          <input
            className="input" type="text" inputMode="decimal"
            placeholder={reference != null ? formatMicro(reference) : '—'}
            value={value}
            onChange={(e) => setValue(sanitizeAmount(e.target.value))}
            autoFocus
          />
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
          {reference != null && (
            <div className="row between" style={{ padding: '3px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{isLimit ? 'Общий ориентир' : 'Справочная норма'}</span>
              <span className="tabular" style={{ fontSize: 13 }}>{formatMicro(reference, def.unit)}</span>
            </div>
          )}
          {def.ul != null && (
            <div className="row between" style={{ padding: '3px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Верхний предел{def.ulScope === 'supp' ? ' (для добавок)' : ''}
              </span>
              <span className="tabular" style={{ fontSize: 13, color: 'var(--warn)' }}>{formatMicro(def.ul, def.unit)}</span>
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '10px 0 0' }}>
            {def.ul != null
              ? 'Своя норма меняет только то, от чего считается полоска. Верхний предел она не двигает: предупреждение о превышении останется.'
              : 'Своя норма меняет только то, от чего считается полоска.'}
          </p>
        </div>

        <button className="btn" onClick={() => submit(value)} disabled={!String(value).trim()}>Сохранить</button>
        {current != null && (
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => submit('')}>
            Вернуть справочную норму
          </button>
        )}
      </div>
    </div>
  )
}
