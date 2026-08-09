// Декодер штрихкодов проверяем «от стандарта»: таблицы кодирования в этом файле
// выписаны литералами из спецификации EAN/UPC, а не взяты из barcode.js. Иначе
// тест доказывал бы только то, что модуль согласован сам с собой.
//
// Отдельно держим два свойства, важнее скорости распознавания:
//   • на шуме и на битой картинке декодер молчит, а не выдумывает код —
//     иначе в дневник улетит случайный продукт;
//   • перевёрнутая в кадре упаковка читается так же, как правильная.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeLine, scanLuma, checksumOk, expandUpcE, barcodeVariants } from './barcode.js'

// ── Таблицы стандарта (модули: 1 — штрих, 0 — пробел) ────────────────────────

const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
]

// Чередование чётностей левой половины EAN-13 по первой цифре.
const EAN13_PARITY = [
  'OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE',
  'OEEOOE', 'OEEEOO', 'OEOEOE', 'OEOEEO', 'OEEOEO',
]

// Чередование чётностей UPC-E по контрольной цифре (система нумерации 0).
const UPCE_PARITY = [
  'EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO',
  'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE',
]

const digitsOf = (s) => [...s].map(Number)

function encodeEan13(code) {
  const d = digitsOf(code)
  const parity = EAN13_PARITY[d[0]]
  let bits = '101'
  for (let i = 0; i < 6; i++) bits += parity[i] === 'O' ? L[d[i + 1]] : G[d[i + 1]]
  bits += '01010'
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]]
  return bits + '101'
}

function encodeEan8(code) {
  const d = digitsOf(code)
  let bits = '101'
  for (let i = 0; i < 4; i++) bits += L[d[i]]
  bits += '01010'
  for (let i = 4; i < 8; i++) bits += R[d[i]]
  return bits + '101'
}

// ns — система нумерации (0 или 1), six — шесть печатных цифр, check —
// контрольная цифра развёрнутого UPC-A.
function encodeUpcE(ns, six, check) {
  const base = UPCE_PARITY[check]
  const parity = ns === 1 ? [...base].map((c) => (c === 'O' ? 'E' : 'O')).join('') : base
  const d = digitsOf(six)
  let bits = '101'
  for (let i = 0; i < 6; i++) bits += parity[i] === 'O' ? L[d[i]] : G[d[i]]
  return bits + '010101'
}

// ── Рендер «снимка» ──────────────────────────────────────────────────────────

// Детерминированный генератор — тест не должен мигать от запуска к запуску.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Ширина модуля намеренно дробная: у настоящей камеры границы штрихов почти
// никогда не совпадают с пикселями.
function renderLine(bits, { module = 3, quiet = 26, dark = 40, light = 225 } = {}) {
  const width = Math.ceil(quiet * 2 + bits.length * module)
  const line = new Uint8Array(width).fill(light)
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue
    const from = Math.round(quiet + i * module)
    const to = Math.round(quiet + (i + 1) * module)
    for (let x = from; x < to && x < width; x++) line[x] = dark
  }
  return line
}

function blur(line, radius) {
  if (!radius) return line
  const out = new Uint8Array(line.length)
  for (let i = 0; i < line.length; i++) {
    let sum = 0
    let n = 0
    for (let d = -radius; d <= radius; d++) {
      const j = i + d
      if (j >= 0 && j < line.length) { sum += line[j]; n++ }
    }
    out[i] = Math.round(sum / n)
  }
  return out
}

function noisy(line, amount, seed) {
  if (!amount) return line
  const rand = rng(seed)
  const out = new Uint8Array(line.length)
  for (let i = 0; i < line.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(line[i] + (rand() - 0.5) * 2 * amount)))
  }
  return out
}

// Кадр: полосы штрихкода в середине, вокруг — ровный фон с крупицей шума.
function renderImage(bits, { width, height, top, bottom, module, seed = 7, vertical = false } = {}) {
  const line = renderLine(bits, { module, quiet: 20 })
  const w = vertical ? height : width
  const h = vertical ? width : height
  const rand = rng(seed)
  const img = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      img[y * w + x] = Math.round(200 + (rand() - 0.5) * 20)
    }
  }
  const offset = Math.max(0, Math.floor((w - line.length) / 2))
  for (let y = top; y < bottom; y++) {
    for (let i = 0; i < line.length && offset + i < w; i++) img[y * w + offset + i] = line[i]
  }
  if (!vertical) return { luma: img, width: w, height: h }
  // Транспонируем: тот же штрихкод, но повёрнутый на 90°.
  const out = new Uint8Array(width * height)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * width + y] = img[y * w + x]
  return { luma: out, width, height }
}

// ── Контрольная сумма ────────────────────────────────────────────────────────

