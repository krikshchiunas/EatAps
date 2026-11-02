// Жизненный цикл языка в настоящем браузере и production-сборке:
// первый запуск, ручной выбор, перезапуск, смена языка устройства, отсутствие
// мелькания чужого языка и направления, доступность выбора языка, RTL,
// поиск в интерфейсе, аварийный экран.
import { test, expect } from '@playwright/test'
import { dict, openApp, auditScreen, NOW } from './helpers.mjs'

const deviceLang = async (page, tag) => {
  await page.addInitScript((d) => {
    Object.defineProperty(navigator, 'languages', { get: () => [d] })
    Object.defineProperty(navigator, 'language', { get: () => d })
  }, tag)
}

// Записывает lang/dir документа и текст в момент ПЕРВОЙ отрисовки приложения.
const recordFirstPaint = (page) => page.addInitScript(() => {
  window.__firstPaint = null
  new MutationObserver((list, obs) => {
    const root = document.getElementById('root')
    if (root && root.firstChild && !window.__firstPaint) {
      window.__firstPaint = { lang: document.documentElement.lang, dir: document.documentElement.dir, text: root.innerText.slice(0, 400) }
      obs.disconnect()
    }
  }).observe(document, { childList: true, subtree: true })
})

for (const [tag, lang] of [['de-DE', 'de'], ['de-CH', 'de'], ['fr-FR', 'en'], ['it-IT', 'en'], ['ar-SA', 'ar'], ['tr-TR', 'tr'], ['pt-BR', 'pt'], ['es-MX', 'es']]) {
  test(`первый запуск на устройстве ${tag} → ${lang}, без мелькания`, async ({ page }) => {
    await deviceLang(page, tag)
    await recordFirstPaint(page)
    await openApp(page, { seed: false })
    const first = await page.evaluate(() => window.__firstPaint)
    expect(first.lang).toBe(lang)
    expect(first.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr')
    if (lang !== 'ru') expect(first.text).not.toMatch(/[А-Яа-яЁё]/)
    expect(await page.evaluate(() => localStorage.getItem('eataps:lang'))).toBe(lang)
  })
}

test('старая установка без выбора языка остаётся русской', async ({ page }) => {
  await deviceLang(page, 'de-DE')
  await openApp(page, { seed: true })
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru')
})

test('выбор языка: сразу весь интерфейс, без перезагрузки, выбор переживает перезапуск и смену языка устройства', async ({ page, context }) => {
  await deviceLang(page, 'de-DE')
  const errors = await openApp(page, { lang: 'de' })
  const de = await dict('de')
  const tr = await dict('tr')
  await page.locator('nav.bottomnav button', { hasText: de('nav.profile') }).click()
  await page.getByRole('button', { name: de('settings.title') }).first().click()
  // Строка языка видна сразу и показывает текущий язык его же названием.
  const langRow = page.getByRole('button', { name: de('lang.title') }).first()
  await expect(langRow).toContainText('Deutsch')
  await langRow.click()
  const list = page.getByRole('listbox', { name: de('lang.title') })
  await expect(list.getByRole('option', { name: /Deutsch/ })).toHaveAttribute('aria-selected', 'true')
  await expect(list.getByRole('option')).toHaveCount(7)
  // Не перезагружаемся: метка в window переживает переключение.
  await page.evaluate(() => { window.__noReload = true })
  await list.getByRole('option', { name: /Türkçe/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
  // Список теперь называется по-турецки — ищем его заново.
  const listTr = page.getByRole('listbox', { name: tr('lang.title') })
  await expect(listTr).toBeVisible() // экран не сброшен
  await expect(listTr.getByRole('option', { name: /Türkçe/ })).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => window.__noReload)).toBe(true)
  await expect(page.locator('nav.bottomnav')).toContainText(tr('nav.profile'))
  expect(await page.evaluate(() => localStorage.getItem('eataps:lang'))).toBe('tr')
  await auditScreen(page, 'tr', 'после переключения', errors)

  // Перезапуск — турецкий.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
  // Устройство переключили на английский — приложение всё равно турецкое.
  const page2 = await context.newPage()
  await deviceLang(page2, 'en-US')
  await page2.goto('/')
  await page2.locator('#root > *').first().waitFor()
  await expect(page2.locator('html')).toHaveAttribute('lang', 'tr')
  await expect(page2.locator('nav.bottomnav')).toContainText(tr('nav.day'))
})

test('выбор языка с клавиатуры: стрелки, Enter, видимый фокус', async ({ page }) => {
  await openApp(page, { lang: 'en' })
  const en = await dict('en')
  await page.locator('nav.bottomnav button', { hasText: en('nav.profile') }).click()
  await page.getByRole('button', { name: en('settings.title') }).first().click()
  await page.getByRole('button', { name: en('lang.title') }).first().click()
  const current = page.getByRole('option', { name: /English/ })
  await current.focus()
  await page.keyboard.press('ArrowDown') // Deutsch
  await expect(page.getByRole('option', { name: /Deutsch/ })).toBeFocused()
  const outline = await page.getByRole('option', { name: /Deutsch/ }).evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: /العربية/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
})

for (const lang of ['en', 'de', 'ar']) {
  test(`старые записи дневника и подписи для экранного диктора — ${lang}`, async ({ page }) => {
    const L = await dict(lang)
    await openApp(page, { lang })
    const text = await page.locator('#root').innerText()
    const shown = { en: 'Rolled oats, dry', de: 'Haferflocken, trocken', ar: null }[lang]
    if (shown) expect(text).toContain(shown)
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
    await expect(page.getByRole('button', { name: L('day.prevDay') })).toBeVisible()
    await expect(page.getByRole('button', { name: L('day.stats') })).toBeVisible()
  })
}

test('арабский: направление стрелок дней и шеврона настроек', async ({ page }) => {
  await openApp(page, { lang: 'ar' })
  const ar = await dict('ar')
  const prev = await page.getByRole('button', { name: ar('day.prevDay') }).boundingBox()
  const next = await page.getByRole('button', { name: ar('day.nextDay') }).boundingBox()
  expect(prev.x, 'вчера — справа в RTL').toBeGreaterThan(next.x)
  await page.locator('nav.bottomnav button', { hasText: ar('nav.profile') }).click()
  await page.getByRole('button', { name: ar('settings.title') }).first().click()
  const chev = page.locator('.set-chev').first()
  expect(await chev.evaluate((el) => getComputedStyle(el).transform)).toMatch(/matrix\(-1/)
})

test('поиск в интерфейсе: опечатка находит продукт и тихо подсказывает', async ({ page }) => {
  await openApp(page, { lang: 'de' })
  const de = await dict('de')
  await page.getByRole('button', { name: de('day.addFood') }).first().click()
  const box = page.getByLabel(de('add.searchAria')).first()
  await box.fill('haferfloken')
  await expect(page.getByText('Haferflocken, trocken').first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Meintest du' })).toBeVisible()
  // Русский запрос при немецком интерфейсе.
  await box.fill('овсянка')
  await expect(page.getByText('Haferbrei', { exact: false }).or(page.getByText('Haferflocken')).first()).toBeVisible()
})

test('аварийный экран на языке устройства, даже если приложение не загрузилось', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await deviceLang(page, 'ar-EG')
  await page.route(/\/assets\/index-.*\.js$/, (route) => route.abort())
  await page.goto('/')
  await expect(page.locator('#eataps-recover')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#eataps-recover')).toHaveText('تحديث التطبيق')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})
