// E2E-проверки мультиязычности: все 7 языков на телефоне, планшете и
// десктопе, переполнение по ширине, RTL, офлайн, снимки экранов.
// Запуск — после сборки: npm run build && npm run test:e2e
// (сервер — vite preview, то есть настоящая production-сборка с service worker).
import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 4173)

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Время зафиксировано в тестах (page.clock), часовой пояс — здесь: даты в
    // шапке дня и на снимках не зависят от того, где и когда запущены тесты.
    timezoneId: 'Europe/Berlin',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true }, testIgnore: /visual\.spec/ },
    { name: 'phone-375', use: { viewport: { width: 375, height: 812 }, hasTouch: true }, testMatch: /screens\.spec/ },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, hasTouch: true }, testMatch: /screens\.spec/ },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } }, testMatch: /screens\.spec/ },
    { name: 'visual', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }, testMatch: /visual\.spec/ },
  ],
})
