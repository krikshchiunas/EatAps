// Каталог итогового состояния базы — генерируется из исходников.
//
// Зачем генерировать, а не писать руками: справочник, который пишут руками,
// расходится с базой на первой же миграции, и тогда он хуже, чем ничего —
// в него верят. Здесь единственный источник правды тот же, что у setup_all.sql:
// supabase/schema.sql плюс миграции в порядке из build-setup-all.mjs.
//
// Скрипт проходит файлы по порядку, ведя учёт create/drop, и печатает то, что
// останется в базе после полного прогона. Семантику предикатов он не проверяет —
// отвечает только на вопрос «что в итоге есть и с каким условием».
//
// Запуск:  node scripts/sql-catalog.mjs          — переписать supabase/docs/catalog.md
//          node scripts/sql-catalog.mjs --check  — не писать, упасть при расхождении

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SOURCES } from './build-setup-all.mjs'
import { finalPolicies } from './policy-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'supabase', 'docs', 'catalog.md')

// Комментарии убираем везде: в этом проекте объекты подробно цитируются в
// комментариях, и цитата не должна попадать в каталог как объявление.
const strip = (sql) => sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

const short = (p) => p.replace('supabase/', '').replace('migrations/', '')

// ── Сбор ────────────────────────────────────────────────────────────────────
const tables = new Map()     // имя -> { file, cols: [], from }
const columns = new Map()    // таблица -> [{ name, type, file }]
const functions = new Map()  // имя -> { args, returns, lang, security, volatility, file }
const grants = new Map()     // имя функции -> Set ролей
const triggers = new Map()   // имя -> { table, timing, events, fn, file }
const indexes = new Map()    // имя -> { table, def, file }
const realtime = new Set()
const enums = new Map()

for (const rel of SOURCES) {
  const code = strip(readFileSync(join(ROOT, rel), 'utf8'))
  const file = short(rel)

  for (const m of code.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    if (!tables.has(m[1])) tables.set(m[1], { file, body: m[2] })
  }
  for (const m of code.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+([^\n;]+)/gi)) {
    const list = columns.get(m[1]) || []
    if (!list.some((c) => c.name === m[2])) list.push({ name: m[2], type: m[3].trim(), file })
    columns.set(m[1], list)
  }
  for (const m of code.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi)) {
    const t = tables.get(m[1])
    if (t) t.dropped = [...(t.dropped || []), m[2]]
    columns.set(m[1], (columns.get(m[1]) || []).filter((c) => c.name !== m[2]))
  }

  for (const m of code.matchAll(/create\s+type\s+public\.(\w+)\s+as\s+enum\s*\(([\s\S]*?)\)/gi)) {
    enums.set(m[1], m[2].replace(/\s+/g, ' ').trim())
  }

  for (const m of code.matchAll(/drop\s+function\s+if\s+exists\s+(?:public\.)?(\w+)/gi)) {
    functions.delete(m[1]); grants.delete(m[1])
  }
  for (const m of code.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s*language\s+(\w+)([\s\S]{0,200}?)\bas\s+\$/gi)) {
    const tail = m[5] || ''
    functions.set(m[1], {
      args: m[2].replace(/\s+/g, ' ').trim(),
      returns: m[3].replace(/\s+/g, ' ').trim(),
      lang: m[4],
      security: /security\s+definer/i.test(tail) ? 'definer' : 'invoker',
      volatility: (tail.match(/\b(stable|immutable)\b/i) || [])[1]?.toLowerCase() || 'volatile',
      file,
    })
  }
  for (const m of code.matchAll(/revoke\s+all\s+on\s+function\s+(?:public\.)?(\w+)/gi)) grants.set(m[1], new Set())
  for (const m of code.matchAll(/grant\s+execute\s+on\s+function\s+(?:public\.)?(\w+)\s*\([^)]*\)\s*to\s+([\w, ]+)/gi)) {
    const s = grants.get(m[1]) || new Set()
    for (const r of m[2].split(',')) s.add(r.trim())
    grants.set(m[1], s)
  }

  for (const m of code.matchAll(/drop\s+trigger\s+if\s+exists\s+(\w+)/gi)) triggers.delete(m[1])
  for (const m of code.matchAll(
    /create\s+trigger\s+(\w+)\s+(before|after|instead\s+of)\s+([\s\S]*?)\s+on\s+((?:\w+\.)?\w+)[\s\S]*?execute\s+function\s+(?:public\.)?(\w+)/gi)) {
    triggers.set(m[1], {
      timing: m[2].replace(/\s+/g, ' ').toUpperCase(),
      events: m[3].replace(/\s+/g, ' ').trim(),
      table: m[4].replace(/^public\./, ''), fn: m[5], file,
    })
  }

  for (const m of code.matchAll(/drop\s+index\s+if\s+exists\s+(?:public\.)?(\w+)/gi)) indexes.delete(m[1])
  for (const m of code.matchAll(/create\s+(unique\s+)?index\s+if\s+not\s+exists\s+(\w+)\s+on\s+(?:public\.)?(\w+)\s*([\s\S]*?);/gi)) {
    indexes.set(m[2], { unique: !!m[1], table: m[3], def: m[4].replace(/\s+/g, ' ').trim(), file })
  }

  for (const m of code.matchAll(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.(\w+)/gi)) realtime.add(m[1])
}

