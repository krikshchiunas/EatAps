import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { keyOf, humanDay } from '../lib/date.js'
import { computeStats, PERIODS, NUTRIENTS, TOL } from '../lib/stats.js'
import { unitLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { t, fmtNum } from '../lib/i18n.js'
import { useLang } from '../lib/useLang.js'
import StatChart from './StatChart.jsx'

const fmt = (n, digits = 0) => {
  const num = Number(n)
  if (n == null || !Number.isFinite(num)) return '—' // отсекаем NaN/Infinity/undefined/строки
  const v = digits ? Math.round(num * 10 ** digits) / 10 ** digits : Math.round(num)
  return fmtNum(v)
}

export default function StatsScreen({ onClose }) {
  const { days, profile } = useStore()
  const [period, setPeriod] = useState('7d')
  const today = keyOf()
  // Подписи графиков (месяцы, «неделя с…») считаются вместе со статистикой —
  // при смене языка их нужно пересчитать.
  const lang = useLang()

  // Тяжёлый расчёт — только при смене данных/периода/целей, не на каждый рендер.
  const stats = useMemo(
    () => computeStats(days, profile, period, today),
    [days, profile?.targets, period, today, lang] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div className="screen">
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t('stats.eyebrow')}</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>{t('stats.title')}</h1>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label={t('common.close')} style={{ flex: '0 0 auto' }}>✕</button>
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
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 4px 0', lineHeight: 1.5 }}>
            {t('stats.scope', { n: stats.loggedDays, total: stats.totalDays })}
            {stats.sugarEstimated && ` ${t('stats.sugarNote')}`}
            {/* Числа обязаны сходиться: если день с едой не попал в средние,
                человек должен видеть почему, а не гадать над расхождением. */}
            {stats.pendingLowDays > 0 && ` ${t('stats.pendingLow', { count: stats.pendingLowDays })}`}
            {stats.excludedDays > 0 && ` ${t('stats.excludedDays', { count: stats.excludedDays })}`}
            {stats.summary.calTargetVaried && ` ${t('stats.targetVaried')}`}
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
      <div className="h2" style={{ fontSize: 18, marginBottom: 8 }}>{t('stats.emptyTitle')}</div>
      <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
        {t('stats.emptyText', { period: period.label })}
      </p>
    </div>
  )
}

function DataScope({ stats }) {
  return (
    <div className="row between" style={{ margin: '0 4px 14px', fontSize: 13, color: 'var(--ink-3)' }}>
      <span>{t('stats.filledDays')} <b style={{ color: 'var(--ink-2)' }}>{t('stats.nOfTotal', { n: stats.loggedDays, total: stats.totalDays })}</b></span>
      <span>{t('stats.meals', { count: stats.totalMeals })}</span>
    </div>
  )
}