test('контрольная сумма считается по правилу EAN/UPC', () => {
  for (const code of ['4006381333931', '5901234123457', '4600494212819', '96385074', '40170725', '012345678905']) {
    assert.equal(checksumOk(code), true, `отвергнут корректный код ${code}`)
  }
  for (const code of ['4006381333932', '5901234123456', '96385075', '012345678900']) {
    assert.equal(checksumOk(code), false, `принят код с битой контрольной цифрой ${code}`)
  }
  // Длина не из стандарта — не код.
  for (const code of ['', '123', '1234567890', '12345678901234', 'abcdefgh']) {
    assert.equal(checksumOk(code), false, `принята строка неверной длины: ${code}`)
  }
})

// ── EAN-13 ───────────────────────────────────────────────────────────────────

const EAN13_SAMPLES = ['4006381333931', '5901234123457', '4600494212819', '3017620422003', '8712100325762']

test('EAN-13 читается при разной ширине модуля', () => {
  for (const code of EAN13_SAMPLES) {
    for (const module of [2, 2.4, 3, 3.7, 5]) {
      const line = renderLine(encodeEan13(code), { module })
      assert.equal(decodeLine(line), code, `${code} при модуле ${module}`)
    }
  }
})

test('EAN-13 читается смазанным и зашумлённым', () => {
  for (const code of EAN13_SAMPLES) {
    const bits = encodeEan13(code)
    const line = noisy(blur(renderLine(bits, { module: 4 }), 1), 18, 42)
    assert.equal(decodeLine(line), code, `${code} на смазанном кадре`)
  }
})

test('EAN-13 читается при слабом контрасте', () => {
  // Тень на упаковке: разница «штрих/фон» всего 60 уровней вместо 185.
  const code = '4006381333931'
  const line = renderLine(encodeEan13(code), { module: 4, dark: 90, light: 150 })
  assert.equal(decodeLine(line), code)
})

test('перевёрнутая упаковка читается так же', () => {
  for (const code of EAN13_SAMPLES) {
    const line = renderLine(encodeEan13(code), { module: 3 })
    const mirrored = Uint8Array.from([...line].reverse())
    assert.equal(decodeLine(mirrored), code, `${code} задом наперёд`)
  }
})

test('UPC-A распознаётся как EAN-13 с ведущим нулём', () => {
  // 12 цифр с упаковки → 13 в базе. Ноль дописывает не пользователь, а декодер.
  const line = renderLine(encodeEan13('0012345678905'), { module: 3 })
  assert.equal(decodeLine(line), '0012345678905')
})

// ── EAN-8 ────────────────────────────────────────────────────────────────────

test('EAN-8 читается (маленькие упаковки)', () => {
  for (const code of ['96385074', '40170725', '20886509']) {
    for (const module of [3, 4.3]) {
      const line = renderLine(encodeEan8(code), { module })
      assert.equal(decodeLine(line), code, `${code} при модуле ${module}`)
    }
  }
})

// ── UPC-E ────────────────────────────────────────────────────────────────────

test('UPC-E разворачивается в UPC-A по правилам последней цифры', () => {
  // Значения посчитаны по спецификации вручную.
  assert.equal(expandUpcE(0, [1, 2, 3, 4, 5, 5], 8), '012345000058')
  assert.equal(expandUpcE(0, [1, 2, 3, 4, 5, 0], 5), '012000003455')
  // Контрольная цифра не сошлась — это не UPC-E, а совпадение рисунка.
  assert.equal(expandUpcE(0, [1, 2, 3, 4, 5, 5], 7), null)
})

test('UPC-E читается с кадра и отдаётся уже развёрнутым', () => {
  const line = renderLine(encodeUpcE(0, '123455', 8), { module: 4 })
  assert.equal(decodeLine(line), '012345000058')

  const other = renderLine(encodeUpcE(0, '123450', 5), { module: 3 })
  assert.equal(decodeLine(other), '012000003455')
})

// ── Отказы: молчать важнее, чем угадать ──────────────────────────────────────

test('на шуме кода не находится', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed)
    const line = new Uint8Array(640)
    for (let i = 0; i < line.length; i++) line[i] = Math.floor(rand() * 256)
    assert.equal(decodeLine(line), null, `выдуман код на шуме, seed=${seed}`)
  }
})

test('на однотонном кадре кода не находится', () => {
  assert.equal(decodeLine(new Uint8Array(640).fill(210)), null)
  assert.equal(decodeLine(new Uint8Array(640).fill(12)), null)
})

test('обрезанный краем кадра штрихкод не читается наполовину', () => {
  const line = renderLine(encodeEan13('4006381333931'), { module: 4 })
  // Отрезаем правую треть — вместе с ограничителем и последними цифрами.
  const cut = line.subarray(0, Math.floor(line.length * 0.66))
  assert.equal(decodeLine(cut), null)
})

