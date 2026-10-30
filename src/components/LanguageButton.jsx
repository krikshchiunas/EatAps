// Кнопка выбора языка в шапке анкеты. До настроек новый человек доберётся
// только после анкеты, а читать анкету на чужом языке — первое, что ему
// пришлось бы сделать.
import { useState } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { t } from '../lib/i18n.js'
import LanguageList from './LanguageList.jsx'

function LanguageSheet({ onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="h2">{t('lang.title')}</h2>
          <button className="iconbtn" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="set-list">
          <LanguageList onPicked={close} />
        </div>
      </div>
    </div>
  )
}

export default function LanguageButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="iconbtn" onClick={() => setOpen(true)} aria-label={t('lang.title')}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
      </button>
      {open && <LanguageSheet onClose={() => setOpen(false)} />}
    </>
  )
}
