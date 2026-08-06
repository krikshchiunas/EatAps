import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useStore } from '../store.jsx'
import { sumDay, sumQuality, sumAdvanced, satFatLimit, sugarLimit, fiberGoal, carbGrade, carbBucket, BUCKET_LABEL } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import {
  getMealSections, foodsForMeal, resolvedTime, newCustomSection,
  effectiveMealId, stdId, STANDARD_TYPES, OTHER_ID,
} from '../lib/meals.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import MealSectionSheet from './MealSectionSheet.jsx'
import Ring from './Ring.jsx'
import MacroBar from './MacroBar.jsx'

const WELLBEING = ['Энергия', 'Сон', 'Лёгкость', 'Тяжесть', 'Вздутие', 'Голод', 'Стресс', 'Тренировка']
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const STANDARD_IDS = new Set(STANDARD_TYPES.map(stdId))

export default function DayScreen({ date, setDate, onOpenAdd, onOpenCalendar, onOpenStats, clipboard, setClipboard }) {
  const store = useStore()
  const { profile, dayOf, removeFood, editFood, toggleWellbeing, addFood, upsertMealSection, deleteMealSection, moveMealSection } = store
  const [editingFood, setEditingFood] = useState(null)
  const [sectionSheet, setSectionSheet] = useState(null) // null | { mode, section }
  const today = keyOf()

  const prevDate = addDays(date, -1)
  const nextDate = addDays(date, 1)
  const canNext = date <= today // вперёд не дальше завтрашнего дня

  // ── Интерактивный пейджер: трек из 3 страниц, центр = текущий день ──────────
  const viewportRef = useRef(null)
  const trackRef = useRef(null)
  const gesture = useRef(null)
  const animRef = useRef(null)
  const animating = useRef(false)
  const dateRef = useRef(date)
  dateRef.current = date

  const vw = () => viewportRef.current?.offsetWidth || window.innerWidth
  const base = () => -vw() // сдвиг трека, чтобы показать центральную страницу

  // Ставим трек в центр без анимации — на маунте и после каждой смены даты
  // (бесшовный recenter: новая центральная страница = та, что доехала).
  useLayoutEffect(() => {
    const tr = trackRef.current
    if (tr) tr.style.transform = `translate3d(${base()}px,0,0)`
  }, [date])

  const cancelAnim = () => { try { animRef.current?.cancel() } catch {} animRef.current = null }

  const settle = (from, to, vel, onDone) => {
    const tr = trackRef.current
    if (!tr) { onDone?.(); return }
    cancelAnim()
    const dist = Math.abs(to - from)
    if (dist < 0.5) { tr.style.transform = `translate3d(${to}px,0,0)`; onDone?.(); return }
    const speed = Math.min(4, Math.max(0.9, Math.abs(vel)))
    const dur = Math.max(190, Math.min(430, dist / speed))
    animRef.current = tr.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
      { duration: dur, easing: EASING, fill: 'forwards' },
    )
    animRef.current.onfinish = () => {
      tr.style.transform = `translate3d(${to}px,0,0)`
      cancelAnim()
      onDone?.()
    }
  }

  // Перейти на соседний день с анимацией (жест или стрелки).
  const go = (dir, vel = 1.2) => {
    if (animating.current) return
    if (dir === 1 && !canNext) { settle(currentX(), base(), 1); return }
    if (dir === 0) { settle(currentX(), base(), Math.max(Math.abs(vel), 1)); return }
    animating.current = true
    const target = base() + (dir === 1 ? -vw() : vw())
    settle(currentX(), target, vel, () => {
      // Меняем дату ПОСЛЕ доводки. useLayoutEffect вернёт трек в центр
      // до перерисовки — новая страница совпадает со старой соседней → без прыжка.
      setDate((d) => addDays(d, dir))
      animating.current = false
    })
  }

  const currentX = () => {
    const tr = trackRef.current
    if (!tr) return base()
    try { return new DOMMatrixReadOnly(getComputedStyle(tr).transform).m41 || base() } catch { return base() }
  }

  // Жест (touch, non-passive для preventDefault при горизонтали).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onStart = (e) => {
      if (animating.current) return
      // Свайп строки приёма пищи имеет приоритет — не перехватываем.
      if (e.target.closest?.('[data-swipeable]')) return
      const t = e.touches[0]
      cancelAnim()
      gesture.current = {
        x: t.clientX, y: t.clientY, base: currentX(),
        decided: false, horiz: false,
        lastX: t.clientX, lastT: e.timeStamp, vel: 0,
      }
    }
    const onMove = (e) => {
      const g = gesture.current
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x
      const dy = t.clientY - g.y
      if (!g.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        g.horiz = Math.abs(dx) > Math.abs(dy) * 1.3
        g.decided = true
        if (!g.horiz) { gesture.current = null; return } // вертикаль → скролл
      }
      if (g.horiz) {
        e.preventDefault()
        const dt = e.timeStamp - g.lastT
        if (dt > 0) g.vel = (t.clientX - g.lastX) / dt
        g.lastX = t.clientX; g.lastT = e.timeStamp
        // Сопротивление на «запретной» границе (будущее).
        let x = g.base + dx
        if (!canNext && x < base()) x = base() + (x - base()) * 0.28
        trackRef.current.style.transform = `translate3d(${x}px,0,0)`
      }
    }
    const onEnd = () => {
      const g = gesture.current
      gesture.current = null
      if (!g || !g.horiz) return
      const v = g.vel
      const moved = currentX() - g.base
      const w = vw()
      // Решение по расстоянию ИЛИ скорости (уверенный флик).
      let dir = 0
      if (v < -0.35 || moved < -w * 0.32) dir = 1       // ушли влево → следующий
      else if (v > 0.35 || moved > w * 0.32) dir = -1   // ушли вправо → предыдущий
      go(dir, Math.max(Math.abs(v), 1))
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [canNext])

  // ── Приёмы пищи: создание/редактирование секций ─────────────────────────────
  const openCreateSection = () => setSectionSheet({ mode: 'create' })
  const openEditSection = (section) => setSectionSheet({
    mode: section.renameable ? 'edit-custom' : 'edit-standard',
    section,
  })
  const closeSectionSheet = () => setSectionSheet(null)

  const handleSectionSubmit = ({ name, time, showTime }) => {
    const s = sectionSheet
    if (!s) return
    if (s.mode === 'create') {
      const day = dayOf(date)
      const sec = newCustomSection(name, day)
      upsertMealSection(date, { ...sec, time, showTime })
    } else if (s.mode === 'edit-custom') {
      upsertMealSection(date, { id: s.section.id, customName: name, time, showTime })
    } else {
      upsertMealSection(date, { id: s.section.id, time, showTime })
    }
    setSectionSheet(null)
  }

  const handleSectionDelete = () => {
    if (!sectionSheet?.section) return
    deleteMealSection(date, sectionSheet.section.id)
    setSectionSheet(null)
  }

  const bodyProps = {
    profile, dayOf, removeFood, toggleWellbeing, addFood, moveMealSection,
    clipboard, setClipboard, onOpenAdd, onEditFood: setEditingFood, onEditSection: openEditSection,
    onCreateSection: openCreateSection, today,
  }

  const sheetHasFoods = sectionSheet?.section
    ? foodsForMeal(dayOf(date), sectionSheet.section.id).length > 0
    : false

  return (
    <div className="screen">
      {/* Шапка с датой — статична, не свайпается. Grid 1fr/auto/1fr держит дату
          по центру независимо от ширины боковых групп (справа стрелка + статистика). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ justifySelf: 'start' }}>
          <button className="iconbtn" onClick={() => go(-1)} aria-label="Предыдущий день">‹</button>
        </div>
        <button onClick={onOpenCalendar} aria-label="Открыть календарь" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span className="row gap8" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.3px' }}>{humanDay(date, today)}</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-3)' }}>
              <rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9h17M8 3v3M16 3v3" />
            </svg>
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{humanDow(date)}</span>
        </button>
        <div className="row gap8" style={{ justifySelf: 'end' }}>
          <button className="iconbtn" onClick={() => go(1)} aria-label="Следующий день" style={{ opacity: canNext ? 1 : 0.4 }} disabled={!canNext}>›</button>
          <button className="iconbtn" onClick={onOpenStats} aria-label="Статистика питания">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10M10 20V4M16 20v-7M4 20h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Пейджер: 3 страницы, центр — текущий день */}
      <div className="day-pager" ref={viewportRef}>
        <div className="day-track" ref={trackRef}>
          <div className="day-page" aria-hidden="true"><DayBody date={prevDate} interactive={false} {...bodyProps} /></div>
          <div className="day-page"><DayBody date={date} interactive {...bodyProps} /></div>
          <div className="day-page" aria-hidden="true"><DayBody date={nextDate} interactive={false} {...bodyProps} /></div>
        </div>
      </div>

      {editingFood && (
        <EditFoodSheet
          food={editingFood}
          onSave={(updated) => { editFood(date, updated); setEditingFood(null) }}
          onClose={() => setEditingFood(null)}
        />
      )}

      {sectionSheet && (
        <MealSectionSheet
          mode={sectionSheet.mode}
          title={sectionSheet.mode === 'create' ? 'Новый приём пищи' : sectionSheet.section.label}
          initialName={sectionSheet.section?.customName || ''}
          initialTime={sectionSheet.section?.time || ''}
          initialShowTime={sectionSheet.section?.showTime ?? true}
          hasFoods={sheetHasFoods}
          onSubmit={handleSectionSubmit}
          onDelete={handleSectionDelete}
          onClose={closeSectionSheet}
        />
      )}
    </div>
  )
}

