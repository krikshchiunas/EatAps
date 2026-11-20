// «Штрихкод: помощь ИИ» от камеры до экрана количества.
//
// Камера — настоящая, только фейковая: Chromium показывает вместо неё видео со
// штрихкодом (Y4M, генерируется ниже). Сканер читает код своим декодером, база
// отдаёт товар с типичной ошибкой (килоджоули в поле «ккал»), сервер ИИ
// подменён ответом — и проверяется то, что видит человек: «было → стало»,
// «вернуть как в базе», и что без Premium-настройки ИИ не вызывается вовсе.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dict, seedState, NOW, isolateNetwork } from './helpers.mjs'
import { mockCloud, session, sessionStorageKey, USER_ID } from './cloud.mjs'

const CODE = '4006381333931'

// ── Видео со штрихкодом для фейковой камеры ──────────────────────────────────
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE', 'OEEOOE', 'OEEEOO', 'OEOEOE', 'OEOEEO', 'OEEOEO']

function ean13Bits(code) {
  const d = [...code].map(Number)
  let bits = '101'
  for (let i = 0; i < 6; i++) bits += PARITY[d[0]][i] === 'O' ? L[d[i + 1]] : G[d[i + 1]]
  bits += '01010'
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]]
  return bits + '101'
}

// YUV4MPEG2: заголовок, затем кадры «FRAME\n» + яркость + цветность (серый).
function barcodeVideo(code, path) {
  const W = 640, H = 480, MODULE = 4, BAR_H = 220
  const bits = ean13Bits(code)
  const left = Math.round((W - bits.length * MODULE) / 2)
  const top = Math.round((H - BAR_H) / 2)
  const y = Buffer.alloc(W * H, 235)
  for (let r = top; r < top + BAR_H; r++) {
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue
      for (let x = left + i * MODULE; x < left + (i + 1) * MODULE; x++) y[r * W + x] = 20
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma])
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]))
  return path
}

const VIDEO = barcodeVideo(CODE, join(tmpdir(), `eataps-barcode-${process.pid}.y4m`))

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`],
  },
  permissions: ['camera'],
})

// ── Облако, база и ИИ ────────────────────────────────────────────────────────
// Товар с ошибкой базы, которую по самим цифрам не поймать: значения «на
// порцию 30 г» записаны в поле «на 100 г». Между собой они сходятся, и только
// таблица на упаковке показывает, что творог — 157 ккал, а не 47.
const PRODUCT = {
  product_name: 'Quark 9%', brands: 'Milbona', quantity: '200 g', product_quantity: 200, product_quantity_unit: 'g',
  categories_tags: ['en:dairies'],
  nutriments: { 'energy-kcal_100g': 47, proteins_100g: 4.8, carbohydrates_100g: 0.9, fat_100g: 2.7 },
}
const CHECK = {
  status: 'corrected', name: null, unit: 'g',
  per100: { kcal: 157, protein: 16, carbs: 3, sugar: null, fat: 9, satFat: null, fiber: null },
  servingSize: 30, packSize: 200,
  corrections: [{ field: 'kcal', reason: 'Per-serving values were entered as per 100 g.' }],
  confidence: 'high', summary: 'Values were per 30 g serving.',
}

async function open(page, { aiPref }) {
  await page.clock.setFixedTime(NOW)
  await isolateNetwork(page)
  await mockCloud(page)
  // Позже зарегистрированный маршрут срабатывает раньше — переопределяем.
  await page.route(/mock\.supabase\.test\/rest\/v1\/subscriptions/, (route) => route.fulfill({ json: { tier: 'AI_PREMIUM', status: 'active' } }))
  await page.route(/openfoodfacts\.org\/api\/v2\/product\//, (route) => route.fulfill({ json: { status: 1, product: PRODUCT } }))
  const calls = []
  await page.route('**/api/ai/barcode', (route) => {
    calls.push(route.request().postDataJSON())
    return route.fulfill({ json: { check: CHECK, usage: {} } })
  })
  const state = seedState()
  state.prefs = { ...state.prefs, ...(aiPref ? { barcodeAI: true } : {}) }
  await page.addInitScript(([s, key, st, uid]) => {
    if (sessionStorage.getItem('e2e:seeded')) return
    sessionStorage.setItem('e2e:seeded', '1')
    localStorage.setItem(key, JSON.stringify(s))
    localStorage.setItem(`eataps:state:${uid}`, JSON.stringify({ state: st, revision: 1, dirty: false }))
    localStorage.setItem('eataps:lang', 'en')
  }, [session, sessionStorageKey, state, USER_ID])
  await page.goto('/')
  await page.locator('#root > *').first().waitFor()
  return calls
}

async function scan(page, T) {
  await page.getByRole('button', { name: T('day.addFood') }).first().click()
  await page.getByRole('button', { name: T('add.scan') }).first().click()
  // Сканер прочитал код с видео и ушёл к товару.
  await expect(page.getByText('Quark 9% · Milbona').first()).toBeVisible({ timeout: 20_000 })
}

test('ИИ исправляет ошибку базы, видно «было → стало», можно вернуть как было', async ({ page }) => {
  const T = await dict('en')
  const calls = await open(page, { aiPref: true })
  await scan(page, T)

  // Калории, белки, углеводы, жиры и порция с упаковки.
  await expect(page.getByText(/AI corrected 5 values/)).toBeVisible()
  await expect(page.getByText('Per-serving values were entered as per 100 g.')).toBeVisible()
  // Количество по умолчанию было «вся пачка» (200 г): человек его не трогал,
  // поэтому оно стало порцией с упаковки — 30 г. 157 ккал на 100 г → 47.
  const add = (n) => page.getByRole('button', { name: T('add.addKcal', { n }) })
  const grams = page.getByLabel(T('add.portionGrams'))
  await expect(grams).toHaveValue('30')
  await expect(add(47)).toBeVisible()

  // «Вернуть как в базе» — цифры базы и пачка по умолчанию: 200 г × 47 / 100.
  await page.getByRole('button', { name: T('barcodeAI.revert') }).click()
  await expect(grams).toHaveValue('200')
  await expect(add(94)).toBeVisible()
  await page.getByRole('button', { name: T('barcodeAI.reapply') }).click()
  await expect(add(47)).toBeVisible()

  // Своё количество человек не теряет: вписал 150 г — правка его не трогает.
  await page.getByRole('button', { name: T('barcodeAI.revert') }).click()
  await grams.fill('150')
  await page.getByRole('button', { name: T('barcodeAI.reapply') }).click()
  await expect(grams).toHaveValue('150')
  await expect(add(236)).toBeVisible()

  // На сервер ушёл только штрихкод — данные товара сервер берёт из базы сам.
  expect(calls).toHaveLength(1)
  expect(Object.keys(calls[0]).sort()).toEqual(['code', 'lang'])
  expect(calls[0].code).toBe(CODE)
})

test('без включённой настройки ИИ не вызывается', async ({ page }) => {
  const T = await dict('en')
  const calls = await open(page, { aiPref: false })
  await scan(page, T)
  await expect(page.getByRole('button', { name: T('add.addKcal', { n: 94 }) })).toBeVisible()
  await page.waitForTimeout(500)
  expect(calls).toHaveLength(0)
  await expect(page.getByText(/AI corrected/)).toHaveCount(0)
})
