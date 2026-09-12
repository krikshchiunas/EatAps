// ─────────────────────────────────────────────────────────────────────────────
// Изменения дневника — чистыми функциями.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ
//
// store.jsx отвечает за многое сразу: авторизацию, синхронизацию, вкладки,
// подписку, тему — и заодно содержал всю логику правки дневника. Вперемешку
// с эффектами её нельзя ни прочитать целиком, ни прогнать тестом: чтобы
// проверить «добавление продукта обновляет список недавних», пришлось бы
// поднимать React и провайдера.
//
// Здесь только преобразования состояния: `(state, …) → state`. Ни React, ни
// часов, ни генератора идентификаторов внутри нет — метка времени и id
// приходят параметрами. Это следует тому же приёму, которым в проекте уже
// написаны syncModel, meals, library и suppStack: решение — чистая функция,
// побочные эффекты — в store.
//
// Публичный набор действий store при этом не изменился: наружу смотрят те же
// addFood / removeFood / editFood, просто их тела переехали сюда.
// ─────────────────────────────────────────────────────────────────────────────
import { blankDay, addTombstone, setDayFieldTs, tombMeal, tombSection, recentKey } from './syncModel.js'
import { upsertSection, removeSection, swapCustomOrder, effectiveMealId } from './meals.js'

// Сколько продуктов держим в «недавних». Список нужен для быстрого повторного
// добавления, а не как вторая история: сорока хватает с запасом.
export const MAX_RECENTS = 40

// Снимок продукта для списка недавних. Порция сюда НЕ входит: список хранит
// продукт, а привычное количество приходит из журнала приёмов.
export function recentSnapshot(food) {
  return {
    name: food.name,
    emoji: food.emoji || '🍽️',
    unit: food.unit || 'г',
    grams: food.grams ?? null,
    kcal: food.kcal,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
  }
}

// Добавить продукты в список недавних, подняв их наверх и увеличив счётчик.
//
// Раньше это было написано ДВАЖДЫ — в addFood и в addFoods — слово в слово.
// Такое дублирование не остаётся одинаковым: правку вносят в одно место, и
// одиночное добавление начинает вести себя не так, как пакетное.
//
// Ключ — имя И единица, как в syncModel.recentKey. Раньше сравнивали по
// точному имени: «Банан» и «банан» становились двумя строками, а при
// нормализации перед отправкой одна из них молча исчезала вместе со счётчиком.
export function withRecents(recents, foods, now = Date.now()) {
  let list = recents || []
  for (const food of foods) {
    const snap = recentSnapshot(food)
    const key = recentKey(snap)
    const prev = list.find((r) => recentKey(r) === key)
    list = [
      { ...snap, count: (prev?.count || 0) + 1, ts: now },
      ...list.filter((r) => recentKey(r) !== key),
    ]
  }
  return list.slice(0, MAX_RECENTS)
}

// ── Продукты дня ─────────────────────────────────────────────────────────────

// Добавить готовые записи в день. Идентификаторы и время создания приходят
// снаружи: генерация случайных значений внутри чистой функции сделала бы её
// непроверяемой.
export function withEntries(state, date, entries) {
  if (!entries.length) return state
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, meals: [...day.meals, ...entries] } },
    recents: withRecents(state.recents, entries),
  }
}

// Собрать запись дневника из продукта.
export function makeEntry(food, { id, createdAt, ts }) {
  return { id, createdAt, ...food, updatedAt: ts }
}

// Удаление оставляет тумбстоун: без него запись «воскресала» из копии другого
// устройства при следующем слиянии.
export function withoutEntry(state, date, id, ts) {
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, meals: day.meals.filter((m) => m.id !== id) } },
    meta: addTombstone(state.meta, tombMeal(date, id), ts),
  }
}

export function withEditedEntry(state, date, updatedFood, ts) {
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: {
      ...state.days,
      [date]: {
        ...day,
        meals: day.meals.map((m) => (m.id === updatedFood.id ? { ...updatedFood, updatedAt: ts } : m)),
      },
    },
  }
}

