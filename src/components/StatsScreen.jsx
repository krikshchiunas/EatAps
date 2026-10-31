import { useMemo, useState } from 'react'
import { plural } from '../lib/text.js'
import { useStore } from '../store.jsx'
import { keyOf, humanDay } from '../lib/date.js'
import { computeStats, PERIODS, NUTRIENTS, TOL } from '../lib/stats.js'
import { computeMicroStats } from '../lib/microStats.js'
import { formatMicro } from '../lib/micronutrients.js'
import { microTone, microStatusWord } from '../lib/microSummary.js'
import { stackMicroKeys } from '../lib/suppStack.js'
import StatChart from './StatChart.jsx'

// Разделы статистики. Период у них общий и при переключении не сбрасывается:
// человек смотрит на одну и ту же неделю с двух сторон — КБЖУ и витамины.
const SECTIONS = [
  { key: 'food', label: 'Питание' },
  { key: 'micro', label: 'Витамины' },
]

const fmt = (n, digits = 0) => {
  const num = Number(n)
  if (n == null || !Number.isFinite(num)) return '—' // отсекаем NaN/Infinity/undefined/строки
  const v = digits ? Math.round(num * 10 ** digits) / 10 ** digits : Math.round(num)
  return v.toLocaleString('ru-RU')
}

