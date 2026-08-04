// Убирает почти-белый фон исходного лого и делает прозрачный public/logo.png.
// Фон (#f8..#fe) и цвета лого (зелёный #04604e, синий) чётко разделяются по
// минимальному каналу: у фона min(R,G,B) ~248, у лого — <100.
import sharp from 'sharp'

const SRC = 'brand/logo-source.png'
const OUT = 'public/logo.png'

// Лого — насыщенные цвета (min-канал < ~40); фон — почти-белый с квадратным
// вигнетом (min ~224–240). Режем всё выше 200 в ноль, чтобы убрать квадрат.
const OPAQUE_BELOW = 140 // min-канал < 140 → полностью непрозрачно (тело лого)
const CLEAR_ABOVE = 200 // min-канал > 200 → полностью прозрачно (весь фон + вигнет)

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = info

for (let i = 0; i < data.length; i += channels) {
  const r = data[i], g = data[i + 1], b = data[i + 2]
  const m = Math.min(r, g, b)
  let alpha
  if (m <= OPAQUE_BELOW) alpha = 255
  else if (m >= CLEAR_ABOVE) alpha = 0
  else alpha = Math.round(255 * (1 - (m - OPAQUE_BELOW) / (CLEAR_ABOVE - OPAQUE_BELOW)))
  data[i + 3] = alpha
}

// Обрезаем прозрачные поля вокруг знака.
const trimmed = await sharp(data, { raw: { width, height, channels } })
  .png()
  .trim()
  .toBuffer()

await sharp(trimmed).toFile(OUT)

const meta = await sharp(OUT).metadata()
console.log('logo.png:', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha)
