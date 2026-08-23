// ─────────────────────────────────────────────────────────────────────────────
// Карточка дня для соцсетей.
//
// Рисуем на canvas вручную, без библиотек: готовые «html-в-картинку» решения
// весят сотни килобайт и тянут разбор CSS ради одной картинки, которую человек
// делает изредка. Здесь фиксированный макет и десяток вызовов canvas.
//
// Что НЕ попадает на карточку: вес, ИМТ, самочувствие, заметки и цель по
// калориям. Это личные данные, а картинку публикуют. Показываем только то, что
// человек и так собирался показать: съеденное за день.
//
// Размер 1080×1350 (4:5) — вертикальный формат, который соцсети не обрезают.
// ─────────────────────────────────────────────────────────────────────────────
import { sumDay } from './nutrition.js'
import { fromKey } from './date.js'

export const CARD_W = 1080
export const CARD_H = 1350

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

// Палитры карточки. Совпадают с темами приложения, но заданы явно: читать
// значения CSS-переменных на canvas нельзя, а «примерно похожий» зелёный
// выглядел бы чужим рядом со скриншотом приложения.
export const CARD_THEMES = {
  light: { bg: '#EBF0EE', surface: '#FFFFFF', ink: '#1F312B', ink2: '#5A6B64', ink3: '#8A9A93', primary: '#4F8375', accent: '#9FC4B8', track: '#DFE7E4' },
  dark: { bg: '#1C221E', surface: '#262E28', ink: '#E6EDE7', ink2: '#AFBDB4', ink3: '#7E8D85', primary: '#8AA891', accent: '#5C7267', track: '#333D37' },
}

// Данные карточки — чистая функция, отделена от рисования: её можно проверить
// тестами, а canvas в тестах недоступен.
export function buildShareData(day, dateKey, { name } = {}) {
  const meals = day?.meals || []
  const totals = sumDay(meals)
  const d = fromKey(dateKey)

  // Топ продуктов по калорийности — то, что реально составило день.
  // Одинаковые названия складываем: «Кофе ×3» честнее трёх строк «Кофе».
  const byName = new Map()
  for (const m of meals) {
    const key = (m.name || '').trim()
    if (!key) continue
    const prev = byName.get(key) || { name: key, emoji: m.emoji || '🍽️', kcal: 0, count: 0 }
    prev.kcal += Number(m.kcal) || 0
    prev.count += 1
    byName.set(key, prev)
  }
  const top = [...byName.values()].sort((a, b) => b.kcal - a.kcal).slice(0, 5)

  return {
    dateLabel: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
    name: (name || '').trim(),
    kcal: Math.round(totals.kcal),
    protein: Math.round(totals.protein),
    fat: Math.round(totals.fat),
    carbs: Math.round(totals.carbs),
    mealCount: meals.length,
    top,
    empty: meals.length === 0,
  }
}

// Доли макросов для полосы. Считаем по КАЛОРИЯМ, а не по граммам: грамм жира
// даёт вдвое больше энергии, и полоса «по граммам» врала бы о структуре дня.
export function macroShares({ protein, fat, carbs }) {
  const p = Math.max(0, protein) * 4
  const f = Math.max(0, fat) * 9
  const c = Math.max(0, carbs) * 4
  const sum = p + f + c
  if (sum <= 0) return { protein: 0, fat: 0, carbs: 0 }
  return { protein: p / sum, fat: f / sum, carbs: c / sum }
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Обрезка длинного названия по реальной ширине текста, а не по числу символов:
// «Ш» и «i» занимают разное место, и счёт по символам оставлял бы то дыру,
// то вылезающий за край текст.
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

// Рисует карточку в готовый canvas. Возвращает тот же canvas.
export function renderShareCard(canvas, data, themeKey = 'dark') {
  const t = CARD_THEMES[themeKey] || CARD_THEMES.dark
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Шапка
  ctx.fillStyle = t.ink3
  ctx.font = `500 34px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('EatAps', 80, 110)

  ctx.fillStyle = t.ink
  ctx.font = `700 76px ${FONT}`
  ctx.fillText(data.dateLabel, 80, 210)

  if (data.name) {
    ctx.fillStyle = t.ink2
    ctx.font = `500 36px ${FONT}`
    ctx.fillText(data.name, 80, 268)
  }

  // Главная карточка с калориями
  const cardY = data.name ? 320 : 280
  ctx.fillStyle = t.surface
  roundRect(ctx, 80, cardY, CARD_W - 160, 300, 40)
  ctx.fill()

  ctx.textAlign = 'center'
  ctx.fillStyle = t.primary
  ctx.font = `700 150px ${FONT}`
  ctx.fillText(String(data.kcal), CARD_W / 2, cardY + 175)

  ctx.fillStyle = t.ink3
  ctx.font = `500 38px ${FONT}`
  ctx.fillText('ккал за день', CARD_W / 2, cardY + 235)

  // Полоса макросов
  const barY = cardY + 360
  const barW = CARD_W - 160
  const shares = macroShares(data)
  const segs = [
    { v: shares.protein, c: t.primary, label: `Б ${data.protein}` },
    { v: shares.carbs, c: t.accent, label: `У ${data.carbs}` },
    { v: shares.fat, c: t.ink3, label: `Ж ${data.fat}` },
  ]

  if (shares.protein + shares.carbs + shares.fat > 0) {
    let x = 80
    ctx.save()
    roundRect(ctx, 80, barY, barW, 28, 14)
    ctx.clip()
    for (const s of segs) {
      const w = barW * s.v
      ctx.fillStyle = s.c
      ctx.fillRect(x, barY, w + 1, 28)
      x += w
    }
    ctx.restore()

    ctx.textAlign = 'left'
    ctx.font = `600 34px ${FONT}`
    let lx = 80
    for (const s of segs) {
      ctx.fillStyle = s.c
      ctx.fillText(s.label, lx, barY + 86)
      lx += ctx.measureText(s.label).width + 46
    }
  }

  // Что было съедено
  let y = barY + 170
  ctx.textAlign = 'left'
  ctx.fillStyle = t.ink2
  ctx.font = `600 36px ${FONT}`
  ctx.fillText(data.empty ? 'Записей нет' : 'Что было', 80, y)
  y += 30

  for (const item of data.top) {
    y += 78
    ctx.fillStyle = t.surface
    roundRect(ctx, 80, y - 52, barW, 68, 22)
    ctx.fill()

    ctx.font = `400 38px ${FONT}`
    ctx.fillStyle = t.ink
    ctx.fillText(item.emoji, 106, y - 4)

    const kcalText = `${Math.round(item.kcal)}`
    ctx.font = `600 34px ${FONT}`
    const kcalW = ctx.measureText(kcalText).width

    ctx.font = `500 34px ${FONT}`
    const nameMax = barW - 190 - kcalW
    const title = item.count > 1 ? `${item.name} ×${item.count}` : item.name
    ctx.fillStyle = t.ink
    ctx.fillText(ellipsize(ctx, title, nameMax), 168, y - 4)

    ctx.font = `600 34px ${FONT}`
    ctx.fillStyle = t.ink3
    ctx.textAlign = 'right'
    ctx.fillText(kcalText, CARD_W - 106, y - 4)
    ctx.textAlign = 'left'
  }

  // Подвал
  ctx.fillStyle = t.ink3
  ctx.font = `500 30px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('eataps.com', CARD_W / 2, CARD_H - 70)

  return canvas
}

// Готовое изображение как Blob. Canvas → PNG.
export function cardToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось создать изображение'))), 'image/png')
  })
}
