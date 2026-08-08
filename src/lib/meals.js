// ─────────────────────────────────────────────────────────────────────────────
// Слой «приёмов пищи» — контейнеры (завтрак/обед/ужин/перекус + пользовательские),
// внутри которых лежат продукты из day.meals. Все функции чистые, day не мутируют.
//
// Ключевое решение: day.meals НЕ переименован и НЕ мигрирован деструктивно — это
// плоский список продуктов, как и раньше (совместимость со stats.js/notifications.js/
// HistoryScreen/FriendAccount). Принадлежность продукта приёму пищи вычисляется на
// лету через effectiveMealId: новые продукты несут явный mealId, старые (без него)
// раскладываются по своему полю type — так старые данные не переписываются и не
// теряются, а «безопасная миграция» происходит просто за счёт правила чтения.
//
// Стандартные секции (завтрак/обед/ужин/перекус) существуют ВИРТУАЛЬНО — они не
// хранятся в day.mealSections, пока пользователь не поменяет им время/показ времени.
// Пользовательские секции хранятся в day.mealSections с момента создания.
// ─────────────────────────────────────────────────────────────────────────────
import { MEAL_TYPES } from './foods.js'
import { newId } from './uuid.js'

export const STANDARD_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
export const OTHER_ID = 'std:other' // фолбэк для продуктов с нераспознанным/отсутствующим type
const OTHER_LABEL = 'Без категории'
const CUSTOM_EMOJI = '🍽️'
const OTHER_EMOJI = '🗂️'

const STANDARD_META = Object.fromEntries(MEAL_TYPES.map((m) => [m.key, m]))

export const QUICK_MEAL_NAMES = ['Второй завтрак', 'Второй обед', 'Второй ужин', 'После тренировки', 'Поздний перекус']

function isStandardType(t) {
  return STANDARD_TYPES.includes(t)
}

export function stdId(type) {
  return 'std:' + type
}

// Обратное к stdId — 'breakfast'/'lunch'/... для стандартных секций, undefined
// для «Без категории» и пользовательских (легаси-поле type им не нужно).
export function typeOfMealId(mealId) {
  return STANDARD_TYPES.find((t) => stdId(t) === mealId)
}

export function labelForMealId(day, mealId) {
  return getMealSections(day).find((s) => s.id === mealId)?.label || 'Приём пищи'
}

// Продукт → id секции, к которой он относится «по факту», даже если mealId не задан.
export function effectiveMealId(food) {
  if (food?.mealId) return food.mealId
  return isStandardType(food?.type) ? stdId(food.type) : OTHER_ID
}

export function foodsForMeal(day, mealId) {
  return (day?.meals || []).filter((m) => effectiveMealId(m) === mealId)
}

function overrideFor(day, id) {
  return (day?.mealSections || []).find((s) => s.id === id) || null
}

