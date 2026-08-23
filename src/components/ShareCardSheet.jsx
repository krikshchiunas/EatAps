import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { buildShareData, renderShareCard, cardToBlob } from '../lib/shareCard.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'

// Карточка дня для соцсетей.
//
// Сначала предпросмотр, потом отправка: человек должен увидеть, что именно
// уйдёт наружу, до того как это уйдёт. На карточку намеренно не попадают вес,
// самочувствие и заметки — только съеденное (см. lib/shareCard.js).
export default function ShareCardSheet({ date, onClose }) {
  const { dayOf, profile, resolvedTheme } = useStore()
  const canvasRef = useRef(null)
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [theme, setTheme] = useState(resolvedTheme === 'light' ? 'light' : 'dark')

  const day = dayOf(date)
  const data = buildShareData(day, date, { name: profile?.name })

  useEffect(() => {
    if (canvasRef.current) renderShareCard(canvasRef.current, data, theme)
  }, [date, theme, day, profile?.name])

  // Системное «Поделиться» доступно не везде (десктопные браузеры, старый
  // Android). Там, где его нет, честно сохраняем файл — а не показываем
  // кнопку, которая молча ничего не делает.
  const share = async () => {
    setBusy(true)
    setNote(null)
    try {
      const blob = await cardToBlob(canvasRef.current)
      const file = new File([blob], `eataps-${date}.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `eataps-${date}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNote('Картинка сохранена')
      }
    } catch (e) {
      // Отмена системного диалога — не ошибка, о ней сообщать не нужно.
      if (e?.name !== 'AbortError') setNote('Не удалось поделиться')
    }
    setBusy(false)
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <div className="h2" style={{ fontSize: 17 }}>Карточка дня</div>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        <canvas
          ref={canvasRef}
          style={{
            width: '100%', maxWidth: 300, display: 'block', margin: '0 auto 16px',
            borderRadius: 18, boxShadow: 'var(--shadow-float)',
          }}
        />

        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Тёмная</button>
          <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Светлая</button>
        </div>

        <button className="btn" disabled={busy || data.empty} onClick={share}>
          {busy ? 'Готовим…' : 'Поделиться'}
        </button>

        {data.empty && (
          <p className="set-note" style={{ marginBottom: 0 }}>
            В этот день ничего не записано — делиться пока нечем.
          </p>
        )}
        {note && <p className="set-note" style={{ marginBottom: 0 }}>{note}</p>}
        {!data.empty && !note && (
          <p className="set-note" style={{ marginBottom: 0 }}>
            На карточку попадает только съеденное. Вес, самочувствие и заметки дня не публикуются.
          </p>
        )}
      </div>
    </div>
  )
}
