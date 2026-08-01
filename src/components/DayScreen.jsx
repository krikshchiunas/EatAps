import { useStore } from '../store.jsx'
import { sumDay, sumQuality, sugarLimit, fiberGoal, carbGrade, carbBucket, BUCKET_LABEL } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { mealMeta } from '../lib/foods.js'
import Ring from './Ring.jsx'
import MacroBar from './MacroBar.jsx'

const MOODS = [
  { v: 1, emoji: '😞', label: 'Плохо' },
  { v: 2, emoji: '😕', label: 'Так себе' },
  { v: 3, emoji: '😐', label: 'Норм' },
  { v: 4, emoji: '🙂', label: 'Хорошо' },
  { v: 5, emoji: '😄', label: 'Отлично' },
]

const WELLBEING = ['Энергия', 'Сон', 'Лёгкость', 'Тяжесть', 'Вздутие', 'Голод', 'Стресс', 'Тренировка']

export default function DayScreen({ date, setDate, onOpenAdd }) {
  const { profile, dayOf, removeMeal, setMood, toggleWellbeing, addMeal } = useStore()
  const today = keyOf()
  const day = dayOf(date)
  const totals = sumDay(day.meals)
  const t = profile.targets
  const remaining = t.calories - totals.kcal
  const isFuture = date > today

  const quality = sumQuality(day.meals)
  const sugarMax = sugarLimit(t.calories)
  const fiberMax = fiberGoal()
  const grade = carbGrade({ freeSugar: quality.freeSugar, sugarLimit: sugarMax, fiber: quality.fiber, fiberGoal: fiberMax, carbs: totals.carbs })
  const carbsLeft = t.carbs - totals.carbs

  return (
    <div className="screen">
      <div className="row between" style={{ marginBottom: 20 }}>
        <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день">‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.3px' }}>{humanDay(date, today)}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{humanDow(date)}</div>
        </div>
        <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} aria-label="Следующий день" style={{ opacity: isFuture ? 0.4 : 1 }} disabled={isFuture && date >= addDays(today, 2)}>›</button>
      </div>

      <div className="card" style={{ textAlign: 'center' }}>
        <Ring value={totals.kcal} max={t.calories} size={196} stroke={16}>
          <div>
            <div className="tabular" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{Math.abs(remaining)}</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{remaining >= 0 ? 'ккал осталось' : 'ккал перебор'}</div>
          </div>
        </Ring>
        <div className="row" style={{ justifyContent: 'center', gap: 20, marginTop: 18 }}>
          <ChipStat label="Съедено" value={`${totals.kcal}`} />
          <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
          <ChipStat label="Цель" value={`${t.calories}`} />
          <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
          <ChipStat label={remaining >= 0 ? 'Недобор' : 'Перебор'} value={`${remaining >= 0 ? '' : '+'}${Math.abs(remaining)}`} accent={remaining < 0 ? 'var(--warn)' : 'var(--primary)'} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row gap16" style={{ alignItems: 'flex-start' }}>
          <MacroBar label="Белки" value={totals.protein} max={t.protein} />
          <MacroBar label="Углеводы" value={totals.carbs} max={t.carbs} color="var(--accent)" />
          <MacroBar label="Жиры" value={totals.fat} max={t.fat} color="var(--warn)" />
        </div>
      </div>

      {grade.level !== 'none' && (
        <QualityCard
          quality={quality}
          grade={grade}
          sugarMax={sugarMax}
          fiberMax={fiberMax}
          carbsLeft={carbsLeft}
          carbsTotal={totals.carbs}
        />
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Самочувствие</div>
        <div className="row between" style={{ marginBottom: 18 }}>
          {MOODS.map((m) => (
            <button key={m.v} onClick={() => setMood(date, day.mood === m.v ? null : m.v)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, opacity: day.mood && day.mood !== m.v ? 0.35 : 1, transition: 'opacity 0.2s ease, transform 0.15s ease', transform: day.mood === m.v ? 'scale(1.18)' : 'none' }}>
              <span style={{ fontSize: 30 }}>{m.emoji}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="divider" />
        <div className="row wrap gap8">
          {WELLBEING.map((w) => (
            <button key={w} className={`chip ${day.wellbeing.includes(w) ? 'on' : ''}`} onClick={() => toggleWellbeing(date, w)} style={day.wellbeing.includes(w) ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="h2" style={{ fontSize: 17 }}>Приёмы пищи</div>
          <button style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 15 }} onClick={onOpenAdd}>＋ Добавить</button>
        </div>
        {day.meals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '26px 0 12px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🍽️</div>
            <p className="muted" style={{ fontSize: 15 }}>Пока ничего не добавлено</p>
            <button className="btn soft" style={{ width: 'auto', marginTop: 14, height: 44, display: 'inline-flex' }} onClick={onOpenAdd}>Добавить первый приём</button>
            {(() => {
              const yesterday = dayOf(addDays(date, -1))
              if (yesterday.meals.length === 0) return null
              return (
                <button
                  className="btn ghost"
                  style={{ width: 'auto', marginTop: 10, marginLeft: 8, height: 44, display: 'inline-flex' }}
                  onClick={() => yesterday.meals.forEach((m) => addMeal(date, { type: m.type, name: m.name, emoji: m.emoji, grams: m.grams, unit: m.unit, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat }))}
                >
                  ↺ Повторить вчера ({yesterday.meals.length})
                </button>
              )
            })()}
          </div>
        ) : (
          day.meals.map((m) => {
            const meta = mealMeta(m.type)
            return (
              <div key={m.id} className="meal-item">
                <span className="meal-emoji">{m.emoji || meta.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div className="meal-name">{m.name}</div>
                  <div className="meal-meta">
                    {meta.label}{m.grams ? ` · ${m.grams} ${m.unit || 'г'}` : ''} · Б{m.protein} У{m.carbs} Ж{m.fat}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tabular" style={{ fontWeight: 650 }}>{m.kcal}</div>
                  <button style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }} onClick={() => removeMeal(date, m.id)}>удалить</button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const GRADE = {
  good: { color: 'var(--good)', bg: 'var(--primary-weak)', emoji: '🟢', title: 'Качественные углеводы' },
  ok: { color: 'var(--warn)', bg: 'var(--accent-weak)', emoji: '🟡', title: 'Углеводы можно улучшить' },
  bad: { color: 'var(--danger)', bg: 'rgba(192,104,78,0.12)', emoji: '🔴', title: 'Много быстрых сахаров' },
}

function QualityCard({ quality, grade, sugarMax, fiberMax, carbsLeft, carbsTotal }) {
  const g = GRADE[grade.level] || GRADE.ok
  const buckets = Object.entries(quality.buckets)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const totalB = buckets.reduce((s, [, v]) => s + v, 0) || 1

  let hint
  if (carbsLeft > 20) hint = `Осталось ${Math.round(carbsLeft)} г углеводов — лучше набрать из круп, хлеба, картофеля, бобовых и фруктов, а не из сладкого.`
  else if (grade.level === 'bad') hint = 'Углеводная цель закрыта, но в основном за счёт сахара. Добавьте клетчатку и сложные углеводы.'
  else if (grade.sugarOver) hint = 'Сахара многовато. В следующий раз замените сладкое на фрукты, крупы или бобовые.'
  else if (grade.fiberLow) hint = 'Мало клетчатки — добавьте овощи, бобовые, цельные крупы или фрукты.'
  else hint = 'Хороший баланс: сахар в норме, клетчатки достаточно.'

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="h2" style={{ fontSize: 17 }}>Качество углеводов</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: g.color, background: g.bg, padding: '4px 12px', borderRadius: 999 }}>{g.emoji} {g.title}</span>
      </div>

      <QualityBar label="Свободные сахара" value={quality.freeSugar} max={sugarMax} invert hint={quality.freeSugar > sugarMax ? 'многовато' : 'в норме'} />
      <div style={{ height: 12 }} />
      <QualityBar label="Клетчатка" value={quality.fiber} max={fiberMax} hint={quality.fiber < fiberMax * 0.6 ? 'маловато' : 'ок'} />

      {buckets.length > 0 && (
        <>
          <div className="divider" />
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, marginBottom: 10 }}>Источники углеводов</div>
          <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden', marginBottom: 10 }}>
            {buckets.map(([k, v]) => (
              <div key={k} style={{ width: `${(v / totalB) * 100}%`, background: k === 'sweet' ? 'var(--danger)' : k === 'grain' ? 'var(--primary)' : k === 'fruit' ? 'var(--accent)' : k === 'veg' ? 'var(--good)' : 'var(--ink-3)' }} />
            ))}
          </div>
          <div className="stack" style={{ marginTop: 0 }}>
            {buckets.map(([k, v]) => (
              <div key={k} className="row between" style={{ fontSize: 13 }}>
                <span className="row gap8" style={{ color: 'var(--ink-2)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: k === 'sweet' ? 'var(--danger)' : k === 'grain' ? 'var(--primary)' : k === 'fruit' ? 'var(--accent)' : k === 'veg' ? 'var(--good)' : 'var(--ink-3)' }} />
                  {BUCKET_LABEL[k]}
                </span>
                <span className="tabular" style={{ color: 'var(--ink-3)' }}>{Math.round((v / totalB) * 100)}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 14, lineHeight: 1.5 }}>{hint}</p>
    </div>
  )
}

function QualityBar({ label, value, max, invert, hint }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const over = invert ? value > max : value < max * 0.6
  const color = over ? 'var(--warn)' : 'var(--good)'
  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 550 }}>{label}</span>
        <span className="tabular" style={{ fontSize: 14, color: over ? 'var(--warn)' : 'var(--ink-3)' }}>
          {value} / {max} г {over ? '⚠️' : '✓'}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 0.5s ease' }} />
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function ChipStat({ label, value, accent }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 680, color: accent || 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{label}</div>
    </div>
  )
}
