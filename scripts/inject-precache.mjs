// После vite build: вписываем в dist/sw.js список стартовых ассетов ядра
// (entry-скрипт + modulepreload + css из index.html), чтобы service worker
// закэшировал их при install и приложение открывалось офлайн с первого раза.
// Ленивые чанки (AppKit/Web3) сюда НЕ попадают — они онлайновые и кэшируются
// по факту обращения.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const htmlPath = resolve(dist, 'index.html')
let html = readFileSync(htmlPath, 'utf8')

const assets = new Set()
const re = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g
let m
while ((m = re.exec(html))) assets.add(m[1])

// Убираем crossorigin у same-origin модульных скриптов/preload: закэшированный
// service worker'ом crossorigin-модуль может не исполниться офлайн (пустой экран).
const stripped = html.replace(/\s+crossorigin(?:="[^"]*")?/g, '')
if (stripped !== html) {
  html = stripped
  writeFileSync(htmlPath, html)
  console.log('inject-precache: stripped crossorigin from index.html')
}

const swPath = resolve(dist, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
const list = [...assets]
const marker = '/* __BUILD_ASSETS__ */ []'
if (sw.includes(marker)) {
  sw = sw.replace(marker, JSON.stringify(list))
  writeFileSync(swPath, sw)
  console.log(`inject-precache: added ${list.length} core asset(s) to sw.js`)
} else {
  console.warn('inject-precache: marker not found in sw.js — skipped')
}
