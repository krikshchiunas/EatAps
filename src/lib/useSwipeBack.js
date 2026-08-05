import { useRef, useCallback, useLayoutEffect, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Единый движок навигации «push-screen» (UINavigationController-подобный).
//
// Жест — на ЧИСТЫХ touch-событиях с { passive:false } (как day-pager и свайп
// вкладок, которые работают стабильно). Pointer events + setPointerCapture на
// iOS в большом скролл-контейнере ловят pointercancel и панель «слетает с пальца»
// — поэтому здесь их НЕТ.
//
// • Панель приклеена к пальцу 1:1 (трансформ пишется напрямую в DOM, без setState).
// • Directional lock: жест берётся только при явной горизонтали ВПРАВО; иначе —
//   отдаём вертикальному скроллу ленты. После захвата — только X.
// • Под панелью scrim (глубина). Доводка/возврат — WAAPI (spring-кривая iOS).
//
//   const { panelProps, scrimProps, close } = useSwipeBack(onClose)
//   <>
//     <div className="nav-scrim" {...scrimProps} />
//     <div className="chat-overlay" {...panelProps}> … </div>
//   </>
// ─────────────────────────────────────────────────────────────────────────────

const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const OPEN_MS = 360
const SCRIM_MAX = 0.28

export function useSwipeBack(onClose, {
  closeDist = 0.34, // доля ширины для закрытия при медленном жесте
  closeVel = 0.35,  // px/ms — быстрый флик закрывает на любом расстоянии
} = {}) {
  const panelRef = useRef(null)
  const scrimRef = useRef(null)
  const gRef = useRef(null)
  const posRef = useRef(0)
  const animRef = useRef(null)
  const scrimAnimRef = useRef(null)
  const closedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const W = () => window.innerWidth || 1

  const readX = () => {
    const el = panelRef.current
    if (!el) return posRef.current
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      return m.m41 || 0
    } catch {
      return posRef.current
    }
  }

  const cancelAnims = () => {
    try { animRef.current?.cancel() } catch {}
    try { scrimAnimRef.current?.cancel() } catch {}
    animRef.current = scrimAnimRef.current = null
  }

  const paint = (x) => {
    const w = W()
    const cl = Math.max(0, Math.min(w, x))
    posRef.current = cl
    const p = panelRef.current, s = scrimRef.current
    if (p) p.style.transform = `translate3d(${cl}px,0,0)`
    if (s) s.style.opacity = String(SCRIM_MAX * (1 - cl / w))
  }

  const settle = (target, velocity, onDone) => {
    const p = panelRef.current, s = scrimRef.current
    if (!p) { onDone?.(); return }
    cancelAnims()
    const w = W()
    const from = posRef.current
    const dist = Math.abs(target - from)
    if (dist < 0.5) { paint(target); onDone?.(); return }
    const speed = Math.min(3.5, Math.max(0.9, Math.abs(velocity)))
    const duration = Math.max(190, Math.min(440, dist / speed))
    const sFrom = SCRIM_MAX * (1 - from / w)
    const sTo = SCRIM_MAX * (1 - target / w)
    animRef.current = p.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }],
      { duration, easing: EASING, fill: 'forwards' },
    )
    if (s) scrimAnimRef.current = s.animate([{ opacity: sFrom }, { opacity: sTo }], { duration, easing: EASING, fill: 'forwards' })
    posRef.current = target
    animRef.current.onfinish = () => {
      p.style.transform = `translate3d(${target}px,0,0)`
      if (s) s.style.opacity = String(sTo)
      cancelAnims()
      onDone?.()
    }
  }

  const close = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    settle(W(), 1.6, () => onCloseRef.current())
  }, [])

  // Появление: заезд справа + затемнение.
  useLayoutEffect(() => {
    const p = panelRef.current, s = scrimRef.current
    if (!p) return
    const w = W()
    p.style.transform = `translate3d(${w}px,0,0)`
    if (s) s.style.opacity = '0'
    posRef.current = w
    const a = p.animate([{ transform: `translate3d(${w}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: OPEN_MS, easing: EASING, fill: 'forwards' })
    let sa
    if (s) sa = s.animate([{ opacity: 0 }, { opacity: SCRIM_MAX }], { duration: OPEN_MS, easing: EASING, fill: 'forwards' })
    a.onfinish = () => {
      p.style.transform = 'translate3d(0,0,0)'
      if (s) s.style.opacity = String(SCRIM_MAX)
      posRef.current = 0
      try { a.cancel() } catch {}
      try { sa?.cancel() } catch {}
    }
    return () => { try { a.cancel() } catch {}; try { sa?.cancel() } catch {} }
  }, [])

  // Жест — touch-события, non-passive (preventDefault при горизонтали).
  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const onStart = (e) => {
      if (closedRef.current) return
      const t = e.touches[0]
      cancelAnims()
      const base = readX()
      posRef.current = base
      gRef.current = { x: t.clientX, y: t.clientY, base, decided: false, horiz: false, lastX: t.clientX, lastT: e.timeStamp, vel: 0 }
    }
    const onMove = (e) => {
      const g = gRef.current
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x
      const dy = t.clientY - g.y
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        // Только явная горизонталь ВПРАВО. Иначе — вертикальный скролл ленты.
        g.horiz = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3
        g.decided = true
        if (!g.horiz) { gRef.current = null; return }
      }
      e.preventDefault()
      const dt = e.timeStamp - g.lastT
      if (dt > 0) g.vel = (t.clientX - g.lastX) / dt
      g.lastX = t.clientX; g.lastT = e.timeStamp
      paint(g.base + dx)
    }
    const onEnd = () => {
      const g = gRef.current
      gRef.current = null
      if (!g || !g.horiz) return
      const v = g.vel
      const w = W()
      const pos = posRef.current
      if (v > closeVel || (v > -0.15 && pos > w * closeDist)) {
        closedRef.current = true
        settle(w, Math.max(v, 0.9), () => onCloseRef.current())
      } else {
        settle(0, Math.max(Math.abs(v), 0.9))
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [closeDist, closeVel])

  const panelProps = { ref: panelRef, style: { touchAction: 'pan-y', willChange: 'transform' } }
  const scrimProps = { ref: scrimRef, style: { willChange: 'opacity' } }
  return { panelProps, scrimProps, close }
}
