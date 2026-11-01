#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Статическая проверка исходников на переводы. Работает по AST (@babel/parser),
// а не по регуляркам: строка в JSX, атрибут, аргумент вызова и комментарий —
// разные узлы, и путать их нельзя.
//
// Ловит:
//   1. Текст внутри JSX с буквами — <span>Сохранить</span>.
//   2. Пользовательские атрибуты строкой — placeholder="…", aria-label="…",
//      title, alt, aria-description и т. п.
//   3. Кириллицу и арабский в строках UI-кода. Русский — исходный язык данных
//      (названия продуктов из базы), поэтому такие места помечаются явно, с
//      причиной, видной на ревью:
//        `// @i18n-data-file`       — модуль-справочник канонических данных;
//        `// @i18n-model-prompt`    — текст для модели ИИ, а не для человека;
//        `// @i18n-fixed-language`  — текст обязан быть на одном языке
//                                     (юридические документы на немецком);
//        `/* @i18n-data */`         — одно выражение с каноническими данными.
//      Коды единиц (г, мл, шт… из src/lib/units.js) — значения, а не подписи,
//      и проходят без пометки. Сообщения разработчику (console.*, log.*) — тоже.
//   4. Строку-литерал с пробелом, отданную в alert/confirm/prompt или в
//      сеттер сообщения (setError, setMsg, toast…): это фраза, а не ключ.
//   5. Ключи t()/hasOwn(): литерал обязан существовать в русском словаре,
//      шаблон `stats.tone.${x}` — иметь существующий префикс-раздел.
//
// Запуск: node scripts/i18n/check-source.mjs [--json]
// Код выхода 1 — если найдено хоть одно нарушение.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { flatten, isPluralLeaf } from '../../src/lib/i18n.js'
import * as ru from '../../src/locales/ru.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')

// Тексты, которые одинаковы во всех языках и переводиться не должны: бренды,
// единицы и символы. Список короткий и осмысленный — не свалка исключений.
export const ALLOWED_TEXT = new Set([
  'EatAps', 'Carrot', 'Carrot 🥕', 'EatAps Pro', 'Pro', 'Plus', 'Max', 'Free',
  'Telegram', 'Google', 'Apple', 'Stripe', 'Open Food Facts', 'USDT', 'TON', 'Solana', 'Ethereum',
  'kcal', 'B', 'P', 'C', 'F', 'AI', 'ID', 'OK', 'PWA', 'iOS', 'Android', 'Safari', 'Chrome',
  'x', '×', '·', '—', '–', '…', '/', '%', '+', '−', '-', '=', '→', '←', '✓', '✕',
])

// Атрибуты, которые видит или слышит человек.
const USER_ATTRS = new Set([
  'placeholder', 'title', 'alt', 'label', 'aria-label', 'aria-description', 'aria-placeholder',
  'aria-roledescription', 'aria-valuetext', 'aria-braillelabel',
])

// Значения атрибутов, которые не являются текстом на языке: образец формата.
const ALLOWED_ATTR = [/^name@[\w.]+$/, /^•+$/, /^[—–-]$/, /^0[.,]?0*$/, /^\d+$/]

const MESSAGE_CALLS = /^(alert|confirm|prompt|toast|showToast|notify|setError|setErr|setMsg|setMessage|setNote|setStatus|setHint|setInfo|setToast|setWarning|announce)$/

const SCRIPT_TEXT = /[Ѐ-ӿ؀-ۿ]/ // кириллица и арабский
const LETTER = /\p{L}/u

// Коды единиц — ключи таблицы подписей в units.js и единицы доз добавок.
const UNIT_CODES = new Set()
{
  const units = readFileSync(join(SRC, 'lib/units.js'), 'utf8')
  for (const m of units.matchAll(/^\s*'([^']+)':\s*'units\./gm)) UNIT_CODES.add(m[1])
}

const RU_KEYS = flatten(ru.strings)
const RU_PREFIXES = new Set()
for (const k of RU_KEYS.keys()) {
  const parts = k.split('.')
  for (let i = 1; i < parts.length; i++) RU_PREFIXES.add(parts.slice(0, i).join('.') + '.')
}

function sourceFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'locales' && e.name !== 'node_modules') sourceFiles(p, out)
    } else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.(js|mjs)$/.test(e.name) && e.name !== 'syncTestKit.js') {
      out.push(p)
    }
  }
  return out
}

function walk(node, fn, parent = null, ancestors = []) {
  if (!node || typeof node.type !== 'string') return
  if (fn(node, parent, ancestors) === 'skip') return
  const next = [...ancestors, node]
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments' || key === 'extra') continue
    const v = node[key]
    if (Array.isArray(v)) for (const c of v) walk(c, fn, node, next)
    else if (v && typeof v.type === 'string') walk(v, fn, node, next)
  }
}

// Текст для человека: есть буквы, и это не только бренды и одиночный значок
// («i» на кнопке «что внутри», «G» у входа через Google).
function isUserText(s) {
  if (!LETTER.test(s) || ALLOWED_TEXT.has(s)) return false
  let rest = s
  for (const brand of ALLOWED_TEXT) if (LETTER.test(brand) && brand.length > 1) rest = rest.split(brand).join(' ')
  const letters = [...rest].filter((c) => LETTER.test(c))
  return letters.length > 1
}

// Сообщение разработчику: console.*, log.*, logger.*.
function isDevCall(callee) {
  if (callee?.type !== 'MemberExpression') return false
  const obj = callee.object
  return obj?.type === 'Identifier' && ['console', 'log', 'logger'].includes(obj.name)
}

