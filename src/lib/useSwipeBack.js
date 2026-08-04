import { useRef, useState, useCallback } from 'react'

// Интерактивный «свайп назад», как в iOS. Панель следует за пальцем в реальном
// времени; палец можно вернуть — панель спружинит обратно. Закрытие срабатывает
// только если протянули достаточно далеко ИЛИ быстро смахнули.
//
// Защита от случайного жеста: старт засчитывается ТОЛЬКО у самого левого края
// (edgeWidth px). Внутри контента (скролл, кнопки) жест не начнётся.
//
// Возвращает:
//   bind   — пропсы для корневого элемента панели (onPointerDown/Move/Up/Cancel)
//   style  — inline transform/opacity/transition для панели
//   close  — программное закрытие с той же анимацией (для кнопки «назад»)
export function useSwipeBack(onClose, {
  edgeWidth = 30,       // зона старта от левого края
  distanceRatio = 0.4,  // сколько ширины протянуть, чтобы закрыть
  velocity = 0.45,      // либо скорость px/ms — быстрый флик
  duration = 260,       // длительность доводки/пружины
} = {}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const st = useRef(null)
  const closedRef = useRef(false)

  const finishClose = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    setDragging(false)
    setLeaving(true)
    setDx(window.innerWidth)
    setTimeout(onClose, duration)
  }, [onClose, duration])

  const onPointerDown = useCallback((e) => {
    if (leaving || closedRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.clientX > edgeWidth) return // не от края — игнор (анти-случайность)
    st.current = {
      x: e.clientX, y: e.clientY, t: e.timeStamp,
      decided: false, horiz: false, id: e.pointerId,
      w: window.innerWidth, target: e.currentTarget,
    }
  }, [edgeWidth, leaving])

  const onPointerMove = useCallback((e) => {
    const s = st.current
    if (!s) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y
    if (!s.decided) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return
      // Решаем направление: горизонталь должна явно доминировать, иначе это скролл
      s.horiz = Math.abs(ddx) > Math.abs(ddy) * 1.2 && ddx > 0
      s.decided = true
      if (s.horiz) {
        setDragging(true)
        try { s.target.setPointerCapture(s.id) } catch {}
      } else {
        st.current = null // вертикаль — отдаём скроллу
        return
      }
    }
    if (s.horiz) {
      e.preventDefault()
      setDx(Math.max(0, ddx))
    }
  }, [])

  const onPointerUp = useCallback((e) => {
    const s = st.current
    st.current = null
    if (!s || !s.horiz) { setDragging(false); return }
    const ddx = Math.max(0, e.clientX - s.x)
    const v = ddx / Math.max(1, e.timeStamp - s.t)
    setDragging(false)
    if (ddx > s.w * distanceRatio || v > velocity) finishClose()
    else setDx(0) // не дотянул — пружина обратно
  }, [distanceRatio, velocity, finishClose])

  const onPointerCancel = useCallback(() => {
    st.current = null
    setDragging(false)
    setDx(0)
  }, [])

  const w = typeof window !== 'undefined' ? window.innerWidth : 1
  const progress = Math.min(1, dx / w)
  const style = {
    transform: dx ? `translateX(${dx}px)` : undefined,
    transition: dragging ? 'none' : `transform ${duration}ms cubic-bezier(0.22,1,0.36,1)`,
    boxShadow: dx > 0 ? `-12px 0 32px rgba(0,0,0,${0.18 * (1 - progress)})` : undefined,
    willChange: 'transform',
  }
  const bind = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  return { bind, style, close: finishClose, dragging, progress }
}
