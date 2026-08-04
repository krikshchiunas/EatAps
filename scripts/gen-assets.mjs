// Одноразовая генерация иконок и iOS splash-экранов из brand/logo-source.png.
// Требует установленного sharp (ставится временно: npm i -D sharp).
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'brand/logo-source.png'
// Фон — белый (лого с прозрачным фоном).
const BG = { r: 252, g: 255, b: 255, alpha: 1 }
console.log('background #fcffff')

mkdirSync('public/splash', { recursive: true })

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

// --- iOS splash-экраны: сплошной фон цвета логотипа (без логотипа по центру) ---
const DEVICES = [
  { w: 1290, h: 2796, cw: 430, ch: 932, dpr: 3 },
  { w: 1179, h: 2556, cw: 393, ch: 852, dpr: 3 },
  { w: 1284, h: 2778, cw: 428, ch: 926, dpr: 3 },
  { w: 1170, h: 2532, cw: 390, ch: 844, dpr: 3 },
  { w: 1125, h: 2436, cw: 375, ch: 812, dpr: 3 },
  { w: 1242, h: 2688, cw: 414, ch: 896, dpr: 3 },
  { w: 828, h: 1792, cw: 414, ch: 896, dpr: 2 },
  { w: 750, h: 1334, cw: 375, ch: 667, dpr: 2 },
  { w: 1242, h: 2208, cw: 414, ch: 736, dpr: 3 },
  { w: 640, h: 1136, cw: 320, ch: 568, dpr: 2 },
]

const links = []
for (const d of DEVICES) {
  const file = `public/splash/apple-splash-${d.w}x${d.h}.png`
  await sharp({ create: { width: d.w, height: d.h, channels: 4, background: BG } })
    .png()
    .toFile(file)
  links.push(
    `<link rel="apple-touch-startup-image" media="(device-width: ${d.cw}px) and (device-height: ${d.ch}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)" href="/splash/apple-splash-${d.w}x${d.h}.png" />`
  )
  console.log('splash', file)
}

console.log('\n--- apple-touch-startup-image links ---\n' + links.join('\n'))
