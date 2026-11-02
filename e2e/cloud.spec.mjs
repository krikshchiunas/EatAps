// Экраны, доступные только с аккаунтом (события, челленджи, друзья, лента,
// подписка), — на всех 7 языках, с облаком-заглушкой (e2e/cloud.mjs).
import { test, expect } from '@playwright/test'
import { LANG_CODES, dict, auditScreen, seedState, NOW, isolateNetwork } from './helpers.mjs'
import { mockCloud, session, sessionStorageKey, USER_ID } from './cloud.mjs'

async function openSignedIn(page, lang) {
  await page.clock.setFixedTime(NOW)
  await isolateNetwork(page)
  await mockCloud(page)
  await page.addInitScript(([s, key, state, l, uid]) => {
    if (sessionStorage.getItem('e2e:seeded')) return
    sessionStorage.setItem('e2e:seeded', '1')
    localStorage.setItem(key, JSON.stringify(s))
    localStorage.setItem('eataps:state:guest', JSON.stringify({ state, revision: 0, dirty: false }))
    localStorage.setItem(`eataps:state:${uid}`, JSON.stringify({ state, revision: 1, dirty: false }))
    localStorage.setItem('eataps:lang', l)
  }, [session, sessionStorageKey, seedState(), lang, USER_ID])
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource|net::ERR|WebSocket|PGRST|406/i.test(t)) return
    errors.push(t)
  })
  await page.goto('/')
  await page.locator('#root > *').first().waitFor()
  await page.waitForTimeout(800)
  return errors
}

const nav = (page, L, key) => page.locator('nav.bottomnav button', { hasText: L(key) }).first().click()
const btn = (page, name) => page.getByRole('button', { name, exact: false }).first()

const SCREENS = [
  ['профиль (вошёл)', async (page, L) => nav(page, L, 'nav.profile')],
  ['события', async (page, L) => { await nav(page, L, 'nav.profile'); await btn(page, L('profile.events')).click() }],
  ['челленджи', async (page, L) => {
    await nav(page, L, 'nav.profile')
    await btn(page, L('profile.events')).click()
    await page.getByRole('button', { name: L('profile.tabChallenges'), exact: true }).first().click()
  }],
  ['друзья (вошёл)', async (page, L) => nav(page, L, 'nav.friends')],
  ['чат', async (page, L) => {
    await nav(page, L, 'nav.friends')
    await page.getByText('Mila', { exact: true }).first().click()
    await page.waitForTimeout(500)
  }],
  ['лента (вошёл)', async (page, L) => nav(page, L, 'nav.feed')],
  ['ИИ (вошёл)', async (page) => page.locator('nav.bottomnav button').nth(1).click()],
  ['аккаунт', async (page, L) => {
    await nav(page, L, 'nav.profile')
    await btn(page, L('settings.title')).click()
    await page.getByRole('button', { name: L('settings.row.account') }).first().click()
  }],
]

for (const lang of LANG_CODES) {
  test.describe(`[${lang}]`, () => {
    for (const [name, go] of SCREENS) {
      test(name, async ({ page }) => {
        const L = await dict(lang)
        const errors = await openSignedIn(page, lang)
        await go(page, L)
        await page.waitForTimeout(400)
        await auditScreen(page, lang, name, errors)
        if (process.env.E2E_SHOTS) await page.screenshot({ path: `test-results/cloud-${lang}-${name}.png` })
      })
    }
  })
}

test('вход действительно состоялся: события видны только вошедшему', async ({ page }) => {
  const L = await dict('en')
  await openSignedIn(page, 'en')
  await nav(page, L, 'nav.profile')
  await expect(btn(page, L('profile.events'))).toBeVisible()
})
