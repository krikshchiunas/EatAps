// ─────────────────────────────────────────────────────────────────────────────
// Стрик (дни подряд) и достижения.
//
// Стрик с «заморозкой». Обычный стрик жесток: пропустил один день из-за
// перелёта или болезни — двести дней труда обнулились, и мотивация вместе с
// ними. Поэтому внутри текущей серии разрешено пропустить до FREEZE_ALLOWANCE
// ОДИНОЧНЫХ дней; два пропуска подряд серию всё же прерывают.
//
// Важное решение: заморозки НЕ хранятся в состоянии и не «покупаются» — они
// выводятся из самих данных при каждом расчёте. Иначе пришлось бы синхронизировать
// счётчик между устройствами и решать конфликты, а любая рассинхронизация
// выглядела бы как «у меня украли стрик».
//
// Сегодняшний день особый: он ещё не закончился. Отсутствие записей за сегодня
// серию не рвёт — она просто «под угрозой» (atRisk), и UI это показывает.
// ─────────────────────────────────────────────────────────────────────────────
import { keyOf, addDays } from './date.js'

export const FREEZE_ALLOWANCE = 2 // одиночных пропусков внутри текущей серии

// День засчитан в серию: есть хотя бы одна запись и он не помечен «пропустить».
// Намеренно мягче, чем countsInStats: серия — про привычку записывать, а не про
// качество данных. Подозрительно низкий день привычку всё же подтверждает.
export function dayLogged(day) {
  return Boolean(day && Array.isArray(day.meals) && day.meals.length > 0 && !day.statsExcluded)
}

export function computeStreak(days, today = keyOf()) {
  const src = days && typeof days === 'object' ? days : {}
  const logged = (k) => dayLogged(src[k])

  const todayLogged = logged(today)

  // Старт отсчёта: если сегодня записей ещё нет, начинаем со вчера — день
  // не закончился, наказывать не за что.
  let cursor = todayLogged ? today : addDays(today, -1)

  let current = 0
  let freezesUsed = 0
  const frozenDays = []

  // Бесконечный цикл невозможен: каждая итерация сдвигает курсор на день назад,
  // а ветка выхода срабатывает не позже второго подряд пропуска.
  for (;;) {
    if (logged(cursor)) {
      current += 1
      cursor = addDays(cursor, -1)
      continue
    }
    // Пропуск. Прерывает серию, если это второй подряд или заморозки кончились.
    const prev = addDays(cursor, -1)
    if (freezesUsed >= FREEZE_ALLOWANCE || !logged(prev)) break
    freezesUsed += 1
    frozenDays.push(cursor)
    cursor = prev
  }

  // Серия ещё не начата: ни сегодня, ни вчера ничего нет.
  if (current === 0) freezesUsed = 0

  return {
    current,
    todayLogged,
    atRisk: current > 0 && !todayLogged,
    freezesUsed,
    freezesLeft: Math.max(0, FREEZE_ALLOWANCE - freezesUsed),
    frozenDays,
    longest: longestStreak(src),
    totalLoggedDays: Object.keys(src).filter((k) => dayLogged(src[k])).length,
  }
}

// Самая длинная серия за всю историю — БЕЗ заморозок, честные дни подряд.
export function longestStreak(days) {
  const keys = Object.keys(days || {}).filter((k) => dayLogged(days[k])).sort()
  if (keys.length === 0) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < keys.length; i++) {
    if (addDays(keys[i - 1], 1) === keys[i]) run += 1
    else run = 1
    if (run > best) best = run
  }
  return best
}

