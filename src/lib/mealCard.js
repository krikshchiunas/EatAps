// Единый формат карточки приёма пищи в чате (meal_ref).
//
// Формат v2:
//   { v: 2, type, label, emoji, date, items: [{name, emoji, grams, unit, kcal}],
//     kcal, protein, carbs, fat }
//
// Раньше существовал ещё «плоский» формат {name, emoji, kcal} — им шли реакции
// на приём пищи друга. Отрисовка была двухветочной, и любая правка карточки
// требовала помнить про обе. Теперь строим и рисуем только v2, а старые записи
// из БД поднимаем в него через normalizeMealCard — переписка не ломается.

import { mealMeta } from './foods.js'

const num = (x) => Math.round(Number(x) || 0)

function totalsOf(items) {
  return items.reduce(
    (a, m) => ({
      kcal: a.kcal + (Number(m.kcal) || 0),
      protein: a.protein + (Number(m.protein) || 0),
      carbs: a.carbs + (Number(m.carbs) || 0),
      fat: a.fat + (Number(m.fat) || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

function itemOf(m) {
  return {
    name: m.name,
    emoji: m.emoji || null,
    grams: m.grams ?? null,
    unit: m.unit || 'г',
    kcal: num(m.kcal),
  }
}

// Целый приём пищи (весь завтрак/обед/своя секция) одной карточкой.
// Название и эмодзи берём из секции (см. lib/meals.js): у пользовательских
// приёмов вроде «После тренировки» своего типа нет, и вывод из legacy-поля
// type превратил бы их в «Перекус».
export function mealCardFromGroup({ section, typeKey, date, meals }) {
  const meta = section || mealMeta(typeKey)
  const t = totalsOf(meals)
  return {
    v: 2,
    type: meta.type ?? meta.key ?? null,
    label: meta.label,
    emoji: meta.emoji,
    date: date || null,
    items: meals.map(itemOf),
    kcal: num(t.kcal),
    protein: num(t.protein),
    carbs: num(t.carbs),
    fat: num(t.fat),
  }
}

// Одно блюдо — например, реакция на конкретный приём пищи друга.
export function mealCardFromMeal(meal, date) {
  return mealCardFromGroup({ typeKey: meal.type, date, meals: [meal] })
}

// Старая запись из БД -> v2, чтобы отрисовка осталась одна.
// Макросов в старом формате не было: оставляем null, карточка скроет строку БЖУ.
export function normalizeMealCard(ref) {
  if (!ref) return null
  if (ref.v >= 2) return ref
  const kcal = num(ref.kcal)
  return {
    v: 2,
    type: null,
    label: ref.name || 'Блюдо',
    emoji: ref.emoji || '🍽️',
    date: null,
    items: ref.name ? [{ name: ref.name, emoji: ref.emoji || null, grams: null, unit: 'г', kcal }] : [],
    kcal,
    protein: null,
    carbs: null,
    fat: null,
  }
}
