import { useState } from 'react'
import { statusColor } from '../lib/stats.js'

// ─────────────────────────────────────────────────────────────────────────────
// Лёгкий график нутриента на чистом SVG (без сторонних библиотек).
// • линия факта с разрывами на днях без записей;
// • пунктирная линия цели + мягкая зона допуска (для сахара — линия лимита);
// • точки окрашены по статусу дня (норма / недобор / перебор);
// • tap по столбцу → всплывающее точное значение за день/неделю/месяц.
// Координаты в фиксированном viewBox — SVG масштабируется под ширину карточки.
// ─────────────────────────────────────────────────────────────────────────────

const W = 340
const H = 148
const PAD_X = 12
const PAD_TOP = 14
const PAD_BOTTOM = 22

export default function StatChart({ series = [], target, color, unit, invert = false, estimate = false, tolerance = 0 }) {
  const [sel, setSel] = useState(null)

  // Строго конечные значения: null/undefined/NaN/Infinity → null (разрыв линии),
  // иначе линии/цель рисуются в баз­овой точке 0 вместо пропуска. Number(null)===0,
  // поэтому null проверяем явно.
  const num = (v) => {
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const tgt = num(target)
  const values = series.map((s) => num(s.value)).filter((v) => v != null)
  const dataMax = values.length ? Math.max(...values) : 0
  const yMax = Math.max(dataMax, tgt || 0) * 1.15 || 1

  const n = series.length
  const xAt = (i) => (n <= 1 ? W / 2 : PAD_X + (i / (n - 1)) * (W - 2 * PAD_X))
  const yAt = (v) => PAD_TOP + (1 - num(v) / yMax) * (H - PAD_TOP - PAD_BOTTOM)

  // Линию рвём на сегменты по разрывам (нет значения / нечисло между точками).
  const segments = []
  let cur = []
  series.forEach((s, i) => {
    const v = num(s.value)
    if (v == null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else {
      cur.push({ x: xAt(i), y: yAt(v), i })
    }
  })
  if (cur.length) segments.push(cur)

  const bandTop = tgt != null && tolerance > 0 ? yAt(tgt * (1 + tolerance)) : null
  const bandBot = tgt != null && tolerance > 0 ? yAt(tgt * (1 - tolerance)) : null
  const targetY = tgt != null ? yAt(tgt) : null

  // Подписи оси X: до ~6 равномерно распределённых меток, включая концы —
  // так соседние подписи у края не наезжают друг на друга.
  const labelIdx = new Set()
  const labelCount = Math.min(6, n)
  for (let j = 0; j < labelCount; j++) {
    labelIdx.add(labelCount === 1 ? 0 : Math.round((j * (n - 1)) / (labelCount - 1)))
  }

  const selected = sel != null ? series[sel] : null

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }} role="img" aria-label="График нутриента">
        {/* Зона допуска цели */}
        {bandTop != null && bandBot != null && (
          <rect x={PAD_X} y={Math.min(bandTop, bandBot)} width={W - 2 * PAD_X} height={Math.abs(bandBot - bandTop)} fill={color} opacity="0.07" rx="4" />
        )}
        {/* Линия цели / лимита */}
        {targetY != null && (
          <line x1={PAD_X} y1={targetY} x2={W - PAD_X} y2={targetY} stroke={invert ? 'var(--danger)' : color} strokeWidth="1.4" strokeDasharray="4 4" opacity={invert ? 0.6 : 0.5} />
        )}
        {/* Сегменты факта */}
        {segments.map((seg, si) => (
          <polyline
            key={si}
            points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          />
        ))}
        {/* Маркер выбора */}
        {selected && num(selected.value) != null && (
          <line x1={xAt(sel)} y1={PAD_TOP - 6} x2={xAt(sel)} y2={H - PAD_BOTTOM} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        )}
        {/* Точки */}
        {series.map((s, i) =>
          num(s.value) == null ? null : (
            <circle
              key={i}
              cx={xAt(i)}
              cy={yAt(s.value)}
              r={sel === i ? 5 : n > 20 ? 2.6 : 3.4}
              fill={statusColor(s.status, invert)}
              stroke="var(--surface)"
              strokeWidth={sel === i ? 2 : 1.2}
            />
          )
        )}
        {/* Прозрачные зоны для тапа */}
        {series.map((s, i) => (
          <rect
            key={`hit-${i}`}
            x={n <= 1 ? 0 : xAt(i) - (W - 2 * PAD_X) / (2 * (n - 1)) - 1}
            y="0"
            width={n <= 1 ? W : (W - 2 * PAD_X) / (n - 1) + 2}
            height={H}
            fill="transparent"
            style={{ cursor: num(s.value) != null ? 'pointer' : 'default' }}
            onPointerDown={() => setSel(sel === i ? null : i)}
          />
        ))}
        {/* Подписи оси X */}
        {series.map((s, i) =>
          labelIdx.has(i) ? (
            <text key={`lb-${i}`} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
              {s.label}
            </text>
          ) : null
        )}
      </svg>

      {/* Тултип точного значения */}
      {selected && num(selected.value) != null && (
        <div
          className="stat-tip"
          style={{
            left: `${(xAt(sel) / W) * 100}%`,
            transform: `translateX(${sel === 0 ? '0' : sel === n - 1 ? '-100%' : '-50%'})`,
          }}
        >
          <span className="stat-tip__val" style={{ color }}>
            {estimate ? '≈' : ''}{Math.round(num(selected.value))} {unit}
          </span>
          <span className="stat-tip__day">{selected.full}</span>
        </div>
      )}
    </div>
  )
}
