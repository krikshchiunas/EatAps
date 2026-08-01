export default function Ring({ value, max, size = 168, stroke = 14, children }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const over = max > 0 && value > max
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct
  const color = over ? 'var(--warn)' : 'var(--primary)'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
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
