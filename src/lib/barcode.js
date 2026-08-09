// ─────────────────────────────────────────────────────────────────────────────
// Разбор линейных штрихкодов с этикетки: EAN-13, EAN-8, UPC-A, UPC-E.
//
// Почему свой декодер, а не библиотека. Нативный BarcodeDetector есть только в
// Chrome/Android — в Safari (а это основной для нас iOS-PWA) его нет, и класть
// в бандл zxing ради четырёх линейных форматов дорого. Здесь ровно то, что
// печатают на продуктах, и ничего больше.
//
// Модуль чистый: на вход — яркости пикселей, на выход — строка цифр. Никакого
// DOM, поэтому его можно гонять тестами (barcode.test.js) без браузера.
//
// Схема EAN-13 (95 модулей):
//   101 · 6 цифр слева · 01010 · 6 цифр справа · 101
// Цифры слева кодируются наборами L или G, и сама последовательность L/G —
// это тринадцатая (первая) цифра, у неё нет собственных штрихов.
// ─────────────────────────────────────────────────────────────────────────────

// Ширины четырёх полос цифры в модулях, сумма всегда 7. Слева цифра начинается
// с пробела, справа — со штриха, ширины при этом те же самые.
const L_PATTERNS = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
]
// Набор G — тот же рисунок задом наперёд.
const G_PATTERNS = L_PATTERNS.map((p) => [...p].reverse())

// Чередование L/G в левой половине → первая цифра EAN-13 (0 = L, 1 = G).
const EAN13_PARITY = {
  '000000': '0', '001011': '1', '001101': '2', '001110': '3', '010011': '4',
  '011001': '5', '011100': '6', '010101': '7', '010110': '8', '011010': '9',
}

// У UPC-E штрихов всего шесть, а чередование L/G несёт контрольную цифру.
// Таблица — для системы нумерации 0; для системы 1 рисунок инвертирован.
const UPCE_PARITY = {
  '111000': 0, '110100': 1, '110010': 2, '110001': 3, '101100': 4,
  '100110': 5, '100011': 6, '101010': 7, '101001': 8, '100101': 9,
}

// Допуски подбора цифры: средняя и максимальная ошибка ширины одной полосы в
// долях модуля. Значения обкатаны в zxing — при более строгих смазанный кадр
// перестаёт читаться, при более мягких растёт шанс собрать цифру из шума.
const MAX_AVG_VARIANCE = 0.48
const MAX_INDIVIDUAL_VARIANCE = 0.7

// Больше полос на строке, чем здесь, — это уже не штрихкод, а текстура (трава,
// плитка, текст мелким кеглем). Перебирать в ней все стартовые позиции дорого.
const MAX_RUNS = 700

// ── Контрольная сумма ────────────────────────────────────────────────────────

// Общее правило EAN/UPC: цифры справа налево (без контрольной) с весами 3,1,3,1…
export function checksumOk(code) {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false
  const d = [...code].map(Number)
  const check = d.pop()
  let sum = 0
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w
  return (10 - (sum % 10)) % 10 === check
}

function checkDigitOf(digits) {
  let sum = 0
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w
  return (10 - (sum % 10)) % 10
}

// ── Бинаризация строки ───────────────────────────────────────────────────────

const BUCKETS = 32
const SHIFT = 3

