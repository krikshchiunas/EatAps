// ─────────────────────────────────────────────────────────────────────────────
// Сторож дизайна.
//
// Дизайн в этом проекте «слетал» не потому, что кто-то менял его нарочно, а
// потому, что ломающие правки выглядели безобидно и никто их не ловил:
// опечатка в имени переменной, цвет мимо палитры, новый токен без тёмной
// версии. Эти тесты ловят ровно такие правки — до того, как они доедут до
// экрана.
//
// Здесь НЕ проверяется «красиво или нет». Проверяется только то, что можно
// проверить машиной: все цвета берутся из палитры, палитра полна в обеих
// темах, ни одна переменная не используется в пустоту.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS_PATH = join(SRC, 'index.css')
const css = readFileSync(CSS_PATH, 'utf8')

function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(jsx|js)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p)
    }
  }
  walk(SRC)
  return out
}

// Блок объявлений палитры: от селектора до его закрывающей скобки.
function blockAfter(selector) {
  const start = css.indexOf(selector)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  const end = css.indexOf('\n}', open)
  return css.slice(open, end)
}

const declaredIn = (block) => {
  const set = new Map()
  const re = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm
  let m
  while ((m = re.exec(block))) set.set(m[1], m[2].trim())
  return set
}

const lightVars = declaredIn(blockAfter(':root {'))
const darkVars = declaredIn(blockAfter('[data-theme="dark"]'))

const allDeclared = new Set()
{
  const re = /^\s*(--[a-z0-9-]+)\s*:/gm
  let m
  while ((m = re.exec(css))) allDeclared.add(m[1])
}

