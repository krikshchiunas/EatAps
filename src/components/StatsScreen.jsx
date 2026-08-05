import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { keyOf, humanDay } from '../lib/date.js'
import { computeStats, PERIODS, NUTRIENTS, TOL } from '../lib/stats.js'
import StatChart from './StatChart.jsx'

const fmt = (n, digits = 0) => {
  if (n == null || Number.isNaN(n)) return '—'
  const v = digits ? Math.round(n * 10 ** digits) / 10 ** digits : Math.round(n)
  return v.toLocaleString('ru-RU')
}

export default function StatsScreen({ onClose }) {
  const { days, profile } = useStore()
  const [period, setPeriod] = useState('7d')
  const today = keyOf()

  // Тяжёлый расчёт — только при смене данных/периода/целей, не на каждый рендер.
  const stats = useMemo(
    () => computeStats(days, profile, period, today),
    [days, profile?.targets, period, today]
  )

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Аналитика питания</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Статистика</h1>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
      </div>

      {/* Период анализа */}
      <div className="seg stat-seg" style={{ marginBottom: 16 }}>
        {PERIODS.map((p) => (
          <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {!stats.hasData ? (
        <EmptyState period={stats.period} />
      ) : (
        <>
          <DataScope stats={stats} />
          <SummaryCard stats={stats} today={today} />
          {NUTRIENTS.map((def) => (
            <NutrientSection key={def.key} nut={stats.nutrients[def.key]} single={stats.single} />
          ))}
          <FrequentCard products={stats.products.frequent} />
          {NUTRIENTS.map((def) => (
            <SourcesCard key={def.key} def={def} rows={stats.products.sources[def.key]} />
          ))}
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 4px 0' }}>
            Средние значения считаются по дням с записями. Сахар оценивается как свободные сахара из углеводов.
          </p>
        </>
      )}
    </div>
  )
}

// ── Пустое состояние ──────────────────────────────────────────────────────────
function EmptyState({ period }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
      <div className="h2" style={{ fontSize: 18, marginBottom: 8 }}>Пока нет данных</div>
      <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
        За выбранный период ({period.label.toLowerCase()}) ещё нет записей о питании. Добавляйте приёмы пищи на главном экране — статистика появится здесь автоматически.
      </p>
    </div>
  )
}

function DataScope({ stats }) {
  return (
    <div className="row between" style={{ margin: '0 4px 14px', fontSize: 13, color: 'var(--ink-3)' }}>
      <span>Данные за {stats.loggedDays} {plural(stats.loggedDays, 'день', 'дня', 'дней')} из {stats.totalDays}</span>
      <span>{stats.totalMeals} {plural(stats.totalMeals, 'приём', 'приёма', 'приёмов')}</span>
    </div>
  )
}

// ── Общая динамика ────────────────────────────────────────────────────────────
function SummaryCard({ stats, today }) {
  const { summary } = stats
  const items = [
    { label: 'Калории', value: fmt(summary.avg.kcal), unit: 'ккал', color: 'var(--primary)' },
    { label: 'Белки', value: fmt(summary.avg.protein), unit: 'г', color: 'var(--good)' },
    { label: 'Жиры', value: fmt(summary.avg.fat), unit: 'г', color: 'var(--warn)' },
    { label: 'Углеводы', value: fmt(summary.avg.carbs), unit: 'г', color: 'var(--accent)' },
    { label: 'Сахар', value: fmt(summary.avg.sugar), unit: 'г', color: 'var(--danger)' },
  ]
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Общая динамика</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>В среднем за день</div>
      <div className="stat-grid">
        {items.map((it) => (
          <div key={it.label} className="stat-cell">
            <div className="tabular stat-cell__v" style={{ color: it.color }}>{it.value}</div>
            <div className="stat-cell__u">{it.unit}</div>
            <div className="stat-cell__l">{it.label}</div>
          </div>
        ))}
      </div>

      {summary.goalHitPct != null && (
        <>
          <div className="divider" />
          <div className="row between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 550 }}>Попадание в цель по калориям</span>
            <span className="tabular" style={{ fontSize: 14, fontWeight: 650, color: 'var(--primary)' }}>{summary.goalHitPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${summary.goalHitPct}%`, background: 'var(--primary)', borderRadius: 5, transition: 'width 0.5s ease' }} />
          </div>
        </>
      )}

      {(summary.bestDay || summary.worstDay) && (
        <div className="row gap12" style={{ marginTop: 16 }}>
          {summary.bestDay && (
            <HighlightDay title="Лучший день" emoji="🎯" day={summary.bestDay} today={today} accent="var(--good)"
              caption={`отклонение ${summary.bestDay.dev >= 0 ? '+' : '−'}${Math.abs(Math.round(summary.bestDay.dev))} ккал`} />
          )}
          {summary.worstDay && summary.worstDay.key !== summary.bestDay?.key && (
            <HighlightDay title="Наибольшее отклонение" emoji="⚠️" day={summary.worstDay} today={today} accent="var(--warn)"
              caption={`${summary.worstDay.dev >= 0 ? '+' : '−'}${Math.abs(Math.round(summary.worstDay.dev))} ккал к цели`} />
          )}
        </div>
      )}
    </div>
  )
}

function HighlightDay({ title, emoji, day, today, caption, accent }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 16, padding: '14px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{emoji} {title}</div>
      <div style={{ fontSize: 15, fontWeight: 650 }}>{humanDay(day.key, today)}</div>
      <div className="tabular" style={{ fontSize: 13, color: accent, marginTop: 2 }}>{day.kcal} ккал</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{caption}</div>
    </div>
  )
}

// ── Секция нутриента: график + метрики ────────────────────────────────────────
function NutrientSection({ nut, single }) {
  const digits = nut.key === 'kcal' ? 0 : 1
  const t = nut.trend
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
        <div className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: nut.color, flex: '0 0 auto' }} />
          <span className="h2" style={{ fontSize: 17 }}>{nut.label}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
            {fmt(nut.avg, digits)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', marginLeft: 3 }}>{nut.unit}/день</span>
          </div>
          <TrendChip trend={t} unit={nut.unit} invert={nut.invert} single={single} />
        </div>
      </div>

      <StatChart series={nut.series} target={nut.target} color={nut.color} unit={nut.unit} invert={nut.invert} tolerance={nut.invert ? 0 : TOL[nut.key]} />

      <ChartLegend nut={nut} />

      <div className="divider" />
      <div className="stat-metrics">
        {nut.target != null && !nut.invert && (
          <>
            <Metric label="В норме" value={`${nut.daysIn} дн.`} color="var(--good)" />
            <Metric label="Недобор" value={`${nut.daysUnder} дн.`} color="var(--accent)" />
            <Metric label="Перебор" value={`${nut.daysOver} дн.`} color="var(--warn)" />
            <Metric label="Ср. отклонение" value={`${nut.avgDeviation >= 0 ? '+' : '−'}${fmt(Math.abs(nut.avgDeviation), digits)}`} />
          </>
        )}
        {nut.invert && nut.target != null && (
          <Metric label="Выше лимита" value={`${nut.daysOver} дн.`} color="var(--danger)" />
        )}
        <Metric label="Максимум" value={fmt(nut.max, digits)} />
        <Metric label="Минимум" value={fmt(nut.min, digits)} />
        {nut.invert && <Metric label="Всего за период" value={`${fmt(nut.total)} ${nut.unit}`} />}
        {nut.target != null && <Metric label="Цель" value={`${fmt(nut.target, digits)} ${nut.unit}${nut.invert ? ' макс.' : ''}`} />}
      </div>
    </div>
  )
}

function TrendChip({ trend, unit, invert, single }) {
  if (single || !trend || trend.delta == null) {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>нет данных для тренда</div>
  }
  if (trend.dir === 'flat') {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>≈ как в прошлом периоде</div>
  }
  const up = trend.dir === 'up'
  // Рост «плохого» (сахар) — тревожный; рост прочего — нейтральный.
  const good = invert ? !up : null
  const col = good == null ? 'var(--ink-2)' : good ? 'var(--good)' : 'var(--danger)'
  return (
    <div className="tabular" style={{ fontSize: 12, color: col, marginTop: 4, fontWeight: 600 }}>
      {up ? '↑' : '↓'} {fmt(Math.abs(trend.delta), unit === 'ккал' ? 0 : 1)} {unit}
      {trend.pct != null ? ` (${up ? '+' : '−'}${Math.abs(Math.round(trend.pct))}%)` : ''}
    </div>
  )
}

function ChartLegend({ nut }) {
  const items = nut.target == null
    ? [{ c: nut.color, t: 'фактическое потребление' }]
    : nut.invert
      ? [{ c: 'var(--good)', t: 'в норме' }, { c: 'var(--danger)', t: 'выше лимита' }]
      : [{ c: 'var(--good)', t: 'в норме' }, { c: 'var(--accent)', t: 'недобор' }, { c: 'var(--warn)', t: 'перебор' }]
  return (
    <div className="row wrap gap12" style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
      {items.map((it) => (
        <span key={it.t} className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.c }} /> {it.t}
        </span>
      ))}
      {nut.target != null && (
        <span className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${nut.invert ? 'var(--danger)' : nut.color}` }} /> {nut.invert ? 'лимит' : 'цель'}
        </span>
      )}
    </div>
  )
}

