// ─────────────────────────────────────────────────────────────────────────────
// Сторож заголовков безопасности.
//
// Повод завести его конкретный: Permissions-Policy стоял со значением
//   camera=(), microphone=(), geolocation=()
// Пустой список в этом заголовке означает «запрещено ВСЕМ», включая собственный
// origin, — а не «запрещено чужим», как читается на первый взгляд. В результате
// разом не работали три живые функции: сканер штрихкода, голосовые сообщения и
// геолокация «любимого ресторана». Ни сборка, ни тесты этого не видели, потому
// что в рабочей среде заголовка нет вовсе — он появляется только на Vercel.
//
// Поэтому проверка идёт ОТ КОДА: ищем в исходниках обращения к возможностям
// браузера и требуем, чтобы каждая найденная была разрешена в заголовке.
// Добавили новую возможность и забыли про заголовок — тест падает.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))

const headersFor = (source) => {
  const block = vercel.headers.find((h) => h.source === source)
  assert.ok(block, `в vercel.json нет блока заголовков для ${source}`)
  return Object.fromEntries(block.headers.map((h) => [h.key, h.value]))
}
const GLOBAL = headersFor('/(.*)')

// Все исходники фронтенда одной строкой — по ним ищем обращения к возможностям.
function sources(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sources(p, acc)
    else if (/\.jsx?$/.test(f) && !f.includes('.test.')) acc.push(readFileSync(p, 'utf8'))
  }
  return acc
}
const CODE = sources(join(ROOT, 'src')).join('\n')

// Возможность → как она выглядит в коде → как называется в заголовке.
const CAPABILITIES = [
  { feature: 'camera', used: /getUserMedia\(\s*\{[^}]*video\s*:/s.test(CODE) || /video:\s*\{/.test(CODE) },
  { feature: 'microphone', used: /getUserMedia\(\s*\{\s*audio:\s*true/.test(CODE) },
  { feature: 'geolocation', used: /navigator\.geolocation/.test(CODE) },
]

function policyValue(header, feature) {
  const m = new RegExp(`(?:^|,)\\s*${feature}=\\(([^)]*)\\)`).exec(header)
  return m ? m[1].trim() : null
}

test('Permissions-Policy разрешает то, чем приложение реально пользуется', () => {
  const pp = GLOBAL['Permissions-Policy']
  assert.ok(pp, 'Permissions-Policy отсутствует')

  for (const { feature, used } of CAPABILITIES) {
    const value = policyValue(pp, feature)
    assert.notEqual(value, null, `${feature} не упомянут в Permissions-Policy — решение должно быть явным`)
    if (used) {
      assert.ok(
        /\bself\b/.test(value),
        `${feature} используется в коде, но в Permissions-Policy стоит "${feature}=(${value})". ` +
        'Пустой список запрещает возможность и собственному origin — функция не заработает. ' +
        `Нужно ${feature}=(self).`,
      )
    }
  }
})

test('Permissions-Policy закрывает то, чем приложение не пользуется', () => {
  const pp = GLOBAL['Permissions-Policy']
  // Мощные возможности, которых в коде нет: их отсутствие в заголовке — это
  // не «забыли», а открытая дверь. Список намеренно короткий: только то, что
  // даёт доступ к устройству, оплате или подглядыванию за экраном.
  for (const feature of ['payment', 'usb', 'serial', 'bluetooth', 'hid', 'display-capture', 'midi', 'xr-spatial-tracking']) {
    const value = policyValue(pp, feature)
    assert.notEqual(value, null, `${feature} не закрыт в Permissions-Policy`)
    assert.equal(value, '', `${feature} должен быть закрыт: ${feature}=()`)
  }
})

test('камера выключается при закрытии сканера', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'BarcodeScanner.jsx'), 'utf8')
  assert.match(src, /track\.stop\(\)/, 'дорожки камеры не останавливаются')
  assert.match(src, /srcObject = null/,
    'video.srcObject не обнуляется: Safari держит камеру включённой, пока элемент ссылается на поток')
  // Поток, приехавший после размонтирования, обязан быть остановлен — иначе
  // индикатор камеры горит, а остановить её уже некому.
  assert.match(src, /if \(cancelled\) \{[\s\S]{0,200}?track\.stop\(\)/,
    'поток, полученный после отмены эффекта, не останавливается')
})

// ── Content-Security-Policy ──────────────────────────────────────────────────
const CSP = Object.fromEntries(
  (GLOBAL['Content-Security-Policy'] || '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...values] = d.split(/\s+/)
      return [name, values]
    }),
)

test('CSP не содержит unsafe-eval', () => {
  for (const [directive, values] of Object.entries(CSP)) {
    assert.ok(!values.includes("'unsafe-eval'"),
      `'unsafe-eval' в ${directive}: ни Vite, ни React, ни supabase-js его не требуют. ` +
      "Для криптобиблиотек достаточно 'wasm-unsafe-eval'.")
  }
})

test('CSP не разрешает произвольные адреса', () => {
  // Схема целиком ('https:' или 'wss:') в качестве источника означает «любой
  // сайт в интернете». Для connect-src это ещё и канал вывода данных наружу.
  for (const directive of ['connect-src', 'img-src', 'frame-src', 'media-src', 'script-src', 'style-src']) {
    const values = CSP[directive] || []
    for (const bad of ['https:', 'wss:', 'http:', '*']) {
      assert.ok(!values.includes(bad),
        `${directive} содержит "${bad}" — это разрешает любой адрес. Нужен поимённый список.`)
    }
  }
})

test('CSP закрывает основные векторы', () => {
  assert.deepEqual(CSP['object-src'], ["'none'"], "object-src должен быть 'none'")
  assert.deepEqual(CSP['frame-ancestors'], ["'none'"], "frame-ancestors должен быть 'none'")
  assert.deepEqual(CSP['base-uri'], ["'self'"], "base-uri должен быть 'self'")
  assert.deepEqual(CSP['form-action'], ["'self'"], "form-action должен быть 'self' — иначе форму можно отправить на чужой адрес")
  assert.ok(CSP['default-src'], 'нет default-src')
})

test('CSP разрешает то, к чему код реально обращается', () => {
  const connect = (CSP['connect-src'] || []).join(' ')
  assert.match(connect, /supabase/, 'connect-src не пускает к Supabase — приложение не заработает')
  assert.match(connect, /wss:\/\/\*\.supabase/, 'connect-src не пускает к realtime Supabase (wss)')
  if (/openfoodfacts/.test(CODE)) {
    assert.match(connect, /openfoodfacts/, 'код ходит в Open Food Facts, но connect-src это запрещает')
  }
  if (/openfoodfacts/.test(CODE)) {
    assert.match((CSP['img-src'] || []).join(' '), /openfoodfacts/,
      'фотографии продуктов приходят из Open Food Facts, но img-src это запрещает')
  }
})

test('ответы серверных функций не кэшируются', () => {
  const api = headersFor('/api/(.*)')
  assert.match(api['Cache-Control'] || '', /no-store/,
    'ответы /api/* персональные: без no-store их может закэшировать браузер или промежуточный узел')
})
