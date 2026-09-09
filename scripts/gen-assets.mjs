// Одноразовая генерация иконок из brand/logo-source.png.
// Требует установленного sharp (ставится временно: npm i -D sharp).
import sharp from 'sharp'

const SRC = 'brand/logo-source.png'
// Фон — белый (лого с прозрачным фоном).
const BG = { r: 252, g: 255, b: 255, alpha: 1 }
console.log('background #fcffff')

// Обрезанный «знак» без тёмной рамки (края сглажены на том же фоне BG).
const markBuf = await sharp(SRC).trim({ threshold: 12 }).toBuffer()

// --- Иконки: знак на плитке с отступом ---
// MARK — доля плитки, которую занимает сам знак. Остальное уходит в поля:
// морковь во всю плитку выглядела крупнее соседних иконок на домашнем экране,
// где системные иконки всегда оставляют воздух по краям.
const MARK = 0.75
async function icon(size, out, ratio) {
  const inner = Math.round(size * ratio)
  const resized = await sharp(markBuf).resize(inner, inner, { fit: 'contain', background: BG }).toBuffer()
  // Поля добираем extend'ом до точного размера плитки: sharp всегда выполняет
  // resize раньше extend в одном конвейере, поэтому отступы считаем сами,
  // а не полагаемся на финальный resize — иначе иконка вырастет на 2×pad.
  const gap = size - inner
  const top = Math.floor(gap / 2)
  const left = Math.floor(gap / 2)
  await sharp(resized)
    .extend({ top, bottom: gap - top, left, right: gap - left, background: BG })
    .flatten({ background: BG })
    .png()
    .toFile(out)
  console.log('icon', out, size)
}

await icon(180, 'public/apple-touch-icon.png', MARK)
await icon(192, 'public/icon-192.png', MARK)
await icon(512, 'public/icon-512.png', MARK)
await icon(64, 'public/favicon.png', MARK)