function Metric({ label, value, color }) {
  return (
    <div className="stat-metric">
      <div className="tabular stat-metric__v" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-metric__l">{label}</div>
    </div>
  )
}

// ── Часто употребляемые продукты ──────────────────────────────────────────────
function FrequentRow({ p, i }) {
  return (
    <div className="src-row">
      <span className="src-rank">{i + 1}</span>
      <span className="src-emoji">{p.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="src-name">{p.name}</div>
        <div className="src-sub">
          {p.count} {plural(p.count, 'раз', 'раза', 'раз')} · {Math.round(p.shareOfMeals * 100)}% приёмов
          {p.avgGrams != null ? ` · ${Math.round(p.avgGrams)} г/раз` : ` · ${Math.round(p.avgKcalPerUse)} ккал/раз`}
        </div>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <div className="tabular src-val">{p.count}×</div>
        {p.grams > 0 && <div className="src-pct">{fmt(p.grams)} г</div>}
      </div>
    </div>
  )
}

function FrequentCard({ products }) {
  const [open, setOpen] = useState(false)
  if (!products.length) return null
  const head = products.slice(0, 5)
  const rest = products.slice(5)
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Часто употребляемые продукты</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>По числу употреблений за период</div>
      {head.map((p, i) => <FrequentRow key={p.norm} p={p} i={i} />)}
      {rest.length > 0 && (
        <>
          <Collapsible open={open}>
            {rest.map((p, i) => <FrequentRow key={p.norm} p={p} i={i + 5} />)}
          </Collapsible>
          <ExpandBtn open={open} setOpen={setOpen} total={products.length} />
        </>
      )}
    </div>
  )
}

