import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHALLENGE_KINDS, kindMeta, challengeDays, isDayScored, myProgress,
  challengeStatus, validateChallenge, MAX_DAYS,
} from './challenges.js'
import { createTargetResolver } from './body.js'

const PROFILE = {
  sex: 'male', age: 30, height: 180, weight: 80, activity: 'light', goal: 'maintain',
  targets: { calories: 2450, protein: 128, fat: 74, carbs: 306 },
}
const meal = (o = {}) => ({ id: Math.random().toString(36).slice(2), name: 'Еда', kcal: 0, protein: 0, carbs: 0, fat: 0, ...o })
const day = (...meals) => ({ meals, mealSections: [], mood: null, wellbeing: [], note: '' })
const resolverFor = (days) => createTargetResolver(days, PROFILE)

test('дни челленджа — включая обе границы', () => {
  assert.deepEqual(challengeDays('2026-08-01', '2026-08-03'), ['2026-08-01', '2026-08-02', '2026-08-03'])
  assert.deepEqual(challengeDays('2026-08-01', '2026-08-01'), ['2026-08-01'])
  assert.deepEqual(challengeDays('2026-08-05', '2026-08-01'), [], 'конец раньше начала — пусто')
})

test('kindMeta не падает на неизвестном правиле', () => {
  assert.equal(kindMeta('log_streak').key, 'log_streak')
  assert.equal(kindMeta('чушь').key, CHALLENGE_KINDS[0].key)
})

// ── Правила зачёта ────────────────────────────────────────────────────────────

test('log_streak: зачёт за любой заполненный день', () => {
  const days = { '2026-08-01': day(meal({ kcal: 2400 })) }
  assert.equal(isDayScored('log_streak', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days)), true)
  assert.equal(isDayScored('log_streak', day(), '2026-08-01', PROFILE, resolverFor({})), false, 'пустой день не считается')
  assert.equal(isDayScored('log_streak', undefined, '2026-08-01', PROFILE, resolverFor({})), false)
})

test('calorie_target: зачёт только внутри допуска ±10%', () => {
  const check = (kcal) => {
    const days = { '2026-08-01': day(meal({ kcal })) }
    return isDayScored('calorie_target', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days))
  }
  assert.equal(check(2450), true)   // ровно цель
  assert.equal(check(2205), true)   // нижняя граница 2450*0.9
  assert.equal(check(2695), true)   // верхняя граница 2450*1.1
  assert.equal(check(2100), false)  // недобор
  assert.equal(check(2800), false)  // перебор
})

test('calorie_target учитывает цель ИМЕННО ЭТОГО дня', () => {
  // 3000 ккал — перебор для обычного дня, но норма для дня с тренировкой.
  const lazy = { '2026-08-01': { ...day(meal({ kcal: 3000 })), activity: 'sedentary' } }
  const busy = { '2026-08-01': { ...day(meal({ kcal: 3000 })), activity: 'high' } }

  assert.equal(isDayScored('calorie_target', lazy['2026-08-01'], '2026-08-01', PROFILE, resolverFor(lazy)), false)
  assert.equal(isDayScored('calorie_target', busy['2026-08-01'], '2026-08-01', PROFILE, resolverFor(busy)), true)
})

test('protein_target: перебор белка не наказывается', () => {
  const check = (protein) => {
    const days = { '2026-08-01': day(meal({ kcal: 2400, protein })) }
    return isDayScored('protein_target', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days))
  }
  assert.equal(check(128), true)
  assert.equal(check(200), true, 'много белка — всё ещё зачёт')
  assert.equal(check(109), true, 'граница 128*0.85 ≈ 108.8')
  assert.equal(check(80), false)
})

test('no_sugar: ориентир 10% калорий', () => {
  // Цель дня ≈2450 ккал → лимит ≈61 г сахара.
  const sweet = { '2026-08-01': day(meal({ name: 'Сахар', kcal: 2400, carbs: 200 })) }
  assert.equal(isDayScored('no_sugar', sweet['2026-08-01'], '2026-08-01', PROFILE, resolverFor(sweet)), false)

  const clean = { '2026-08-01': day(meal({ name: 'Гречка', kcal: 2400, carbs: 200 })) }
  assert.equal(isDayScored('no_sugar', clean['2026-08-01'], '2026-08-01', PROFILE, resolverFor(clean)), true)
})

test('день, исключённый из статистики, очков не приносит', () => {
  const base = day(meal({ kcal: 2450 }))
  const days = { '2026-08-01': { ...base, statsExcluded: true } }
  assert.equal(isDayScored('calorie_target', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days)), false)
  assert.equal(isDayScored('log_streak', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days)), false,
    'нечестно получать очко за день, которому сам не веришь')
})