// Кто зовёт функцию с клиента/сервера — читаем из кода приложения.
const callers = new Map()
for (const dir of ['src', 'api']) {
  const out = []
  ;(function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (/\.(js|jsx)$/.test(e.name) && !e.name.endsWith('.test.js')) out.push(join(d, e.name))
    }
  })(join(ROOT, dir))
  for (const f of out) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/g)) {
      const s = callers.get(m[1]) || new Set()
      s.add(f.slice(ROOT.length + 1)); callers.set(m[1], s)
    }
  }
}
// ── Печать ──────────────────────────────────────────────────────────────────
const L = []
const p = (s = '') => L.push(s)

p('# Каталог базы — итоговое состояние')
p()
p('> **Файл генерируется.** Правки руками затрёт следующий прогон.')
p('> Пересобрать: `node scripts/sql-catalog.mjs`. Источник — те же файлы и')
p('> в том же порядке, что у `supabase/setup_all.sql`.')
p()
p('Здесь то, что **останется в базе после полного прогона**, а не то, что')
p('написано в отдельно взятом файле. Объект, созданный в одной миграции и')
p('переопределённый в другой, показан один раз — в последней редакции.')
p()

p('## Таблицы')
p()
p('| Таблица | Заведена в | Realtime |')
p('|---|---|---|')
for (const [name, t] of [...tables].sort()) {
  p(`| \`${name}\` | ${t.file} | ${realtime.has(name) ? 'да' : '—'} |`)
}
p()
p('Колонки, добавленные позже создания таблицы:')
p()
p('| Таблица | Колонка | Тип | Добавлена в |')
p('|---|---|---|---|')
for (const [t, cols] of [...columns].sort()) {
  for (const c of cols) p(`| \`${t}\` | \`${c.name}\` | ${c.type.replace(/\|/g, '\\|')} | ${c.file} |`)
}
p()
if (enums.size) {
  p('Перечисления:')
  p()
  for (const [n, v] of enums) p(`- \`public.${n}\` — ${v}`)
  p()
}

p('## RLS-политики (итоговые)')
p()
const pols = finalPolicies(strip(readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')))
let cur = null
for (const pol of pols) {
  if (pol.table !== cur) { cur = pol.table; p(); p(`### ${cur}`); p() }
  p(`- **${pol.cmd}** \`"${pol.name}"\``)
  p(`  \`\`\`sql`)
  p(`  ${pol.body}`)
  p(`  \`\`\``)
}
p()
p('Таблицы без единой политики на команду — команда запрещена клиенту целиком;')
p('пишет в них только `service_role` или `SECURITY DEFINER`-функция.')
p()

p('## Функции')
p()
p('| Функция | Аргументы | Возвращает | Security | Кому EXECUTE | Определена в | Зовут |')
p('|---|---|---|---|---|---|---|')
for (const [name, f] of [...functions].sort()) {
  if (f.returns.toLowerCase() === 'trigger') continue
  const g = grants.has(name) ? ([...grants.get(name)].join(', ') || '— (никому)') : 'PUBLIC (по умолчанию)'
  const who = callers.has(name) ? [...callers.get(name)].join('<br>') : '—'
  p(`| \`${name}\` | \`${f.args || ''}\` | ${f.returns.replace(/\|/g, '\\|')} | ${f.security}${f.volatility !== 'volatile' ? ', ' + f.volatility : ''} | ${g} | ${f.file} | ${who} |`)
}
p()

p('## Триггерные функции')
p()
p('| Функция | Определена в |')
p('|---|---|')
for (const [name, f] of [...functions].sort()) {
  if (f.returns.toLowerCase() !== 'trigger') continue
  p(`| \`${name}\` | ${f.file} |`)
}
p()

p('## Триггеры')
p()
p('BEFORE- и AFTER-триггеры одной таблицы Postgres выполняет **в алфавитном')
p('порядке имён**. Порядок в таблицах ниже — тот же, в котором они сработают.')
p()
const byTable = new Map()
for (const [name, t] of triggers) {
  const l = byTable.get(t.table) || []; l.push({ name, ...t }); byTable.set(t.table, l)
}
for (const [table, list] of [...byTable].sort()) {
  p(`### ${table}`)
  p()
  p('| Порядок | Триггер | Когда | Функция | Из |')
  p('|---|---|---|---|---|')
  // Postgres выполняет сначала все BEFORE, затем INSTEAD OF, затем AFTER —
  // и внутри каждой группы в алфавитном порядке имён.
  const rank = (t) => ({ BEFORE: 0, 'INSTEAD OF': 1, AFTER: 2 })[t.timing] ?? 3
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  list.forEach((t, i) => p(`| ${i + 1} | \`${t.name}\` | ${t.timing} ${t.events} | \`${t.fn}\` | ${t.file} |`))
  p()
}

p('## Индексы')
p()
p('| Индекс | Таблица | Определение | Из |')
p('|---|---|---|---|')
for (const [name, i] of [...indexes].sort()) {
  p(`| \`${name}\`${i.unique ? ' (uniq)' : ''} | \`${i.table}\` | \`${i.def.replace(/\|/g, '\\|')}\` | ${i.file} |`)
}
p()

const text = L.join('\n') + '\n'
if (process.argv.includes('--check')) {
  const cur = (() => { try { return readFileSync(OUT, 'utf8') } catch { return null } })()
  if (cur !== text) {
    console.error('supabase/docs/catalog.md разошёлся с исходниками. Пересоберите: node scripts/sql-catalog.mjs')
    process.exit(1)
  }
  console.log('supabase/docs/catalog.md совпадает с источниками ✔')
} else {
  writeFileSync(OUT, text)
  console.log(`supabase/docs/catalog.md пересобран: ${tables.size} таблиц, ${functions.size} функций, ${triggers.size} триггеров, ${pols.length} политик`)
}