// Снимки продуктов для повтора дня или приёма.
//
// Копируем СНИМКИ, а не ссылки: новые записи получат свои id, время и метку,
// поэтому правка копии не тронет оригинал в прошлом дне. Поля синхронизации
// (id/updatedAt/createdAt) специально отбрасываем — иначе копия унесла бы
// чужой id и слияние сочло бы её тем же самым продуктом.
export function copiesOfDay(state, fromDate) {
  const src = state.days?.[fromDate]
  if (!src?.meals?.length) return []
  return src.meals.map(({ id, createdAt, updatedAt, ...rest }) => rest)
}

export function copiesOfMeal(state, fromDate, mealId, targetMealId) {
  const src = state.days?.[fromDate]
  if (!src?.meals?.length) return []
  return src.meals
    .filter((m) => effectiveMealId(m) === mealId)
    .map(({ id, createdAt, updatedAt, ...rest }) => ({ ...rest, mealId: targetMealId || mealId }))
}

// ── Приёмы пищи ──────────────────────────────────────────────────────────────

export function withUpsertedSection(state, date, section, ts) {
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: {
      ...state.days,
      [date]: { ...day, mealSections: upsertSection(day, { ...section, updatedAt: ts }) },
    },
  }
}

// Удаление пользовательского приёма — вместе со всеми его продуктами.
// Тумбстоун нужен и на сам приём, и на каждый продукт в нём: иначе с другого
// устройства вернётся либо раздел, либо его содержимое.
export function withoutSection(state, date, mealId, ts) {
  const day = state.days[date] || blankDay()
  const doomed = day.meals.filter((m) => effectiveMealId(m) === mealId)
  let meta = addTombstone(state.meta, tombSection(date, mealId), ts)
  for (const m of doomed) meta = addTombstone(meta, tombMeal(date, m.id), ts)
  return {
    ...state,
    days: {
      ...state.days,
      [date]: {
        ...day,
        mealSections: removeSection(day, mealId),
        meals: day.meals.filter((m) => effectiveMealId(m) !== mealId),
      },
    },
    meta,
  }
}

export function withMovedSection(state, date, mealId, dir, ts) {
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: {
      ...state.days,
      [date]: {
        ...day,
        mealSections: swapCustomOrder(day, mealId, dir).map((sec) => ({ ...sec, updatedAt: ts })),
      },
    },
  }
}

// ── Скаляры дня ──────────────────────────────────────────────────────────────
// Настроение, самочувствие, вес, активность версионируются КАЖДЫЙ своей меткой
// (dayFieldTs), а не общей меткой дня. Ради этого механизм и существует:
// взвешивание на телефоне не должно конфликтовать с добавлением еды на
// компьютере — это разные поля, и слияние обязано взять оба.
export function withDayField(state, date, field, value, ts) {
  const day = state.days[date] || blankDay()
  // Ничего не изменилось — не жжём метку: лишняя метка означала бы лишний
  // конфликт при слиянии на ровном месте.
  if (day[field] === value) return state
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, [field]: value } },
    meta: setDayFieldTs(state.meta, date, field, ts),
  }
}

export function withMood(state, date, mood, ts) {
  const day = state.days[date] || blankDay()
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, mood } },
    meta: setDayFieldTs(state.meta, date, 'mood', ts),
  }
}

export function withToggledWellbeing(state, date, tag, ts) {
  const day = state.days[date] || blankDay()
  const wellbeing = day.wellbeing.includes(tag)
    ? day.wellbeing.filter((t) => t !== tag)
    : [...day.wellbeing, tag]
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, wellbeing } },
    meta: setDayFieldTs(state.meta, date, 'wellbeing', ts),
  }
}

// «Учитывать день всё равно» — снимает исключение из статистики и одновременно
// отмечает, что человек подтвердил день осознанно. Два поля меняются вместе и
// обязаны получить метку ОБА: иначе с другого устройства вернётся половина
// решения (день снова исключён, но уже «подтверждён»).
export function withConfirmedStats(state, date, ts) {
  const day = state.days[date] || blankDay()
  let meta = setDayFieldTs(state.meta, date, 'statsConfirmed', ts)
  meta = setDayFieldTs(meta, date, 'statsExcluded', ts)
  return {
    ...state,
    days: { ...state.days, [date]: { ...day, statsConfirmed: true, statsExcluded: false } },
    meta,
  }
}