test('недозаполненный день не приносит очков, пока не подтверждён', () => {
  const low = { '2026-08-01': day(meal({ kcal: 300 })) } // ~12% от цели
  assert.equal(isDayScored('log_streak', low['2026-08-01'], '2026-08-01', PROFILE, resolverFor(low)), false)

  const confirmed = { '2026-08-01': { ...day(meal({ kcal: 300 })), statsConfirmed: true } }
  assert.equal(isDayScored('log_streak', confirmed['2026-08-01'], '2026-08-01', PROFILE, resolverFor(confirmed)), true)
})

test('без целей правила по целям не срабатывают, а не падают', () => {
  const days = { '2026-08-01': day(meal({ kcal: 2000, protein: 100 })) }
  const bare = {}
  for (const kind of ['calorie_target', 'protein_target', 'no_sugar']) {
    assert.equal(isDayScored(kind, days['2026-08-01'], '2026-08-01', bare, createTargetResolver(days, bare)), false)
  }
})

test('неизвестное правило не даёт зачёта', () => {
  const days = { '2026-08-01': day(meal({ kcal: 2450 })) }
  assert.equal(isDayScored('взломать', days['2026-08-01'], '2026-08-01', PROFILE, resolverFor(days)), false)
})

// ── Прогресс ──────────────────────────────────────────────────────────────────

test('прогресс считается от ПРОШЕДШИХ дней, а не от всего срока', () => {
  const days = {
    '2026-08-01': day(meal({ kcal: 2450 })),
    '2026-08-02': day(meal({ kcal: 2450 })),
    '2026-08-03': day(meal({ kcal: 1000 })), // мимо цели
  }
  const ch = { kind: 'calorie_target', starts_on: '2026-08-01', ends_on: '2026-08-10' }
  const p = myProgress(ch, days, PROFILE, '2026-08-03')

  assert.equal(p.total, 10)
  assert.equal(p.elapsed, 3)
  assert.equal(p.scored, 2)
  assert.equal(p.remaining, 7)
  assert.ok(Math.abs(p.rate - 2 / 3) < 1e-9, 'доля от трёх прошедших дней, а не от десяти')
  assert.equal(p.finished, false)
  assert.equal(p.notStarted, false)
})

test('прогресс до старта: ноль без деления на ноль', () => {
  const ch = { kind: 'log_streak', starts_on: '2026-09-01', ends_on: '2026-09-10' }
  const p = myProgress(ch, {}, PROFILE, '2026-08-20')
  assert.equal(p.elapsed, 0)
  assert.equal(p.scored, 0)
  assert.equal(p.rate, null, 'проценты без прошедших дней бессмысленны')
  assert.equal(p.notStarted, true)
})

test('дни за пределами срока в зачёт не идут', () => {
  const days = {
    '2026-07-31': day(meal({ kcal: 2450 })), // до старта
    '2026-08-01': day(meal({ kcal: 2450 })),
    '2026-08-05': day(meal({ kcal: 2450 })), // после конца
  }
  const ch = { kind: 'calorie_target', starts_on: '2026-08-01', ends_on: '2026-08-02' }
  const p = myProgress(ch, days, PROFILE, '2026-08-10')
  assert.equal(p.scored, 1)
  assert.deepEqual(p.scoredDays, ['2026-08-01'])
  assert.equal(p.finished, true)
})

test('статус челленджа', () => {
  const ch = { starts_on: '2026-08-05', ends_on: '2026-08-10' }
  assert.equal(challengeStatus(ch, '2026-08-01'), 'upcoming')
  assert.equal(challengeStatus(ch, '2026-08-05'), 'active')
  assert.equal(challengeStatus(ch, '2026-08-10'), 'active', 'последний день ещё идёт')
  assert.equal(challengeStatus(ch, '2026-08-11'), 'finished')
})

// ── Валидация ─────────────────────────────────────────────────────────────────

test('валидация формы челленджа', () => {
  const base = { title: 'Неделя без сахара', kind: 'no_sugar', starts_on: '2026-08-01', ends_on: '2026-08-07' }
  assert.equal(validateChallenge(base).ok, true)
  assert.ok(validateChallenge({ ...base, title: '  ' }).error)
  assert.ok(validateChallenge({ ...base, kind: 'нет такого' }).error)
  assert.ok(validateChallenge({ ...base, ends_on: '2026-07-01' }).error)
  assert.ok(validateChallenge({ ...base, starts_on: null }).error)
  assert.ok(validateChallenge({ ...base, ends_on: '2027-08-01' }).error, `дольше ${MAX_DAYS} дней нельзя`)
})
