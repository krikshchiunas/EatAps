// ─────────────────────────────────────────────────────────────────────────────
// Совместные челленджи с друзьями.
//
// Главное решение: зачёт дня СЧИТАЕТСЯ ИЗ ДНЕВНИКА, а не проставляется вручную.
// Кнопка «я молодец» превратила бы соревнование в соревнование по нажатию
// кнопки. Здесь правило челленджа применяется к тем же данным, которые человек
// видит у себя на экране дня, — и результат нельзя разойтись с фактом.
//
// Отметка в базе (challenge_days) — это КЭШ вычисленного значения, чтобы
// остальные участники видели прогресс, не читая чужой дневник целиком. Пишет
// её только сам участник и только про себя (см. миграцию).
//
// День, помеченный «не учитывать в статистике», в зачёт не идёт: нечестно
// получать очко за день, который сам же признал недостоверным.
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, keyOf } from './date.js'
import { dayNutrients, countsInStats, TOL } from './stats.js'
import { createTargetResolver } from './body.js'

export const CHALLENGE_KINDS = [
  {
    key: 'log_streak',
    title: 'Не пропускать дни',
    desc: 'Зачёт за каждый день, где еда записана',
    emoji: '📗',
  },
  {
    key: 'calorie_target',
    title: 'Держать калории',
    desc: 'Зачёт за день в пределах ±10% от цели',
    emoji: '🎯',
  },
  {
    key: 'protein_target',
    title: 'Добирать белок',
    desc: 'Зачёт за день, где белок не ниже нормы',
    emoji: '🥩',
  },
  {
    key: 'no_sugar',
    title: 'Меньше сахара',
    desc: 'Зачёт за день, где свободных сахаров не больше 10% калорий',
    emoji: '🍬',
  },
]

export const kindMeta = (key) => CHALLENGE_KINDS.find((k) => k.key === key) || CHALLENGE_KINDS[0]

export const MAX_DAYS = 90 // дольше трёх месяцев челлендж перестаёт быть челленджем

// Список дат челленджа включительно.
export function challengeDays(startKey, endKey) {
  const out = []
  let k = startKey
  // Ограничение и здесь: испорченные даты не должны крутить бесконечный цикл.
  for (let i = 0; k <= endKey && i < MAX_DAYS * 2; i++) {
    out.push(k)
    k = addDays(k, 1)
  }
  return out
}

// Зачтён ли конкретный день по правилу челленджа.
// resolver — из createTargetResolver: цель считается на КАЖДЫЙ день (вес и
// активность этого дня), поэтому активный день не «проваливает» калории.
export function isDayScored(kind, day, dateKey, profile, resolver) {
  if (!day || !Array.isArray(day.meals) || day.meals.length === 0) return false

  const targets = resolver ? resolver(dateKey, day) : profile?.targets
  const calTarget = Number(targets?.calories)
  const hasCal = Number.isFinite(calTarget) && calTarget > 0

  // День, исключённый из статистики (вручную или как недозаполненный),
  // не может приносить очки: это те же данные, которым человек сам не верит.
  if (!countsInStats(day, profile, hasCal ? calTarget : undefined)) return false

  const n = dayNutrients(day.meals)

  switch (kind) {
    case 'log_streak':
      return true // сюда мы уже дошли только с заполненным и зачтённым днём

    case 'calorie_target': {
      if (!hasCal) return false
      const tol = TOL.kcal
      return n.kcal >= calTarget * (1 - tol) && n.kcal <= calTarget * (1 + tol)
    }

    case 'protein_target': {
      const p = Number(targets?.protein)
      if (!Number.isFinite(p) || p <= 0) return false
      // Только нижняя граница: перебор белка — не провал.
      return n.protein >= p * (1 - TOL.protein)
    }

    case 'no_sugar': {
      if (!hasCal) return false
      // Тот же ориентир ВОЗ, что и на экране дня: 10% калорий из сахара.
      const limit = (calTarget * 0.1) / 4
      return n.sugar <= limit
    }

    default:
      return false
  }
}

// Мой прогресс по челленджу из собственного дневника.
// today ограничивает подсчёт: будущие дни не «зачтены», они просто не наступили.
export function myProgress(challenge, days, profile, today = keyOf()) {
  const resolver = createTargetResolver(days, profile)
  const all = challengeDays(challenge.starts_on, challenge.ends_on)
  const elapsed = all.filter((k) => k <= today)

  const scoredDays = elapsed.filter((k) => isDayScored(challenge.kind, days?.[k], k, profile, resolver))

  return {
    total: all.length,
    elapsed: elapsed.length,
    scored: scoredDays.length,
    scoredDays,
    remaining: all.length - elapsed.length,
    // Доля от ПРОШЕДШИХ дней: показывать 10% в первый день из десяти
    // демотивирует и ничего не сообщает.
    rate: elapsed.length ? scoredDays.length / elapsed.length : null,
    finished: today > challenge.ends_on,
    notStarted: today < challenge.starts_on,
  }
}

// Состояние челленджа для подписи: не начался / идёт / завершён.
export function challengeStatus(challenge, today = keyOf()) {
  if (today < challenge.starts_on) return 'upcoming'
  if (today > challenge.ends_on) return 'finished'
  return 'active'
}

// Проверка формы перед созданием. Возвращает { ok } или { error }.
export function validateChallenge({ title, kind, starts_on, ends_on }) {
  if (!title || !title.trim()) return { error: 'Придумайте название' }
  if (title.trim().length > 80) return { error: 'Слишком длинное название' }
  if (!CHALLENGE_KINDS.some((k) => k.key === kind)) return { error: 'Выберите правило' }
  if (!starts_on || !ends_on) return { error: 'Укажите даты' }
  if (ends_on < starts_on) return { error: 'Конец раньше начала' }
  if (challengeDays(starts_on, ends_on).length > MAX_DAYS) {
    return { error: `Челлендж не длиннее ${MAX_DAYS} дней` }
  }
  return { ok: true }
}
