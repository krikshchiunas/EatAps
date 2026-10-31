import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { keyOf, humanDay } from '../lib/date.js'
import { computeStats, PERIODS, NUTRIENTS, TOL } from '../lib/stats.js'
import { unitLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { suppName } from '../lib/suppNames.js'
import { t, fmtNum } from '../lib/i18n.js'
import { useLang } from '../lib/useLang.js'
import { computeMicroStats } from '../lib/microStats.js'
import { formatMicro } from '../lib/micronutrients.js'
import { microTone, microStatusWord } from '../lib/microSummary.js'
import { stackMicroKeys } from '../lib/suppStack.js'
import StatChart from './StatChart.jsx'

// Разделы статистики. Период у них общий и при переключении не сбрасывается:
// человек смотрит на одну и ту же неделю с двух сторон — КБЖУ и витамины.
const SECTIONS = [
  { key: 'food', get label() { return t('stats.micro.sectionFood') } },
  { key: 'micro', get label() { return t('stats.micro.sectionMicro') } },
]

const fmt = (n, digits = 0) => {
  const num = Number(n)
  if (n == null || !Number.isFinite(num)) return '—' // отсекаем NaN/Infinity/undefined/строки
  const v = digits ? Math.round(num * 10 ** digits) / 10 ** digits : Math.round(num)
  return fmtNum(v)
}

export default function StatsScreen({ onClose }) {
  const { days, profile, supplements, microGoals } = useStore()
  const [section, setSection] = useState('food')
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

  // Витамины считаются, только пока открыт их раздел: за год это разбор
  // каждой записи дневника на микронутриенты, а «Питанию» он не нужен.
  // Дни — те же, что у остальной статистики (stats.loggedKeys).
  const micro = useMemo(
    () => (section === 'micro' && stats.hasData
      ? computeMicroStats(days, stats.loggedKeys, {
        profile,
        goals: microGoals,
        stackKeys: stackMicroKeys(supplements),
      })
      : null),
    [section, stats, days, profile, microGoals, supplements]
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

      {/* Раздел: КБЖУ или витамины */}
      <div className="seg" style={{ marginBottom: 10 }}>
        {SECTIONS.map((s) => (
          <button key={s.key} className={section === s.key ? 'on' : ''} aria-pressed={section === s.key} onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
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
      ) : section === 'micro' ? (
        <MicroSection stats={stats} micro={micro} />
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
            {skippedDaysNote(stats)}
            {stats.summary.calTargetVaried && ` ${t('stats.targetVaried')}`}
          </p>
        </>
      )}
    </div>
  )
}

// Почему в средние попали не все дни с едой. Числа обязаны сходиться: если
// день с едой не вошёл в средние, человек должен видеть почему, а не гадать
// над расхождением. Общая для обоих разделов — дни у них одни и те же.
function skippedDaysNote(stats) {
  let s = ''
  if (stats.pendingLowDays > 0) s += ` ${t('stats.pendingLow', { count: stats.pendingLowDays })}`
  if (stats.excludedDays > 0) s += ` ${t('stats.excludedDays', { count: stats.excludedDays })}`
  return s
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

// ── Витамины и минералы ───────────────────────────────────────────────────────
// Тот же список, что внизу экрана дня (SupplementsCard), только каждое число —
// среднее за день по выбранному периоду. Вид строки и слова статусов общие с
// экраном дня: одна и та же норма не должна выглядеть по-разному в двух местах.
// Вся арифметика — в lib/microStats.js.

function pctText(value, of) {
  const p = (value / of) * 100
  if (p > 0 && p < 1) return t('stats.micro.lessThan1')
  return `${fmtNum(Math.round(p))}%`
}

// Источник в «больше всего дали»: продукт — по исходному названию, добавка —
// по suppId, как и везде в приложении.
const sourceName = (s) => (s.supp ? suppName({ suppId: s.suppId, name: s.name }) || t('supp.title') : foodName(s.name))

function MicroSection({ stats, micro }) {
  if (!micro) return null
  const { coverage } = micro
  const missed = coverage.total - coverage.covered
  return (
    <>
      <DataScope stats={stats} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>{t('stats.micro.title')}</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          {t('stats.micro.intro')}
        </div>
        {micro.total > 0 && (
          <div style={{ marginTop: 12 }}>
            <span className="tabular" style={{ display: 'inline-block', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: '4px 12px', borderRadius: 'var(--r-pill)' }}>
              {t('stats.micro.doneOf', { done: micro.done, total: micro.total })}
            </span>
          </div>
        )}
      </div>

      {micro.groups.map((g) => <MicroGroupCard key={g.key} group={g} days={micro.days} />)}

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 4px 0', lineHeight: 1.5 }}>
        {t('stats.micro.footAvg', { n: stats.loggedDays, total: stats.totalDays })}
        {skippedDaysNote(stats)}
        {/* Неразобранная запись — не «ноль витаминов», а пробел в данных, и
            молчать о нём нельзя: иначе средние выглядят точнее, чем есть. */}
        {missed > 0 && ` ${t('stats.micro.missed', { count: coverage.total, missed })}`}
        {' '}{t('supp.disclaimer')}
      </p>
    </>
  )
}

function MicroGroupCard({ group, days }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 14, gap: 10 }}>
        <span className="h2" style={{ fontSize: 17 }}>{group.emoji} {group.label}</span>
        {group.total > 0 && (
          <span className="tabular" style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: '0 0 auto' }}>{group.done} / {group.total}</span>
        )}
      </div>
      <div className="stack">
        {group.rows.map((r) => <MicroStatRow key={r.key} row={r} days={days} />)}
      </div>
    </div>
  )
}

