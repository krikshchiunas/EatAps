// ─────────────────────────────────────────────────────────────────────────────
// После vite build: вписываем в dist/sw.js список файлов, которые service
// worker кладёт в кэш при установке, — чтобы приложение открывалось офлайн с
// первого раза и на языке человека.
//
// Список строится по манифесту сборки (dist/.vite/manifest.json), а не по
// именам файлов: Rollup выносит общие модули (например, словарь продуктов,
// нужный и пакету языка, и поиску) в отдельные чанки с непредсказуемыми
// именами. Берём каждую точку входа целиком — с её статическими импортами и CSS.
//
// В кэш попадают:
//   • ядро — index.html и всё, что он грузит;
//   • пакет КАЖДОГО языка из src/locales/registry.js. Словарь грузится до
//     первого рендера: без него человек с немецким интерфейсом, открывший
//     обновлённое приложение без сети, увидел бы его по-русски;
//   • многоязычный индекс поиска (src/lib/search/names.js) — поиск офлайн
//     должен понимать «Haferflocken» так же, как в сети.
//
// Сборка ПАДАЕТ, если чего-то из этого нет: язык, тихо выпавший из офлайна,
// заметили бы только люди без сети.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const dist = resolve(root, 'dist')
const manifestPath = resolve(dist, '.vite/manifest.json')

// Дополнительные ленивые точки входа, обязательные офлайн.
export const OFFLINE_ENTRIES = ['src/lib/search/names.js']

const fail = (msg) => {
  console.error(`inject-precache: ✗ ${msg}`)
  process.exit(1)
}

export function closure(manifest, key, out = new Set(), seen = new Set()) {
  if (seen.has(key)) return out
  seen.add(key)
  const chunk = manifest[key]
  if (!chunk) return out
  out.add('/' + chunk.file)
  for (const css of chunk.css || []) out.add('/' + css)
  for (const imp of chunk.imports || []) closure(manifest, imp, out, seen)
  return out
}

async function main() {
  if (!existsSync(manifestPath)) fail('нет dist/.vite/manifest.json — включите build.manifest в vite.config.js')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const { LANGUAGES, SOURCE_LANG } = await import(pathToFileURL(resolve(root, 'src/locales/registry.js')).href)

  const assets = new Set()
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith('index.html'))
  if (!entry) fail('в манифесте нет точки входа index.html')
  closure(manifest, entry, assets)
  const core = assets.size

  // Исходный язык вшит в основной бандл — проверяем, что он там действительно есть.
  const ru = await import(pathToFileURL(resolve(root, `src/locales/${SOURCE_LANG}.js`)).href)
  const probe = ru.strings?.day?.addMeal
  const mainFile = resolve(dist, manifest[entry].file)
  if (!probe || !readFileSync(mainFile, 'utf8').includes(probe)) {
    fail(`исходный язык «${SOURCE_LANG}» не найден в основном бандле ${manifest[entry].file}`)
  }

  const report = []
  for (const l of LANGUAGES.filter((x) => x.enabled !== false && x.code !== SOURCE_LANG)) {
    const key = `src/locales/${l.code}.js`
    if (!manifest[key]) fail(`пакет языка «${l.code}» (${key}) отсутствует в сборке — он не будет работать офлайн`)
    if (!manifest[key].isDynamicEntry) fail(`пакет «${l.code}» не ленивый чанк — проверьте LOADERS в src/lib/i18n.js`)
    const files = closure(manifest, key)
    files.forEach((f) => assets.add(f))
    report.push(`${l.code}:${files.size}`)
  }
  for (const key of OFFLINE_ENTRIES) {
    if (!manifest[key]) fail(`${key} отсутствует в сборке — поиск офлайн не будет многоязычным`)
    closure(manifest, key).forEach((f) => assets.add(f))
  }
  for (const f of assets) if (!existsSync(resolve(dist, f.slice(1)))) fail(`файл ${f} из манифеста не найден в dist`)

  // Убираем crossorigin у same-origin модульных скриптов/preload: закэшированный
  // service worker'ом crossorigin-модуль может не исполниться офлайн (пустой экран).
  const htmlPath = resolve(dist, 'index.html')
  const html = readFileSync(htmlPath, 'utf8')
  const stripped = html.replace(/\s+crossorigin(?:="[^"]*")?/g, '')
  if (stripped !== html) {
    writeFileSync(htmlPath, stripped)
    console.log('inject-precache: stripped crossorigin from index.html')
  }

  const swPath = resolve(dist, 'sw.js')
  let sw = readFileSync(swPath, 'utf8')
  const marker = '/* __BUILD_ASSETS__ */ []'
  if (!sw.includes(marker)) fail('маркер /* __BUILD_ASSETS__ */ не найден в dist/sw.js')
  const list = [...assets].sort()
  sw = sw.replace(marker, JSON.stringify(list))
  writeFileSync(swPath, sw)

  // Манифест нужен только сборке — на сервер ему незачем.
  rmSync(resolve(dist, '.vite'), { recursive: true, force: true })
  console.log(`inject-precache: ${list.length} file(s) precached — core ${core}, languages ${report.join(' ')}, offline entries ${OFFLINE_ENTRIES.length}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
