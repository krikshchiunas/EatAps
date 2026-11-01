// ─────────────────────────────────────────────────────────────────────────────
// Наблюдения «еда ↔ самочувствие».
//
// Данные для этого уже собираются: на экране дня человек отмечает теги
// самочувствия (Энергия, Тяжесть, Вздутие…), а рядом лежит список съеденного.
// Здесь мы ищем СОВПАДЕНИЯ: в дни с тегом X сахара в среднем больше, чем в
// дни без него; тег Y чаще встречается в дни, когда ел продукт Z.
//
// ⚠️ Главное ограничение, которое обязан повторять и UI: это КОРРЕЛЯЦИЯ, а не
// причина. У человека десятки дней, а не рандомизированное исследование; тег
// «Тяжесть» мог совпасть с недосыпом, стрессом или болезнью. Поэтому:
//   • ничего не показываем, пока данных объективно мало (MIN_*);
//   • не показываем слабые совпадения (пороги эффекта);
//   • формулировки — «чаще совпадает», а не «вызывает»;
//   • у каждого наблюдения есть размер выборки, чтобы его можно было взвесить.
// Никаких медицинских выводов здесь не делается и делаться не должно.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeName } from './text.js'
import { t, fmtNum } from './i18n.js'
import { unitLabel } from './units.js'
import { foodName } from './foodNames.js'

// Теги самочувствия, предлагаемые на экране дня. Полярность нужна только для
// оформления (что считать «хорошим» исходом), на математику не влияет.
// Значения тегов — русские: так они записаны в днях у людей (day.wellbeing),
// это данные, а не подписи. Подпись на языке интерфейса — wellbeingLabel().
/* @i18n-data */
export const WELLBEING = ['Энергия', 'Сон', 'Лёгкость', 'Тяжесть', 'Вздутие', 'Голод', 'Стресс', 'Тренировка']
/* @i18n-data */
const WELLBEING_KEY = {
  'Энергия': 'energy', 'Сон': 'sleep', 'Лёгкость': 'light', 'Тяжесть': 'heavy',
  'Вздутие': 'bloating', 'Голод': 'hunger', 'Стресс': 'stress', 'Тренировка': 'workout',
}
// Тег → подпись на языке интерфейса. Незнакомый тег (свой) — как записан.
export const wellbeingLabel = (tag) => (Object.prototype.hasOwnProperty.call(WELLBEING_KEY, tag) ? t(`wellbeing.${WELLBEING_KEY[tag]}`) : tag)

/* @i18n-data */
export const TAG_POLARITY = {
  'Энергия': 'good',
  'Сон': 'good',
  'Лёгкость': 'good',
  'Тренировка': 'good',
  'Тяжесть': 'bad',
  'Вздутие': 'bad',
  'Голод': 'bad',
  'Стресс': 'bad',
}

// Пороги. Сознательно консервативные: лучше не показать наблюдение, чем
// показать шум и заставить человека менять питание из-за случайности.
export const MIN_DAYS_TOTAL = 12 // меньше — не показываем ничего
export const MIN_SIDE = 4 // минимум дней и с тегом, и без него
export const MIN_PRODUCT_DAYS = 4 // продукт должен встречаться минимум в стольких днях
const MIN_NUTRIENT_EFFECT = 0.15 // разница средних ≥ 15%
const MIN_PRODUCT_EFFECT = 0.25 // разница частот ≥ 25 п.п.

// Нутриенты, по которым ищем связь. Оценочные (сахар, насыщенные жиры) помечены —
// UI обязан показывать это как приблизительное.
const LINK_NUTRIENTS = [
  { key: 'kcal', unit: 'ккал', digits: 0 },
  { key: 'sugar', unit: 'г', digits: 1, estimate: true },
  { key: 'satFat', unit: 'г', digits: 1, estimate: true },
  { key: 'protein', unit: 'г', digits: 1 },
  { key: 'carbs', unit: 'г', digits: 1 },
  { key: 'fat', unit: 'г', digits: 1 },
  { key: 'complexCarb', unit: 'г', digits: 1, estimate: true },
]

const mean = (arr) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null)

// Уверенность — грубая шкала по размеру меньшей выборки. Это НЕ p-значение и
// не статистическая значимость; честнее назвать вещи своими именами в UI.
function confidenceOf(nWith, nWithout) {
  const smaller = Math.min(nWith, nWithout)
  if (smaller >= 12) return 'medium'
  if (smaller >= 7) return 'low'
  return 'weak'
}

// ── Связь тега с нутриентами ──────────────────────────────────────────────────
function nutrientLinks(entries, tag) {
  const withTag = entries.filter((e) => e.tags.has(tag))
  const without = entries.filter((e) => !e.tags.has(tag))
  if (withTag.length < MIN_SIDE || without.length < MIN_SIDE) return []

  const out = []
  for (const def of LINK_NUTRIENTS) {
    const a = mean(withTag.map((e) => e.nut[def.key]))
    const b = mean(without.map((e) => e.nut[def.key]))
    if (a == null || b == null || b <= 0) continue
    const effect = (a - b) / b
    if (Math.abs(effect) < MIN_NUTRIENT_EFFECT) continue
    out.push({
      kind: 'nutrient',
      tag,
      nutrient: def.key,
      unit: def.unit,
      digits: def.digits,
      estimate: Boolean(def.estimate),
      withAvg: a,
      withoutAvg: b,
      diff: a - b,
      effect,
      nWith: withTag.length,
      nWithout: without.length,
      confidence: confidenceOf(withTag.length, without.length),
    })
  }
  return out.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect))
}

