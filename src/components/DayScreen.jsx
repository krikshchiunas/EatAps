import { useState, useRef } from 'react'
import { useStore } from '../store.jsx'
import { sumDay, sumQuality, sugarLimit, fiberGoal, carbGrade, carbBucket, BUCKET_LABEL } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { mealMeta } from '../lib/foods.js'
import Ring from './Ring.jsx'
import MacroBar from './MacroBar.jsx'

const WELLBEING = ['Энергия', 'Сон', 'Лёгкость', 'Тяжесть', 'Вздутие', 'Голод', 'Стресс', 'Тренировка']

export default function DayScreen({ date, setDate, onOpenAdd, onOpenCalendar, clipboard, setClipboard }) {
  const { profile, dayOf, removeMeal, editMeal, toggleWellbeing, addMeal } = useStore()
  const [editingMeal, setEditingMeal] = useState(null)
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

  // Карточка приёмов пищи — вынесена в переменную, чтобы стоять ВЫШЕ макросов.
  const mealsCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: clipboard ? 8 : 6 }}>
        <div className="h2" style={{ fontSize: 17 }}>Приёмы пищи</div>
        <button style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 15 }} onClick={onOpenAdd}>＋ Добавить</button>
      </div>
      {clipboard && (
        <button
          className="btn soft"
          style={{ height: 40, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}
          onClick={() => addMeal(date, clipboard)}
        >
          <span>📋</span>
          <span>Вставить «{clipboard.name}»</span>
        </button>
      )}
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
            <SwipeableMealItem
              key={m.id}
              m={m}
              meta={meta}
              date={date}
              removeMeal={removeMeal}
              setClipboard={setClipboard}
              onEdit={setEditingMeal}
            />
          )
        })
      )}
    </div>
  )

  return (
    <div className="screen">
      <div className="row between" style={{ marginBottom: 20 }}>
        <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день">‹</button>
        {/* Тап по дате открывает календарь (иконка-подсказка справа от даты). */}
        <button onClick={onOpenCalendar} aria-label="Открыть календарь" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span className="row gap8" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.3px' }}>{humanDay(date, today)}</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-3)' }}>
              <rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9h17M8 3v3M16 3v3" />
            </svg>
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{humanDow(date)}</span>
        </button>
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

      {/* Качество углеводов — над приёмами пищи, свёрнуто по умолчанию. */}
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

      {/* Приёмы пищи — подняты выше белков/углеводов/жиров. */}
      {mealsCard}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row gap16" style={{ alignItems: 'flex-start' }}>
          <MacroBar label="Белки" value={totals.protein} max={t.protein} />
          <MacroBar label="Углеводы" value={totals.carbs} max={t.carbs} color="var(--accent)" />
          <MacroBar label="Жиры" value={totals.fat} max={t.fat} color="var(--warn)" />
        </div>
      </div>

      {editingMeal && (
        <EditMealSheet
          meal={editingMeal}
          onSave={(updated) => { editMeal(date, updated); setEditingMeal(null) }}
          onClose={() => setEditingMeal(null)}
        />
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="h2" style={{ fontSize: 17, marginBottom: 14 }}>Самочувствие</div>
        <div className="row wrap gap8">
          {WELLBEING.map((w) => (
            <button key={w} className={`chip ${day.wellbeing.includes(w) ? 'on' : ''}`} onClick={() => toggleWellbeing(date, w)} style={day.wellbeing.includes(w) ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>
              {w}
            </button>
          ))}
        </div>
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
  const [open, setOpen] = useState(false)
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
      {/* Свёрнутая шапка: заголовок + оценка + шеврон. Тап — раскрыть/свернуть. */}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left' }}>
        <span className="h2" style={{ fontSize: 17 }}>Качество углеводов</span>
        <span className="row gap8" style={{ alignItems: 'center', flex: '0 0 auto' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: g.color, background: g.bg, padding: '4px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{g.emoji} {g.title}</span>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flex: '0 0 auto' }}><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
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
      )}
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

const ACTION_W = 80
const SNAP = 55

function SwipeableMealItem({ m, meta, date, removeMeal, setClipboard, onEdit }) {
  const [offsetX, setOffsetX] = useState(0)
  const startRef = useRef(null)
  const isDraggingRef = useRef(false)
  const timerRef = useRef(null)
  const contentRef = useRef(null)

  const handlePointerDown = (e) => {
    if (e.button !== 0) return
    startRef.current = { x: e.clientX, y: e.clientY }
    isDraggingRef.current = false
    try { contentRef.current?.setPointerCapture(e.pointerId) } catch {}
    timerRef.current = setTimeout(() => {
      navigator.vibrate?.(40)
      setClipboard({ type: m.type, name: m.name, emoji: m.emoji, grams: m.grams, unit: m.unit, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat })
      startRef.current = null
    }, 600)
  }

  const handlePointerMove = (e) => {
    if (!startRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = Math.abs(e.clientY - startRef.current.y)
    if (!isDraggingRef.current) {
      if (dy > Math.abs(dx) + 3) { clearTimeout(timerRef.current); startRef.current = null; return }
      if (Math.abs(dx) < 6) return
      isDraggingRef.current = true
      clearTimeout(timerRef.current)
    }
    setOffsetX(Math.max(-ACTION_W, Math.min(ACTION_W, dx)))
  }

  const handlePointerUp = (e) => {
    clearTimeout(timerRef.current)
    if (!isDraggingRef.current) { startRef.current = null; return }
    isDraggingRef.current = false
    const dx = startRef.current ? e.clientX - startRef.current.x : 0
    startRef.current = null
    if (dx <= -SNAP) setOffsetX(-ACTION_W)
    else if (dx >= SNAP) setOffsetX(ACTION_W)
    else setOffsetX(0)
  }

  const handlePointerCancel = () => {
    clearTimeout(timerRef.current)
    isDraggingRef.current = false
    startRef.current = null
    setOffsetX(0)
  }

  const reset = () => setOffsetX(0)

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Swipe-right action: edit (appears on left) */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
        <button style={{ color: '#fff', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { onEdit(m); reset() }}>
          <span style={{ fontSize: 20 }}>✏️</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Изменить</span>
        </button>
      </div>
      {/* Swipe-left action: delete (appears on right) */}
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
        <button style={{ color: '#fff', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { removeMeal(date, m.id); reset() }}>
          <span style={{ fontSize: 20 }}>🗑️</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Удалить</span>
        </button>
      </div>
      {/* Content */}
      <div
        ref={contentRef}
        style={{ transform: `translateX(${offsetX}px)`, transition: isDraggingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)', touchAction: 'pan-y', userSelect: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="meal-item" style={{ borderBottom: 'none' }}>
          <span className="meal-emoji">{m.emoji || meta.emoji}</span>
          <div style={{ flex: 1 }}>
            <div className="meal-name">{m.name}</div>
            <div className="meal-meta">{meta.label}{m.grams ? ` · ${m.grams} ${m.unit || 'г'}` : ''} · Б{m.protein} У{m.carbs} Ж{m.fat}</div>
          </div>
          <div className="tabular" style={{ fontWeight: 650 }}>{m.kcal}</div>
        </div>
      </div>
    </div>
  )
}

function EditMealSheet({ meal, onSave, onClose }) {
  const [grams, setGrams] = useState(String(meal.grams || ''))
  const g = Math.max(0, parseFloat(grams) || 0)
  const scale = meal.grams && g > 0 ? g / meal.grams : 1

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <div className="h2" style={{ fontSize: 17 }}>{meal.name}</div>
          <button className="iconbtn" onClick={onClose}>✕</button>
        </div>
        {meal.grams ? (
          <>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="label">{meal.unit === 'мл' ? 'Объём, мл' : 'Порция, г'}</label>
              <input className="input" type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} style={{ marginTop: 6 }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 22 }}>
              {[['ккал', Math.round(meal.kcal * scale)], ['белки', +(meal.protein * scale).toFixed(1)], ['угл.', +(meal.carbs * scale).toFixed(1)], ['жиры', +(meal.fat * scale).toFixed(1)]].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div className="tabular" style={{ fontSize: 20, fontWeight: 680 }}>{v}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>Порция не задана — редактирование недоступно.</p>
        )}
        <button className="btn" onClick={() => onSave(meal.grams ? { ...meal, grams: g, kcal: Math.round(meal.kcal * scale), protein: +(meal.protein * scale).toFixed(1), carbs: +(meal.carbs * scale).toFixed(1), fat: +(meal.fat * scale).toFixed(1) } : meal)}>
          Сохранить
        </button>
      </div>
    </div>
  )
}
