// Офлайн: service worker production-сборки кэширует пакеты ВСЕХ языков и
// многоязычный индекс поиска при установке. После одного запуска в сети
// приложение открывается без сети на выбранном языке, переключается на язык,
// который ни разу не загружался, и ищет на всех языках.
import { test, expect } from '@playwright/test'
import { dict, openApp, auditScreen } from './helpers.mjs'

test('офлайн: выбранный язык, переключение на незагруженный язык, поиск', async ({ page, context }) => {
  const errors = await openApp(page, { lang: 'de' })
  // Ждём, пока service worker установится и разложит всё по кэшу.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.active || !navigator.serviceWorker.controller) return false
    const keys = await caches.keys()
    if (!keys.length) return false
    const cache = await caches.open(keys[0])
    const urls = (await cache.keys()).map((r) => new URL(r.url).pathname)
    return ['ar-', 'tr-', 'names-'].every((p) => urls.some((u) => u.startsWith(`/assets/${p}`)))
  }, null, { timeout: 30_000, polling: 500 })

  await context.setOffline(true)
  await page.reload()
  await page.locator('#root > *').first().waitFor()
  const de = await dict('de')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.locator('nav.bottomnav')).toContainText(de('nav.day'))
  await auditScreen(page, 'de', 'офлайн', errors)

  // Арабский ни разу не загружался — но он в кэше с установки.
  await page.locator('nav.bottomnav button', { hasText: de('nav.profile') }).click()
  await page.getByRole('button', { name: de('settings.title') }).first().click()
  await page.getByRole('button', { name: de('lang.title') }).first().click()
  await page.getByRole('option', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

  // Перезапуск без сети — арабский остаётся.
  await page.reload()
  await page.locator('#root > *').first().waitFor()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  const ar = await dict('ar')
  await expect(page.locator('nav.bottomnav')).toContainText(ar('nav.day'))

  // Поиск без сети понимает немецкое название.
  await page.getByRole('button', { name: ar('day.addFood') }).first().click()
  await page.getByLabel(ar('add.searchAria')).first().fill('Haferflocken')
  await expect(page.getByText(/شوفان/).first()).toBeVisible()
  await context.setOffline(false)
})

test('пакет языка недоступен при первом запуске → английский, выбор сохранён', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR'] }))
  await page.route(/\/assets\/tr-[^/]+\.js$/, (route) => route.abort())
  await openApp(page, { seed: false })
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  // Сохранён язык устройства, а не запасной английский: появится сеть —
  // следующий запуск откроется по-турецки (а не по-русски как «старая установка»).
  expect(await page.evaluate(() => localStorage.getItem('eataps:lang'))).toBe('tr')
  await page.unroute(/\/assets\/tr-[^/]+\.js$/)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
})