// ── Основные источники нутриента (раскрывающаяся таблица) ──────────────────────
function SourceRow({ r, i, def, digits }) {
  return (
    <div className="src-row">
      <span className="src-rank">{i + 1}</span>
      <span className="src-emoji">{r.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="src-name">{r.name}</div>
        <div className="src-sub">{r.count} {plural(r.count, 'употребление', 'употребления', 'употреблений')}</div>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto', minWidth: 74 }}>
        <div className="tabular src-val">{fmt(r.value, digits)} {def.unit}</div>
        <div className="src-pct">{Math.round(r.percent)}%</div>
      </div>
    </div>
  )
}

function SourcesCard({ def, rows }) {
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  const digits = def.key === 'kcal' ? 0 : 1
  const head = rows.slice(0, 3)
  const rest = rows.slice(3)
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row gap8" style={{ alignItems: 'center', marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: def.color, flex: '0 0 auto' }} />
        <span className="h2" style={{ fontSize: 17 }}>Источники: {def.label.toLowerCase()}</span>
      </div>
      {head.map((r, i) => <SourceRow key={r.name + i} r={r} i={i} def={def} digits={digits} />)}
      {rest.length > 0 && (
        <>
          <Collapsible open={open}>
            {rest.map((r, i) => <SourceRow key={r.name + (i + 3)} r={r} i={i + 3} def={def} digits={digits} />)}
          </Collapsible>
          <ExpandBtn open={open} setOpen={setOpen} total={rows.length} />
        </>
      )}
    </div>
  )
}

function ExpandBtn({ open, setOpen, total }) {
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontWeight: 600, fontSize: 14 }}
    >
      {open ? 'Свернуть' : `Показать все (${total})`}
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  )
}

// Плавное раскрытие через grid-template-rows (без измерения высоты).
function Collapsible({ open, children }) {
  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  )
}

function plural(n, one, few, many) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
