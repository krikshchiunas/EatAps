import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isValidWeight, isValidActivity, dayWeight, effectiveActivity, hasDayActivity,
  buildWeightIndex, weightAt, createTargetResolver, targetsForDay,
  weightSeries, movingAverage, weightTrend, bmi, bmiBand,
  weightSummary, activitySummary,
} from './body.js'
import { computeTargets } from './nutrition.js'

const PROFILE = { sex: 'male', age: 30, height: 180, weight: 80, activity: 'light', goal: 'maintain' }
const day = (extra = {}) => ({ meals: [], mealSections: [], mood: null, wellbeing: [], note: '', ...extra })
const range = (from, to) => {
  const out = []
  const d = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

// ── Валидация ─────────────────────────────────────────────────────────────────

test('isValidWeight отсекает опечатки и мусор', () => {
  assert.equal(isValidWeight(80), true)
  assert.equal(isValidWeight('72.5'), true)
  assert.equal(isValidWeight(19), false) // ниже нижней границы
  assert.equal(isValidWeight(401), false) // выше верхней
  assert.equal(isValidWeight(null), false)
  assert.equal(isValidWeight('семьдесят'), false)
  assert.equal(isValidWeight(NaN), false)
})

test('isValidActivity принимает только известные уровни', () => {
  assert.equal(isValidActivity('sedentary'), true)
  assert.equal(isValidActivity('high'), true)
  assert.equal(isValidActivity('ультра'), false)
  assert.equal(isValidActivity(undefined), false)
})

test('dayWeight возвращает null вместо мусора', () => {
  assert.equal(dayWeight(day({ weight: 77.4 })), 77.4)
  assert.equal(dayWeight(day({ weight: 0 })), null)
  assert.equal(dayWeight(day()), null)
  assert.equal(dayWeight(null), null)
})

// ── Активность дня ────────────────────────────────────────────────────────────

test('активность дня перебивает профиль, мусор игнорируется', () => {
  assert.equal(effectiveActivity(day({ activity: 'high' }), PROFILE), 'high')
  assert.equal(effectiveActivity(day(), PROFILE), 'light') // из профиля
  assert.equal(effectiveActivity(day({ activity: 'чушь' }), PROFILE), 'light')
  assert.equal(effectiveActivity(day(), {}), 'light') // дефолт, без профиля
  assert.equal(hasDayActivity(day({ activity: 'moderate' })), true)
  assert.equal(hasDayActivity(day()), false)
})

// ── Индекс взвешиваний ────────────────────────────────────────────────────────

test('weightAt: последнее взвешивание НА дату или раньше', () => {
  const days = {
    '2026-01-05': day({ weight: 80 }),
    '2026-01-10': day({ weight: 79 }),
    '2026-01-20': day({ weight: 78 }),
  }
  const idx = buildWeightIndex(days)
  assert.equal(idx.keys.length, 3)

  assert.equal(weightAt(idx, '2026-01-05'), 80) // ровно в день взвешивания
  assert.equal(weightAt(idx, '2026-01-07'), 80) // между — держим прошлое
  assert.equal(weightAt(idx, '2026-01-10'), 79)
  assert.equal(weightAt(idx, '2026-01-19'), 79)
  assert.equal(weightAt(idx, '2026-01-20'), 78)
  assert.equal(weightAt(idx, '2026-02-01'), 78) // после последнего — оно же
})

test('weightAt до первого взвешивания откатывается на вес профиля', () => {
  const idx = buildWeightIndex({ '2026-01-10': day({ weight: 79 }) })
  assert.equal(weightAt(idx, '2026-01-01', 85), 85)
  assert.equal(weightAt(idx, '2026-01-01', null), null)
  // Совсем без взвешиваний — только фолбэк.
  assert.equal(weightAt(buildWeightIndex({}), '2026-01-01', 85), 85)
})

test('buildWeightIndex пропускает дни без валидного веса', () => {
  const idx = buildWeightIndex({
    '2026-01-01': day({ weight: 80 }),
    '2026-01-02': day(),
    '2026-01-03': day({ weight: 'ой' }),
    '2026-01-04': day({ weight: 5000 }),
  })
  assert.deepEqual(idx.keys, ['2026-01-01'])
})

// ── Цели, пересчитанные на день ───────────────────────────────────────────────

test('активность дня меняет дневную цель по калориям', () => {
  const days = {
    '2026-03-01': day({ activity: 'sedentary' }),
    '2026-03-02': day({ activity: 'high' }),
    '2026-03-03': day(), // без пометки — как в профиле
  }
  const resolve = createTargetResolver(days, PROFILE)
  const lazy = resolve('2026-03-01', days['2026-03-01']).calories
  const busy = resolve('2026-03-02', days['2026-03-02']).calories
  const plain = resolve('2026-03-03', days['2026-03-03']).calories

  assert.ok(busy > plain, 'активный день должен давать большую цель')
  assert.ok(plain > lazy, 'день на диване — меньшую')
  assert.equal(plain, computeTargets(PROFILE).calories)
})

test('вес дня влияет на цель и переносится вперёд', () => {
  const days = {
    '2026-03-01': day({ weight: 90 }),
    '2026-03-05': day({ weight: 85 }),
  }
  const resolve = createTargetResolver(days, PROFILE)
  const heavy = resolve('2026-03-02', days['2026-03-02']).calories // держится 90 кг
  const lighter = resolve('2026-03-06', days['2026-03-06']).calories // уже 85 кг
  assert.ok(heavy > lighter, 'при меньшем весе цель по калориям ниже')
  assert.equal(heavy, computeTargets({ ...PROFILE, weight: 90 }).calories)
})

test('неполный профиль не ломает расчёт — отдаём цели профиля как есть', () => {
  const base = { targets: { calories: 2000, protein: 100, fat: 60, carbs: 250 } }
  const resolve = createTargetResolver({}, base)
  assert.deepEqual(resolve('2026-03-01', undefined), base.targets)
})

test('targetsForDay — разовый расчёт без ручного индекса', () => {
  const days = { '2026-03-01': day({ weight: 70, activity: 'high' }) }
  const t = targetsForDay(days, '2026-03-01', PROFILE)
  assert.equal(t.calories, computeTargets({ ...PROFILE, weight: 70, activity: 'high' }).calories)
})

// ── История веса ──────────────────────────────────────────────────────────────

test('weightSeries отдаёт только дни со взвешиванием, по возрастанию', () => {
  const days = {
    '2026-01-01': day({ weight: 80 }),
    '2026-01-02': day(),
    '2026-01-03': day({ weight: 79.5 }),
  }
  const s = weightSeries(days, ['2026-01-01', '2026-01-02', '2026-01-03'])
  assert.deepEqual(s, [
    { key: '2026-01-01', weight: 80 },
    { key: '2026-01-03', weight: 79.5 },
  ])
})

test('movingAverage сглаживает скачки и не теряет точки', () => {
  const s = [
    { key: 'a', weight: 80 }, { key: 'b', weight: 84 }, { key: 'c', weight: 79 },
  ]
  const ma = movingAverage(s, 3)
  assert.equal(ma.length, 3)
  assert.equal(ma[0].weight, 80) // первая точка = она сама
  assert.equal(ma[1].weight, 82) // (80+84)/2
  assert.equal(ma[2].weight, 81) // (80+84+79)/3
  assert.deepEqual(movingAverage([], 7), [])
})

test('weightTrend: снижение, рост и «шум» различаются', () => {
  const down = weightTrend([
    { key: '2026-01-01', weight: 82 },
    { key: '2026-01-08', weight: 81 },
    { key: '2026-01-15', weight: 80 },
  ])
  assert.equal(down.dir, 'down')
  assert.ok(Math.abs(down.perWeek + 1) < 1e-9, 'ровно −1 кг в неделю')

  const up = weightTrend([
    { key: '2026-01-01', weight: 80 },
    { key: '2026-01-08', weight: 81 },
  ])
  assert.equal(up.dir, 'up')

  // Колебания весов туда-сюда — не тренд.
  const noise = weightTrend([
    { key: '2026-01-01', weight: 80 },
    { key: '2026-01-08', weight: 80.05 },
  ])
  assert.equal(noise.dir, 'flat')

  assert.equal(weightTrend([{ key: '2026-01-01', weight: 80 }]).perWeek, null)
  assert.equal(weightTrend([]).perWeek, null)
})

// ── ИМТ ───────────────────────────────────────────────────────────────────────

test('ИМТ и его диапазоны', () => {
  assert.ok(Math.abs(bmi(80, 180) - 24.69) < 0.01)
  assert.equal(bmi(80, 0), null)
  assert.equal(bmi(0, 180), null)
  assert.equal(bmiBand(17).key, 'under')
  assert.equal(bmiBand(22).key, 'normal')
  assert.equal(bmiBand(27).key, 'over')
  assert.equal(bmiBand(33).key, 'obese')
  assert.equal(bmiBand(null), null)
})

// ── Своды ─────────────────────────────────────────────────────────────────────

test('weightSummary: дельта, цель и прогноз достижения', () => {
  const days = {
    '2026-01-01': day({ weight: 85 }),
    '2026-01-08': day({ weight: 84 }),
    '2026-01-15': day({ weight: 83 }),
  }
  const keys = range('2026-01-01', '2026-01-15')
  const s = weightSummary(days, keys, { ...PROFILE, weightGoal: 80 })

  assert.equal(s.entries, 3)
  assert.equal(s.current, 83)
  assert.equal(s.first, 85)
  assert.equal(s.delta, -2)
  assert.equal(s.min, 83)
  assert.equal(s.max, 85)
  assert.equal(s.goal, 80)
  assert.equal(s.remaining, -3) // нужно сбросить ещё 3 кг
  assert.ok(s.etaWeeks != null && Math.abs(s.etaWeeks - 3) < 1e-6)
  assert.equal(s.trend.dir, 'down')
})

test('weightSummary не прогнозирует, когда движемся ОТ цели', () => {
  const days = {
    '2026-01-01': day({ weight: 80 }),
    '2026-01-08': day({ weight: 81 }),
  }
  const s = weightSummary(days, range('2026-01-01', '2026-01-08'), { ...PROFILE, weightGoal: 75 })
  assert.equal(s.trend.dir, 'up')
  assert.equal(s.etaWeeks, null, 'вес растёт, а цель ниже — прогноза быть не должно')
})

test('weightSummary без взвешиваний не падает', () => {
  const s = weightSummary({}, range('2026-01-01', '2026-01-05'), PROFILE)
  assert.equal(s.entries, 0)
  assert.equal(s.current, null)
  assert.equal(s.delta, null)
  assert.equal(s.bmi, null)
  assert.equal(s.trend.perWeek, null)
})

test('activitySummary считает только явно отмеченные дни', () => {
  const days = {
    '2026-02-01': day({ activity: 'high' }),
    '2026-02-02': day({ activity: 'high' }),
    '2026-02-03': day({ activity: 'sedentary' }),
    '2026-02-04': day(), // не отмечен — в счёт не идёт
  }
  const keys = range('2026-02-01', '2026-02-04')
  const a = activitySummary(days, keys, PROFILE)

  assert.equal(a.markedDays, 3)
  assert.equal(a.totalDays, 4)
  assert.equal(a.counts.high, 2)
  assert.equal(a.counts.sedentary, 1)
  assert.equal(a.counts.light, 0)
  assert.equal(a.mostCommon, 'high')
  assert.ok(a.avgFactor > a.profileFactor, 'реально активнее, чем записано в профиле')
  assert.ok(a.vsProfile > 0)
})

test('activitySummary без отметок отдаёт null вместо выдуманного среднего', () => {
  const a = activitySummary({ '2026-02-01': day() }, ['2026-02-01'], PROFILE)
  assert.equal(a.markedDays, 0)
  assert.equal(a.avgFactor, null)
  assert.equal(a.vsProfile, null)
  assert.equal(a.mostCommon, null)
})