// Порог «штрих / фон» по гистограмме яркостей строки: ищем два пика (тёмный и
// светлый) и впадину между ними. Глобальная середина (min+max)/2 разваливается
// на бликах от плёнки, а этот способ держит их.
function blackPoint(line, len) {
  const buckets = new Int32Array(BUCKETS)
  for (let i = 0; i < len; i++) buckets[line[i] >> SHIFT]++

  let maxCount = 0
  let firstPeak = 0
  for (let i = 0; i < BUCKETS; i++) {
    if (buckets[i] > maxCount) { maxCount = buckets[i]; firstPeak = i }
  }

  // Второй пик — не просто следующий по высоте, а самый высокий из дальних:
  // иначе им становится соседний бакет того же самого пика.
  let secondPeak = 0
  let secondScore = -1
  for (let i = 0; i < BUCKETS; i++) {
    const d = i - firstPeak
    const score = buckets[i] * d * d
    if (score > secondScore) { secondScore = score; secondPeak = i }
  }

  let lo = firstPeak
  let hi = secondPeak
  if (lo > hi) { const t = lo; lo = hi; hi = t }
  // Пики рядом — на строке нет контраста, читать нечего.
  if (hi - lo <= BUCKETS / 16) return -1

  let valley = hi - 1
  let valleyScore = -1
  for (let i = hi - 1; i > lo; i--) {
    const fromLo = i - lo
    const score = fromLo * fromLo * (hi - i) * (maxCount - buckets[i])
    if (score > valleyScore) { valley = i; valleyScore = score }
  }
  return valley << SHIFT
}

// Строка → длины чередующихся полос. Цвет хранить для каждой не нужно: они
// строго чередуются, достаточно знать цвет первой.
function toRuns(line, len, threshold) {
  const widths = []
  let black = line[0] < threshold
  const firstBlack = black
  let start = 0
  for (let i = 1; i < len; i++) {
    const b = line[i] < threshold
    if (b !== black) { widths.push(i - start); black = b; start = i }
  }
  widths.push(len - start)
  return { widths, firstBlack }
}

// ── Подбор цифры ─────────────────────────────────────────────────────────────

// Насколько ширины полос по смещению offset похожи на эталонный рисунок.
// Нормируем на сумму самой цифры, а не на общий модуль символа: так рисунок
// переживает перспективу и «расплывание» штрихов к краю кадра.
//
// delta — поправка на смещение порога бинаризации (см. guardDelta): штрихи
// «толстеют» ровно настолько, насколько худеют пробелы. Внутри цифры два штриха
// и два пробела, так что на сумму поправка не влияет — только на отдельные
// полосы, а именно по ним и различаются рисунки.
function patternVariance(widths, offset, pattern, delta, blackFirst) {
  let total = 0
  let patternLength = 0
  for (let i = 0; i < pattern.length; i++) {
    total += widths[offset + i]
    patternLength += pattern[i]
  }
  if (total < patternLength) return Infinity // полосы уже модуля — не разобрать
  const unit = total / patternLength
  const maxIndividual = MAX_INDIVIDUAL_VARIANCE * unit
  let variance = 0
  for (let i = 0; i < pattern.length; i++) {
    const black = blackFirst === (i % 2 === 0)
    const w = widths[offset + i] + (black ? -delta : delta)
    const d = Math.abs(w - pattern[i] * unit)
    if (d > maxIndividual) return Infinity
    variance += d
  }
  return variance / total
}

// Правая половина EAN-13/EAN-8: только набор L (у R те же ширины), полосы
// цифры начинаются со штриха.
function decodeDigit(widths, offset, delta) {
  let best = -1
  let bestVariance = MAX_AVG_VARIANCE
  for (let d = 0; d < 10; d++) {
    const v = patternVariance(widths, offset, L_PATTERNS[d], delta, true)
    if (v < bestVariance) { bestVariance = v; best = d }
  }
  return best
}

// Левая половина: цифра плюс её чётность (0 = L, 1 = G). Полосы начинаются
// с пробела.
function decodeDigitWithParity(widths, offset, delta) {
  let best = -1
  let parity = 0
  let bestVariance = MAX_AVG_VARIANCE
  for (let d = 0; d < 10; d++) {
    const vl = patternVariance(widths, offset, L_PATTERNS[d], delta, false)
    if (vl < bestVariance) { bestVariance = vl; best = d; parity = 0 }
    const vg = patternVariance(widths, offset, G_PATTERNS[d], delta, false)
    if (vg < bestVariance) { bestVariance = vg; best = d; parity = 1 }
  }
  return best < 0 ? null : { digit: best, parity }
}