// Время секции: ручное значение > время первого добавленного продукта > нет времени.
// Если showTime=false — время не резолвится вовсе (не показываем и не подставляем).
export function resolvedTime(section, foods) {
  if (!section?.showTime) return null
  if (section.time) return section.time
  const withTs = (foods || [])
    .filter((f) => f.createdAt)
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  const first = withTs[0]
  if (!first) return null
  const d = new Date(first.createdAt)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Полный упорядоченный список секций дня: 4 стандартные (с учётом override),
// «Без категории» (только если в неё реально попадают продукты), затем
// пользовательские секции по sortOrder.
export function getMealSections(day) {
  const foods = day?.meals || []
  const sections = []

  STANDARD_TYPES.forEach((type, i) => {
    const id = stdId(type)
    const ov = overrideFor(day, id)
    const meta = STANDARD_META[type]
    sections.push({
      id,
      type,
      label: meta.label,
      emoji: meta.emoji,
      customName: null,
      time: ov?.time ?? null,
      showTime: ov?.showTime ?? true,
      createdAt: ov?.createdAt ?? null,
      sortOrder: i,
      deletable: false,
      renameable: false,
    })
  })

  const hasOther = foods.some((f) => effectiveMealId(f) === OTHER_ID)
  if (hasOther) {
    const ov = overrideFor(day, OTHER_ID)
    sections.push({
      id: OTHER_ID,
      type: 'custom',
      label: OTHER_LABEL,
      emoji: OTHER_EMOJI,
      customName: OTHER_LABEL,
      time: ov?.time ?? null,
      showTime: ov?.showTime ?? true,
      createdAt: ov?.createdAt ?? null,
      sortOrder: STANDARD_TYPES.length,
      deletable: false,
      renameable: false,
    })
  }

  const customs = (day?.mealSections || [])
    .filter((s) => s.type === 'custom' && s.id !== OTHER_ID)
    .map((s) => ({
      id: s.id,
      type: 'custom',
      label: s.customName || 'Приём пищи',
      emoji: CUSTOM_EMOJI,
      customName: s.customName || 'Приём пищи',
      time: s.time ?? null,
      showTime: s.showTime ?? true,
      createdAt: s.createdAt ?? null,
      sortOrder: Number.isFinite(s.sortOrder) ? s.sortOrder : STANDARD_TYPES.length + 1,
      deletable: true,
      renameable: true,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return [...sections, ...customs]
}

export function nextSortOrder(day) {
  const customs = (day?.mealSections || []).filter((s) => s.type === 'custom' && s.id !== OTHER_ID)
  const max = customs.reduce((m, s) => Math.max(m, Number.isFinite(s.sortOrder) ? s.sortOrder : 0), STANDARD_TYPES.length)
  return max + 1
}

export function newCustomSection(name, day) {
  return {
    id: newId(),
    type: 'custom',
    customName: name.trim(),
    time: null,
    showTime: true,
    createdAt: new Date().toISOString(),
    sortOrder: nextSortOrder(day),
  }
}

// Вставить/обновить запись override по id (используется и для кастомных секций,
// и для override времени/showTime стандартных секций).
export function upsertSection(day, section) {
  const overrides = day?.mealSections || []
  const idx = overrides.findIndex((s) => s.id === section.id)
  if (idx === -1) return [...overrides, section]
  const next = overrides.slice()
  next[idx] = { ...next[idx], ...section }
  return next
}

export function removeSection(day, id) {
  return (day?.mealSections || []).filter((s) => s.id !== id)
}

// Переставить пользовательскую секцию местами с соседней (кнопки «выше»/«ниже»).
// dir: -1 — выше, +1 — ниже. Возвращает новый mealSections (или тот же, если нельзя).
export function swapCustomOrder(day, mealId, dir) {
  const customs = getMealSections(day).filter((s) => s.type === 'custom' && s.id !== OTHER_ID)
  const idx = customs.findIndex((s) => s.id === mealId)
  const swapIdx = idx + dir
  if (idx === -1 || swapIdx < 0 || swapIdx >= customs.length) return day?.mealSections || []
  const a = customs[idx]
  const b = customs[swapIdx]
  return (day?.mealSections || []).map((s) => {
    if (s.id === a.id) return { ...s, sortOrder: b.sortOrder }
    if (s.id === b.id) return { ...s, sortOrder: a.sortOrder }
    return s
  })
}

// Умный выбор стандартного приёма для «быстрого» добавления (FAB в нижнем меню) —
// то же правило, что раньше было в AddMealSheet (autoMealType): считаем продукты
// в завтраке/обеде/ужине (перекусы не считаем), первый пустой слот — цель.
export function autoStandardMealId(day) {
  const std = new Set([stdId('breakfast'), stdId('lunch'), stdId('dinner')])
  const count = (day?.meals || []).filter((m) => std.has(effectiveMealId(m))).length
  if (count === 0) return stdId('breakfast')
  if (count === 1) return stdId('lunch')
  return stdId('dinner')
}
