// Одноразовая генерация иконок из brand/logo-source.png.
// Требует установленного sharp (ставится временно: npm i -D sharp).
import sharp from 'sharp'

const SRC = 'brand/logo-source.png'
// Фон — белый (лого с прозрачным фоном).
const BG = { r: 252, g: 255, b: 255, alpha: 1 }
console.log('background #fcffff')

// Обрезанный «знак» без тёмной рамки (края сглажены на том же фоне BG).
const markBuf = await sharp(SRC).trim({ threshold: 12 }).toBuffer()

// --- Иконки: знак на тёмной плитке с отступом ---
async function icon(size, out, ratio) {
  const inner = Math.round(size * ratio)
  const resized = await sharp(markBuf).resize(inner, inner, { fit: 'contain', background: BG }).toBuffer()
  const pad = Math.round((size - inner) / 2)
  await sharp(resized)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG })
    .resize(size, size)
    .flatten({ background: BG })
    .png()
    .toFile(out)
  console.log('icon', out, size)
}

await icon(180, 'public/apple-touch-icon.png', 1.0)
await icon(192, 'public/icon-192.png', 1.0)
await icon(512, 'public/icon-512.png', 1.0)
await icon(64, 'public/favicon.png', 1.0)
