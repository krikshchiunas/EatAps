// Общие помощники E2E: состояние приложения, словари языков, проверки экрана.
import { expect } from '@playwright/test'
import { LANGUAGES } from '../src/locales/registry.js'
import { flatten, isPluralLeaf } from '../src/lib/i18n.js'

export const LANG_CODES = LANGUAGES.filter((l) => l.enabled !== false).map((l) => l.code)
export const dirOf = (code) => LANGUAGES.find((l) => l.code === code)?.dir || 'ltr'
// Фиксированное «сегодня»: даты в шапке и на снимках не зависят от дня запуска.
export const NOW = new Date('2026-03-18T12:00:00+01:00')

const cache = {}
export async function dict(code) {
  if (!cache[code]) cache[code] = flatten((await import(`../src/locales/${code}.js`)).strings)
  const m = cache[code]
  return (key, params = {}) => {
    let v = m.get(key)
    if (v == null) throw new Error(`нет ключа ${key} в ${code}`)
    if (isPluralLeaf(v)) v = v.other
    return String(v).replace(/\{(\w+)\}/g, (s, n) => (params[n] != null ? String(params[n]) : s))
  }
}

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => key(new Date(NOW.getTime() + offset * 86400000))
const meal = (o) => ({ id: `${o.name}-${o.mealId}`, unit: 'г', createdAt: NOW.toISOString(), ...o })

// Дневник «как у живого человека»: старые записи без id каталога (до появления
// id), продукты разных групп, вес, добавки.
export function seedState() {
  const tour = Object.fromEntries(['day-swipe', 'food-swipe', 'food-hold', 'day-repeat', 'day-body', 'day-skip'].map((k) => [k, true]))
  const full = [
    meal({ name: 'Овсяные хлопья сухие', grams: 60, kcal: 220, protein: 7.2, carbs: 37, fat: 4.2, mealId: 'std:breakfast', emoji: '🥣' }),
    meal({ name: 'Молоко 2.5%', grams: 200, unit: 'мл', kcal: 104, protein: 5.8, carbs: 9.6, fat: 5, mealId: 'std:breakfast', emoji: '🥛' }),
    meal({ name: 'Куриная грудка, варёная', grams: 180, kcal: 247, protein: 52, carbs: 0, fat: 3.2, mealId: 'std:lunch', emoji: '🍗' }),
    meal({ name: 'Гречка сухая', grams: 80, kcal: 274, protein: 10, carbs: 50, fat: 2.7, mealId: 'std:lunch', emoji: '🌾' }),
    meal({ name: 'Лосось', grams: 150, kcal: 312, protein: 30, carbs: 0, fat: 20, mealId: 'std:dinner', emoji: '🐟' }),
    meal({ name: 'Творог', grams: 200, kcal: 242, protein: 34, carbs: 6, fat: 10, mealId: 'std:dinner', emoji: '🧀' }),
    meal({ name: 'Банан', grams: 120, kcal: 107, protein: 1.3, carbs: 27, fat: 0.4, mealId: 'std:snack', emoji: '🍌' }),
  ]
  const days = {}
  for (let i = 0; i < 6; i++) days[day(-i)] = { meals: full.map((m) => ({ ...m, id: `${m.id}-${i}` })), weight: 62 + i * 0.2 }
  return {
    profile: { name: 'Lena', sex: 'female', age: 31, height: 168, weight: 62, goal: 'maintain', activity: 'light' },
    prefs: { tourSeen: tour },
    days,
  }
}

