import { useState } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { quickMealNames } from '../lib/meals.js'
import { t } from '../lib/i18n.js'

// Sheet создания/редактирования приёма пищи.
// mode: 'create' (новый пользовательский приём) | 'edit-standard' (только время
// стандартного приёма) | 'edit-custom' (имя/время/удаление пользовательского).
export default function MealSectionSheet({
  mode,
  title,
  initialName = '',
  initialTime = '',
  initialShowTime = true,
  hasFoods = false,
  onSubmit,
  onDelete,
  onClose,
}) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [name, setName] = useState(initialName)
  const [time, setTime] = useState(initialTime || '')
  const [showTime, setShowTime] = useState(initialShowTime)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const editableName = mode !== 'edit-standard'
  const canDelete = mode === 'edit-custom'
  const valid = !editableName || name.trim().length > 0

  const submit = () => {
    if (!valid) return
    onSubmit({ name: name.trim(), time: showTime ? time || null : null, showTime })
    close()
  }

  const handleDeleteClick = () => {
    if (!hasFoods) { onDelete(); return }
    setConfirmDelete(true)
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{title}</h2>
          <button className="iconbtn" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>

        {confirmDelete ? (
          <div>
            <p style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 18 }}>
              {t('section.deleteConfirm')}
            </p>
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={onDelete}>{t('section.deleteWithFoods')}</button>
            </div>
          </div>
        ) : (
          <div>
            {editableName && (
              <div className="field">
                <label>{t('section.name')}</label>
                <input
                  className="input"
                  placeholder={t('section.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ marginBottom: 10 }}
                />
                <div className="row wrap gap8">
                  {quickMealNames().map((n) => (
                    <button key={n} className={`chip ${name === n ? 'on' : ''}`} onClick={() => setName(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label>{t('section.showTime')}</label>
              <div className="seg">
                <button className={showTime ? 'on' : ''} onClick={() => setShowTime(true)}>{t('section.show')}</button>
                <button className={!showTime ? 'on' : ''} onClick={() => setShowTime(false)}>{t('section.hide')}</button>
              </div>
            </div>

            {showTime && (
              <div className="field">
                <label>{mode === 'create' ? t('section.timeOptional') : t('section.time')}</label>
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            )}

            <button className="btn" style={{ marginTop: 4 }} onClick={submit} disabled={!valid}>
              {mode === 'create' ? t('section.create') : t('common.save')}
            </button>

            {canDelete && (
              <button className="btn ghost" style={{ marginTop: 10, color: 'var(--danger)' }} onClick={handleDeleteClick}>
                {t('section.delete')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
