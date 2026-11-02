// Все ключевые экраны на всех 7 языках: каждый открывается из чистой загрузки
// и проверяется auditScreen (язык и направление документа, переполнение,
// выход за край, сырые ключи, чужой язык, ошибки консоли).
// Проект Playwright задаёт размер экрана: 390, 375, 768, 1440.
import { test } from '@playwright/test'
import { LANG_CODES, dict, openApp, auditScreen } from './helpers.mjs'

// Запрос в поиске на языке интерфейса — и заодно на другом языке.
const QUERY = { ru: 'овсян', en: 'oat', de: 'Hafer', es: 'avena', pt: 'aveia', tr: 'yulaf', ar: 'شوفان' }

const nav = (L, key) => async (page) => page.locator('nav.bottomnav button', { hasText: L(key) }).first().click()
const btn = (page, name) => page.getByRole('button', { name, exact: false }).first()

// [название, путь до экрана]. Путь получает page и словарь языка L.
const SCREENS = [
  ['день', async () => {}],
  ['меню дня', async (page, L) => btn(page, L('day.dayActions')).click()],
  ['календарь', async (page, L) => btn(page, L('day.openCalendar')).click()],
  ['статистика', async (page, L) => btn(page, L('day.stats')).click()],
  ['витамины', async (page, L) => {
    await btn(page, L('day.stats')).click()
    await page.getByRole('button', { name: L('stats.micro.sectionMicro'), exact: true }).first().click()
  }],
  ['добавление еды', async (page, L) => btn(page, L('day.addFood')).click()],
  ['поиск продукта', async (page, L, lang) => {
    await btn(page, L('day.addFood')).click()
    await page.getByRole('searchbox').or(page.getByLabel(L('add.searchAria'))).first().fill(QUERY[lang])
    await page.waitForTimeout(300)
  }],
  ['поиск на чужом языке', async (page, L, lang) => {
    await btn(page, L('day.addFood')).click()
    await page.getByLabel(L('add.searchAria')).first().fill(lang === 'de' ? 'oat milk' : 'Haferflocken')
    await page.waitForTimeout(300)
  }],
  ['сканер', async (page, L) => {
    await btn(page, L('day.addFood')).click()
    await page.getByRole('button', { name: L('add.scan') }).first().click()
    await page.waitForTimeout(400)
  }],
  ['добавки', async (page, L) => btn(page, L('supp.add')).click()],
  ['ИИ', async (page) => page.locator('nav.bottomnav button').nth(1).click()],
  ['лента', async (page, L) => nav(L, 'nav.feed')(page)],
  ['друзья', async (page, L) => nav(L, 'nav.friends')(page)],
  ['профиль', async (page, L) => nav(L, 'nav.profile')(page)],
  // Челленджи и события доступны только с облачным аккаунтом (Supabase), которого
  // в тестовом окружении нет; их строки проверяют юнит-тесты словарей.
  ['профиль: питание', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await page.getByRole('button', { name: L('profile.tabDiet'), exact: true }).first().click()
  }],
  ['профиль: обо мне', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await page.getByRole('button', { name: L('profile.tabSelf'), exact: true }).first().click()
  }],
  ['настройки', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await btn(page, L('settings.title')).click()
  }],
  ['выбор языка', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await btn(page, L('settings.title')).click()
    await page.getByRole('button', { name: L('lang.title') }).first().click()
    await page.getByRole('listbox').waitFor()
  }],
  ['уведомления', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await btn(page, L('settings.title')).click()
    await page.getByRole('button', { name: L('settings.row.notifications') }).first().click()
  }],
  ['мои данные', async (page, L) => {
    await nav(L, 'nav.profile')(page)
    await btn(page, L('settings.title')).click()
    await page.getByRole('button', { name: L('settings.row.body') }).first().click()
  }],
]

for (const lang of LANG_CODES) {
  test.describe(`[${lang}]`, () => {
    for (const [name, go] of SCREENS) {
      test(`${name}`, async ({ page }) => {
        const L = await dict(lang)
        const errors = await openApp(page, { lang })
        await go(page, L, lang)
        await page.waitForTimeout(250)
        await auditScreen(page, lang, name, errors)
      })
    }

    test('первый запуск: анкета на языке устройства', async ({ page }) => {
      const device = { ru: 'ru-RU', en: 'en-US', de: 'de-AT', es: 'es-MX', pt: 'pt-BR', tr: 'tr-TR', ar: 'ar-SA' }[lang]
      await page.context().setExtraHTTPHeaders({ 'Accept-Language': device })
      await page.addInitScript((d) => Object.defineProperty(navigator, 'languages', { get: () => [d] }), device)
      const errors = await openApp(page, { seed: false })
      await auditScreen(page, lang, 'анкета', errors)
    })
  })
}
