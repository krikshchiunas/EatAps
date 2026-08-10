export default function Ring({ value, max, size = 168, stroke = 14, children }) {
  // Приводим к конечным числам: NaN/Infinity/undefined/строки/null не должны
  // попасть в SVG-атрибуты (иначе React ругается и кольцо ломается).
  const v = Number.isFinite(Number(value)) ? Number(value) : 0
  const m = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : 0
  const pct = m > 0 ? Math.min(Math.max(v / m, 0), 1) : 0
  const over = m > 0 && v > m
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct
  const color = over ? 'var(--warn)' : 'var(--primary)'
  // margin auto: блок с фиксированной шириной не центрируется text-align'ом
  // родителя — без этого кольцо прижималось к левому краю карточки.
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1), stroke 0.3s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )
}
