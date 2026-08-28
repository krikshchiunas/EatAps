// ─────────────────────────────────────────────────────────────────────────────
// Сборка контекста для ассистента: что именно он видит о пользователе.
//
// Каждый лишний символ здесь — деньги: контекст уходит в модель при КАЖДОМ
// сообщении и оплачивается из месячного бюджета (aiBudget.js). Поэтому тут
// не «весь дневник», а выжимка: короткие ключи, целые числа, ни одного
// служебного поля из состояния (id, updatedAt, createdAt в модель не едут).
//
// Глубина истории зависит от тарифа: на AI неделя, на AI+ месяц. Не из
// жадности — недельного окна хватает, чтобы увидеть паттерн, а месяц ощутимо
// дороже на каждом запросе.
// ─────────────────────────────────────────────────────────────────────────────

import { keyOf, addDays } from './date.js'
import { sumDay } from './nutrition.js'
import { targetsForDay } from './body.js'
import { getMealSections, foodsForMeal, labelForMealId } from './meals.js'
import { normalizeProfileList } from './profileLists.js'
import { TIER } from './subscription.js'

const r = (n) => Math.round(Number(n) || 0)

// Глубина истории по тарифам — числа совпадают с обещаниями на экране тарифов
// (AIPlansScreen): «История за неделю / 30 дней / 90 дней». Если поменять
// обещание — поменять и здесь, иначе Carrot расскажет не то, что человек купил.
export const HISTORY_DAYS = Object.freeze({
  [TIER.FREE]: 3,
  [TIER.AI]: 7,          // Carrot+
  [TIER.AI_PLUS]: 30,    // Carrot Pro
  [TIER.AI_PREMIUM]: 90, // Carrot Premium
})

export function historyDepth(tier) {
  return HISTORY_DAYS[tier] ?? HISTORY_DAYS[TIER.FREE]
}

// Профиль и цели. Вес берём из дня (он меняется), остальное из профиля.
function profileBlock(state, dateKey) {
  const p = state.profile
  if (!p) return null
  const targets = targetsForDay(state.days, dateKey, p)
  return {
    пол: p.sex === 'male' ? 'м' : 'ж',
    возраст: p.age,
    рост: p.height,
    вес: p.weight,
    цель: p.goal,
    активность: p.activity,
    норма: { ккал: r(targets.calories), белки: r(targets.protein), жиры: r(targets.fat), углеводы: r(targets.carbs) },
  }
}

// Сегодняшний день по приёмам пищи + остаток до нормы.
function todayBlock(state, dateKey) {
  const day = state.days?.[dateKey]
  const p = state.profile
  const targets = p ? targetsForDay(state.days, dateKey, p) : null
  if (!day) return { дата: dateKey, приёмы: [], итог: { ккал: 0 }, осталось: targets ? { ккал: r(targets.calories) } : null }

  const приёмы = getMealSections(day)
    .map((section) => {
      const foods = foodsForMeal(day, section.id)
      if (!foods.length) return null
      return {
        приём: labelForMealId(day, section.id),
        еда: foods.map((f) => ({
          что: f.name,
          г: f.grams ?? null,
          ккал: r(f.kcal),
          б: r(f.protein),
          ж: r(f.fat),
          у: r(f.carbs),
        })),
      }
    })
    .filter(Boolean)

  const total = sumDay(day.meals || [])
  return {
    дата: dateKey,
    приёмы,
    итог: { ккал: r(total.kcal), белки: r(total.protein), жиры: r(total.fat), углеводы: r(total.carbs) },
    осталось: targets
      ? {
          ккал: r(targets.calories - total.kcal),
          белки: r(targets.protein - total.protein),
          жиры: r(targets.fat - total.fat),
          углеводы: r(targets.carbs - total.carbs),
        }
      : null,
    самочувствие: day.wellbeing?.length ? day.wellbeing : undefined,
    вес: day.weight ?? undefined,
  }
}

// История: одна строка на день, без списка продуктов. Пустые дни включаем —
// «три дня не записывал» это тоже факт, и ассистент должен его видеть.
function historyBlock(state, dateKey, depth) {
  const out = []
  for (let i = depth; i >= 1; i--) {
    const key = addDays(dateKey, -i)
    const day = state.days?.[key]
    if (!day || !(day.meals || []).length) {
      out.push({ д: key, пусто: true })
      continue
    }
    const t = sumDay(day.meals)
    out.push({ д: key, ккал: r(t.kcal), б: r(t.protein), ж: r(t.fat), у: r(t.carbs), вес: day.weight ?? undefined })
  }
  return out
}

function prefsBlock(state) {
  const p = state.profile
  if (!p) return null
  const noGos = normalizeProfileList(p.noGos)
  const toGos = normalizeProfileList(p.toGos)
  const block = {}
  if (noGos.length) block['не ест'] = noGos
  if (toGos.length) block['любит'] = toGos
  if (p.favDish) block['любимое блюдо'] = p.favDish
  return Object.keys(block).length ? block : null
}

// Единственная точка сборки. Возвращает объект под buildUserContext().
export function buildContext(state, { tier = TIER.FREE, dateKey = keyOf(), memory = [] } = {}) {
  return {
    profile: profileBlock(state, dateKey),
    today: todayBlock(state, dateKey),
    history: historyBlock(state, dateKey, historyDepth(tier)),
    prefs: prefsBlock(state),
    // Долгая память — на Carrot Pro и Premium (оба обещают память на экране тарифов).
    memory: (tier === TIER.AI_PLUS || tier === TIER.AI_PREMIUM) ? memory : [],
  }
}