export default function StatsScreen({ onClose }) {
  const { days, profile, supplements, microGoals } = useStore()
  const [section, setSection] = useState('food')
  const [period, setPeriod] = useState('7d')
  const today = keyOf()

  // Тяжёлый расчёт — только при смене данных/периода/целей, не на каждый рендер.
  const stats = useMemo(
    () => computeStats(days, profile, period, today),
    [days, profile?.targets, period, today]
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
          <div className="eyebrow">Аналитика питания</div>
          <h1 className="h1" style={{ margin: '4px 0 0' }}>Статистика</h1>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
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
            Средние и проценты считаются по дням, учитываемым в статистике ({stats.loggedDays} из {stats.totalDays}).
            {stats.sugarEstimated && ' «Оценка сахара» рассчитана приблизительно из углеводов там, где сахар не указан отдельно, — это ориентир, а не точное количество.'}
            {skippedDaysNote(stats)}
            {stats.summary.calTargetVaried && ' Цель по калориям за период менялась вместе с вашим весом и активностью дней — в подписях показано среднее значение цели.'}
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
  if (stats.pendingLowDays > 0) s += ` Ещё ${stats.pendingLowDays} ${plural(stats.pendingLowDays, 'день ждёт', 'дня ждут', 'дней ждут')} вашего решения — калорий заметно меньше цели. Откройте такой день и подтвердите или пропустите его.`
  if (stats.excludedDays > 0) s += ` ${stats.excludedDays} ${plural(stats.excludedDays, 'день пропущен', 'дня пропущено', 'дней пропущено')} вручную.`
  return s
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
      <span>Заполнено дней: <b style={{ color: 'var(--ink-2)' }}>{stats.loggedDays} из {stats.totalDays}</b></span>
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
    // Сахар — приблизительная оценка (см. секцию «Оценка сахара»), помечаем ≈.
    { label: 'Сахар*', value: `${stats.sugarEstimated ? '≈' : ''}${fmt(summary.avg.sugar)}`, unit: 'г', color: 'var(--danger)' },
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
          <div className="row between" style={{ marginBottom: 6, alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: 550 }}>Цель по калориям достигнута</span>
            <span className="tabular" style={{ fontSize: 14, fontWeight: 650, color: 'var(--primary)' }}>{summary.goalHitPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${summary.goalHitPct}%`, background: 'var(--primary)', borderRadius: 5, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
            в {summary.daysInTarget} из {stats.loggedDays} {plural(stats.loggedDays, 'заполненного дня', 'заполненных дней', 'заполненных дней')} (±{Math.round(TOL.kcal * 100)}% от цели)
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
  const approx = nut.estimate ? '≈' : '' // сахар — приблизительная оценка
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
            {approx}{fmt(nut.avg, digits)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', marginLeft: 3 }}>{nut.unit}/день</span>
          </div>
          <TrendChip trend={t} unit={nut.unit} invert={nut.invert} single={single} />
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
            <Metric label="В норме" value={`${nut.daysIn} дн.`} color="var(--good)" />
            <Metric label="Недобор" value={`${nut.daysUnder} дн.`} color="var(--accent)" />
            <Metric label="Перебор" value={`${nut.daysOver} дн.`} color="var(--warn)" />
            <Metric label="Ср. отклонение" value={`${nut.avgDeviation >= 0 ? '+' : '−'}${fmt(Math.abs(nut.avgDeviation), digits)}`} />
          </>
        )}
        <Metric label="Максимум" value={`${approx}${fmt(nut.max, digits)}`} />
        <Metric label="Минимум" value={`${approx}${fmt(nut.min, digits)}`} />
        {nut.invert && <Metric label="Всего за период" value={`${approx}${fmt(nut.total)} ${nut.unit}`} />}
        {nut.target != null && <Metric label="Цель" value={`${fmt(nut.target, digits)} ${nut.unit}`} />}
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
    ? [{ c: nut.color, t: nut.estimate ? 'оценка потребления' : 'фактическое потребление' }]
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
        <div className="tabular src-val">{def.estimate ? '≈' : ''}{fmt(r.value, digits)} {def.unit}</div>
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

// ── Витамины и минералы ───────────────────────────────────────────────────────
// Тот же список, что внизу экрана дня (SupplementsCard), только каждое число —
// среднее за день по выбранному периоду. Вид строки и слова статусов общие с
// экраном дня: одна и та же норма не должна выглядеть по-разному в двух местах.
// Вся арифметика — в lib/microStats.js.

const daysWord = (n) => plural(n, 'дня', 'дней', 'дней') // «в 3 из 7 дней», «из 21 дня»

function pctText(value, of) {
  const p = (value / of) * 100
  if (p > 0 && p < 1) return 'меньше 1%'
  return `${Math.round(p)}%`
}

function MicroSection({ stats, micro }) {
  if (!micro) return null
  const { coverage } = micro
  const missed = coverage.total - coverage.covered
  return (
    <>
      <DataScope stats={stats} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 4 }}>Витамины и минералы</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          В среднем за день, еда и добавки вместе. Нажмите на строку — откуда что взялось.
        </div>
        {micro.total > 0 && (
          <div style={{ marginTop: 12 }}>
            <span className="tabular" style={{ display: 'inline-block', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: '4px 12px', borderRadius: 'var(--r-pill)' }}>
              норма закрыта у {micro.done} из {micro.total}
            </span>
          </div>
        )}
      </div>

      {micro.groups.map((g) => <MicroGroupCard key={g.key} group={g} days={micro.days} />)}

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)', margin: '4px 4px 0', lineHeight: 1.5 }}>
        Среднее — всё, что пришло с едой и добавками за дни, учитываемые в статистике ({stats.loggedDays} из {stats.totalDays}), делённое на число этих дней.
        {skippedDaysNote(stats)}
        {/* Неразобранная запись — не «ноль витаминов», а пробел в данных, и
            молчать о нём нельзя: иначе средние выглядят точнее, чем есть. */}
        {missed > 0 && ` Из ${coverage.total} ${plural(coverage.total, 'записи', 'записей', 'записей')} еды ${missed} разобрать не удалось — их витамины и минералы в средние не вошли. Обычно это товары со штрихкодом и записи без веса.`}
        {' '}Числа справочные: они показывают, сколько вещества было в съеденном, а не сколько усвоилось. Это ориентир, а не медицинский показатель, и дефицит по нему не определяют — для этого есть анализы.
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
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', textAlign: 'left' }}>
        <div className="row between" style={{ gap: 10, marginBottom: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 550, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.def.label}
            {row.personal && <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}> · моя норма</span>}
          </span>
          <span className="tabular" style={{ fontSize: 13, color: tone.color, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
            {formatMicro(row.total)}{row.target != null ? ` / ${formatMicro(row.target)}` : ''} {unit}
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
            {row.fromFood > 0 && `еда ${formatMicro(row.fromFood)}`}
            {row.fromFood > 0 && row.fromSupp > 0 && ' · '}
            {row.fromSupp > 0 && `добавки ${formatMicro(row.fromSupp)}`}
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
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Больше всего дали</div>
              {row.sources.map((s) => (
                <div key={(s.supp ? 's:' : 'f:') + s.name} className="row between" style={{ fontSize: 12.5, padding: '2px 0', gap: 10 }}>
                  <span style={{ color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.emoji} {s.name}</span>
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
  const avg = row.total > 0 ? `В среднем ${f(row.total)} в день` : 'За эти дни в записях этого не было'
  const out = []

  if (row.def.kind === 'limit' && row.target != null) {
    out.push(`Ориентир — не больше ${f(row.target)} в сутки.`, `${avg}.`)
    if (many && row.daysOver > 0) out.push(`Выше ориентира — в ${row.daysOver} из ${days} ${daysWord(days)}.`)
  } else if (row.target != null) {
    const norm = row.personal ? 'вашей нормы' : 'нормы'
    if (row.total > 0) {
      out.push(`${avg} — ${pctText(row.total, row.target)} ${norm} (${f(row.target)}).`)
      if (many) {
        out.push(row.daysDone > 0
          ? `Норма закрыта в ${row.daysDone} из ${days} ${daysWord(days)}.`
          : 'Ни в один из дней норма не закрыта.')
      }
    } else {
      out.push(`${avg}. ${row.personal ? 'Ваша норма' : 'Норма'} — ${f(row.target)} в день.`)
    }
  } else {
    out.push(`${avg}.`)
    if (many && row.daysWith > 0 && row.daysWith < days) out.push(`Было в рационе в ${row.daysWith} из ${days} ${daysWord(days)}.`)
    out.push('Нормы для этого вещества не установлено.')
  }

  if (row.ul != null) {
    out.push(row.ulScope === 'supp'
      ? `Верхний предел для добавок — ${f(row.ul)}${row.fromSupp > 0 ? `; из добавок в среднем ${f(row.fromSupp)}` : ''}.`
      : `Верхний предел — ${f(row.ul)} в сутки.`)
  }
  return out.join(' ')
}

