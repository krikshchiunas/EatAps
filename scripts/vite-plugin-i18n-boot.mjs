// ─────────────────────────────────────────────────────────────────────────────
// Vite-плагин: встраивает в index.html всё, что нужно ДО загрузки приложения.
//
//   • реестр языков и функции выбора языка из src/locales/registry.js — как
//     исходный код (Function#toString), а не копией: загрузочный скрипт и
//     приложение выбирают язык одной и той же функцией;
//   • тексты аварийного экрана всех языков из src/locales/<code>/boot.js;
//   • <noscript> на всех языках.
//
// Так новый язык, добавленный в реестр, автоматически попадает и на аварийный
// экран: забыть его там нельзя, а если у языка нет boot.js — сборка падает.
// ─────────────────────────────────────────────────────────────────────────────
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const BOOT_KEYS = ['title', 'text', 'bold', 'tail', 'button', 'hint', 'homeScreen', 'failedLoad', 'startupError', 'timeout', 'noscript']

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export async function buildBootData(root) {
  const reg = await import(pathToFileURL(resolve(root, 'src/locales/registry.js')).href + `?t=${Date.now()}`)
  const langs = reg.LANGUAGES.filter((l) => l.enabled !== false)
  const text = {}
  for (const l of langs) {
    const file = resolve(root, `src/locales/${l.code}/boot.js`)
    if (!existsSync(file)) throw new Error(`i18n-boot: нет src/locales/${l.code}/boot.js — аварийный экран остался бы без языка «${l.code}»`)
    const mod = (await import(pathToFileURL(file).href + `?t=${Date.now()}`)).default
    for (const k of BOOT_KEYS) {
      if (typeof mod[k] !== 'string' || !mod[k].trim()) throw new Error(`i18n-boot: в ${l.code}/boot.js нет строки «${k}»`)
    }
    text[l.code] = mod
  }
  return { reg, langs, text }
}

export function bootScript({ reg, langs, text }) {
  const slim = langs.map((l) => ({ code: l.code, dir: l.dir, matches: l.matches }))
  const strings = {}
  for (const l of langs) strings[l.code] = BOOT_KEYS.slice(0, 10).map((k) => text[l.code][k])
  return [
    `var LANGS = ${JSON.stringify(slim)};`,
    `var TEXT = ${JSON.stringify(strings)};`,
    `var I18N = ${JSON.stringify({ source: reg.SOURCE_LANG, fallback: reg.FALLBACK_LANG, key: reg.LANG_KEY, legacyKeys: reg.LEGACY_INSTALL_KEYS, legacyPrefixes: reg.LEGACY_INSTALL_PREFIXES })};`,
    reg.matchLanguage.toString(),
    reg.readStoredLanguage.toString(),
    reg.detectLanguage.toString(),
    reg.hasLegacyInstall.toString(),
    reg.deviceLanguages.toString(),
  ].join('\n')
}

export function noscriptHtml({ langs, text }) {
  return langs
    .map((l) => `<p lang="${l.code}" dir="${l.dir}" style="margin:0 0 8px">${esc(text[l.code].noscript)}</p>`)
    .join('\n        ')
}

export default function i18nBoot() {
  let root = process.cwd()
  return {
    name: 'eataps-i18n-boot',
    configResolved(cfg) { root = cfg.root },
    async transformIndexHtml(html) {
      const data = await buildBootData(root)
      if (!html.includes('/*__I18N_BOOT__*/') || !html.includes('<!--__I18N_NOSCRIPT__-->')) {
        throw new Error('i18n-boot: в index.html нет маркеров /*__I18N_BOOT__*/ и <!--__I18N_NOSCRIPT__-->')
      }
      return html
        .replace('/*__I18N_BOOT__*/', bootScript(data))
        .replace('<!--__I18N_NOSCRIPT__-->', noscriptHtml(data))
    },
  }
}
