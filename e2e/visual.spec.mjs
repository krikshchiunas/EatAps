// Снимки ключевых экранов: ломающаяся от правки CSS вёрстка на немецком
// (длинные слова) или арабском (RTL) видна как разница пикселей.
// Время зафиксировано, шрифт — DejaVu Sans (есть и локально, и в CI), чтобы
// снимок не зависел от машины. Обновить эталоны после намеренной правки:
//   npm run build && npm run test:visual:update
import { test, expect } from '@playwright/test'
import { LANG_CODES, dict, openApp } from './helpers.mjs'

const STABLE_CSS = `
  *, *::before, *::after { font-family: 'DejaVu Sans', sans-serif !important; transition: none !important; animation: none !important; caret-color: transparent !important; }
`

async function shoot(page, name) {
  await page.addStyleTag({ content: STABLE_CSS })
  await page.waitForTimeout(300)
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false })
}

const SCREENS = {
  day: async () => {},
  stats: async (page, L) => page.getByRole('button', { name: L('day.stats') }).first().click(),
  search: async (page, L, lang) => {
    await page.getByRole('button', { name: L('day.addFood') }).first().click()
    await page.getByLabel(L('add.searchAria')).first().fill({ ru: 'молоко', en: 'milk', de: 'Milch', es: 'leche', pt: 'leite', tr: 'süt', ar: 'حليب' }[lang])
  },
  settings: async (page, L) => {
    await page.locator('nav.bottomnav button', { hasText: L('nav.profile') }).click()
    await page.getByRole('button', { name: L('settings.title') }).first().click()
  },
  language: async (page, L) => {
    await page.locator('nav.bottomnav button', { hasText: L('nav.profile') }).click()
    await page.getByRole('button', { name: L('settings.title') }).first().click()
    await page.getByRole('button', { name: L('lang.title') }).first().click()
  },
}

const PLAN = [
  ...LANG_CODES.flatMap((lang) => [[lang, 'day'], [lang, 'language']]),
  ...['en', 'de', 'ar'].flatMap((lang) => [[lang, 'stats'], [lang, 'search'], [lang, 'settings']]),
]

for (const [lang, screen] of PLAN) {
  test(`${lang} ${screen}`, async ({ page }) => {
    const L = await dict(lang)
    await openApp(page, { lang })
    await SCREENS[screen](page, L, lang)
    await shoot(page, `${lang}-${screen}`)
  })
}
