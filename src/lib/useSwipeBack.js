import { useRef, useCallback, useLayoutEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Единый движок навигации «push-screen», как UINavigationController в iOS.
//
// • Панель приклеена к пальцу 1:1 — трансформ пишется НАПРЯМУЮ в DOM каждый кадр
//   (никакого setState на move → ноль перерисовок React → 60/120 FPS).
// • Под панелью — scrim (затемнение предыдущего экрана). По мере ухода панели
//   вправо scrim гаснет → предыдущий экран «проявляется». Глубина, как у Apple.
// • Отпускание: решение по РАССТОЯНИЮ + СКОРОСТИ + НАПРАВЛЕНИЮ. Доводка/возврат —
//   через Web Animations API (композиторный поток, spring-подобная кривая iOS).
// • Вертикальный скролл не перехватывается: жест берётся только при явном
//   горизонтальном доминировании; touch-action: pan-y отдаёт вертикаль браузеру.
//
// Использование:
//   const { panelProps, scrimProps, close } = useSwipeBack(onClose)
//   <>
//     <div className="nav-scrim" {...scrimProps} />
//     <div className="chat-overlay" {...panelProps}> … </div>
//   </>
// ─────────────────────────────────────────────────────────────────────────────

// Кривая iOS UINavigationController (decelerate). Мягкий, «дорогой» доезд.
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const OPEN_MS = 360
const SCRIM_MAX = 0.28

export function useSwipeBack(onClose, {
  fullWidth = true,     // Telegram-стиль: свайп с любого места (не только от края)
  edgeWidth = 28,       // если fullWidth=false — зона старта у левого края
  closeDist = 0.34,     // доля ширины для закрытия при медленном жесте
  closeVel = 0.35,      // px/ms — быстрый флик закрывает на любом расстоянии
} = {}) {
  const panelRef = useRef(null)
  const scrimRef = useRef(null)
  const gesture = useRef(null)     // активный жест
  const posRef = useRef(0)         // текущий translateX панели (px)
  const animRef = useRef(null)     // текущая WAAPI-анимация панели
  const scrimAnimRef = useRef(null)
  const closedRef = useRef(false)

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
    animRef.current = null
    scrimAnimRef.current = null
  }

  // Мгновенно ставит визуальное состояние (во время перетаскивания).
  const paint = (x) => {
    const w = W()
    const clamped = Math.max(0, Math.min(w, x))
    posRef.current = clamped
    const p = panelRef.current
    const s = scrimRef.current
    if (p) p.style.transform = `translate3d(${clamped}px,0,0)`
    if (s) s.style.opacity = String(SCRIM_MAX * (1 - clamped / w))
  }

  // Плавный доезд к target с физикой: длительность зависит от остатка и скорости.
  const settle = (target, velocity, onDone) => {
    const p = panelRef.current
    const s = scrimRef.current
    if (!p) { onDone?.(); return }
    cancelAnims()
    const w = W()
    const from = posRef.current
    const dist = Math.abs(target - from)
    if (dist < 0.5) { paint(target); onDone?.(); return }
    // скорость доводки ≥ скорости пальца, но в разумных рамках
    const speed = Math.min(3.5, Math.max(0.9, Math.abs(velocity)))
    const duration = Math.max(190, Math.min(440, dist / speed))
    const sFrom = SCRIM_MAX * (1 - from / w)
    const sTo = SCRIM_MAX * (1 - target / w)

    animRef.current = p.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }],
      { duration, easing: EASING, fill: 'forwards' },
    )
    if (s) {
      scrimAnimRef.current = s.animate(
        [{ opacity: sFrom }, { opacity: sTo }],
        { duration, easing: EASING, fill: 'forwards' },
      )
    }
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
    settle(W(), 1.6, onClose)
  }, [onClose])

  // ── Появление экрана (заезд справа + затемнение снизу) ──────────────────────
  useLayoutEffect(() => {
    const p = panelRef.current
    const s = scrimRef.current
    if (!p) return
    const w = W()
    p.style.transform = `translate3d(${w}px,0,0)`
    if (s) s.style.opacity = '0'
    posRef.current = w
    const a = p.animate(
      [{ transform: `translate3d(${w}px,0,0)` }, { transform: 'translate3d(0,0,0)' }],
      { duration: OPEN_MS, easing: EASING, fill: 'forwards' },
    )
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

  // ── Жест ────────────────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (closedRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!fullWidth && e.clientX > edgeWidth) return
    // Перехватываем текущую доводку: продолжим с той точки, где панель сейчас.
    cancelAnims()
    const base = readX()
    posRef.current = base
    gesture.current = {
      x: e.clientX, y: e.clientY, id: e.pointerId,
      base, decided: false, horiz: false,
      lastX: e.clientX, lastT: e.timeStamp, vel: 0,
    }
  }, [fullWidth, edgeWidth])

  const onPointerMove = useCallback((e) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      // Горизонталь должна явно доминировать; иначе это вертикальный скролл.
      g.horiz = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3
      g.decided = true
      if (!g.horiz) { gesture.current = null; return }
      try { panelRef.current?.setPointerCapture(g.id) } catch {}
    }
    if (g.horiz) {
      e.preventDefault()
      const dt = e.timeStamp - g.lastT
      if (dt > 0) g.vel = (e.clientX - g.lastX) / dt // px/ms, знаковая
      g.lastX = e.clientX
      g.lastT = e.timeStamp
      paint(g.base + dx)
    }
  }, [])

  const onPointerUp = useCallback((e) => {
    const g = gesture.current
    gesture.current = null
    if (!g || !g.horiz) return
    const v = g.vel
    const w = W()
    const pos = posRef.current
    // Закрываем если: быстрый флик вправо ИЛИ протянули за порог без флика назад.
    const shouldClose = v > closeVel || (v > -0.15 && pos > w * closeDist)
    if (shouldClose) {
      closedRef.current = true
      settle(w, Math.max(v, 0.9), onClose)
    } else {
      settle(0, Math.max(Math.abs(v), 0.9))
    }
  }, [onClose, closeDist, closeVel])

  const onPointerCancel = useCallback(() => {
    const g = gesture.current
    gesture.current = null
    if (g && g.horiz) settle(0, 1)
  }, [])

  const panelProps = {
    ref: panelRef,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    style: { touchAction: 'pan-y', willChange: 'transform' },
  }
  const scrimProps = {
    ref: scrimRef,
    style: { willChange: 'opacity' },
  }
  return { panelProps, scrimProps, close }
}
