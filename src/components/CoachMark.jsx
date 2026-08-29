import { useState, useEffect } from 'react'
import { useStore } from '../store.jsx'
import { nextTip, markSeen, TOUR_PREF } from '../lib/tour.js'

// Одна подсказка внизу экрана — не модалка поверх всего.
//
// Почему не затемнение с «дырой» вокруг элемента: такой тур блокирует работу и
// его хочется закрыть не читая. Здесь подсказка не мешает: приложение под ней
// продолжает работать, и человек может выполнить жест прямо сейчас.
//
// Показываем не чаще одной за запуск приложения: за сессию человек усваивает
// одну вещь, а очередь из шести карточек читают только из вежливости.
let shownThisSession = false

export default function CoachMark({ facts, paused }) {
  const { prefs, setPref } = useStore()
  const [tip, setTip] = useState(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Пока открыта шторка или диалог, подсказку не показываем: она перекрыла
    // бы их кнопки. Совет, загораживающий действие, — это уже помеха.
    if (paused || shownThisSession || tip) return
    const candidate = nextTip(prefs, facts)
    if (!candidate) return
    // Небольшая пауза: подсказка, выпрыгнувшая одновременно с экраном,
    // читается как ошибка интерфейса, а не как совет.
    const t = setTimeout(() => {
      shownThisSession = true
      setTip(candidate)
    }, 1200)
    return () => clearTimeout(t)
  }, [prefs, facts, tip, paused])

  if (!tip || paused) return null

  const dismiss = () => {
    setLeaving(true)
    // Отмечаем сразу, не дожидаясь анимации: если человек закроет приложение
    // прямо сейчас, подсказка всё равно должна считаться показанной.
    setPref(TOUR_PREF, markSeen(prefs, tip.id))
    setTimeout(() => { setTip(null); setLeaving(false) }, 200)
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 12, right: 12,
        bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        zIndex: 550,
        // Непрозрачная поверхность, а не стекло: подсказка всплывает поверх
        // списка, и сквозь неё читался бы текст, который она объясняет.
        background: 'var(--surface-solid)',
        border: '1.5px solid var(--primary)',
        borderRadius: 22,
        padding: '14px 16px',
        boxShadow: 'var(--shadow-float)',
        display: 'flex', gap: 12, alignItems: 'flex-start',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'none',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1, flex: '0 0 auto' }} aria-hidden>{tip.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 3 }}>{tip.title}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>{tip.text}</div>
      </div>
      <button
        onClick={dismiss}
        aria-label="Понятно, скрыть подсказку"
        style={{ color: 'var(--ink-3)', fontSize: 18, flex: '0 0 auto', padding: '0 2px', lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  )
}
