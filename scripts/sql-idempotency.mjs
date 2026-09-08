// Проверка идемпотентности миграций.
//
// ЗАЧЕМ. Основной способ обновить базу в этом проекте — прогнать
// supabase/setup_all.sql целиком поверх работающей. Значит, каждая строка
// цепочки обязана переживать повторное выполнение. Это свойство ломается
// молча и НЕ ЛОВИТСЯ ни сборкой, ни статической проверкой синтаксиса, ни
// прогоном на чистой базе — там объектов ещё нет и всё проходит.
//
// Ловится оно только этим: пройти по файлам и убедиться, что каждое создание
// объекта либо снабжено `if not exists`, либо стоит под своим же
// `drop … if exists`, либо спрятано в условный do-блок.
//
// Уже стоило трёх сорванных прогонов на проде, каждый раз посреди
// семитысячестрочного файла:
//   42P13  list_posts — create or replace не меняет набор OUT-колонок;
//   42710  "profiles select own" — create policy без своего drop policy;
//   23514  ai_usage_period_check — CHECK ужесточили, данные не перенесли.
// Последний случай — не про DDL, а про ДАННЫЕ, и первая редакция этого
// скрипта его не ловила: ограничение в исходной таблице записано без имени,
// а Postgres даёт ему своё. См. constraintHistory ниже.
//
// Запуск: node scripts/sql-idempotency.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { SOURCES } from './build-setup-all.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Снять хвостовой `-- …` со строки, не тронув `--` внутри кавычек.
function stripTrailingComment(line) {
  let qt = false
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === "'") { qt = !qt; continue }
    if (!qt && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i)
  }
  return line
}

// Предикат CHECK-ограничения по имени, в порядке появления в цепочке. Нужен,
// чтобы отличить «ограничение заводят впервые» от «ограничение ПОДМЕНЯЮТ на
// живой таблице» — второе проверяется по всем существующим строкам и падает с
// 23514, если данные под новое условие не подходят.
function constraintHistory(root, sources) {
  const hist = new Map()
  for (const rel of sources) {
    const code = readFileSync(join(root, rel), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    const push = (name, pred) => {
      if (!hist.has(name)) hist.set(name, [])
      hist.get(name).push({ file: rel, pred: pred.replace(/\s+/g, ' ').trim().toLowerCase() })
    }

    // Именованные: `add constraint N check (...)` и `constraint N check (...)`.
    for (const m of code.matchAll(/constraint\s+(\w+)\s+check\s*\(([\s\S]*?)\)\s*(?:,|;|\n\s*\))/gi)) {
      push(m[1], m[2])
    }

    // БЕЗЫМЯННЫЕ inline-CHECK в create table. Именно этот случай и пропустила
    // первая редакция проверки: в 2026-08-24 ограничение на период записано как
    //   period text not null check (period ~ '^\d{4}-\d{2}$')
    // — имени нет, но Postgres даёт своё, по схеме <таблица>_<колонка>_check.
    // Под этим же именем его потом подменяет 2026-08-26. Не зная про имя,
    // проверка видела всего одно объявление и считала, что подмены нет.
    for (const t of code.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const table = t[1]
      for (const raw of t[2].split('\n')) {
        // Хвостовой комментарий на строке колонки — не редкость в этом проекте
        // («-- 'YYYY-MM', UTC»), и именно он сначала не дал регулярке сойтись.
        // Снимаем его, но только если `--` не внутри строкового литерала.
        const line = stripTrailingComment(raw)
        const col = line.match(/^\s*(\w+)\s+[^,]*?\bcheck\s*\((.+)\)\s*,?\s*$/i)
        if (col && !/^(primary|unique|constraint|check|foreign)$/i.test(col[1])) {
          push(`${table}_${col[1]}_check`, col[2])
        }
      }
    }
  }
  return hist
}

// Расширение списка допустимых значений (`in ('A','B')` → `in ('A','B','C')`)
// существующие строки сломать не может — такую подмену пропускаем.
function isWidening(oldPred, newPred) {
  const list = (p) => {
    const m = p.match(/^(\w+)\s+in\s*\(([^)]*)\)$/)
    if (!m) return null
    return { col: m[1], vals: new Set(m[2].split(',').map((v) => v.trim())) }
  }
  const a = list(oldPred); const b = list(newPred)
  if (!a || !b || a.col !== b.col) return false
  return [...a.vals].every((v) => b.vals.has(v))
}

