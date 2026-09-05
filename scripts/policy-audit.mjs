// Итоговый набор RLS-политик после прогона setup_all.sql.
//
// Зачем: политики создаются и удаляются по всему файлу, в девятнадцати
// источниках, и «какая политика в итоге стоит на таблице» глазами не
// определить. А это ровно тот вопрос, от которого зависит приватность.
//
// Скрипт проходит файл по порядку, ведя учёт create/drop policy, и печатает
// то, что останется в базе. Проверка семантики предикатов — не его дело:
// он отвечает только на вопрос «что осталось и с каким условием».
//
// Запуск: node scripts/policy-audit.mjs [таблица]

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function finalPolicies(sql) {
  const alive = new Map() // "table policy" -> { table, name, cmd, body }

  // Комментарии убираем: в них политики цитируются, и цитата не должна
  // считаться объявлением.
  const code = sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

  const dropRe = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+(?:public\.)?(\w+)/gi
  const createRe = /create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?(\w+)([\s\S]*?);\s*\n/gi

  // Проходим по документу в порядке появления обеих конструкций.
  const events = []
  for (const m of code.matchAll(dropRe)) events.push({ at: m.index, kind: 'drop', name: m[1], table: m[2] })
  for (const m of code.matchAll(createRe)) {
    events.push({ at: m.index, kind: 'create', name: m[1], table: m[2], body: m[3] })
  }
  events.sort((a, b) => a.at - b.at)

  for (const e of events) {
    const key = `${e.table} ${e.name}`
    if (e.kind === 'drop') { alive.delete(key); continue }
    const cmd = (e.body.match(/\bfor\s+(select|insert|update|delete|all)\b/i) || [])[1] || 'all'
    alive.set(key, {
      table: e.table,
      name: e.name,
      cmd: cmd.toUpperCase(),
      body: e.body.replace(/\s+/g, ' ').trim(),
    })
  }
  return [...alive.values()].sort((a, b) => (a.table + a.cmd).localeCompare(b.table + b.cmd))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')
  const only = process.argv[2]
  let table = null
  for (const p of finalPolicies(sql)) {
    if (only && p.table !== only) continue
    if (p.table !== table) { table = p.table; console.log(`\n── ${table}`) }
    console.log(`   ${p.cmd.padEnd(6)} "${p.name}"`)
    console.log(`          ${p.body.slice(0, 200)}`)
  }
  console.log()
}
