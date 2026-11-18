// «Мои продукты» целиком, как их проходит человек: завести свой продукт,
// найти его, положить в рецепт вместо обычного и вернуть обратно.
import { test, expect } from '@playwright/test'
import { dict, openApp } from './helpers.mjs'

const btn = (page, name) => page.getByRole('button', { name, exact: false }).first()

test('свой продукт: завести, привязать к продукту базы, найти в своих', async ({ page }) => {
  const L = await dict('en')
  const errors = await openApp(page, { lang: 'en' })
  await page.locator('nav.bottomnav button', { hasText: L('nav.profile') }).first().click()
  await btn(page, L('products.title')).click()
  await page.getByRole('button', { name: L('products.add') }).first().click()

  await page.getByPlaceholder(L('products.namePh')).fill('Feta Light')
  await page.getByPlaceholder(L('products.brandPh')).fill('Salakis')
  await page.getByLabel(L('products.base')).fill('feta')
  // Продукт базы, разновидностью которого является свой.
  await page.getByRole('button', { name: /Feta/ }).filter({ hasText: '＋' }).first().click()
  await expect(page.getByText(L('products.useBaseValues'))).toBeVisible()
  await page.getByLabel(L('add.kcalField')).fill('180')
  await page.getByLabel(L('add.proteinField')).fill('17')
  await page.getByRole('button', { name: L('products.save'), exact: true }).click()

  const row = page.getByRole('button', { name: /Feta Light · Salakis/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('180 kcal / 100 g')
  expect(errors).toEqual([])
})

test('рецепт: обычная Гауда меняется на свою и обратно, вес остаётся', async ({ page }) => {
  const L = await dict('en')
  const errors = await openApp(page, { lang: 'en' })
  await btn(page, L('day.addFood')).click()
  await page.getByRole('button', { name: /Omelette/ }).first().click()
  await page.getByRole('button', { name: L('add.editRecipe') }).first().click()

  const toMine = page.getByRole('button', { name: L('recipe.swapAria', { from: 'Gouda', to: 'Gouda 45% · Lambert' }) })
  await expect(toMine).toBeVisible()
  await toMine.click()
  await expect(page.getByLabel(L('recipe.weightAria', { name: 'Gouda 45% · Lambert' }))).toHaveValue('40')

  const back = page.getByRole('button', { name: L('recipe.swapAria', { from: 'Gouda 45% · Lambert', to: 'Gouda' }) })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page.getByLabel(L('recipe.weightAria', { name: 'Gouda' }))).toHaveValue('40')
  expect(errors).toEqual([])
})

test('добавление еды: свой продукт находится поиском по продукту базы', async ({ page }) => {
  const L = await dict('en')
  const errors = await openApp(page, { lang: 'en' })
  await btn(page, L('day.addFood')).click()
  await page.getByLabel(L('add.searchAria')).first().fill('gouda')
  // Основная кнопка строки (не звёздочка и не «＋ порция»), и своя — первой.
  const rows = page.getByRole('button', { name: /^🧀 / })
  await expect(rows.first()).toContainText('Gouda 45% · Lambert')
  await expect(rows.nth(1)).toContainText('Gouda')
  await rows.first().click()
  // Порция с упаковки — первой подсказкой, и она же в поле количества.
  await expect(page.getByLabel(L('add.portionGrams'))).toHaveValue('20')
  await expect(page.getByText(L('products.badge'), { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