// ── Общая динамика ────────────────────────────────────────────────────────────
function SummaryCard({ stats, today }) {
  const { summary } = stats
  const items = [
    { label: t('macro.kcal'), value: fmt(summary.avg.kcal), unit: t('units.kcal'), color: 'var(--primary)' },
    { label: t('macro.protein'), value: fmt(summary.avg.protein), unit: t('units.g'), color: 'var(--good)' },
    { label: t('macro.fat'), value: fmt(summary.avg.fat), unit: t('units.g'), color: 'var(--warn)' },
    { label: t('macro.carbs'), value: fmt(summary.avg.carbs), unit: t('units.g'), color: 'var(--accent)' },
    // Сахар — приблизительная оценка (см. секцию «Оценка сахара»), помечаем ≈.
    { label: t('stats.sugarStar'), value: `${stats.sugarEstimated ? '≈' : ''}${fmt(summary.avg.sugar)}`, unit: t('units.g'), color: 'var(--danger)' },
  ]
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>{t('stats.overview')}</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{t('stats.avgPerDay')}</div>
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
          <div className="row between" style={{ marginBottom: 6, alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: 550 }}>{t('stats.goalHit')}</span>
            <span className="tabular" style={{ fontSize: 14, fontWeight: 650, color: 'var(--primary)' }}>{summary.goalHitPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${summary.goalHitPct}%`, background: 'var(--primary)', borderRadius: 5, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
            {t('stats.daysInTarget', { n: summary.daysInTarget, count: stats.loggedDays, pct: Math.round(TOL.kcal * 100) })}
          </div>
        </>
      )}

      {(summary.bestDay || summary.worstDay) && (
        <div className="row gap12" style={{ marginTop: 16 }}>
          {summary.bestDay && (
            <HighlightDay title={t('stats.bestDay')} emoji="🎯" day={summary.bestDay} today={today} accent="var(--good)"
              caption={t('stats.deviation', { n: `${summary.bestDay.dev >= 0 ? '+' : '−'}${Math.abs(Math.round(summary.bestDay.dev))}` })} />
          )}
          {summary.worstDay && summary.worstDay.key !== summary.bestDay?.key && (
            <HighlightDay title={t('stats.worstDay')} emoji="⚠️" day={summary.worstDay} today={today} accent="var(--warn)"
              caption={t('stats.vsTarget', { n: `${summary.worstDay.dev >= 0 ? '+' : '−'}${Math.abs(Math.round(summary.worstDay.dev))}` })} />
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
      <div className="tabular" style={{ fontSize: 13, color: accent, marginTop: 2 }}>{t('units.kcalN', { n: day.kcal })}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{caption}</div>
    </div>
  )
}

// ── Секция нутриента: график + метрики ────────────────────────────────────────
function NutrientSection({ nut, single }) {
  const digits = nut.key === 'kcal' ? 0 : 1
  const approx = nut.estimate ? '≈' : '' // сахар — приблизительная оценка
  const trend = nut.trend
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
        <div className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: nut.color, flex: '0 0 auto' }} />
          <span className="h2" style={{ fontSize: 17 }}>{nut.label}</span>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div className="tabular" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
            {approx}{fmt(nut.avg, digits)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', marginInlineStart: 3 }}>{t('stats.perDay', { unit: unitLabel(nut.unit) })}</span>
          </div>
          <TrendChip trend={trend} unit={nut.unit} invert={nut.invert} single={single} />
        </div>
      </div>

      <StatChart series={nut.series} target={nut.target} color={nut.color} unit={nut.unit} invert={nut.invert} estimate={nut.estimate} tolerance={nut.invert ? 0 : TOL[nut.key]} />

      <ChartLegend nut={nut} />

      {nut.estimate && nut.disclaimer && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '10px 0 0', lineHeight: 1.45 }}>
          ≈ {nut.disclaimer}
        </p>
      )}

      <div className="divider" />
      <div className="stat-metrics">
        {nut.target != null && !nut.invert && (
          <>
            <Metric label={t('stats.inRange')} value={t('stats.daysShort', { n: nut.daysIn })} color="var(--good)" />
            <Metric label={t('stats.under')} value={t('stats.daysShort', { n: nut.daysUnder })} color="var(--accent)" />
            <Metric label={t('stats.over')} value={t('stats.daysShort', { n: nut.daysOver })} color="var(--warn)" />
            <Metric label={t('stats.avgDev')} value={`${nut.avgDeviation >= 0 ? '+' : '−'}${fmt(Math.abs(nut.avgDeviation), digits)}`} />
          </>
        )}
        <Metric label={t('stats.max')} value={`${approx}${fmt(nut.max, digits)}`} />
        <Metric label={t('stats.min')} value={`${approx}${fmt(nut.min, digits)}`} />
        {nut.invert && <Metric label={t('stats.total')} value={`${approx}${fmt(nut.total)} ${unitLabel(nut.unit)}`} />}
        {nut.target != null && <Metric label={t('stats.target')} value={`${fmt(nut.target, digits)} ${unitLabel(nut.unit)}`} />}
      </div>
    </div>
  )
}

function TrendChip({ trend, unit, invert, single }) {
  if (single || !trend || trend.delta == null) {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{t('stats.noTrend')}</div>
  }
  if (trend.dir === 'flat') {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{t('stats.flat')}</div>
  }
  const up = trend.dir === 'up'
  // Рост «плохого» (сахар) — тревожный; рост прочего — нейтральный.
  const good = invert ? !up : null
  const col = good == null ? 'var(--ink-2)' : good ? 'var(--good)' : 'var(--danger)'
  return (
    <div className="tabular" style={{ fontSize: 12, color: col, marginTop: 4, fontWeight: 600 }}>
      {up ? '↑' : '↓'} {fmt(Math.abs(trend.delta), unit === 'ккал' ? 0 : 1)} {unitLabel(unit)}
      {trend.pct != null ? ` (${up ? '+' : '−'}${Math.abs(Math.round(trend.pct))}%)` : ''}
    </div>
  )
}

function ChartLegend({ nut }) {
  const items = nut.target == null
    ? [{ c: nut.color, text: nut.estimate ? t('stats.estIntake') : t('stats.actualIntake') }]
    : [{ c: 'var(--good)', text: t('stats.legendIn') }, { c: 'var(--accent)', text: t('stats.legendUnder') }, { c: 'var(--warn)', text: t('stats.legendOver') }]
  return (
    <div className="row wrap gap12" style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
      {items.map((it) => (
        <span key={it.text} className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.c }} /> {it.text}
        </span>
      ))}
      {nut.target != null && (
        <span className="row gap8" style={{ alignItems: 'center' }}>
          <span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${nut.invert ? 'var(--danger)' : nut.color}` }} /> {nut.invert ? t('stats.limit') : t('stats.goal')}
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
        <div className="src-name">{foodName(p.name)}</div>
        <div className="src-sub">
          {t('count.times', { count: p.count })} · {t('stats.ofMeals', { n: Math.round(p.shareOfMeals * 100) })}
          {p.avgGrams != null ? ` · ${t('stats.gPerTime', { n: Math.round(p.avgGrams) })}` : ` · ${t('stats.kcalPerTime', { n: Math.round(p.avgKcalPerUse) })}`}
        </div>
      </div>
      <div style={{ textAlign: 'end', flex: '0 0 auto' }}>
        <div className="tabular src-val">{p.count}×</div>
        {p.grams > 0 && <div className="src-pct">{t('units.gN', { n: fmt(p.grams) })}</div>}
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
      <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>{t('stats.frequentTitle')}</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t('stats.frequentSub')}</div>
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
        <div className="src-name">{foodName(r.name)}</div>
        <div className="src-sub">{t('stats.uses', { count: r.count })}</div>
      </div>
      <div style={{ textAlign: 'end', flex: '0 0 auto', minWidth: 74 }}>
        <div className="tabular src-val">{def.estimate ? '≈' : ''}{fmt(r.value, digits)} {unitLabel(def.unit)}</div>
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
        <span className="h2" style={{ fontSize: 17 }}>{def.sources}</span>
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
      {open ? t('stats.collapse') : t('stats.showAll', { n: total })}
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

