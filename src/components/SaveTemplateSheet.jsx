import { useState } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { makeTemplate, templateTotals, MAX_TEMPLATE_ITEMS } from '../lib/library.js'
import { macroLabel, amountLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { t } from '../lib/i18n.js'

// Сохранение приёма пищи как шаблона («моё блюдо»).
//
// Показываем СОСТАВ до сохранения, а не просто поле имени. Шаблон потом
// добавляется одним нажатием сразу несколькими строками, и человек должен
// видеть, что именно он закрепляет, — иначе через неделю «Мой завтрак»
// окажется не тем, что он помнил.
export default function SaveTemplateSheet({ section, foods, existing = [], onSave, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [name, setName] = useState(section?.label || '')

  const trimmed = name.trim()
  // Совпало по имени — предлагаем ОБНОВИТЬ, а не завести второй такой же.
  // Два «Моих завтрака» в списке невозможно различить.
  const clash = existing.find((t) => t.name.trim().toLowerCase() === trimmed.toLowerCase())
  const preview = makeTemplate(trimmed || 'x', foods, section?.emoji || '🍽️')
  const kept = preview?.items.length || 0
  const dropped = foods.length - kept
  const totals = preview ? templateTotals(preview) : null

  const submit = () => {
    const tpl = makeTemplate(trimmed, foods, section?.emoji || '🍽️')
    if (!tpl) return
    onSave(clash ? { ...tpl, id: clash.id } : tpl, Boolean(clash))
    close()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{t('template.title')}</h2>
          <button className="iconbtn" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>

        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 16px' }}>
          {t('template.text')}
        </p>

        <div className="field">
          <label>{t('template.name')}</label>
          <input
            className="input"
            placeholder={t('template.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {clash && (
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '-6px 0 16px' }}>
            {t('template.clash')}
          </p>
        )}

        <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{t('template.contents', { n: kept })}</span>
            {totals && <span className="tabular" style={{ fontWeight: 680 }}>{t('units.kcalN', { n: totals.kcal })}</span>}
          </div>
          {preview?.items.map((m, i) => (
            <div key={m.id || i} className="row between" style={{ padding: '5px 0', gap: 10 }}>
              <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.emoji} {foodName(m.name)}
              </span>
              <span className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto' }}>
                {m.grams ? amountLabel(m.grams, m.unit || 'г') : t('units.kcalN', { n: m.kcal })}
              </span>
            </div>
          ))}
          {totals && (
            <div className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8 }}>{macroLabel(totals)}</div>
          )}
          {dropped > 0 && (
            <p style={{ fontSize: 13, color: 'var(--warn)', margin: '10px 0 0' }}>
              {t('template.dropped', { max: MAX_TEMPLATE_ITEMS, n: dropped })}
            </p>
          )}
        </div>

        <button className="btn" onClick={submit} disabled={!trimmed || kept === 0}>
          {clash ? t('template.update', { name: clash.name }) : t('template.save')}
        </button>
      </div>
    </div>
  )
}