const isColorValue = (v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bcolor-mix\(/i.test(v)

test('палитра объявлена и не пуста', () => {
  assert.ok(lightVars.size > 30, `в светлой теме всего ${lightVars.size} переменных`)
  assert.ok(darkVars.size > 20, `в тёмной теме всего ${darkVars.size} переменных`)
})

test('у каждого цвета светлой темы есть тёмная версия', () => {
  const missing = []
  for (const [name, value] of lightVars) {
    if (!isColorValue(value)) continue // радиусы, шрифты, отступы — общие
    if (!darkVars.has(name)) missing.push(name)
  }
  assert.deepEqual(missing, [],
    `эти цвета не переопределены в тёмной теме и останутся светлыми: ${missing.join(', ')}`)
})

test('тёмная тема не вводит переменных, которых нет в светлой', () => {
  const extra = [...darkVars.keys()].filter((n) => !lightVars.has(n))
  assert.deepEqual(extra, [],
    `в светлой теме этих переменных нет, и там они схлопнутся в пустоту: ${extra.join(', ')}`)
})

test('каждая используемая переменная где-то объявлена', () => {
  // Переменные, которые компоненты ставят инлайном (например --i для задержки
  // анимации), объявляются в JSX, а не в палитре — собираем и их.
  const inline = new Set()
  const files = sourceFiles()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    let m
    const re = /['"](--[a-z0-9-]+)['"]\s*:/g
    while ((m = re.exec(text))) inline.add(m[1])
  }

  const unknown = []
  for (const f of [CSS_PATH, ...files]) {
    const text = readFileSync(f, 'utf8')
    let m
    const re = /var\(\s*(--[a-z0-9-]+)\s*(,|\))/g
    while ((m = re.exec(text))) {
      // var(--x, fallback) — с запасным значением опечатка не так страшна.
      if (m[2] === ',') continue
      if (!allDeclared.has(m[1]) && !inline.has(m[1])) {
        unknown.push(`${relative(SRC, f)}: ${m[1]}`)
      }
    }
  }
  assert.deepEqual(unknown, [],
    `эти переменные не объявлены — свойство молча схлопнется: ${unknown.join(', ')}`)
})

test('в компонентах нет цветов мимо палитры', () => {
  // Единственный источник цвета — переменные темы. Захардкоженный #4F8375
  // выглядит правильно в светлой теме и разваливается в тёмной, и именно так
  // дизайн «слетал» раньше.
  const offenders = []
  for (const f of sourceFiles()) {
    const text = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      // Пропускаем SVG-градиенты и данные, где цвет — часть картинки.
      if (/stopColor|xlink|data:image|linearGradient/.test(line)) return
      // Белый поверх СВОЕЙ непрозрачной тёмной подложки читается одинаково в
      // обеих темах — это не «цвет мимо палитры», а часть самой подложки.
      if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(line) && /#fff\b|#ffffff\b/i.test(line)) return
      const m = /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{2})?)?\b/.exec(line)
      if (m && /(color|background|fill|stroke|border|shadow)/i.test(line)) {
        offenders.push(`${relative(SRC, f)}:${i + 1} → ${m[0]}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    `цвет мимо палитры (в тёмной теме сломается): ${offenders.join('; ')}`)
})

test('экран дня не возвращается к пиксельному смещению пейджера', () => {
  // Смещение трека в пикселях верно только для той ширины, при которой его
  // посчитали: поворот экрана или изменение размера окна — и день уезжает
  // вбок. Положение покоя обязано быть процентным.
  const day = readFileSync(join(SRC, 'components', 'DayScreen.jsx'), 'utf8')
  assert.ok(day.includes("translate3d(-100%,0,0)"),
    'положение покоя пейджера должно задаваться процентами, а не пикселями')
  assert.ok(/const REST\b/.test(day), 'константа REST пропала — смещение снова считается вручную')
  assert.ok(!/offsetWidth\s*\|\|\s*window\.innerWidth[\s\S]{0,400}?getBoundingClientRect\(\)\.width/.test(day),
    'ширина вьюпорта должна браться из offsetWidth: getBoundingClientRect ловит масштаб анимации входа')
})

test('фон страницы лежит отдельным фиксированным слоем', () => {
  // background-attachment: fixed на iOS дёргается при инерционной прокрутке,
  // поэтому фон живёт в body::before. Возврат к attachment — регрессия.
  assert.ok(/body::before[\s\S]{0,240}position:\s*fixed/.test(css),
    'фон страницы должен лежать в фиксированном body::before')
  // Комментарии не считаются: в них как раз объясняется, почему так нельзя.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/background-attachment:\s*fixed/.test(cssCode),
    'background-attachment: fixed дёргается на iOS — фон рисуется через body::before')
})

test('приложение не расползается по ширине', () => {
  assert.ok(/\.app\s*\{[\s\S]{0,200}max-width:\s*\d+px/.test(css),
    'у .app должна быть максимальная ширина, иначе на планшете строка растянется на весь экран')
})

test('под навигацией остаётся место — контент не прячется за круги', () => {
  assert.ok(/--nav-space:\s*\d+px/.test(css), 'переменная --nav-space пропала')
  assert.ok(/\.screen[\s\S]{0,300}var\(--nav-space\)/.test(css),
    'нижний отступ экрана должен считаться от --nav-space')
})

test('безопасные зоны учтены сверху и снизу', () => {
  assert.ok(css.includes('env(safe-area-inset-top'), 'нет отступа под «чёлку»')
  assert.ok(css.includes('env(safe-area-inset-bottom'), 'нет отступа под домашнюю полосу')
})

test('поверх цветных подложек пишем токеном, а не белым', () => {
  // Классика «слетевшего дизайна»: color:#fff на var(--primary) выглядит
  // безупречно в светлой теме и становится нечитаемым в тёмной, где primary —
  // светлая мята. Для этого есть --on-primary и --on-danger.
  const offenders = []
  for (const f of sourceFiles()) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!/#fff\b|#ffffff\b|'white'|"white"/i.test(line)) return
      if (!/var\(--(primary|danger|good|warn|accent)\)/.test(line)) return
      offenders.push(`${relative(SRC, f)}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `белый текст поверх цвета темы — в тёмной теме он пропадёт: ${offenders.join(', ')}`)
})

test('у каждого «поверх» есть пара в обеих темах', () => {
  for (const name of ['--on-primary', '--on-danger']) {
    assert.ok(lightVars.has(name), `${name} не объявлен в светлой теме`)
    assert.ok(darkVars.has(name), `${name} не объявлен в тёмной теме`)
    assert.notEqual(lightVars.get(name), darkVars.get(name),
      `${name} одинаков в обеих темах — значит, в одной из них контраст потерян`)
  }
})

test('нижняя панель закреплена и вынесена на отдельный слой', () => {
  // Панель уезжала вместе с контентом на живом телефоне: у кнопок внутри стоит
  // backdrop-filter, и на iOS/Android его пересчёт во время инерционной
  // прокрутки успевал разъехаться с фиксированной позицией. Лечится
  // собственным слоем композитинга. В десктопном Chrome не воспроизводится,
  // поэтому проверяем сам факт наличия правил.
  const block = /\.bottomnav\s*\{([\s\S]*?)\}/.exec(css)
  assert.ok(block, 'блок .bottomnav пропал')
  const rules = block[1]
  assert.match(rules, /position:\s*fixed/, 'панель обязана быть прибита к экрану')
  assert.match(rules, /transform:\s*translateZ\(0\)/, 'без своего слоя панель срывается при скролле')
  assert.match(rules, /backface-visibility:\s*hidden/)
})

test('нижняя панель не лежит внутри листающегося трека дня', () => {
  // Трек пейджера двигается через transform, а transform у предка превращает
  // position: fixed в position: absolute относительно этого предка — панель
  // начала бы ездить вместе с днями. В App она соседка пейджера; если её
  // однажды перенесут внутрь экрана дня, тест это поймёт.
  const app = readFileSync(join(SRC, 'App.jsx'), 'utf8')
  const navLine = app.indexOf('<BottomNav')
  assert.ok(navLine > 0, 'BottomNav пропал из App')
  const dayLine = app.indexOf('<DayScreen')
  assert.ok(dayLine > 0 && navLine > dayLine, 'BottomNav должен рендериться рядом с экранами, а не внутри них')
  assert.ok(!/<DayScreen[\s\S]*?<BottomNav[\s\S]*?<\/DayScreen>/.test(app), 'панель оказалась внутри экрана дня')
})