const hasDataMark = (node) =>
  (node.leadingComments || []).some((c) => c.value.includes('@i18n-data'))

const calleeName = (callee) => {
  if (!callee) return ''
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name
  return ''
}

const literalText = (node) => {
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked).join('{}')
  return null
}

function checkKey(arg, file, line, out) {
  if (!arg) return
  if (arg.type === 'StringLiteral') {
    const k = arg.value
    if (!RU_KEYS.has(k)) out.push({ file, line, rule: 'unknown-key', text: k })
    return
  }
  if (arg.type === 'TemplateLiteral') {
    const head = arg.quasis[0].value.cooked
    if (!head) return // ключ целиком из переменной — проверяется там, где собран
    if (arg.expressions.length === 0) {
      if (!RU_KEYS.has(head)) out.push({ file, line, rule: 'unknown-key', text: head })
      return
    }
    // `stats.tone.${k}` — префикс обязан быть существующим разделом.
    const prefix = head.endsWith('.') ? head : head.slice(0, head.lastIndexOf('.') + 1)
    if (!prefix || !RU_PREFIXES.has(prefix)) out.push({ file, line, rule: 'unknown-key-prefix', text: head + '${…}' })
    return
  }
  if (arg.type === 'ConditionalExpression') {
    checkKey(arg.consequent, file, line, out)
    checkKey(arg.alternate, file, line, out)
    return
  }
  if (arg.type === 'LogicalExpression') {
    checkKey(arg.left, file, line, out)
    checkKey(arg.right, file, line, out)
  }
  // Остальное (переменная) — ключ из таблицы. Такие таблицы проверяет
  // общий проход по литералам «раздел.ключ» ниже.
}

export function checkFile(file) {
  const code = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  const head = code.slice(0, 4000)
  const dataFile = /\/\/ @i18n-(data-file|model-prompt|fixed-language)\b/.test(head)
  const fixedLanguage = /\/\/ @i18n-fixed-language\b/.test(head)
  const out = []
  let ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'], attachComment: true, errorRecovery: false })
  } catch (e) {
    return [{ file: rel, line: e.loc?.line || 0, rule: 'parse-error', text: e.message }]
  }
  const namespaces = new Set(Object.keys(ru.strings))

  walk(ast.program, (node, parent, ancestors) => {
    const line = node.loc?.start.line || 0
    const marked = ancestors.some(hasDataMark) || hasDataMark(node)

    if (node.type === 'JSXText') {
      const s = node.value.replace(/\s+/g, ' ').trim()
      if (s && !fixedLanguage && !marked && isUserText(s)) out.push({ file: rel, line, rule: 'jsx-text', text: s })
      return
    }

    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && USER_ATTRS.has(node.name.name)) {
      const v = node.value
      const lit = v?.type === 'StringLiteral' ? v.value
        : v?.type === 'JSXExpressionContainer' ? literalText(v.expression) : null
      if (lit != null) {
        const s = lit.trim()
        if (s && !fixedLanguage && isUserText(s) && !ALLOWED_ATTR.some((re) => re.test(s))) {
          out.push({ file: rel, line, rule: 'jsx-attr', text: `${node.name.name}="${s}"` })
        }
      }
      return
    }

    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee)
      if (isDevCall(node.callee)) return 'skip'
      if (name === 't' || name === 'hasOwn') checkKey(node.arguments[0], rel, line, out)
      if (MESSAGE_CALLS.test(name)) {
        const s = literalText(node.arguments[0])
        if (s && /\p{L}\s+\p{L}/u.test(s) && !RU_KEYS.has(s)) out.push({ file: rel, line, rule: 'message-literal', text: `${name}(${JSON.stringify(s.slice(0, 60))})` })
      }
      return
    }

    if ((node.type === 'StringLiteral' || node.type === 'TemplateLiteral') && !dataFile && !marked) {
      // Ключ импорта/экспорта и директивы не трогаем.
      if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration')) return
      const s = literalText(node)
      if (s && SCRIPT_TEXT.test(s) && !UNIT_CODES.has(s) && [...s.replace(/\{\}/g, '')].filter((c) => LETTER.test(c)).length > 1) {
        out.push({ file: rel, line, rule: 'script-literal', text: s.slice(0, 80) })
      }
      // Литерал «раздел.ключ» вне вызова t() — ключ из таблицы: тоже обязан существовать.
      if (node.type === 'StringLiteral') {
        const m = /^([a-z][a-zA-Z0-9]*)\.([a-zA-Z0-9.]+)$/.exec(node.value)
        if (m && namespaces.has(m[1]) && !RU_KEYS.has(node.value) && !RU_PREFIXES.has(node.value + '.')) {
          out.push({ file: rel, line, rule: 'unknown-key', text: node.value })
        }
      }
    }
  })
  return out
}

export function checkAll() {
  return sourceFiles().flatMap(checkFile)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkAll()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(problems, null, 2))
  } else {
    const byRule = {}
    for (const p of problems) (byRule[p.rule] ||= []).push(p)
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`\n${rule} (${list.length})`)
      for (const p of list) console.log(`  ${p.file}:${p.line}  ${p.text}`)
    }
    console.log(problems.length ? `\n✗ ${problems.length} problem(s)` : '✓ source strings OK')
  }
  process.exit(problems.length ? 1 : 0)
}

export { isPluralLeaf }