// Ограничитель — count полос по одному модулю каждая. Возвращает ширину модуля
// или -1, если рисунок не похож на ограничитель.
function guardUnit(widths, offset, count) {
  let total = 0
  for (let i = 0; i < count; i++) total += widths[offset + i]
  const unit = total / count
  if (unit < 0.75) return -1
  const maxDev = unit * MAX_INDIVIDUAL_VARIANCE
  for (let i = 0; i < count; i++) {
    if (Math.abs(widths[offset + i] - unit) > maxDev) return -1
  }
  return unit
}

// Насколько порог бинаризации ушёл от середины между «штрихом» и «фоном».
// Смаз объектива плюс невыровненный порог дают систематический перекос: все
// штрихи шире истинных на delta, все пробелы — уже на столько же. Ограничители
// это показывают напрямую: там и штрихи, и пробелы шириной ровно в модуль, так
// что вся разница между ними — удвоенный перекос.
//
// Считаем по всем ограничителям сразу (их 11 полос на EAN-13, а не 3): при
// узких штрихах отдельная полоса округляется до целого пикселя и по трём полосам
// перекос не отличить от этого округления.
function guardsDelta(widths, blacks, whites, unit) {
  let sumBlack = 0
  for (const i of blacks) sumBlack += widths[i]
  let sumWhite = 0
  for (const i of whites) sumWhite += widths[i]
  const d = (sumBlack / blacks.length - sumWhite / whites.length) / 2
  const cap = unit * 0.5
  return Math.max(-cap, Math.min(cap, d))
}

// Проверки, которых не делает контрольная сумма: свободное поле по краям и
// согласованность ширины модуля по всему символу. Без них случайная текстура —
// жалюзи, решётка радиатора, полосатая скатерть — складывается в код с верной
// контрольной цифрой, и он молча уезжает в дневник.
//
// quiet — сколько модулей свободного поля требовать по краям. Стандарт просит
// 7–9, но кадр обрезает края, поэтому обычно берём заметно меньше.
function symbolOk(widths, offset, runs, modules, unitStart, unitEnd, quiet, tol) {
  const ratio = unitStart / unitEnd
  if (ratio < 0.5 || ratio > 2) return false
  const unit = (unitStart + unitEnd) / 2
  let total = 0
  for (let i = 0; i < runs; i++) total += widths[offset + i]
  const expected = modules * unit
  if (total < expected * (1 - tol) || total > expected * (1 + tol)) return false
  return widths[offset - 1] >= unit * quiet && widths[offset + runs] >= unit * quiet
}

// ── Разбор символа с известной стартовой полосы ──────────────────────────────

// EAN-13: 3 + 6×4 + 5 + 6×4 + 3 = 59 полос.
//
// Порядок проверок не случаен: ограничители и геометрия символа стоят копейки,
// а подбор цифр — самое дорогое, что здесь есть. На кадре с полкой магазина
// стартовых позиций сотни, и почти все они отсеиваются до первой цифры.
function readEan13(widths, offset) {
  const unitStart = guardUnit(widths, offset, 3)
  if (unitStart < 0) return null
  if (guardUnit(widths, offset + 27, 5) < 0) return null
  const unitEnd = guardUnit(widths, offset + 56, 3)
  if (unitEnd < 0) return null
  if (!symbolOk(widths, offset, 59, 95, unitStart, unitEnd, 2.5, 0.3)) return null

  const delta = guardsDelta(
    widths,
    [offset, offset + 2, offset + 28, offset + 30, offset + 56, offset + 58],
    [offset + 1, offset + 27, offset + 29, offset + 31, offset + 57],
    (unitStart + unitEnd) / 2,
  )

  const digits = []
  let parity = ''
  for (let k = 0; k < 6; k++) {
    const r = decodeDigitWithParity(widths, offset + 3 + k * 4, delta)
    if (!r) return null
    digits.push(r.digit)
    parity += r.parity
  }
  const first = EAN13_PARITY[parity]
  if (first === undefined) return null

  for (let k = 0; k < 6; k++) {
    const d = decodeDigit(widths, offset + 32 + k * 4, delta)
    if (d < 0) return null
    digits.push(d)
  }

  const code = first + digits.join('')
  return checksumOk(code) ? code : null
}

