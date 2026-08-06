import { useRef, useLayoutEffect, useEffect } from 'react'
import { useScrollLock } from './useScrollLock.js'

// ─────────────────────────────────────────────────────────────────────────────
// Нижний лист (bottom sheet) со свайпом-вниз-для-закрытия — как в Apple.
//
// • Лист приклеен к пальцу 1:1 (трансформ пишется напрямую в DOM, без setState).
// • Координация с внутренним скроллом: свайп-вниз закрывает лист ТОЛЬКО когда
//   контент прокручен в самый верх (scrollTop ≤ 0). Иначе жест — обычный скролл.
//   Никакой двойной реакции.
// • Фон заморожен (useScrollLock) — родительский экран не скроллится и не ловит
//   жесты.
// • Пружинная доводка/возврат по расстоянию + скорости (WAAPI).
//
//   const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
//   <div className="sheet-backdrop" {...backdropProps} onClick={close}>
//     <div className="sheet" {...sheetProps} onClick={stop}> … </div>
// ─────────────────────────────────────────────────────────────────────────────

const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const OPEN_MS = 340

// openMs — длительность выезда. По умолчанию общая для приложения (OPEN_MS);
// контекст-меню сообщения передаёт меньшее значение: оно открывается по долгому
// нажатию, и обычная скорость там ощущается как задержка.
export function useSheetDrag(onClose, { closeDist = 110, closeVel = 0.4, openMs = OPEN_MS } = {}) {
  useScrollLock()
  const sheetRef = useRef(null)
  const backRef = useRef(null)
  const gRef = useRef(null)
  const posRef = useRef(0)
  const animRef = useRef(null)
  const bAnimRef = useRef(null)
  const closedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const H = () => sheetRef.current?.offsetHeight || window.innerHeight

  const cancelAnims = () => {
    try { animRef.current?.cancel() } catch {}
    try { bAnimRef.current?.cancel() } catch {}
    animRef.current = bAnimRef.current = null
  }

  const paint = (y) => {
    const h = H()
    const cl = Math.max(0, y)
    posRef.current = cl
    const s = sheetRef.current, b = backRef.current
    if (s) s.style.transform = `translate3d(0,${cl}px,0)`
    if (b) b.style.opacity = String(Math.max(0, 1 - cl / h))
  }

  const settle = (target, vel, onDone) => {
    const s = sheetRef.current, b = backRef.current
    if (!s) { onDone?.(); return }
    cancelAnims()
    const h = H()
    const from = posRef.current
    const dist = Math.abs(target - from)
    if (dist < 0.5) { paint(target); onDone?.(); return }
    const speed = Math.min(4, Math.max(0.85, Math.abs(vel)))
    const dur = Math.max(180, Math.min(420, dist / speed))
    const bFrom = Math.max(0, 1 - from / h)
    const bTo = Math.max(0, 1 - target / h)
    animRef.current = s.animate(
      [{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${target}px,0)` }],
      { duration: dur, easing: EASING, fill: 'forwards' },
    )
    if (b) bAnimRef.current = b.animate([{ opacity: bFrom }, { opacity: bTo }], { duration: dur, easing: EASING, fill: 'forwards' })
    posRef.current = target
    animRef.current.onfinish = () => {
      s.style.transform = `translate3d(0,${target}px,0)`
      if (b) b.style.opacity = String(bTo)
      cancelAnims()
      onDone?.()
    }
  }

  const close = () => {
    if (closedRef.current) return
    closedRef.current = true
    settle(H() + 40, 1.4, () => onCloseRef.current())
  }

  // Появление: заезд снизу + затемнение.
  useLayoutEffect(() => {
    const s = sheetRef.current, b = backRef.current
    if (!s) return
    const h = s.offsetHeight || window.innerHeight
    s.style.transform = `translate3d(0,${h}px,0)`
    if (b) b.style.opacity = '0'
    posRef.current = h
    const a = s.animate([{ transform: `translate3d(0,${h}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: openMs, easing: EASING, fill: 'forwards' })
    let ba
    if (b) ba = b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: openMs, easing: EASING, fill: 'forwards' })
    a.onfinish = () => {
      s.style.transform = 'translate3d(0,0,0)'
      if (b) b.style.opacity = '1'
      posRef.current = 0
      try { a.cancel() } catch {}
      try { ba?.cancel() } catch {}
    }
    return () => { try { a.cancel() } catch {}; try { ba?.cancel() } catch {} }
  }, [])

  // Жест свайп-вниз (touch, non-passive — чтобы гасить нативный скролл при dismiss).
  useEffect(() => {
    const s = sheetRef.current
    if (!s) return

    const onStart = (e) => {
      if (closedRef.current) return
      const t = e.touches[0]
      gRef.current = {
        y: t.clientY, x: t.clientX,
        startTop: s.scrollTop,
        decided: false, own: false,
        lastY: t.clientY, lastT: e.timeStamp, vel: 0,
      }
    }
    const onMove = (e) => {
      const g = gRef.current
      if (!g) return
      const t = e.touches[0]
      const dy = t.clientY - g.y
      const dx = t.clientX - g.x
      if (!g.decided) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
        g.decided = true
        // Владеем закрытием только если тянем вниз, вертикаль доминирует и
        // контент уже в самом верху. Иначе — отдаём нативному скроллу.
        g.own = dy > 0 && Math.abs(dy) > Math.abs(dx) && g.startTop <= 0
        if (g.own) cancelAnims()
        else { gRef.current = null; return }
      }
      if (g.own) {
        e.preventDefault()
        const dt = e.timeStamp - g.lastT
        if (dt > 0) g.vel = (t.clientY - g.lastY) / dt
        g.lastY = t.clientY; g.lastT = e.timeStamp
        paint(dy)
      }
    }
    const onEnd = () => {
      const g = gRef.current
      gRef.current = null
      if (!g || !g.own) return
      const v = g.vel
      const p = posRef.current
      if (v > closeVel || (v > -0.15 && p > closeDist)) {
        closedRef.current = true
        settle(H() + 40, Math.max(v, 0.9), () => onCloseRef.current())
      } else {
        settle(0, Math.max(Math.abs(v), 0.9))
      }
    }

    s.addEventListener('touchstart', onStart, { passive: true })
    s.addEventListener('touchmove', onMove, { passive: false })
    s.addEventListener('touchend', onEnd, { passive: true })
    s.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      s.removeEventListener('touchstart', onStart)
      s.removeEventListener('touchmove', onMove)
      s.removeEventListener('touchend', onEnd)
      s.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  const sheetProps = { ref: sheetRef, style: { willChange: 'transform', touchAction: 'pan-y' } }
  const backdropProps = { ref: backRef }
  return { sheetProps, backdropProps, close }
}
