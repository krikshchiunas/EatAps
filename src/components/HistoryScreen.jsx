import { useState } from 'react'
import { useStore } from '../store.jsx'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, MONTH_NAMES } from '../lib/date.js'

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function HistoryScreen({ onPickDay, onClose }) {
  const { days, profile } = useStore()
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const today = keyOf()
  const target = profile.targets.calories

  const first = new Date(ym.y, ym.m, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const changeMonth = (delta) => {
    setYm((s) => {
      const nd = new Date(s.y, s.m + delta, 1)
      return { y: nd.getFullYear(), m: nd.getMonth() }
    })
  }

  const monthKeys = Object.keys(days).filter((k) => {
    const [y, m] = k.split('-').map(Number)
    return y === ym.y && m - 1 === ym.m
  })
  const logged = monthKeys.filter((k) => days[k].meals.length > 0)
  const avgKcal = logged.length ? Math.round(logged.reduce((a, k) => a + sumDay(days[k].meals).kcal, 0) / logged.length) : 0

  const isFuture = (d) => {
    const k = keyOf(new Date(ym.y, ym.m, d))
    return k > today
  }

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', margin: '0 0 20px' }}>
        <div>
          <div className="eyebrow">История</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Календарь</h1>
        </div>
        {onClose && <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>}
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 16 }}>
          <button className="iconbtn" onClick={() => changeMonth(-1)} aria-label="Предыдущий месяц">‹</button>
          <div style={{ fontSize: 17, fontWeight: 650 }}>{MONTH_NAMES[ym.m]} {ym.y}</div>
          <button className="iconbtn" onClick={() => changeMonth(1)} aria-label="Следующий месяц">›</button>
        </div>

        <div className="cal-grid" style={{ marginBottom: 6 }}>
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="cal-cell empty" />
            const k = keyOf(new Date(ym.y, ym.m, d))
            const entry = days[k]
            const kcal = entry ? sumDay(entry.meals).kcal : 0
            const future = isFuture(d)
            return (
              <button
                key={i}
                className={`cal-cell ${k === today ? 'today' : ''}`}
                style={{ opacity: future ? 0.4 : 1, color: k === today ? 'var(--primary)' : 'var(--ink-2)', fontWeight: k === today ? 700 : 500, position: 'relative' }}
                onClick={() => !future && onPickDay(k)}
                disabled={future}
              >
                <MiniRing kcal={kcal} target={target} />
                <span style={{ position: 'relative', zIndex: 1 }}>{d}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="row gap12" style={{ marginTop: 14 }}>
        <SummaryCard label="Дней с записями" value={logged.length} />
        <SummaryCard label="Средние ккал" value={avgKcal || '—'} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row wrap gap16" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          <Legend color="var(--accent)" text="ниже нормы" />
          <Legend color="var(--good)" text="в норме" />
          <Legend color="var(--warn)" text="перебор" />
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="card" style={{ flex: 1, textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function Legend({ color, text }) {
  return (
    <span className="row gap8">
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} /> {text}
    </span>
  )
}

function MiniRing({ kcal, target }) {
  if (kcal <= 0) return null
  const r = 15
  const circ = 2 * Math.PI * r
  const pct = Math.min(kcal / target, 1)
  const dash = pct * circ
  const ratio = kcal / target
  const color = ratio > 1.1 ? 'var(--warn)' : ratio >= 0.85 ? 'var(--good)' : 'var(--accent)'
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" style={{ position: 'absolute', inset: 2, width: 'calc(100% - 4px)', height: 'calc(100% - 4px)' }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 18 18)" />
    </svg>
  )
}