// ── Контент одного дня (переиспользуется тремя страницами пейджера) ────────────
function DayBody({
  date, interactive, profile, dayOf, removeFood, toggleWellbeing, addFood, moveMealSection,
  clipboard, setClipboard, onOpenAdd, onEditFood, onEditSection, onCreateSection, today,
}) {
  const day = dayOf(date)
  const totals = sumDay(day.meals)
  const advanced = sumAdvanced(day.meals)
  // Цели могут отсутствовать/быть неполными (частичный онбординг, битые данные).
  // Приводим к конечным числам, чтобы в кольцо/бары не попали NaN/undefined.
  const t = profile?.targets || {}
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  const calGoal = num(t.calories)
  const proteinGoal = num(t.protein)
  const carbGoal = num(t.carbs)
  const fatGoal = num(t.fat)
  const hasCalGoal = calGoal > 0
  const remaining = calGoal - totals.kcal
  const satFatMax = hasCalGoal ? satFatLimit(calGoal) : 0

  const quality = sumQuality(day.meals)
  const sugarMax = sugarLimit(calGoal)
  const fiberMax = fiberGoal()
  const grade = carbGrade({ freeSugar: quality.freeSugar, sugarLimit: sugarMax, fiber: quality.fiber, fiberGoal: fiberMax, carbs: totals.carbs })
  const carbsLeft = carbGoal - totals.carbs

  const sections = getMealSections(day)
  const yesterday = dayOf(addDays(date, -1))
  const canRepeatYesterday = day.meals.length === 0 && yesterday.meals.length > 0

  const repeatYesterday = () => {
    for (const f of yesterday.meals) {
      const id = effectiveMealId(f)
      const targetId = STANDARD_IDS.has(id) ? id : OTHER_ID
      addFood(date, {
        mealId: targetId,
        type: STANDARD_IDS.has(id) ? f.type : undefined,
        name: f.name, emoji: f.emoji, cat: f.cat, grams: f.grams, unit: f.unit,
        kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat,
        sugar: f.sugar, satFat: f.satFat,
      })
    }
  }

  return (
    <div className="day-body" style={interactive ? undefined : { pointerEvents: 'none' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <Ring value={totals.kcal} max={calGoal} size={196} stroke={16}>
          <div>
            <div className="tabular" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{hasCalGoal ? Math.abs(remaining) : totals.kcal}</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{hasCalGoal ? (remaining >= 0 ? 'ккал осталось' : 'ккал перебор') : 'ккал съедено'}</div>
          </div>
        </Ring>
        <div className="row" style={{ justifyContent: 'center', gap: 20, marginTop: 18 }}>
          <ChipStat label="Съедено" value={`${totals.kcal}`} />
          <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
          <ChipStat label="Цель" value={hasCalGoal ? `${calGoal}` : '—'} />
          <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
          <ChipStat label={remaining >= 0 ? 'Недобор' : 'Перебор'} value={hasCalGoal ? `${remaining >= 0 ? '' : '+'}${Math.abs(remaining)}` : '—'} accent={hasCalGoal && remaining < 0 ? 'var(--warn)' : 'var(--primary)'} />
        </div>
      </div>

      {grade.level !== 'none' && (
        <QualityCard quality={quality} grade={grade} sugarMax={sugarMax} fiberMax={fiberMax} carbsLeft={carbsLeft} carbsTotal={totals.carbs} />
      )}

      <div className="row between" style={{ margin: '18px 4px 10px' }}>
        <div className="h2" style={{ fontSize: 17 }}>Приёмы пищи</div>
      </div>

      {canRepeatYesterday && (
        <button className="btn soft" style={{ height: 42, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={repeatYesterday}>
          <span>↺</span><span>Повторить вчера ({yesterday.meals.length})</span>
        </button>
      )}

      {sections.map((section, i) => (
        <MealSectionCard
          key={section.id}
          date={date}
          section={section}
          foods={foodsForMeal(day, section.id)}
          clipboard={clipboard}
          setClipboard={setClipboard}
          addFood={addFood}
          removeFood={removeFood}
          moveMealSection={moveMealSection}
          onOpenAdd={onOpenAdd}
          onEditFood={onEditFood}
          onEditSection={onEditSection}
          canMoveUp={section.renameable && i > 0 && sections[i - 1].renameable}
          canMoveDown={section.renameable && i < sections.length - 1 && sections[i + 1].renameable}
        />
      ))}

      <button className="btn ghost" style={{ height: 46, fontSize: 15, marginTop: 6 }} onClick={onCreateSection}>
        ＋ Добавить приём пищи
      </button>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row gap16" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <MacroBar label="Белки" value={totals.protein} max={proteinGoal} />
            <SubMetricRow
              label="Белок выс. качества"
              valueText={`${Math.round(advanced.qualityProtein)} г${advanced.qualityProteinShare != null ? ` · ${Math.round(advanced.qualityProteinShare * 100)}%` : ''}`}
              sub={advanced.qualityProteinConfidence === 'none' ? 'нет данных' : undefined}
              explain="Ориентировочная оценка качества источника белка (полноценность и усвояемость) — от 1 до 10 по типу продукта. Показан белок из продуктов с оценкой 7+ и его доля от общего белка. Оценка приблизительная, зависит от источника продукта — это не медицинский диагноз и не абсолютная оценка рациона."
            />
          </div>
          <div style={{ flex: 1 }}>
            <MacroBar label="Углеводы" value={totals.carbs} max={carbGoal} color="var(--accent)" />
            <SubMetricRow
              label="Сложные углеводы"
              valueText={`${advanced.complexCarbConfidence !== 'measured' ? '≈' : ''}${Math.round(advanced.complexCarb)} г${totals.carbs > 0 ? ` · ${Math.round((advanced.complexCarb / totals.carbs) * 100)}%` : ''}`}
              sub={advanced.complexCarbConfidence === 'none' ? 'нет данных' : undefined}
              explain="Доля углеводов из круп, картофеля, бобовых и цельнозерновых продуктов — продуктовая классификация по типу продукта, а не медицинский показатель «полезных» углеводов. Сахар, сладости, десерты и напитки в неё не входят."
            />
          </div>
          <div style={{ flex: 1 }}>
            <MacroBar label="Жиры" value={totals.fat} max={fatGoal} color="var(--warn)" />
            <SubMetricRow
              label="Насыщ. жиры"
              valueText={`${advanced.satFatConfidence !== 'measured' ? '≈' : ''}${Math.round(advanced.satFat)}${satFatMax > 0 ? `/${satFatMax}` : ''} г`}
              sub={
                advanced.satFatConfidence === 'none' ? 'нет данных' :
                advanced.satFatConfidence === 'partial' ? 'неполные данные' :
                satFatMax > 0 ? (advanced.satFat > satFatMax ? 'превышен ориентир' : 'в пределах ориентира') : undefined
              }
              tone={satFatMax > 0 && advanced.satFat > satFatMax ? 'var(--warn)' : undefined}
              explain="Насыщенные жиры берутся из реальных данных продукта, если они указаны, иначе оцениваются по типу продукта (мясо, молочное, кондитерка и т.п.) — без точности до грамма. Дневной ориентир — не более 10% калорий (рекомендация ВОЗ), считается отдельно от общей нормы жиров."
            />
          </div>
        </div>
      </div>

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

// ── Секция приёма пищи (завтрак/обед/ужин/перекус/пользовательский) ────────────
function MealSectionCard({
  date, section, foods, clipboard, setClipboard, addFood, removeFood, moveMealSection,
  onOpenAdd, onEditFood, onEditSection, canMoveUp, canMoveDown,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const totals = sumDay(foods)
  const time = resolvedTime(section, foods)

  return (
    <div className="card meal-section" style={{ marginBottom: 12 }}>
      <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <div className="row gap12" style={{ alignItems: 'center', minWidth: 0 }}>
          <span className="meal-emoji" style={{ width: 38, height: 38, fontSize: 17, flex: '0 0 auto' }}>{section.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <div className="row gap8" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 15.5, fontWeight: 620 }}>{section.label}</span>
              {time && <span className="tabular" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{time}</span>}
            </div>
            {foods.length > 0 && (
              <div className="tabular" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                {totals.kcal} ккал · Б{totals.protein} Ж{totals.fat} У{totals.carbs}
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <button className="iconbtn" style={{ width: 32, height: 32 }} onClick={() => setMenuOpen((o) => !o)} aria-label="Действия с приёмом">⋯</button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setMenuOpen(false)} />
              <div className="friend-menu" style={{ minWidth: 180 }}>
                <button onClick={() => { onEditSection(section); setMenuOpen(false) }}>
                  ✏️ {section.renameable ? 'Название и время' : 'Изменить время'}
                </button>
                {canMoveUp && <button onClick={() => { moveMealSection(date, section.id, -1); setMenuOpen(false) }}>⬆️ Выше</button>}
                {canMoveDown && <button onClick={() => { moveMealSection(date, section.id, 1); setMenuOpen(false) }}>⬇️ Ниже</button>}
              </div>
            </>
          )}
        </div>
      </div>

      {clipboard && (
        <button className="btn soft" style={{ height: 38, fontSize: 13.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => addFood(date, { ...clipboard, mealId: section.id })}>
          <span>📋</span><span>Вставить «{clipboard.name}»</span>
        </button>
      )}

      {foods.length === 0 ? (
        <p className="muted" style={{ fontSize: 14, padding: '2px 0 12px' }}>Пока ничего не добавлено</p>
      ) : (
        foods.map((f) => (
          <SwipeableFoodItem key={f.id} m={f} date={date} removeFood={removeFood} setClipboard={setClipboard} onEdit={onEditFood} />
        ))
      )}

      <button className="btn soft" style={{ height: 42, fontSize: 14, marginTop: foods.length ? 4 : 0 }} onClick={() => onOpenAdd(section.id, section.label)}>
        ＋ Добавить продукт
      </button>
    </div>
  )
}

// Компактный раскрывающийся показатель под MacroBar (насыщ. жиры / сложные угл. / белок качества).
function SubMetricRow({ label, valueText, sub, tone, explain }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', textAlign: 'left' }}>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 550 }}>{label}</span>
          <span className="tabular" style={{ fontSize: 11.5, color: tone || 'var(--ink-3)' }}>{valueText}</span>
        </div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
      </button>
      {open && <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.4 }}>{explain}</p>}
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
  const buckets = Object.entries(quality.buckets).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const totalB = buckets.reduce((s, [, v]) => s + v, 0) || 1

  let hint
  if (carbsLeft > 20) hint = `Осталось ${Math.round(carbsLeft)} г углеводов — лучше набрать из круп, хлеба, картофеля, бобовых и фруктов, а не из сладкого.`
  else if (grade.level === 'bad') hint = 'Углеводная цель закрыта, но в основном за счёт сахара. Добавьте клетчатку и сложные углеводы.'
  else if (grade.sugarOver) hint = 'Сахара многовато. В следующий раз замените сладкое на фрукты, крупы или бобовые.'
  else if (grade.fiberLow) hint = 'Мало клетчатки — добавьте овощи, бобовые, цельные крупы или фрукты.'
  else hint = 'Хороший баланс: сахар в норме, клетчатки достаточно.'

  return (
    <div className="card" style={{ marginTop: 14 }}>
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
        <span className="tabular" style={{ fontSize: 14, color: over ? 'var(--warn)' : 'var(--ink-3)' }}>{value} / {max} г {over ? '⚠️' : '✓'}</span>
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

function SwipeableFoodItem({ m, date, removeFood, setClipboard, onEdit }) {
  const [offsetX, setOffsetX] = useState(0)
  const startRef = useRef(null)
  const isDraggingRef = useRef(false)
  const timerRef = useRef(null)
  const contentRef = useRef(null)

  const handlePointerDown = (e) => {
    if (e.button !== 0) return
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    isDraggingRef.current = false
    timerRef.current = setTimeout(() => {
      navigator.vibrate?.(40)
      setClipboard({ type: m.type, name: m.name, emoji: m.emoji, cat: m.cat, grams: m.grams, unit: m.unit, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, sugar: m.sugar, satFat: m.satFat })
      startRef.current = null
    }, 600)
  }

  const handlePointerMove = (e) => {
    if (!startRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = Math.abs(e.clientY - startRef.current.y)
    if (!isDraggingRef.current) {
      if (dy > Math.abs(dx) + 4) { clearTimeout(timerRef.current); startRef.current = null; return }
      if (Math.abs(dx) < 8) return
      isDraggingRef.current = true
      clearTimeout(timerRef.current)
      try { contentRef.current?.setPointerCapture(startRef.current.id) } catch {}
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
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button style={{ color: '#fff', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { onEdit(m); reset() }}>
          <span style={{ fontSize: 20 }}>✏️</span><span style={{ fontSize: 12, fontWeight: 600 }}>Изменить</span>
        </button>
      </div>
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button style={{ color: '#fff', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { removeFood(date, m.id); reset() }}>
          <span style={{ fontSize: 20 }}>🗑️</span><span style={{ fontSize: 12, fontWeight: 600 }}>Удалить</span>
        </button>
      </div>
      <div
        ref={contentRef}
        data-swipeable="true"
        style={{ transform: `translateX(${offsetX}px)`, transition: isDraggingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)', touchAction: 'pan-y', userSelect: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="meal-item" style={{ borderBottom: 'none' }}>
          <span className="meal-emoji">{m.emoji || '🍽️'}</span>
          <div style={{ flex: 1 }}>
            <div className="meal-name">{m.name}</div>
            <div className="meal-meta">{m.grams ? `${m.grams} ${m.unit || 'г'} · ` : ''}Б{m.protein} У{m.carbs} Ж{m.fat}</div>
          </div>
          <div className="tabular" style={{ fontWeight: 650 }}>{m.kcal}</div>
        </div>
      </div>
    </div>
  )
}

function EditFoodSheet({ food, onSave, onClose }) {
  const [grams, setGrams] = useState(String(food.grams || ''))
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const g = Math.max(0, parseFloat(grams) || 0)
  const scale = food.grams && g > 0 ? g / food.grams : 1

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <div className="h2" style={{ fontSize: 17 }}>{food.name}</div>
          <button className="iconbtn" onClick={close}>✕</button>
        </div>
        {food.grams ? (
          <>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="label">{food.unit === 'мл' ? 'Объём, мл' : 'Порция, г'}</label>
              <input className="input" type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} style={{ marginTop: 6 }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 22 }}>
              {[['ккал', Math.round(food.kcal * scale)], ['белки', +(food.protein * scale).toFixed(1)], ['угл.', +(food.carbs * scale).toFixed(1)], ['жиры', +(food.fat * scale).toFixed(1)]].map(([l, v]) => (
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
        <button className="btn" onClick={() => onSave(food.grams ? { ...food, grams: g, kcal: Math.round(food.kcal * scale), protein: +(food.protein * scale).toFixed(1), carbs: +(food.carbs * scale).toFixed(1), fat: +(food.fat * scale).toFixed(1) } : food)}>
          Сохранить
        </button>
      </div>
    </div>
  )
}