function MicroStatRow({ row, days }) {
  const [open, setOpen] = useState(false)
  const tone = microTone(row.status)
  const unit = row.def.unit
  // Полоску рисуем только там, где есть с чем сравнивать — у вещества без
  // нормы полная полоска читалась бы как «набрано полностью».
  const hasBar = row.target > 0
  const pct = hasBar ? Math.min(100, (row.total / row.target) * 100) : 0
  // Доля еды внутри набранного: сначала еда, потом добавки — видно, чем
  // именно закрыта норма.
  const foodPct = row.total > 0 ? (row.fromFood / row.total) * 100 : 0
  const word = microStatusWord(row)

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', textAlign: 'start' }}>
        <div className="row between" style={{ gap: 10, marginBottom: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 550, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.def.label}
            {row.personal && <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}> · {t('supp.myNorm')}</span>}
          </span>
          <span className="tabular" style={{ fontSize: 13, color: tone.color, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
            {formatMicro(row.total)}{row.target != null ? ` / ${formatMicro(row.target)}` : ''} {unitLabel(unit)}
          </span>
        </div>
        {hasBar && (
          <div style={{ height: 7, borderRadius: 5, background: 'var(--track)', overflow: 'hidden', display: 'flex' }}>
            <div style={{ height: '100%', width: `${(pct * foodPct) / 100}%`, background: tone.bar, transition: 'width 0.4s ease' }} />
            <div style={{ height: '100%', width: `${pct - (pct * foodPct) / 100}%`, background: tone.bar, opacity: 0.45, transition: 'width 0.4s ease' }} />
          </div>
        )}
        <div className="row between" style={{ marginTop: 4, gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.fromFood > 0 && t('supp.fromFood', { n: formatMicro(row.fromFood) })}
            {row.fromFood > 0 && row.fromSupp > 0 && ' · '}
            {row.fromSupp > 0 && t('supp.fromSupps', { n: formatMicro(row.fromSupp) })}
          </span>
          {word && <span style={{ fontSize: 11, color: tone.color, flex: '0 0 auto' }}>{word}</span>}
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}>
          {row.def.about && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>{row.def.about}</p>
          )}
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: row.sources.length ? '0 0 10px' : 0 }}>
            {microDetailsText(row, days)}
          </p>
          {row.sources.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{t('supp.topSources')}</div>
              {row.sources.map((s) => (
                <div key={(s.supp ? 's:' : 'f:') + s.name} className="row between" style={{ fontSize: 12.5, padding: '2px 0', gap: 10 }}>
                  <span style={{ color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.emoji} {sourceName(s)}</span>
                  <span className="tabular" style={{ color: 'var(--ink-3)', flex: '0 0 auto' }}>{pctText(s.share, 1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Пояснение к строке словами. Среднее и «сколько дней» — вместе: среднее
// прячет режим (печень раз в неделю даёт «норму» витамина A при шести пустых
// днях), а счёт дней без среднего не говорит, сколько всего набралось.
function microDetailsText(row, days) {
  const f = (v) => formatMicro(v, row.def.unit)
  // За один день «норма закрыта в 1 из 1» — не новость, а повтор среднего.
  const many = days > 1
  const avg = row.total > 0 ? t('stats.micro.avgPerDay', { v: f(row.total) }) : t('stats.micro.none')
  const out = []

  if (row.def.kind === 'limit' && row.target != null) {
    out.push(t('stats.micro.limitGuide', { v: f(row.target) }), `${avg}.`)
    if (many && row.daysOver > 0) out.push(t('stats.micro.daysOver', { n: row.daysOver, count: days }))
  } else if (row.target != null) {
    if (row.total > 0) {
      const pct = pctText(row.total, row.target)
      out.push(t(row.personal ? 'stats.micro.pctOfMyNorm' : 'stats.micro.pctOfNorm', { avg, pct, v: f(row.target) }))
      if (many) {
        out.push(row.daysDone > 0
          ? t('stats.micro.daysDone', { n: row.daysDone, count: days })
          : t('stats.micro.noneDone'))
      }
    } else {
      out.push(t(row.personal ? 'stats.micro.myNormIs' : 'stats.micro.normIs', { avg, v: f(row.target) }))
    }
  } else {
    out.push(`${avg}.`)
    if (many && row.daysWith > 0 && row.daysWith < days) out.push(t('stats.micro.daysWith', { n: row.daysWith, count: days }))
    out.push(t('stats.micro.noNorm'))
  }

  if (row.ul != null) {
    out.push(row.ulScope === 'supp'
      ? (row.fromSupp > 0
        ? t('stats.micro.ulSuppWith', { ul: f(row.ul), v: f(row.fromSupp) })
        : t('stats.micro.ulSupp', { ul: f(row.ul) }))
      : t('stats.micro.ul', { ul: f(row.ul) }))
  }
  return out.join(' ')
}