// Колонки, которые какая-то миграция УДАЛЯЕТ, и файл, где это происходит.
// Всё, что ссылается на такую колонку РАНЬШЕ, обязано быть под условием: на
// базе, где удаление уже прошло, повторный прогон дойдёт до этой строки и
// упадёт с 42703. У функций на language sql — прямо при создании.
function droppedColumns(root, sources) {
  const out = []
  sources.forEach((rel, i) => {
    const code = readFileSync(join(root, rel), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    for (const m of code.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi)) {
      out.push({ at: i, table: m[1], column: m[2], file: basename(rel) })
    }
  })
  return out
}

export function auditIdempotency(root = ROOT, sources = SOURCES) {
  const problems = []
  const checks = constraintHistory(root, sources)
  const drops = droppedColumns(root, sources)

  for (const rel of sources) {
    // Комментарии убираем: объекты здесь подробно цитируются в комментариях,
    // и цитата не должна считаться объявлением.
    const code = readFileSync(join(root, rel), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    const file = basename(rel)
    const add = (kind, what, hint) => problems.push({ file, kind, what, hint })

    // Создание внутри условного do-блока защищено самим условием.
    const blocks = [...code.matchAll(/^do \$\$[\s\S]*?^end\s*\$\$;/gim)]
      .map((m) => [m.index, m.index + m[0].length])
    const guarded = (i) => blocks.some(([a, b]) => i > a && i < b)

    // Собираем позиции всех `drop … if exists` — создание обязано идти ПОСЛЕ
    // снятия объекта с тем же именем.
    const dropsOf = (re, key = (m) => m[1]) =>
      [...code.matchAll(re)].map((m) => ({ at: m.index, key: key(m) }))
    const dropped = (list, at, key) => list.some((d) => d.at < at && d.key === key)

    const policyDrops = dropsOf(
      /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+(?:public\.|storage\.)?(\w+)/gi,
      (m) => `${m[2]}.${m[1]}`)
    for (const m of code.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.|storage\.)?(\w+)/gi)) {
      const key = `${m[2]}.${m[1]}`
      if (!dropped(policyDrops, m.index, key)) {
        add('policy', `"${m[1]}" on ${m[2]}`, 'добавьте drop policy if exists с ТЕМ ЖЕ именем выше (иначе 42710)')
      }
    }

    const triggerDrops = dropsOf(/drop\s+trigger\s+if\s+exists\s+(\w+)/gi)
    for (const m of code.matchAll(/create\s+trigger\s+(\w+)/gi)) {
      if (!dropped(triggerDrops, m.index, m[1])) {
        add('trigger', m[1], 'добавьте drop trigger if exists выше (иначе 42710)')
      }
    }

    const constraintDrops = dropsOf(/drop\s+constraint\s+if\s+exists\s+(\w+)/gi)
    for (const m of code.matchAll(/add\s+constraint\s+(\w+)/gi)) {
      if (!dropped(constraintDrops, m.index, m[1])) {
        add('constraint', m[1], 'добавьте drop constraint if exists выше (иначе 42710)')
      }
    }

    // Подмена CHECK-ограничения на таблице, где уже есть данные. Postgres
    // проверяет новое условие по ВСЕМ строкам: если хоть одна не подходит,
    // весь прогон падает с 23514 посреди файла. Значит, миграция обязана
    // сначала привести данные к новому условию — иначе она работает только на
    // пустой базе. Так и было с ai_usage: формат периода сменили с месячного
    // на дневной, а строки старого формата остались лежать.
    for (const m of code.matchAll(/add\s+constraint\s+(\w+)\s+check/gi)) {
      if (guarded(m.index)) continue
      const defs = checks.get(m[1]) || []
      if (defs.length < 2) continue                       // заводится впервые — данных под ним ещё нет
      const here = defs.findIndex((d) => basename(d.file) === file)
      if (here <= 0) continue
      const prev = defs[here - 1]
      if (prev.pred === defs[here].pred) continue          // предикат не менялся
      if (isWidening(prev.pred, defs[here].pred)) continue // список значений только расширили

      // Таблица, на которой стоит ограничение, — из того же alter table.
      const before = code.slice(0, m.index)
      const t = [...before.matchAll(/alter\s+table\s+(?:public\.)?(\w+)/gi)].pop()
      const table = t ? t[1] : null
      const touchesData = table && new RegExp(
        `(update\\s+public\\.${table}\\b|delete\\s+from\\s+public\\.${table}\\b|insert\\s+into\\s+public\\.${table}\\b)`, 'i'
      ).test(before)
      if (!touchesData) {
        add('check constraint', `${m[1]} на ${table || '?'}`,
          'условие ужесточается на таблице с данными, но строки к нему не приводятся — ' +
          'добавьте перенос/чистку данных ВЫШЕ add constraint (иначе 23514)')
      }
    }

    const viewDrops = dropsOf(/drop\s+view\s+if\s+exists\s+(?:public\.)?(\w+)/gi)
    for (const m of code.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(\w+)/gi)) {
      if (!dropped(viewDrops, m.index, m[1])) {
        add('view', m[1], 'добавьте drop view if exists выше: замена view требует того же набора колонок')
      }
    }

    // Функции с набором OUT-параметров: если состав колонок меняется по ходу
    // цепочки, drop обязан стоять перед КАЖДЫМ созданием, включая первое.
    // Эта часть считается по всей цепочке сразу, ниже.

    const bare = [
      ['table',      /create\s+table\s+(?!if\s+not\s+exists)(\S+)/gi,                        'create table if not exists'],
      ['index',      /create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists|concurrently)(\S+)/gi, 'create index if not exists'],
      ['sequence',   /create\s+sequence\s+(?!if\s+not\s+exists)(\S+)/gi,                     'create sequence if not exists'],
      ['type',       /create\s+type\s+(\S+)/gi,                                              'оберните в do-блок с проверкой pg_type'],
      ['add column', /add\s+column\s+(?!if\s+not\s+exists)(\w+)/gi,                          'add column if not exists'],
    ]
    for (const [kind, re, hint] of bare) {
      for (const m of code.matchAll(re)) {
        if (guarded(m.index)) continue
        add(kind, m[1], hint)
      }
    }

    // Ссылки на колонку, которую удаляет более поздняя миграция.
    //
    // Тело language sql проверяется при СОЗДАНИИ — там ссылка на исчезнувшую
    // колонку валит прогон сразу. Тело plpgsql компилируется без разрешения
    // имён, поэтому оно безопасно на этапе создания; опасно оно в другом
    // месте — если это триггерная функция и она обращается к new.<колонке>,
    // то падает КАЖДАЯ запись в таблицу, и уже на живой базе. Ровно так
    // guard_profile_update ронял всякий update по profiles (pitfalls §8).
    const plpgsql = [...code.matchAll(
      /create\s+(?:or\s+replace\s+)?function[\s\S]*?language\s+plpgsql[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1/gi)]
      .map((m) => [m.index, m.index + m[0].length])
    const inPlpgsql = (i) => plpgsql.some(([a, b]) => i > a && i < b)

    for (const d of drops) {
      if (d.at <= sources.indexOf(rel)) continue
      const re = new RegExp(`\\b${d.column}\\b`, 'gi')
      const seen = new Set()
      for (const m of code.matchAll(re)) {
        if (guarded(m.index)) continue
        const line = code.slice(code.lastIndexOf('\n', m.index) + 1, code.indexOf('\n', m.index))
        // Объявление колонки в create table и её же удаление — законны:
        // на мигрированной базе `create table if not exists` ничего не делает.
        if (/create\s+table|drop\s+column|drop\s+constraint/i.test(line)) continue
        if (/^\s*\w+\s+(text|uuid|int|integer|bigint|boolean|timestamptz|jsonb|date)\b/i.test(line)) continue
        // Имя политики — просто строка, к колонке отношения не имеет.
        if (new RegExp(`"[^"]*${d.column}[^"]*"`, 'i').test(line)) continue

        const runtime = new RegExp(`\\b(new|old)\\.${d.column}\\b`, 'i').test(line)
        if (inPlpgsql(m.index) && !runtime) continue

        const key = runtime ? 'runtime' : 'create'
        if (seen.has(key)) continue
        seen.add(key)
        add('dropped column', `${d.column} (удаляется в ${d.file})`, runtime
          ? 'триггерная функция читает new/old.<колонку>: тело plpgsql компилируется, но падает при КАЖДОЙ записи (42703). Уберите ссылку или создавайте функцию под условием'
          : 'оберните в условный do-блок с проверкой information_schema.columns (иначе 42703 при создании)')
      }
    }

    for (const m of code.matchAll(/insert\s+into\s+storage\.buckets[\s\S]{0,400}?;/gi)) {
      if (!/on\s+conflict/i.test(m[0])) {
        add('bucket', 'insert into storage.buckets', 'добавьте on conflict (id) do nothing')
      }
    }
  }

  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = auditIdempotency()
  if (!problems.length) {
    console.log(`идемпотентность: нарушений нет (${SOURCES.length} файлов) ✔`)
    process.exit(0)
  }
  console.error(`НАРУШЕНИЙ ИДЕМПОТЕНТНОСТИ: ${problems.length}`)
  console.error('Повторный прогон setup_all.sql на живой базе упадёт на первом же из них.\n')
  let cur = null
  for (const p of problems) {
    if (p.file !== cur) { cur = p.file; console.error(`── ${cur}`) }
    console.error(`   ${p.kind.padEnd(12)} ${p.what}`)
    console.error(`   ${' '.repeat(12)} → ${p.hint}`)
  }
  process.exit(1)
}
