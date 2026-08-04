import { useRef, useState } from 'react'

// Свайп-вниз для нижних листов (sheet). Лист следует за пальцем; не дотянул —
// пружинит обратно; протянул за порог или быстро смахнул — закрывается.
// Тянуть можно за «грабер» (широкая зона сверху) — надёжно, не воюет со скроллом.
//
//   const { sheetStyle, grabberBind } = useSheetDrag(onClose)
//   <div className="sheet" style={sheetStyle}>
//     <div className="grabber" {...grabberBind} />
export function useSheetDrag(onClose, { threshold = 90, velocity = 0.5, duration = 300 } = {}) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)
  const startT = useRef(0)
  const closed = useRef(false)

  const close = () => {
    if (closed.current) return
    closed.current = true
    setDragging(false)
    setDy(window.innerHeight)
    setTimeout(onClose, duration)
  }

  const onTouchStart = (e) => {
    if (closed.current) return
    start.current = e.touches[0].clientY
    startT.current = e.timeStamp
    setDragging(true)
  }
  const onTouchMove = (e) => {
    if (start.current === null) return
    setDy(Math.max(0, e.touches[0].clientY - start.current))
  }
  const onTouchEnd = (e) => {
    if (start.current === null) return
    const ddy = Math.max(0, e.changedTouches[0].clientY - start.current)
    const v = ddy / Math.max(1, e.timeStamp - startT.current)
    start.current = null
    setDragging(false)
    if (ddy > threshold || v > velocity) close()
    else setDy(0)
  }

  const sheetStyle = {
    transform: dy ? `translateY(${dy}px)` : undefined,
    transition: dragging ? 'none' : `transform ${duration}ms cubic-bezier(0.22,1,0.36,1)`,
  }
  const grabberBind = {
    onTouchStart, onTouchMove, onTouchEnd,
    style: { touchAction: 'none', padding: '10px 0', margin: '-4px auto 12px', cursor: 'grab' },
  }
  return { sheetStyle, grabberBind, close }
}