// EAN-8: 3 + 4×4 + 5 + 4×4 + 3 = 43 полосы, чётности нет — все цифры слева L.
function readEan8(widths, offset) {
  const unitStart = guardUnit(widths, offset, 3)
  if (unitStart < 0) return null
  if (guardUnit(widths, offset + 19, 5) < 0) return null
  const unitEnd = guardUnit(widths, offset + 40, 3)
  if (unitEnd < 0) return null
  if (!symbolOk(widths, offset, 43, 67, unitStart, unitEnd, 2.5, 0.3)) return null

  const delta = guardsDelta(
    widths,
    [offset, offset + 2, offset + 20, offset + 22, offset + 40, offset + 42],
    [offset + 1, offset + 19, offset + 21, offset + 23, offset + 41],
    (unitStart + unitEnd) / 2,
  )

  const digits = []
  for (let k = 0; k < 4; k++) {
    const r = decodeDigitWithParity(widths, offset + 3 + k * 4, delta)
    if (!r || r.parity !== 0) return null
    digits.push(r.digit)
  }
  for (let k = 0; k < 4; k++) {
    const d = decodeDigit(widths, offset + 24 + k * 4, delta)
    if (d < 0) return null
    digits.push(d)
  }

  const code = digits.join('')
  return checksumOk(code) ? code : null
}

// UPC-E → UPC-A. Правила «раскрытия» задаёт последняя из шести цифр.
export function expandUpcE(ns, six, check) {
  const [a, b, c, d, e, f] = six
  let body
  if (f <= 2) body = [ns, a, b, f, 0, 0, 0, 0, c, d, e]
  else if (f === 3) body = [ns, a, b, c, 0, 0, 0, 0, 0, d, e]
  else if (f === 4) body = [ns, a, b, c, d, 0, 0, 0, 0, 0, e]
  else body = [ns, a, b, c, d, e, 0, 0, 0, 0, f]
  if (checkDigitOf(body) !== check) return null
  return body.join('') + String(check)
}

// UPC-E: 3 + 6×4 + 6 = 33 полосы, ограничитель в конце — 010101.
function readUpcE(widths, offset) {
  const unitStart = guardUnit(widths, offset, 3)
  if (unitStart < 0) return null
  const unitEnd = guardUnit(widths, offset + 27, 6)
  if (unitEnd < 0) return null
  if (!symbolOk(widths, offset, 33, 51, unitStart, unitEnd, 5, 0.15)) return null

  const delta = guardsDelta(
    widths,
    [offset, offset + 2, offset + 28, offset + 30, offset + 32],
    [offset + 1, offset + 27, offset + 29, offset + 31],
    (unitStart + unitEnd) / 2,
  )

  const digits = []
  let parity = ''
  for (let k = 0; k < 6; k++) {
    const r = decodeDigitWithParity(widths, offset + 3 + k * 4, delta)
    if (!r) return null
    digits.push(r.digit)
    parity += r.parity
  }

  let ns = 0
  let check = UPCE_PARITY[parity]
  if (check === undefined) {
    // Система нумерации 1 — тот же рисунок наоборот.
    const flipped = [...parity].map((c) => (c === '0' ? '1' : '0')).join('')
    check = UPCE_PARITY[flipped]
    if (check === undefined) return null
    ns = 1
  }
  return expandUpcE(ns, digits, check)
}

// Перебор стартовых позиций. Нулевую полосу пропускаем всегда: она обрезана
// краем кадра, её ширина ничего не значит. Последнюю — по той же причине.
// Форматы перебираем по очереди целиком, а не вперемешку по каждой позиции:
// чем короче символ, тем легче он собирается из случайного узора, и находка
// UPC-E левее не должна перебивать настоящий EAN-13 правее по строке.
const FORMATS = [
  { runs: 59, read: readEan13 },
  { runs: 43, read: readEan8 },
  { runs: 33, read: readUpcE },
]

