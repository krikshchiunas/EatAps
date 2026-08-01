export default function MacroBar({ label, value, max, unit = 'г', color = 'var(--primary)' }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const left = Math.max(0, Math.round(max - value))
  return (
    <div style={{ flex: 1 }}>
      <div className="row between" style={{ marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550 }}>{label}</span>
        <span className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {Math.round(value)}<span style={{ opacity: 0.6 }}>/{max}{unit}</span>
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>
        {left > 0 ? `осталось ${left}${unit}` : 'норма закрыта'}
      </div>
    </div>
  )
}