test('искажённые штрихи не превращаются в другой код', () => {
  const bits = encodeEan13('4006381333931')
  const line = renderLine(bits, { module: 4 })
  // Замазываем середину — там центральный ограничитель и соседние цифры.
  const damaged = Uint8Array.from(line)
  for (let i = Math.floor(damaged.length * 0.45); i < Math.floor(damaged.length * 0.55); i++) {
    damaged[i] = 225
  }
  const got = decodeLine(damaged)
  assert.notEqual(got, '4006381333931')
  assert.equal(got, null, `вместо отказа выдан код ${got}`)
})

// ── Скан кадра целиком ───────────────────────────────────────────────────────

test('scanLuma находит штрихкод в кадре и считает совпадения', () => {
  const code = '4600494212819'
  const { luma, width, height } = renderImage(encodeEan13(code), {
    width: 480, height: 220, top: 70, bottom: 150, module: 3,
  })
  const hit = scanLuma(luma, width, height)
  assert.ok(hit, 'штрихкод в центре кадра не найден')
  assert.equal(hit.code, code)
  assert.ok(hit.hits >= 2, `код подтверждён только одной строкой (${hit.hits})`)
})

test('scanLuma читает штрихкод, повёрнутый на 90°', () => {
  const code = '5901234123457'
  const { luma, width, height } = renderImage(encodeEan13(code), {
    width: 300, height: 460, top: 150, bottom: 300, module: 3, vertical: true,
  })
  const hit = scanLuma(luma, width, height)
  assert.ok(hit, 'вертикальный штрихкод не найден')
  assert.equal(hit.code, code)
})

test('scanLuma на кадре без штрихкода возвращает null', () => {
  const rand = rng(99)
  const width = 480
  const height = 220
  const luma = new Uint8Array(width * height)
  for (let i = 0; i < luma.length; i++) luma[i] = Math.floor(rand() * 256)
  assert.equal(scanLuma(luma, width, height), null)
})

// ── Поток: много случайных кодов в тяжёлых условиях ──────────────────────────

test('случайные коды читаются на плохих кадрах и никогда не читаются неверно', () => {
  const rand = rng(12345)
  const checkDigit = (d) => {
    let sum = 0
    for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w
    return (10 - (sum % 10)) % 10
  }

  let ok = 0
  let wrong = null
  const total = 400
  for (let n = 0; n < total; n++) {
    const short = rand() < 0.2
    const body = [...Array(short ? 7 : 12)].map(() => Math.floor(rand() * 10))
    const code = body.join('') + checkDigit(body)
    const bits = short ? encodeEan8(code) : encodeEan13(code)

    // Каждый кадр свой: масштаб, освещение, смаз, зерно.
    const dark = 20 + rand() * 70
    const line = noisy(
      blur(renderLine(bits, { module: 2 + rand() * 4, dark, light: dark + 60 + rand() * 140 }), rand() < 0.5 ? 1 : 0),
      rand() * 20,
      Math.floor(rand() * 1e6),
    )

    const got = decodeLine(line)
    if (got === code) ok++
    else if (got !== null && !wrong) wrong = { code, got }
  }

  // Неверный код хуже нечитаемого: нераспознанный кадр человек просто повторит,
  // а чужой продукт уедет в дневник молча.
  assert.equal(wrong, null, `код прочитан неверно: ${JSON.stringify(wrong)}`)
  // Одна строка — одна попытка; в кадре их полтора десятка, и так по 10 раз
  // в секунду, поэтому даже такой доли хватает на мгновенное считывание.
  assert.ok(ok / total > 0.7, `слишком низкая доля распознавания: ${ok}/${total}`)
})

test('полосатая текстура не превращается в штрихкод', () => {
  // Жалюзи, решётка, штрихкод соседнего товара не в фокусе — кадры, на которых
  // декодер обязан молчать, а не выдавать «правдоподобный» код.
  for (let s = 1; s <= 120; s++) {
    const rand = rng(s * 7919)
    const width = 420
    const height = 200
    const img = new Uint8Array(width * height)
    const mode = s % 3
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v
        if (mode === 0) v = rand() * 256
        else if (mode === 1) v = Math.floor(x / (2 + Math.floor(rand() * 6))) % 2 ? 230 : 30
        else v = 140 + 80 * Math.sin(x / 3 + y / 11) + (rand() - 0.5) * 90
        img[y * width + x] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
    const hit = scanLuma(img, width, height)
    assert.equal(hit, null, `выдуман код ${hit && hit.code} на кадре без штрихкода (seed=${s}, тип=${mode})`)
  }
})

// ── Написание кода для базы ──────────────────────────────────────────────────

test('для UPC-A пробуем оба написания — с ведущим нулём и без', () => {
  assert.deepEqual(barcodeVariants('0012345678905'), ['0012345678905', '012345678905'])
  assert.deepEqual(barcodeVariants('012345678905'), ['012345678905', '0012345678905'])
  // Обычный EAN-13 переписывать незачем.
  assert.deepEqual(barcodeVariants('4006381333931'), ['4006381333931'])
  assert.deepEqual(barcodeVariants('96385074'), ['96385074'])
})