function decodeRuns(widths, firstBlack) {
  const n = widths.length
  if (n > MAX_RUNS) return null
  // Штрихкод начинается со штриха; полоса i чёрная, если её чётность совпадает
  // с цветом первой.
  const blackAt = (i) => firstBlack === (i % 2 === 0)

  for (const { runs, read } of FORMATS) {
    for (let i = 1; i + runs <= n - 1; i++) {
      if (!blackAt(i)) continue
      const code = read(widths, i)
      if (code) return code
    }
  }
  return null
}

// ── Публичный вход ───────────────────────────────────────────────────────────

// Медиана по трём соседям убирает одиночные выбросы сенсора, не размывая
// границы штрихов (в отличие от усреднения). Полосы уже двух пикселей она
// сохраняет, а тоньше их всё равно не разобрать.
function median3(line, len) {
  const out = new Uint8Array(len)
  out[0] = line[0]
  out[len - 1] = line[len - 1]
  for (let i = 1; i < len - 1; i++) {
    const a = line[i - 1]
    const b = line[i]
    const c = line[i + 1]
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  }
  return out
}

function decodeBoth(line, len) {
  const threshold = blackPoint(line, len)
  if (threshold < 0) return null
  const { widths, firstBlack } = toRuns(line, len, threshold)
  const forward = decodeRuns(widths, firstBlack)
  if (forward) return forward
  // Перевёрнутая в кадре упаковка — обычное дело, а лишний проход стоит копейки.
  const reversed = [...widths].reverse()
  return decodeRuns(reversed, firstBlack === (widths.length % 2 === 1))
}

// Одна линия яркостей → код или null.
export function decodeLine(line, len = line.length) {
  if (len < 60) return null
  // Сначала как есть: на чистом кадре так читаются и самые тонкие штрихи.
  // Если не вышло — ещё раз с фильтром: на зерне при слабом свете граница
  // штриха «дребезжит» вокруг порога и рождает полосы шириной в пиксель.
  return decodeBoth(line, len) || decodeBoth(median3(line, len), len)
}

// Позиции линий: от середины к краям — штрихкод почти всегда в центре рамки.
function lineOrder(size, count) {
  const out = []
  const step = size / (count + 1)
  for (let i = 1; i <= count; i++) out.push(Math.min(size - 1, Math.round(step * i)))
  return out.sort((a, b) => Math.abs(a - size / 2) - Math.abs(b - size / 2))
}

// RGBA из canvas → яркости (коэффициенты BT.601 в целочисленном виде).
export function toLuma(rgba, width, height) {
  const out = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 306 + rgba[p + 1] * 601 + rgba[p + 2] * 117) >> 10
  }
  return out
}

// Скан кадра: горизонтальные линии, затем вертикальные — чтобы не заставлять
// человека доворачивать телефон под штрихкод.
//
// Возвращает { code, hits }, где hits — сколько линий дали один и тот же код.
// Вызывающий по числу совпадений решает, доверять ли результату сразу: одна
// строка с верной контрольной суммой ошибается редко, но всё же ошибается.
export function scanLuma(luma, width, height, { rows = 14, cols = 10 } = {}) {
  const found = new Map()
  const bump = (code) => found.set(code, (found.get(code) || 0) + 1)

  for (const y of lineOrder(height, rows)) {
    const code = decodeLine(luma.subarray(y * width, y * width + width), width)
    if (code) bump(code)
  }

  if (found.size === 0 && cols > 0) {
    const column = new Uint8Array(height)
    for (const x of lineOrder(width, cols)) {
      for (let y = 0; y < height; y++) column[y] = luma[y * width + x]
      const code = decodeLine(column, height)
      if (code) bump(code)
    }
  }

  let best = null
  for (const [code, hits] of found) {
    if (!best || hits > best.hits) best = { code, hits }
  }
  return best
}

// Один и тот же товар живёт в базе то как 13 цифр с ведущим нулём, то как 12:
// UPC-A печатают на американских упаковках без него. Отдаём оба написания —
// поиск попробует их по очереди.
export function barcodeVariants(code) {
  const out = [code]
  if (code.length === 13 && code[0] === '0') out.push(code.slice(1))
  else if (code.length === 12) out.push('0' + code)
  return out
}
