import { useEffect } from 'react'
import { useSwipeBack } from '../lib/useSwipeBack.js'
import { useScrollLock } from '../lib/useScrollLock.js'

// Универсальная «push-панель»: заезжает справа, свайп-назад приклеен к пальцу,
// под ней — scrim (глубина). Дети могут быть функцией (close) => node, чтобы
// закрывать с той же анимацией из своих кнопок.
export default function PushScreen({ onClose, children, className = '', style }) {
  const { panelProps, scrimProps, close } = useSwipeBack(onClose)
  useScrollLock() // фон полностью заморожен

  // Прячем BottomNav, пока панель открыта (счётчик — оверлеи вкладываются).
  useEffect(() => {
    const el = document.documentElement
    el.dataset.overlayCount = Number(el.dataset.overlayCount || 0) + 1
    el.classList.add('has-overlay')
    return () => {
      const next = Number(el.dataset.overlayCount || 1) - 1
      el.dataset.overlayCount = next
      if (next <= 0) el.classList.remove('has-overlay')
    }
  }, [])

  return (
    <>
      <div className="nav-scrim" {...scrimProps} />
      <div
        className={`push-screen ${className}`.trim()}
        {...panelProps}
        style={{ ...panelProps.style, ...style }}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </>
  )
}
