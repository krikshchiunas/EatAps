// Сборка обязана падать, если пакет языка выпал из офлайн-кэша.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { closure } from './inject-precache.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruProbe = (await import(join(ROOT, 'src/locales/ru.js'))).strings.day.addMeal

function fakeProject(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'precache-'))
  cpSync(join(ROOT, 'src/locales'), join(dir, 'src/locales'), { recursive: true })
  mkdirSync(join(dir, 'dist/.vite'), { recursive: true })
  mkdirSync(join(dir, 'dist/assets'), { recursive: true })
  for (const c of Object.values(manifest)) writeFileSync(join(dir, 'dist', c.file), c.isEntry ? `const s=${JSON.stringify(ruProbe)}` : 'x')
  writeFileSync(join(dir, 'dist/.vite/manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'dist/index.html'), '<script type="module" crossorigin src="/assets/main.js"></script>')
  writeFileSync(join(dir, 'dist/sw.js'), 'const BUILD_ASSETS = /* __BUILD_ASSETS__ */ []')
  return dir
}
const run = (dir) => spawnSync(process.execPath, [join(ROOT, 'scripts/inject-precache.mjs')], { cwd: dir, encoding: 'utf8' })

const full = () => {
  const m = { 'index.html': { file: 'assets/main.js', isEntry: true, imports: ['_shared.js'] }, '_shared.js': { file: 'assets/shared.js' } }
  for (const c of ['en', 'de', 'es', 'pt', 'tr', 'ar']) {
    m[`src/locales/${c}.js`] = { file: `assets/${c}.js`, isDynamicEntry: true, imports: [`_data-${c}.js`, 'index.html'] }
    m[`_data-${c}.js`] = { file: `assets/data-${c}.js` }
  }
  m['src/lib/search/index.js'] = { file: 'assets/search.js', isDynamicEntry: true, imports: ['index.html'] }
  m['src/lib/search/names.js'] = { file: 'assets/names.js', isDynamicEntry: true, imports: ['_data-en.js'] }
  m['src/components/BarcodeScanner.jsx'] = { file: 'assets/scanner.js', isDynamicEntry: true, imports: ['index.html'] }
  return m
}

test('closure: точка входа со всеми статическими импортами, без циклов', () => {
  const m = full()
  const files = closure(m, 'src/locales/de.js')
  assert.ok(files.has('/assets/de.js') && files.has('/assets/data-de.js') && files.has('/assets/main.js') && files.has('/assets/shared.js'))
})

test('все языки на месте — sw.js получает их чанки и общие модули', () => {
  const dir = fakeProject(full())
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  const sw = readFileSync(join(dir, 'dist/sw.js'), 'utf8')
  for (const f of ['main.js', 'ar.js', 'data-ar.js', 'names.js']) assert.ok(sw.includes(`/assets/${f}`), f)
  assert.doesNotMatch(readFileSync(join(dir, 'dist/index.html'), 'utf8'), /crossorigin/)
  rmSync(dir, { recursive: true, force: true })
})

test('пропал пакет языка — сборка падает', () => {
  const m = full()
  delete m['src/locales/tr.js']
  const dir = fakeProject(m)
  const r = run(dir)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /«tr»/)
  rmSync(dir, { recursive: true, force: true })
})

test('пропал индекс поиска или русский в основном бандле — сборка падает', () => {
  const m = full()
  delete m['src/lib/search/names.js']
  let dir = fakeProject(m)
  assert.notEqual(run(dir).status, 0)
  rmSync(dir, { recursive: true, force: true })
  dir = fakeProject(full())
  writeFileSync(join(dir, 'dist/assets/main.js'), 'no russian here')
  assert.notEqual(run(dir).status, 0)
  rmSync(dir, { recursive: true, force: true })
})