// ── Связь тега с конкретными продуктами ───────────────────────────────────────
// Считаем частоту тега в дни, когда продукт ели, против дней, когда не ели.
function productLinks(entries, tag, productIndex) {
  const out = []
  for (const [norm, info] of productIndex) {
    const withProd = entries.filter((e) => info.dayKeys.has(e.key))
    const withoutProd = entries.filter((e) => !info.dayKeys.has(e.key))
    if (withProd.length < MIN_PRODUCT_DAYS || withoutProd.length < MIN_SIDE) continue

    const rateWith = withProd.filter((e) => e.tags.has(tag)).length / withProd.length
    const rateWithout = withoutProd.filter((e) => e.tags.has(tag)).length / withoutProd.length
    const effect = rateWith - rateWithout
    if (Math.abs(effect) < MIN_PRODUCT_EFFECT) continue

    out.push({
      kind: 'product',
      tag,
      norm,
      name: info.name,
      emoji: info.emoji,
      rateWith,
      rateWithout,
      effect,
      nWith: withProd.length,
      nWithout: withoutProd.length,
      confidence: confidenceOf(withProd.length, withoutProd.length),
    })
  }
  return out.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect))
}

// ── Точка входа ───────────────────────────────────────────────────────────────
// logged: [{ key, day, nut }] — только дни, учитываемые в статистике
// (см. countsInStats). Возвращает готовые к отрисовке наблюдения.
export function buildInsights(logged) {
  const entries = (logged || [])
    .map((e) => ({
      key: e.key,
      nut: e.nut,
      tags: new Set(Array.isArray(e.day?.wellbeing) ? e.day.wellbeing : []),
      meals: e.day?.meals || [],
    }))
    // Дни без единой отметки самочувствия ничего не говорят о связи — но и
    // выкидывать их нельзя: они законная «контрольная группа» для тега.
    .filter((e) => Array.isArray(e.meals))

  const totalDays = entries.length
  const taggedDays = entries.filter((e) => e.tags.size > 0).length

  if (totalDays < MIN_DAYS_TOTAL || taggedDays < MIN_SIDE) {
    return {
      ready: false,
      totalDays,
      taggedDays,
      needDays: Math.max(0, MIN_DAYS_TOTAL - totalDays),
      links: [],
      tags: [],
    }
  }

  // Индекс продуктов: в каких днях встречался + человекочитаемое имя.
  const productIndex = new Map()
  for (const e of entries) {
    const seenToday = new Set()
    for (const m of e.meals) {
      const norm = normalizeName(m?.name)
      if (!norm || seenToday.has(norm)) continue
      seenToday.add(norm)
      let info = productIndex.get(norm)
      if (!info) {
        info = { name: m.name, emoji: m.emoji || '🍽️', dayKeys: new Set() }
        productIndex.set(norm, info)
      }
      info.dayKeys.add(e.key)
    }
  }
  for (const [norm, info] of [...productIndex]) {
    if (info.dayKeys.size < MIN_PRODUCT_DAYS) productIndex.delete(norm)
  }

  // Теги, по которым вообще есть смысл считать.
  const tagCounts = new Map()
  for (const e of entries) for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1)
  const tags = [...tagCounts.entries()]
    .filter(([, n]) => n >= MIN_SIDE && totalDays - n >= MIN_SIDE)
    .map(([tag, n]) => ({ tag, days: n, polarity: TAG_POLARITY[tag] || 'neutral' }))
    .sort((a, b) => b.days - a.days)

  const links = []
  for (const { tag } of tags) {
    links.push(...nutrientLinks(entries, tag))
    links.push(...productLinks(entries, tag, productIndex))
  }
  links.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))

  return {
    ready: true,
    totalDays,
    taggedDays,
    needDays: 0,
    tags,
    links: links.slice(0, 24), // длинный хвост слабых совпадений только шумит
  }
}

// Человекочитаемая формулировка наблюдения. Намеренно осторожная:
// «чаще совпадает», «в среднем больше» — никаких «приводит к» и «вызывает».
export function describeLink(link) {
  const pct = Math.abs(Math.round(link.effect * 100))
  const tag = wellbeingLabel(link.tag)
  if (link.kind === 'nutrient') {
    const diff = Math.abs(link.diff)
    const shown = link.digits ? Math.round(diff * 10) / 10 : Math.round(diff)
    const value = `${link.estimate ? '≈' : ''}${fmtNum(shown)} ${unitLabel(link.unit)}`
    const nutrient = t(`insight.nut.${link.nutrient}`)
    return t(link.effect > 0 ? 'insight.nutrientMore' : 'insight.nutrientLess', { tag, value, nutrient, pct: fmtNum(pct) })
  }
  return t(link.effect > 0 ? 'insight.productMore' : 'insight.productLess', {
    tag,
    name: foodName(link.name),
    with: fmtNum(Math.round(link.rateWith * 100)),
    without: fmtNum(Math.round(link.rateWithout * 100)),
  })
}
