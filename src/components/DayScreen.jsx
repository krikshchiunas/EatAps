import { macroLabel, amountLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { t, isRtl } from '../lib/i18n.js'
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { sumDay, sumQuality, sumAdvanced, satFatLimit, sugarLimit, fiberGoal, carbGrade, carbBucket, BUCKET_LABEL } from '../lib/nutrition.js'
import {
  targetsForDay, baselineTargetsForDay, profileScore, dayWeight, hasDayActivity, effectiveActivity,
  ACTIVITY_LEVELS, activityLevelFor, strengthDeltaForDay,
} from '../lib/body.js'
import { isLowLogged } from '../lib/stats.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { getMealSections, foodsForMeal, resolvedTime, newCustomSection } from '../lib/meals.js'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import SupplementsCard from './SupplementsCard.jsx'
import SupplementSheet from './SupplementSheet.jsx'
import MicroGoalSheet from './MicroGoalSheet.jsx'
import FoodInfoSheet from './FoodInfoSheet.jsx'
import { buildMicroSummary } from '../lib/microSummary.js'
import { stackMicroKeys } from '../lib/suppStack.js'
import MealSectionSheet from './MealSectionSheet.jsx'
import SaveTemplateSheet from './SaveTemplateSheet.jsx'
import ShareCardSheet from './ShareCardSheet.jsx'
import CoachMark from './CoachMark.jsx'
import Ring from './Ring.jsx'
import MacroBar from './MacroBar.jsx'

const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

export default function DayScreen({ date, setDate, onOpenAdd, onOpenCalendar, onOpenStats, clipboard, setClipboard }) {
  const store = useStore()
  const {
    profile, days, dayOf, removeFood, editFood, addFood,
    upsertMealSection, deleteMealSection, moveMealSection,
    setDayWeight, setDayActivity, setDayActivityScore, setDayStrength, setDefaultActivityScore,
    setDayStatsExcluded, confirmDayStats,
    repeatDay, repeatMeal, templates, saveTemplate,
    supplements, microGoals, suppDoses, addSupp, removeSupp, editSupp,
    saveStackItem, removeStackItem, setSuppDose, setMicroGoal,
  } = store
  const [editingFood, setEditingFood] = useState(null)
  const [sectionSheet, setSectionSheet] = useState(null) // null | { mode, section }
  const [dayMenuOpen, setDayMenuOpen] = useState(false)
  const [saveTpl, setSaveTpl] = useState(null) // null | { section, foods }
  const openSaveTemplate = (section, foods) => setSaveTpl({ section, foods })
  const [toast, setToast] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [infoFood, setInfoFood] = useState(null)
  const [suppOpen, setSuppOpen] = useState(false)
  const [goalKey, setGoalKey] = useState(null)
  const today = keyOf()
  const day = dayOf(date)

  // Свод для листа добавок считаем здесь, а не внутри листа: лист открывается
  // поверх дня и обязан знать, сколько чего УЖЕ набрано, — без этого прикидка
  // «станет за сегодня» показывала бы приём в пустоту.
  //
  // Но только пока лист открыт. Свод стоит около миллисекунды на насыщенном
  // дне, и считать его на каждый рендер экрана дня (а он перерисовывается от
  // любого касания) ради шторки, которая почти всегда закрыта, незачем.
  const microSummary = useMemo(() => (suppOpen ? buildMicroSummary({
    meals: day.meals,
    supps: day.supps,
    profile,
    goals: microGoals,
    stackKeys: stackMicroKeys(supplements),
  }) : null), [suppOpen, day.meals, day.supps, profile, microGoals, supplements])

  const prevDate = addDays(date, -1)
  const nextDate = addDays(date, 1)
  // Повторять нечего, если в предыдущем дне пусто — не показываем мёртвый пункт.
  const prevHasMeals = (dayOf(prevDate).meals || []).length > 0

  // Факты для обучающих подсказок: учим жестам только тогда, когда им уже
  // есть где примениться (см. lib/tour.js).
  const tourFacts = useMemo(() => ({
    loggedDays: Object.values(days || {}).filter((d) => (d?.meals || []).length > 0).length,
    mealsToday: (day.meals || []).length,
  }), [days, day.meals])
  const canNext = date <= today // вперёд не дальше завтрашнего дня
  // В арабском время идёт справа налево: завтрашний день лежит слева, и листают
  // к нему свайпом вправо. Трек при этом остаётся LTR (так считается сдвиг),
  // а зеркалятся порядок страниц и знак жеста.
  const rtl = isRtl()

  // ── Интерактивный пейджер: трек из 3 страниц, центр = текущий день ──────────
  const viewportRef = useRef(null)
  const trackRef = useRef(null)
  const gesture = useRef(null)
  const animRef = useRef(null)
  const animating = useRef(false)
  const dateRef = useRef(date)
  dateRef.current = date

  // Ширина — ЛЕЙАУТНАЯ (offsetWidth), а не из getBoundingClientRect: на входе
  // экрана .screen проигрывает scale(0.97), и getBoundingClientRect вернул бы
  // ширину с этим масштабом. useLayoutEffect выполняется как раз в этот момент,
  // и трек встал бы на 3% мимо — ровно тот «съехавший» день, который потом
  // никто не мог объяснить.
  const vw = () => viewportRef.current?.offsetWidth || window.innerWidth
  const base = () => -vw() // сдвиг трека, чтобы показать центральную страницу

  // Положение покоя задаём ПРОЦЕНТАМИ, а не пикселями. Пиксельное смещение
  // верно ровно для той ширины, при которой его посчитали: поворот экрана,
  // split view, изменение размера окна, появление полосы прокрутки — и
  // центральная страница уезжает вбок, а экран дня выглядит поехавшим.
  // Проценты браузер пересчитывает сам при любой смене ширины, поэтому такой
  // рассинхрон невозможен в принципе. Пиксели остаются только внутри жеста и
  // доводки, где они и нужны.
  const REST = 'translate3d(-100%,0,0)'

  // Ставим трек в центр без анимации — на маунте и после каждой смены даты
  // (бесшовный recenter: новая центральная страница = та, что доехала).
  useLayoutEffect(() => {
    const tr = trackRef.current
    if (tr) tr.style.transform = REST
  }, [date])

  const cancelAnim = () => { try { animRef.current?.cancel() } catch {} animRef.current = null }

  const settle = (from, to, vel, onDone) => {
    const tr = trackRef.current
    if (!tr) { onDone?.(); return }
    cancelAnim()
    const dist = Math.abs(to - from)
    // Доехали — возвращаемся к процентному положению покоя, если это центр.
    const land = () => { tr.style.transform = Math.abs(to - base()) < 0.5 ? REST : `translate3d(${to}px,0,0)` }
    if (dist < 0.5) { land(); onDone?.(); return }
    const speed = Math.min(4, Math.max(0.9, Math.abs(vel)))
    const dur = Math.max(190, Math.min(430, dist / speed))
    animRef.current = tr.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
      { duration: dur, easing: EASING, fill: 'forwards' },
    )
    animRef.current.onfinish = () => {
      land()
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
    const target = base() + ((dir === 1) !== rtl ? -vw() : vw())
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
      // Свайп строки приёма пищи и собственные горизонтальные жесты (ползунок
      // активности) имеют приоритет — пейджер туда не лезет. Без исключения
      // палец, ведущий ползунок влево/вправо, листал день вместо перетаскивания.
      if (e.target.closest?.('[data-swipeable],[data-no-pager]')) return
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
        const towardNext = rtl ? x > base() : x < base()
        if (!canNext && towardNext) x = base() + (x - base()) * 0.28
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
      if (rtl) dir = -dir
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
  }, [canNext, rtl])

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
    profile, days, dayOf, removeFood, addFood, moveMealSection,
    clipboard, setClipboard, onOpenAdd, onEditFood: setEditingFood, onFoodInfo: setInfoFood,
    onEditSection: openEditSection,
    onCreateSection: openCreateSection, today,
    setDayWeight, setDayActivity, setDayActivityScore, setDayStrength, setDefaultActivityScore,
    setDayStatsExcluded, confirmDayStats,
    repeatMeal, prevDate, onToast: setToast, onSaveTemplate: openSaveTemplate,
    supplements, microGoals, addSupp, removeSupp, editSupp, saveStackItem, removeStackItem,
    onOpenSupp: () => setSuppOpen(true), onOpenGoal: setGoalKey,
  }

  const sheetHasFoods = sectionSheet?.section
    ? foodsForMeal(dayOf(date), sectionSheet.section.id).length > 0
    : false

  return (
    <div className="screen day-screen">
      {/* Шапка с датой — статична, не свайпается: лежит поверх пейджера
          (position: absolute), поэтому при листании дней она остаётся на месте,
          а градиентная плита с кольцом уезжает под ней. Место под шапку
          зарезервировано верхним отступом самой плиты (см. index.css). */}
      <div className="day-topbar">
        {/* Листалка дня — одной группой: ‹ дата ›. Раньше стрелки стояли по
            краям строки, и дата зажималась между ними и кнопками справа. */}
        <div className="day-topbar__nav">
          <button className="iconbtn" onClick={() => go(-1)} aria-label={t('day.prevDay')}>‹</button>
          <button className="day-topbar__date tap44" onClick={onOpenCalendar} aria-label={t('day.openCalendar')}>
            <span className="row gap8" style={{ alignItems: 'center' }}>
              <span className="day-topbar__day">{humanDay(date, today)}</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="day-topbar__cal">
                <rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9h17M8 3v3M16 3v3" />
              </svg>
            </span>
            <span className="day-topbar__dow">{humanDow(date)}</span>
          </button>
          <button className="iconbtn" onClick={() => go(1)} aria-label={t('day.nextDay')} style={{ opacity: canNext ? 1 : 0.4 }} disabled={!canNext}>›</button>
        </div>
        <div className="row gap8">
          <button className="iconbtn" onClick={onOpenStats} aria-label={t('day.stats')}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10M10 20V4M16 20v-7M4 20h16" />
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button className="iconbtn" onClick={() => setDayMenuOpen((o) => !o)} aria-label={t('day.dayActions')} aria-expanded={dayMenuOpen}>⋯</button>
            {dayMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setDayMenuOpen(false)} />
                <div className="friend-menu" style={{ minWidth: 250, insetInlineEnd: 0 }}>
                  {prevHasMeals && (
                    <button onClick={() => { const n = repeatDay(prevDate, date); setDayMenuOpen(false); setToast(n ? t('day.copied', { list: t('count.products', { count: n }) }) : t('day.nothingToCopy')) }}>
                      ♻️ {date === today ? t('day.repeatYesterday') : t('day.repeatPrevious')}
                    </button>
                  )}
                  {day.meals.length > 0 && (
                    <button onClick={() => { setShareOpen(true); setDayMenuOpen(false) }}>
                      📤 {t('day.share')}
                    </button>
                  )}
                  <button onClick={() => { setDayStatsExcluded(date, !day.statsExcluded); setDayMenuOpen(false) }}>
                    {day.statsExcluded ? `📊 ${t('day.includeStats')}` : `🚫 ${t('day.excludeStats')}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Пейджер: 3 страницы, центр — текущий день */}
      <div className="day-pager" ref={viewportRef}>
        <div className="day-track" ref={trackRef}>
          <div className="day-page" aria-hidden="true"><DayBody date={rtl ? nextDate : prevDate} interactive={false} {...bodyProps} /></div>
          <div className="day-page"><DayBody date={date} interactive {...bodyProps} /></div>
          <div className="day-page" aria-hidden="true"><DayBody date={rtl ? prevDate : nextDate} interactive={false} {...bodyProps} /></div>
        </div>
      </div>

      {infoFood && (
        <FoodInfoSheet
          food={infoFood}
          profile={profile}
          microGoals={microGoals}
          onClose={() => setInfoFood(null)}
        />
      )}

      {suppOpen && (
        <SupplementSheet
          summary={microSummary}
          suppDoses={suppDoses}
          setSuppDose={setSuppDose}
          onAdd={(entry) => { addSupp(date, entry); setToast(t('day.suppLogged', { name: entry.name })) }}
          // Ответ стека важнее подтверждения записи и поэтому перекрывает его:
          // «записана» человек и так видит в списке, а вот молчаливый отказ
          // добавить в стек (список полон) не виден ниоткуда. Раньше результат
          // здесь просто выбрасывался, и добавка тихо не попадала в стек.
          onPin={(item) => {
            if (!item) return
            const saved = saveStackItem(item)
            setToast(saved ? t('day.suppPinned', { name: item.name }) : t('day.stackFull'))
          }}
          onClose={() => setSuppOpen(false)}
        />
      )}

      {goalKey && (
        <MicroGoalSheet
          microKey={goalKey}
          profile={profile}
          current={microGoals?.[goalKey] ?? null}
          onSave={(key, value) => setMicroGoal(key, value)}
          onClose={() => setGoalKey(null)}
        />
      )}

      {editingFood && (
        <EditFoodSheet
          food={editingFood}
          onSave={(updated) => { editFood(date, updated); setEditingFood(null) }}
          onClose={() => setEditingFood(null)}
        />
      )}

      {toast && <Toast text={toast} onDone={() => setToast(null)} />}

      {shareOpen && <ShareCardSheet date={date} onClose={() => setShareOpen(false)} />}

      {/* Листы подсказка распознаёт сама (useOverlayOpen), перечислять их тут
          не нужно. Остаётся только то, что листом не является: выпадающее меню
          дня. Совет, перекрывающий действие, — это помеха. */}
      <CoachMark facts={tourFacts} paused={dayMenuOpen} />

      {saveTpl && (
        <SaveTemplateSheet
          section={saveTpl.section}
          foods={saveTpl.foods}
          existing={templates}
          onSave={(tpl, updated) => {
            saveTemplate(tpl)
            setToast(updated ? t('day.tplUpdated', { name: tpl.name }) : t('day.tplSaved', { name: tpl.name }))
          }}
          onClose={() => setSaveTpl(null)}
        />
      )}

      {sectionSheet && (
        <MealSectionSheet
          mode={sectionSheet.mode}
          title={sectionSheet.mode === 'create' ? t('day.newMeal') : sectionSheet.section.label}
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
  date, interactive, profile, days, dayOf, removeFood, addFood, moveMealSection,
  clipboard, setClipboard, onOpenAdd, onEditFood, onFoodInfo, onEditSection, onCreateSection, today,
  setDayWeight, setDayActivity, setDayActivityScore, setDayStrength, setDefaultActivityScore,
  setDayStatsExcluded, confirmDayStats,
  repeatMeal, prevDate, onToast, onSaveTemplate,
  supplements, microGoals, addSupp, removeSupp, editSupp, saveStackItem, removeStackItem, onOpenSupp, onOpenGoal,
}) {
  const day = dayOf(date)
  const prevDay = dayOf(prevDate)
  const totals = sumDay(day.meals)
  const advanced = sumAdvanced(day.meals)
  // Цель считается НА ЭТОТ ДЕНЬ: из веса, актуального на эту дату, и активности
  // этого дня. День на диване и день с тренировкой — разные цели по калориям
  // (см. lib/body.js). Без записей вес и активность берутся из профиля, как раньше.
  const goals = useMemo(() => targetsForDay(days, date, profile) || profile?.targets || {}, [days, date, profile])
  // Та же дата и тот же вес, но активность из анкеты — база для подписи
  // «ползунок добавил/убрал N ккал».
  const baseT = useMemo(() => baselineTargetsForDay(days, date, profile) || profile?.targets || {}, [days, date, profile])
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  const calGoal = num(goals.calories)
  const proteinGoal = num(goals.protein)
  const carbGoal = num(goals.carbs)
  const fatGoal = num(goals.fat)
  const hasCalGoal = calGoal > 0
  const remaining = calGoal - totals.kcal
  const satFatMax = hasCalGoal ? satFatLimit(calGoal) : 0

  const quality = sumQuality(day.meals)
  const sugarMax = sugarLimit(calGoal)
  const fiberMax = fiberGoal()
  const grade = carbGrade({ freeSugar: quality.freeSugar, sugarLimit: sugarMax, fiber: quality.fiber, fiberGoal: fiberMax, carbs: totals.carbs })
  const carbsLeft = carbGoal - totals.carbs

  const sections = getMealSections(day)

  return (
    <div className="day-body" style={interactive ? undefined : { pointerEvents: 'none' }}>
      {/* Кольцо и итоги дня лежат ВНУТРИ градиентной плиты и едут вместе с
          пейджером: свайп перелистывает плиту целиком, а не только карточки под
          ней. Раньше кольцо жило в белой карточке, наезжавшей на шапку снизу —
          получалось два слоя вместо одного, и цифры дня оставались на месте. */}
      <div className="day-hero">
        <Ring
          value={totals.kcal} max={calGoal} size={184} stroke={15}
          trackColor="var(--hero-line)" progressColor="var(--ring-hero)"
        >
          <div>
            <div className="display day-hero__num">{Math.round(hasCalGoal ? Math.abs(remaining) : totals.kcal)}</div>
            <div className="day-hero__cap">{hasCalGoal ? (remaining >= 0 ? t('day.kcalLeft') : t('day.kcalOver')) : t('day.kcalEaten')}</div>
          </div>
        </Ring>
        {/* sumDay складывает дробные КБЖУ продуктов, и сумма приходит сырым
            float'ом (116.69999999999999). В плитке на первом экране нужны целые
            граммы — точность до десятых остаётся в карточках приёмов пищи. */}
        <div className="day-hero__stats">
          <HeroStat label={t('macro.protein')} value={`${Math.round(totals.protein)}${proteinGoal > 0 ? `/${proteinGoal}` : ''}`} />
          <HeroStat label={t('macro.carbs')} value={`${Math.round(totals.carbs)}${carbGoal > 0 ? `/${carbGoal}` : ''}`} />
          <HeroStat label={t('macro.fat')} value={`${Math.round(totals.fat)}${fatGoal > 0 ? `/${fatGoal}` : ''}`} />
        </div>
      </div>

      <StatsFlagBanner
        date={date}
        day={day}
        profile={profile}
        calGoal={calGoal}
        setDayStatsExcluded={setDayStatsExcluded}
        confirmDayStats={confirmDayStats}
      />

      <BodyCard
        date={date}
        day={day}
        profile={profile}
        targets={goals}
        baseTargets={baseT}
        calGoal={calGoal}
        days={days}
        setDayWeight={setDayWeight}
        setDayActivityScore={setDayActivityScore}
        setDayStrength={setDayStrength}
        setDefaultActivityScore={setDefaultActivityScore}
      />

      {grade.level !== 'none' && (
        <QualityCard quality={quality} grade={grade} sugarMax={sugarMax} fiberMax={fiberMax} carbsLeft={carbsLeft} carbsTotal={totals.carbs} />
      )}

      <div className="row between" style={{ margin: '18px 4px 10px' }}>
        <div className="h2" style={{ fontSize: 17 }}>{t('day.meals')}</div>
      </div>

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
          onFoodInfo={onFoodInfo}
          onEditSection={onEditSection}
          canMoveUp={section.renameable && i > 0 && sections[i - 1].renameable}
          canMoveDown={section.renameable && i < sections.length - 1 && sections[i + 1].renameable}
          repeatMeal={repeatMeal}
          prevDate={prevDate}
          prevCount={foodsForMeal(prevDay, section.id).length}
          onToast={onToast}
          onSaveTemplate={onSaveTemplate}
        />
      ))}

      <button className="btn ghost" style={{ height: 46, fontSize: 15, marginTop: 6 }} onClick={onCreateSection}>
        ＋ {t('day.addMeal')}
      </button>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row gap10" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}><MacroBar label={t('macro.protein')} value={totals.protein} max={proteinGoal} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><MacroBar label={t('macro.carbs')} value={totals.carbs} max={carbGoal} color="var(--accent)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}><MacroBar label={t('macro.fat')} value={totals.fat} max={fatGoal} color="var(--warn)" /></div>
        </div>

        {/* Подробности качества — отдельными строками во всю ширину, а не третью
            колонки: в колонке 91 px «Сложные углеводы» и «Усвояемый белок» не
            помещались никогда и всегда стояли с многоточием. */}
        <div className="divider" />
        <SubMetricRow
          label={t('foodInfo.usableProtein')}
          valueText={`${t('units.gN', { n: Math.round(advanced.qualityProtein) })}${advanced.qualityProteinShare != null ? ` · ${Math.round(advanced.qualityProteinShare * 100)}%` : ''}`}
          sub={advanced.qualityProteinConfidence === 'none' ? t('common.noData') : advanced.qualityProteinConfidence === 'partial' ? t('day.partUnknown') : undefined}
          explain={t('day.usableProteinExplain')}
        />
        <SubMetricRow
          label={t('day.complexCarbs')}
          valueText={`${advanced.complexCarbConfidence !== 'measured' ? '≈' : ''}${t('units.gN', { n: Math.round(advanced.complexCarb) })}${totals.carbs > 0 ? ` · ${Math.round((advanced.complexCarb / totals.carbs) * 100)}%` : ''}`}
          sub={advanced.complexCarbConfidence === 'none' ? t('common.noData') : undefined}
          explain={t('day.complexCarbsExplain')}
        />
        <SubMetricRow
          label={t('day.satFat')}
          valueText={`${advanced.satFatConfidence !== 'measured' ? '≈' : ''}${t('units.gN', { n: `${Math.round(advanced.satFat)}${satFatMax > 0 ? `/${satFatMax}` : ''}` })}`}
          sub={
            advanced.satFatConfidence === 'none' ? t('common.noData') :
            advanced.satFatConfidence === 'partial' ? t('day.incomplete') :
            satFatMax > 0 ? (advanced.satFat > satFatMax ? t('day.overGuide') : t('day.withinGuide')) : undefined
          }
          tone={satFatMax > 0 && advanced.satFat > satFatMax ? 'var(--warn)' : undefined}
          explain={t('day.satFatExplain')}
        />
      </div>

      {/* Добавки и микронутриенты — самым низом дня. Выше них ничего не
          двигаем: экран дня остаётся про еду, а витамины человек смотрит
          отдельным заходом и по своему поводу. */}
      <SupplementsCard
        date={date}
        day={day}
        profile={profile}
        supplements={supplements}
        microGoals={microGoals}
        addSupp={addSupp}
        removeSupp={removeSupp}
        editSupp={editSupp}
        saveStackItem={saveStackItem}
        removeStackItem={removeStackItem}
        onOpenAdd={onOpenSupp}
        onOpenGoal={onOpenGoal}
        onToast={onToast}
      />

    </div>
  )
}

// ── Секция приёма пищи (завтрак/обед/ужин/перекус/пользовательский) ────────────
function MealSectionCard({
  date, section, foods, clipboard, setClipboard, addFood, removeFood, moveMealSection,
  onOpenAdd, onEditFood, onFoodInfo, onEditSection, canMoveUp, canMoveDown,
  repeatMeal, prevDate, prevCount, onToast, onSaveTemplate,
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
                {t('units.kcalN', { n: Math.round(totals.kcal) })} · {macroLabel(totals)}
              </div>
            )}
          </div>
        </div>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <button className="iconbtn tap44" style={{ width: 32, height: 32 }} onClick={() => setMenuOpen((o) => !o)} aria-label={t('day.mealActions')}>⋯</button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setMenuOpen(false)} />
              <div className="friend-menu" style={{ minWidth: 180 }}>
                <button onClick={() => { onEditSection(section); setMenuOpen(false) }}>
                  ✏️ {section.renameable ? t('day.nameAndTime') : t('day.changeTime')}
                </button>
                {prevCount > 0 && (
                  <button onClick={() => {
                    const n = repeatMeal(prevDate, date, section.id)
                    setMenuOpen(false)
                    onToast?.(t('day.mealRepeated', { name: section.label, list: t('count.products', { count: n }) }))
                  }}>
                    ♻️ {t('day.repeatYesterdayMeal')}
                  </button>
                )}
                {foods.length > 0 && (
                  <button onClick={() => { onSaveTemplate(section, foods); setMenuOpen(false) }}>
                    💾 {t('template.title')}
                  </button>
                )}
                {canMoveUp && <button onClick={() => { moveMealSection(date, section.id, -1); setMenuOpen(false) }}>⬆️ {t('day.up')}</button>}
                {canMoveDown && <button onClick={() => { moveMealSection(date, section.id, 1); setMenuOpen(false) }}>⬇️ {t('day.down')}</button>}
              </div>
            </>
          )}
        </div>
      </div>

      {clipboard && (
        <button className="btn soft" style={{ height: 38, fontSize: 13.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => addFood(date, { ...clipboard, mealId: section.id })}>
          <span>📋</span><span>{t('day.paste', { name: foodName(clipboard.name) })}</span>
        </button>
      )}

      {foods.length === 0 ? (
        <p className="muted" style={{ fontSize: 14, padding: '2px 0 12px' }}>{t('day.empty')}</p>
      ) : (
        foods.map((f) => (
          <SwipeableFoodItem key={f.id} m={f} date={date} removeFood={removeFood} setClipboard={setClipboard} onEdit={onEditFood} onInfo={onFoodInfo} />
        ))
      )}

      <button className="btn soft" style={{ height: 42, fontSize: 14, marginTop: foods.length ? 4 : 0 }} onClick={() => onOpenAdd(section.id, section.label)}>
        ＋ {t('day.addFood')}
      </button>
    </div>
  )
}

// Компактный раскрывающийся показатель под MacroBar (насыщ. жиры / сложные угл. / белок качества).
function SubMetricRow({ label, valueText, sub, tone, explain }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ minWidth: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: '100%', textAlign: 'start', display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0' }}
      >
        <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, minWidth: 0, flex: 1 }}>
          {label}
          <span aria-hidden="true" style={{ color: 'var(--ink-3)', marginInlineStart: 5, fontSize: 11 }}>{open ? '▴' : '▾'}</span>
        </span>
        <span style={{ flex: '0 0 auto', textAlign: 'end' }}>
          <span className="tabular" style={{ fontSize: 13.5, color: tone || 'var(--ink)', fontWeight: 600 }}>{valueText}</span>
          {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{sub}</span>}
        </span>
      </button>
      {open && <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 8px', lineHeight: 1.45 }}>{explain}</p>}
    </div>
  )
}

// Подписи короткие намеренно: карточка уже называется «Качество углеводов», и
// полные формулировки («Углеводы можно улучшить») вместе с заголовком не
// помещались в 375 px — бейдж вылезал за край карточки вместе со стрелкой.
const GRADE = {
  good: { color: 'var(--good)', bg: 'var(--primary-weak)', emoji: '🟢', get title() { return t('day.gradeGood') } },
  ok: { color: 'var(--warn)', bg: 'var(--accent-weak)', emoji: '🟡', get title() { return t('day.gradeOk') } },
  bad: { color: 'var(--danger)', bg: 'rgba(192,104,78,0.12)', emoji: '🔴', get title() { return t('day.gradeBad') } },
}

function QualityCard({ quality, grade, sugarMax, fiberMax, carbsLeft, carbsTotal }) {
  const [open, setOpen] = useState(false)
  const g = GRADE[grade.level] || GRADE.ok
  const buckets = Object.entries(quality.buckets).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const totalB = buckets.reduce((s, [, v]) => s + v, 0) || 1

  let hint
  if (carbsLeft > 20) hint = t('day.hintCarbsLeft', { n: Math.round(carbsLeft) })
  else if (grade.level === 'bad') hint = t('day.hintSugarGoal')
  else if (grade.sugarOver) hint = t('day.hintSugarOver')
  else if (grade.fiberLow) hint = t('day.hintFiberLow')
  else hint = t('day.hintBalanced')

  return (
    <div className="card" style={{ marginTop: 14 }}>
      {/* Заголовок и оценка лежат в ОДНОЙ переносимой группе, а стрелка всегда
          прижата к правому краю. Помещаются — строка одна; не помещаются (длинная
          оценка, крупный системный шрифт, узкий экран) — пилюля спокойно уезжает
          на вторую строку. Обрезать заголовок многоточием тут нечестно: это
          единственное, что объясняет, о чём карточка. */}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start' }}>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
          <span className="h2" style={{ fontSize: 17 }}>{t('day.carbQuality')}</span>
          {/* Смысл несёт сам текст пилюли — цвет остаётся усилением, а не
              единственным носителем информации. */}
          <span style={{ fontSize: 13, fontWeight: 600, color: g.color, background: g.bg, padding: '4px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{g.title}</span>
        </span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flex: '0 0 auto' }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          <QualityBar label={t('foodInfo.freeSugar')} value={quality.freeSugar} max={sugarMax} invert hint={quality.freeSugar > sugarMax ? t('day.tooMuch') : t('day.normal')} />
          <div style={{ height: 12 }} />
          <QualityBar label={t('foodInfo.fiber')} value={quality.fiber} max={fiberMax} hint={quality.fiber < fiberMax * 0.6 ? t('day.tooLittle') : t('day.ok')} />

          {buckets.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, marginBottom: 10 }}>{t('day.carbSources')}</div>
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
        <span className="tabular" style={{ fontSize: 14, color: over ? 'var(--warn)' : 'var(--ink-3)' }}>{value} / {t('units.gN', { n: max })} {over ? '⚠️' : '✓'}</span>
      </div>
      <div style={{ height: 8, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5, transition: 'width 0.5s ease' }} />
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// ── Вес и режим дня ───────────────────────────────────────────────────────────
// Смысл: цель по калориям больше не константа из анкеты. Один день человек
// лежит на кровати, другой много ходит — и норма у этих дней разная. Здесь он
// отмечает то и другое за пару касаний, а кольцо калорий выше сразу
// пересчитывается (см. targetsForDay в lib/body.js).
// Шкала уровней живёт в body.js: от неё зависит цель по калориям, а не только
// подписи. Здесь — только показ.

function BodyCard({
  date, day, days, profile, targets, baseTargets, calGoal,
  setDayWeight, setDayActivityScore, setDayStrength, setDefaultActivityScore,
}) {
  const [open, setOpen] = useState(false)
  const [defaultOpen, setDefaultOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const weight = dayWeight(day)

  const hasScore = day.activityScore != null && Number.isFinite(Number(day.activityScore))
  const score = hasScore ? Number(day.activityScore) : profileScore(profile)
  const isDefault = !hasScore

  useEffect(() => { setDraft(weight != null ? String(weight) : '') }, [date, weight])

  const commitWeight = () => {
    const raw = draft.trim().replace(',', '.')
    if (raw === '') { setDayWeight(date, null); return }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 20 || n > 400) { setDraft(weight != null ? String(weight) : ''); return }
    setDayWeight(date, n)
  }

  const level = activityLevelFor(score)
  const defaultLevel = activityLevelFor(profileScore(profile))
  const strengthOn = day.strength === true
  // Прибавка за тренировку — РАЗНИЦА двух целей этого дня, а не отдельная
  // формула: иначе подпись и скачок цели расходятся на глазах (см. body.js).
  const strengthBonus = useMemo(
    () => strengthDeltaForDay(days, date, profile),
    [days, date, profile],
  )

  // Насколько балл сдвинул цель относительно активности из анкеты — это и есть
  // ответ на «ползунок вообще на что-то влияет?».
  const goal = useMemo(() => {
    const n = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : null)
    const calories = n(targets?.calories)
    if (!calories || calories <= 0) return null
    const baseCal = n(baseTargets?.calories)
    return {
      calories,
      protein: n(targets?.protein) ?? 0,
      fat: n(targets?.fat) ?? 0,
      carbs: n(targets?.carbs) ?? 0,
      delta: baseCal ? calories - baseCal : 0,
    }
  }, [targets, baseTargets])

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'start' }}
      >
        <span className="h2" style={{ fontSize: 17 }}>{t('day.bodyTitle')}</span>
        <span className="row gap8" style={{ alignItems: 'center', flex: '0 0 auto' }}>
          <span className="tabular" style={{ fontSize: 13, color: weight != null ? 'var(--ink-2)' : 'var(--ink-3)' }}>
            {weight != null ? t('units.kgN', { n: weight }) : t('day.noWeight')}
          </span>
          <span style={{ fontSize: 15 }}>{level.emoji}</span>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flex: '0 0 auto' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label" htmlFor={`w-${date}`}>{t('day.morningWeight')}</label>
            <input
              id={`w-${date}`}
              className="input"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder={t('day.weightPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitWeight}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              style={{ marginTop: 6 }}
            />
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>
              {t('day.weightNote')}
            </p>
          </div>

          <div className="activity-zone">
            <div style={{ fontSize: 14, fontWeight: 550, marginBottom: 4 }}>{t('day.walkedTitle')}</div>
            {/* Шаги, а не эпитеты. «Активный день» у каждого свой, а число шагов
                человек видит в телефоне и может с ним сверить. */}
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.45 }}>
              {t('day.stepsNote')}
            </p>

            <div className="row wrap gap8">
              {ACTIVITY_LEVELS.map((lvl) => (
                <button
                  key={lvl.label}
                  className={`chip ${level === lvl ? 'on' : ''}`}
                  onClick={() => setDayActivityScore(date, lvl.score)}
                >
                  {lvl.emoji} {lvl.label} · {lvl.hint}
                </button>
              ))}
            </div>

            <p style={{ fontSize: 12, color: isDefault ? 'var(--ink-3)' : 'var(--ink-2)', marginTop: 10, lineHeight: 1.5, minHeight: 32 }}>
              {level.desc}
              {isDefault && <span style={{ color: 'var(--ink-3)' }}> — {t('day.defaultHint')}</span>}
            </p>

            {/* ── Силовая тренировка ─────────────────────────────────────────
                Отдельно от ходьбы: час со штангой даёт мало шагов, но заметный
                расход, и подкручивать ради него ползунок ходьбы человеку
                пришлось бы наугад. */}
            <div className="divider" style={{ margin: '14px 0' }} />
            <button
              onClick={() => setDayStrength(date, !strengthOn)}
              aria-pressed={strengthOn}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
                padding: '10px 12px', borderRadius: 'var(--r-sm)',
                background: strengthOn ? 'var(--primary-weak)' : 'var(--surface-2)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22, height: 22, flex: '0 0 auto', borderRadius: 7,
                  display: 'grid', placeItems: 'center', fontSize: 13,
                  border: strengthOn ? 'none' : '2px solid var(--border-strong)',
                  background: strengthOn ? 'var(--primary)' : 'transparent',
                  color: 'var(--on-primary)',
                }}
              >
                {strengthOn ? '✓' : ''}
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 550, display: 'block' }}>🏋️ {t('day.strength')}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {strengthOn
                    ? (strengthBonus ? t('day.strengthCountedBonus', { n: strengthBonus }) : t('day.strengthCounted'))
                    : (strengthBonus ? t('day.strengthAskBonus', { n: strengthBonus }) : t('day.strengthAsk'))}
                </span>
              </span>
              <span style={{ fontSize: 12, color: strengthOn ? 'var(--good)' : 'var(--ink-3)', flex: '0 0 auto' }}>
                {strengthOn ? t('day.strengthDone') : t('day.strengthMark')}
              </span>
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '8px 0 0', lineHeight: 1.45 }}>
              {t('day.strengthNote')}
            </p>

            {/* ── Что ставить по умолчанию ───────────────────────────────────
                Анкета спрашивает про образ жизни один раз и словами. Живут люди
                по-разному, и подставлять всем одно и то же — значит для одних
                завышать цель, для других занижать. */}
            <div className="divider" style={{ margin: '14px 0' }} />
            <button
              onClick={() => setDefaultOpen((o) => !o)}
              aria-expanded={defaultOpen}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start' }}
            >
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 550, display: 'block' }}>{t('day.usualDay')}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {t('day.usualDayHint', { level: `${defaultLevel.emoji} ${defaultLevel.hint}` })}
                </span>
              </span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', transform: defaultOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flex: '0 0 auto' }}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {defaultOpen && (
              <div style={{ marginTop: 10 }}>
                <div className="row wrap gap8">
                  {ACTIVITY_LEVELS.map((lvl) => (
                    <button
                      key={lvl.label}
                      className={`chip ${defaultLevel === lvl ? 'on' : ''}`}
                      onClick={() => setDefaultActivityScore(lvl.score)}
                    >
                      {lvl.emoji} {lvl.hint}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '8px 0 0', lineHeight: 1.45 }}>
                  {t('day.usualDayNote')}
                </p>
              </div>
            )}

            {goal && (
              <div className="activity-goal">
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{t('day.goalForDay')}</div>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span className="tabular" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.4px' }}>
                    {goal.calories}
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}> {t('units.kcal')}</span>
                  </span>
                  <span className="tabular" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                    {t('day.goalMacros', { p: goal.protein, f: goal.fat, c: goal.carbs })}
                  </span>
                </div>
                <div className="activity-goal__delta" style={{ color: goal.delta === 0 ? 'var(--ink-3)' : 'var(--primary)' }}>
                  {goal.delta === 0
                    ? t('day.sameAsUsual')
                    : t(strengthOn ? 'day.deltaWalkStrength' : 'day.deltaWalk', { n: `${goal.delta > 0 ? '+' : '−'}${Math.abs(goal.delta)}` })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Учёт дня в статистике ─────────────────────────────────────────────────────
// Три состояния:
// 1. День явно пропущен — не считается, пока не вернуть.
// 2. День похож на не полностью внесённый (калорий сильно меньше цели) — не
//    считается по умолчанию, пока человек явно не решит.
// 3. Подтверждённый низкий день — тихая пометка, что он всё же учитывается.
function StatsFlagBanner({ date, day, profile, calGoal, setDayStatsExcluded, confirmDayStats }) {
  const low = isLowLogged(day, profile, calGoal)

  if (day.statsExcluded) {
    return (
      <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)', boxShadow: 'none' }}>
        <div className="row between" style={{ alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>🚫 {t('day.excluded')}</span>
          <button style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13.5, flex: '0 0 auto' }} onClick={() => setDayStatsExcluded(date, false)}>
            {t('day.include')}
          </button>
        </div>
      </div>
    )
  }

  if (low && !day.statsConfirmed) {
    return (
      <div className="card" style={{ marginTop: 14, borderColor: 'var(--warn)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>⚠️ {t('day.lowTitle')}</div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 12 }}>
          {t('day.lowText')}
        </p>
        <div className="row gap8">
          <button className="btn soft" style={{ height: 40, fontSize: 13.5, width: 'auto', flex: 1 }} onClick={() => confirmDayStats(date)}>{t('day.lowConfirm')}</button>
          <button className="btn ghost" style={{ height: 40, fontSize: 13.5, width: 'auto', flex: 1 }} onClick={() => setDayStatsExcluded(date, true)}>{t('day.exclude')}</button>
        </div>
      </div>
    )
  }

  if (low && day.statsConfirmed) {
    return (
      <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)', boxShadow: 'none' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>✓ {t('day.lowConfirmed')}</span>
      </div>
    )
  }

  return null
}

// Ячейка итогов внутри градиентной плиты. Цвета не задаются здесь: текст
// наследует --on-hero от плиты, разделители рисует .day-hero__stats.
function HeroStat({ label, value }) {
  return (
    <div>
      <div className="display day-hero__val">{value}</div>
      <div className="day-hero__lab">{label}</div>
    </div>
  )
}

const ACTION_W = 80
const SNAP = 32

function SwipeableFoodItem({ m, date, removeFood, setClipboard, onEdit, onInfo }) {
  const [offsetX, setOffsetX] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Зафиксированное положение строки: -ACTION_W (удалить) | 0 | ACTION_W (изменить).
  // Каждый жест считается ОТ него, а не от нуля — иначе строка,
  // уже открытая на одну сторону, перескакивала на противоположную.
  const openRef = useRef(0)
  const startRef = useRef(null)
  const timerRef = useRef(null)
  const contentRef = useRef(null)

  const settle = (to) => { openRef.current = to; setDragging(false); setOffsetX(to) }

  const handlePointerDown = (e) => {
    if (e.button !== 0) return
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, base: openRef.current, moved: false }
    timerRef.current = setTimeout(() => {
      navigator.vibrate?.(40)
      setClipboard({ type: m.type, name: m.name, emoji: m.emoji, cat: m.cat, grams: m.grams, unit: m.unit, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, sugar: m.sugar, satFat: m.satFat })
      startRef.current = null
      settle(openRef.current)
    }, 600)
  }

  const handlePointerMove = (e) => {
    const s = startRef.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = Math.abs(e.clientY - s.y)
    if (!s.moved) {
      if (dy > Math.abs(dx) + 4) { clearTimeout(timerRef.current); startRef.current = null; return }
      if (Math.abs(dx) < 8) return
      s.moved = true
      clearTimeout(timerRef.current)
      setDragging(true)
      try { contentRef.current?.setPointerCapture(s.id) } catch {}
    }
    // Дальше одной кнопки не пускаем — за границей сопротивление, а не стоп.
    let x = s.base + dx
    if (x > ACTION_W) x = ACTION_W + (x - ACTION_W) * 0.2
    else if (x < -ACTION_W) x = -ACTION_W + (x + ACTION_W) * 0.2
    setOffsetX(x)
  }

  const handlePointerUp = (e) => {
    clearTimeout(timerRef.current)
    const s = startRef.current
    startRef.current = null
    try { contentRef.current?.releasePointerCapture(e.pointerId) } catch {}
    if (!s) { settle(openRef.current); return }
    if (!s.moved) {
      // Тап по открытой строке — закрываем; по закрытой — ничего.
      if (openRef.current !== 0) settle(0)
      return
    }
    // Порог отсчитываем от положения до жеста: встречное движение закрывает,
    // движение от центра открывает. Промежуточных состояний нет.
    const dx = e.clientX - s.x
    let to = s.base
    if (dx <= -SNAP) to = s.base > 0 ? 0 : -ACTION_W
    else if (dx >= SNAP) to = s.base < 0 ? 0 : ACTION_W
    settle(to)
  }

  const handlePointerCancel = () => {
    clearTimeout(timerRef.current)
    startRef.current = null
    settle(openRef.current)
  }

  const reset = () => settle(0)

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button style={{ color: 'var(--on-primary)', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { onEdit(m); reset() }}>
          <span style={{ fontSize: 20 }}>✏️</span><span style={{ fontSize: 12, fontWeight: 600 }}>{t('common.edit')}</span>
        </button>
      </div>
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W, background: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button style={{ color: 'var(--on-danger)', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }} onClick={() => { removeFood(date, m.id); reset() }}>
          <span style={{ fontSize: 20 }}>🗑️</span><span style={{ fontSize: 12, fontWeight: 600 }}>{t('common.delete')}</span>
        </button>
      </div>
      <div
        ref={contentRef}
        data-swipeable="true"
        style={{ transform: `translateX(${offsetX}px)`, transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94)', touchAction: 'pan-y', userSelect: 'none', background: 'var(--surface-solid)', borderBottom: '1px solid var(--border)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="meal-item" style={{ borderBottom: 'none' }}>
          <span className="meal-emoji">{m.emoji || '🍽️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="meal-name">{foodName(m.name)}</div>
            <div className="meal-meta">{m.grams ? `${amountLabel(m.grams, m.unit || 'г')} · ` : ''}{macroLabel(m)}</div>
          </div>
          <div className="tabular" style={{ fontWeight: 650, flex: '0 0 auto' }}>{m.kcal}</div>
          {/* Разбор порции. Кнопка живёт ВНУТРИ свайпаемой строки, поэтому
              гасит свои события указателя: без этого долгое нажатие на «i»
              копировало бы продукт в буфер, а протяжка открывала бы строку. */}
          <button
            className="meal-info"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onInfo?.(m) }}
            aria-label={t('day.whatsInside', { name: foodName(m.name) })}
            title={t('day.whatsInsideTitle')}
          >
            i
          </button>
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
          <div className="h2" style={{ fontSize: 17 }}>{foodName(food.name)}</div>
          <button className="iconbtn" onClick={close} aria-label={t('common.close')}>✕</button>
        </div>
        {food.grams ? (
          <>
            <div className="field" style={{ marginBottom: 16 }}>
              <label className="label">{food.unit === 'мл' ? t('day.volumeMl') : t('day.portionG')}</label>
              <input className="input" type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} style={{ marginTop: 6 }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 22 }}>
              {[[t('units.kcal'), Math.round(food.kcal * scale)], [t('day.proteinShort'), +(food.protein * scale).toFixed(1)], [t('day.carbsShort'), +(food.carbs * scale).toFixed(1)], [t('day.fatShort'), +(food.fat * scale).toFixed(1)]].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div className="tabular" style={{ fontSize: 20, fontWeight: 680 }}>{v}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>{t('day.noPortion')}</p>
        )}
        <button className="btn" onClick={() => onSave(food.grams ? { ...food, grams: g, kcal: Math.round(food.kcal * scale), protein: +(food.protein * scale).toFixed(1), carbs: +(food.carbs * scale).toFixed(1), fat: +(food.fat * scale).toFixed(1) } : food)}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}


// Короткое подтверждение действия. Нужно именно потому, что «повторить день»
// добавляет продукты ВНИЗ списка, за пределами экрана: без ответа кажется,
// что кнопка не сработала, и человек жмёт её второй раз.
function Toast({ text, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600)
    return () => clearTimeout(t)
  }, [text, onDone])
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        zIndex: 600, maxWidth: 'calc(100vw - 48px)',
        background: 'var(--ink)', color: 'var(--bg)',
        padding: '10px 18px', borderRadius: 999,
        fontSize: 13.5, fontWeight: 550, boxShadow: 'var(--shadow-float)',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  )
}