// ── Достижения ────────────────────────────────────────────────────────────────
// Данные-первыми: каждое достижение — это порог по одному числу из facts.
// Так их легко добавлять и невозможно рассинхронизировать с UI.
export const ACHIEVEMENTS = [
  { id: 'first-log', emoji: '🌱', title: 'Первый шаг', desc: 'Записать первый приём пищи', target: 1, of: (f) => f.totalLoggedDays, group: 'Начало' },
  { id: 'days-7', emoji: '📗', title: 'Неделя наблюдений', desc: 'Записать 7 дней', target: 7, of: (f) => f.totalLoggedDays, group: 'Начало' },
  { id: 'days-30', emoji: '📘', title: 'Месяц данных', desc: 'Записать 30 дней', target: 30, of: (f) => f.totalLoggedDays, group: 'Начало' },
  { id: 'days-100', emoji: '📚', title: 'Сотня', desc: 'Записать 100 дней', target: 100, of: (f) => f.totalLoggedDays, group: 'Начало' },

  { id: 'streak-3', emoji: '✨', title: 'Три подряд', desc: '3 дня подряд без пропусков', target: 3, of: (f) => f.longestStreak, group: 'Постоянство' },
  { id: 'streak-7', emoji: '🔥', title: 'Неделя огня', desc: '7 дней подряд', target: 7, of: (f) => f.longestStreak, group: 'Постоянство' },
  { id: 'streak-30', emoji: '🏆', title: 'Месяц подряд', desc: '30 дней подряд', target: 30, of: (f) => f.longestStreak, group: 'Постоянство' },
  { id: 'streak-100', emoji: '💎', title: 'Сто дней подряд', desc: '100 дней подряд', target: 100, of: (f) => f.longestStreak, group: 'Постоянство' },

  { id: 'goal-7', emoji: '🎯', title: 'Точно в цель', desc: '7 дней в пределах цели по калориям', target: 7, of: (f) => f.daysInCalorieTarget, group: 'Цели' },
  { id: 'goal-30', emoji: '🎖️', title: 'Тридцать в цель', desc: '30 дней в пределах цели', target: 30, of: (f) => f.daysInCalorieTarget, group: 'Цели' },
  { id: 'protein-14', emoji: '🥩', title: 'Белок под контролем', desc: '14 дней с нормой белка', target: 14, of: (f) => f.daysProteinOk, group: 'Цели' },

  { id: 'weigh-10', emoji: '⚖️', title: 'Держу вес на виду', desc: '10 взвешиваний', target: 10, of: (f) => f.weighIns, group: 'Тело' },
  { id: 'activity-14', emoji: '🏃', title: 'Честный режим', desc: 'Отметить активность в 14 днях', target: 14, of: (f) => f.activityMarked, group: 'Тело' },
  { id: 'weight-goal', emoji: '🥇', title: 'Цель по весу взята', desc: 'Достичь целевого веса', target: 1, of: (f) => (f.weightGoalReached ? 1 : 0), group: 'Тело' },

  { id: 'recipes-3', emoji: '🍲', title: 'Свой повар', desc: 'Сохранить 3 рецепта', target: 3, of: (f) => f.recipes, group: 'Библиотека' },
  { id: 'templates-3', emoji: '🥪', title: 'Свои блюда', desc: 'Сохранить 3 своих блюда', target: 3, of: (f) => f.templates, group: 'Библиотека' },
]

// Собрать факты для проверки достижений из уже посчитанных данных.
// Ничего не считает заново — только раскладывает по именам.
export function achievementFacts({ streak, stats, weight, activity, library } = {}) {
  return {
    totalLoggedDays: streak?.totalLoggedDays || 0,
    longestStreak: streak?.longest || 0,
    daysInCalorieTarget: stats?.nutrients?.kcal?.daysIn || 0,
    daysProteinOk: stats?.nutrients?.protein?.daysIn || 0,
    weighIns: weight?.entries || 0,
    activityMarked: activity?.markedDays || 0,
    // Цель по весу «взята», если текущий вес дошёл до неё с той стороны,
    // с которой человек шёл. Направление берём из первого замера.
    weightGoalReached: isWeightGoalReached(weight),
    recipes: library?.recipes || 0,
    templates: library?.templates || 0,
  }
}

function isWeightGoalReached(weight) {
  if (!weight || weight.goal == null || weight.current == null || weight.first == null) return false
  if (weight.first > weight.goal) return weight.current <= weight.goal // снижали
  if (weight.first < weight.goal) return weight.current >= weight.goal // набирали
  return true // стартовали ровно на цели
}

// Достижения с прогрессом. earnedAt — из сохранённого состояния (когда получено).
export function computeAchievements(facts, earnedMap = {}) {
  return ACHIEVEMENTS.map((a) => {
    const value = Math.max(0, Number(a.of(facts)) || 0)
    const earned = value >= a.target
    return {
      id: a.id,
      emoji: a.emoji,
      title: a.title,
      desc: a.desc,
      group: a.group,
      target: a.target,
      value: Math.min(value, a.target),
      rawValue: value,
      progress: a.target > 0 ? Math.min(1, value / a.target) : 0,
      earned,
      earnedAt: earned ? earnedMap[a.id] || null : null,
    }
  })
}

// Какие достижения получены ВПЕРВЫЕ (их ещё нет в сохранённой карте).
// Store запишет им дату — и UI один раз покажет поздравление.
export function newlyEarned(list, earnedMap = {}) {
  return list.filter((a) => a.earned && !earnedMap[a.id]).map((a) => a.id)
}