// Новый контекст браузера: язык устройства + (по желанию) сохранённое
// состояние и выбранный язык. Время зафиксировано.
export async function openApp(page, { device = 'en-US', lang = null, seed = true, path = '/' } = {}) {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(([state, l]) => {
    if (sessionStorage.getItem('e2e:seeded')) return
    sessionStorage.setItem('e2e:seeded', '1')
    if (state) localStorage.setItem('eataps:state:guest', JSON.stringify({ state, revision: 0, dirty: false }))
    if (l) localStorage.setItem('eataps:lang', l)
  }, [seed ? seedState() : null, lang])
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // Сетевые ошибки облака в тестовом окружении (Supabase не настроен) — не наши.
    if (/Failed to load resource|net::ERR|supabase|ERR_INTERNET_DISCONNECTED/i.test(t)) return
    errors.push(t)
  })
  await page.goto(path)
  await page.locator('#root > *').first().waitFor()
  return errors
}

// Ключи переводов, которые могли бы утечь на экран: «раздел.ключ».
const NAMESPACES = [...new Set([...flatten((await import('../src/locales/ru.js')).strings).keys()].map((k) => k.split('.')[0]))]
const RAW_KEY = new RegExp(`(?:^|[\\s(«"])((?:${NAMESPACES.join('|')})\\.[a-z][a-zA-Z0-9]*(?:\\.[a-zA-Z0-9]+)*)(?=$|[\\s)»".,:])`, 'm')

// Проверка экрана: язык и направление документа, горизонтальное переполнение,
// выход элементов за экран, сырые ключи, кириллица не на русском, ошибки.
export async function auditScreen(page, lang, label, errors = []) {
  // Экран въезжает анимацией — проверяем, когда она закончилась.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity), null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(100)
  const r = await page.evaluate(() => {
    const de = document.documentElement
    const vw = window.innerWidth
    const out = []
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX !== 'visible' || cs.overflow === 'hidden') {
          const pr = p.getBoundingClientRect()
          if (pr.left >= -1 && pr.right <= vw + 1) return true
        }
      }
      return false
    }
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[aria-hidden="true"]')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      const b = el.getBoundingClientRect()
      if (b.width < 2 || b.height < 2) continue
      if ((b.right > vw + 1 || b.left < -1) && !clipped(el)) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(b.left)}…${Math.round(b.right)}] «${(el.innerText || '').slice(0, 40)}»`)
      }
    }
    // Текст кнопок, обрезанный без многоточия: «Speich» вместо «Speichern».
    const cut = []
    for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], label')) {
      if (el.closest('[aria-hidden="true"]')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis' && el.clientWidth > 0) {
        cut.push(`${el.tagName.toLowerCase()} «${(el.innerText || '').slice(0, 40)}» ${el.scrollWidth}>${el.clientWidth}`)
      }
    }
    return {
      lang: de.getAttribute('lang'),
      dir: de.getAttribute('dir'),
      scroll: Math.max(de.scrollWidth, document.body.scrollWidth) - vw,
      offenders: out.slice(0, 10),
      cut: cut.slice(0, 10),
      text: document.body.innerText,
    }
  })
  const where = `${lang} · ${label}`
  expect(r.lang, `${where}: lang`).toBe(lang)
  expect(r.dir, `${where}: dir`).toBe(lang === 'ar' ? 'rtl' : 'ltr')
  expect(r.scroll, `${where}: горизонтальная прокрутка страницы`).toBeLessThanOrEqual(1)
  expect(r.offenders, `${where}: элементы за краем экрана`).toEqual([])
  expect(r.cut, `${where}: обрезанный текст кнопок`).toEqual([])
  const raw = RAW_KEY.exec(r.text)
  expect(raw?.[1] ?? null, `${where}: ключ перевода на экране`).toBeNull()
  if (lang !== 'ru') {
    // Название языка на нём самом («Русский» в списке языков) — не утечка.
    const native = new Set(LANGUAGES.map((l) => l.name))
    const cyr = r.text.split('\n').filter((line) => /[А-Яа-яЁё]/.test(line) && !native.has(line.trim()))
    expect(cyr, `${where}: русский текст на экране`).toEqual([])
  }
  expect(errors, `${where}: ошибки в консоли`).toEqual([])
  return r
}
