// Статическая проверка SQL-файлов проекта.
//
// Настоящего Postgres в окружении нет, поэтому это не замена прогону —
// это ловушка для того класса ошибок, который уже случился в этом проекте:
// разъехавшаяся склейка setup_all.sql, где тело одной функции оказалось
// внутри другой. Такое видно по несведённым $$ и по begin/end, которые не
// сходятся внутри тела функции.
//
// Запуск: node scripts/check-sql.mjs [файлы...]

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const files = process.argv.slice(2)
if (!files.length) {
  for (const d of ['supabase', 'supabase/migrations']) {
    for (const f of readdirSync(d)) if (f.endsWith('.sql')) files.push(join(d, f))
  }
}

let bad = 0

// Убираем строковые литералы и комментарии, чтобы $$ и ключевые слова внутри
// них не считались за код.
function strip(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') { const nl = sql.indexOf('\n', i); i = nl === -1 ? sql.length : nl; continue }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e === -1 ? sql.length : e + 2; continue }
    const ch = sql[i]
    if (ch === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      out += " '' "
      continue
    }
    out += ch
    i++
  }
  return out
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const code = strip(raw)
  const problems = []

  // 1. Долларовые кавычки должны сходиться по тегам.
  const tags = [...code.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/g)].map((m) => m[0])
  const stack = []
  for (const t of tags) {
    if (stack.length && stack[stack.length - 1] === t) stack.pop()
    else stack.push(t)
  }
  if (stack.length) problems.push(`не закрыты долларовые кавычки: ${stack.join(' ')}`)

  // 2. Внутри каждого тела $$...$$ на языке plpgsql begin/end должны сходиться.
  const bodies = [...code.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\1?\$/g)]
  for (const [, , body] of bodies) {
    const w = (re) => (body.match(re) || []).length
    const begins = w(/\bbegin\b/gi) + w(/\bcase\b/gi) + w(/\bloop\b/gi)
    const ends = w(/\bend\b/gi) + w(/\bend\s+if\b/gi) + w(/\bend\s+loop\b/gi)
    // Точную грамматику здесь не воспроизвести; ловим только грубые перекосы.
    if (begins > 0 && ends === 0) problems.push('в теле функции есть begin без end')
  }

  // 3. Ссылки на колонку public_id, удалённую 2026-08-26.
  //
  // Проверяются только файлы ПОСЛЕ этой даты. Ранние миграции ссылаются на
  // неё законно — на момент их написания колонка была, и переписывать историю
  // ради красивого отчёта нельзя. setup_all.sql пропускаем по той же причине:
  // это склейка всей истории, и ранняя версия функции в ней обязана остаться —
  // важно лишь, что последняя её версия колонку не трогает.
  const dated = file.match(/(\d{4}-\d{2}-\d{2})/)
  const afterDrop = dated && dated[1] > '2026-08-26'
  if (afterDrop && /\bnew\.public_id\b|\bold\.public_id\b/i.test(code)) {
    problems.push('обращение к new/old.public_id — колонки нет с 2026-08-26')
  }

  // 4. Функция, возвращающая таблицу, заменённая без предварительного DROP.
  //
  //    Набор OUT-параметров — часть типа функции, и create or replace менять
  //    его не умеет:
  //        42P13: cannot change return type of existing function
  //    Достаточно расхождения в одном имени колонки. Форму функции в уже
  //    работающей базе знать заранее нельзя, поэтому у table-возвращающих
  //    функций drop обязателен. Правило действует только для новых файлов:
  //    ранние миграции уже прогнаны, и переписывать их нельзя.
  if (afterDrop) {
    for (const m of code.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]{0,600}?)\)\s*returns\s+(table|setof)\b/gi)) {
      const name = m[1]
      const dropped = new RegExp(`drop\\s+function\\s+if\\s+exists\\s+public\\.${name}\\s*\\(`, 'i').test(code)
      if (!dropped) {
        problems.push(`${name}() возвращает таблицу и заменяется без drop — при другой форме в базе будет 42P13`)
      }
    }
  }

  // 5. Пустой псевдоним колонки: `as ""`.
  //    Postgres отвечает 42601 zero-length delimited identifier. Ошибка живёт
  //    в самом конце запроса и всплывает только при выполнении.
  if (/\bas\s+""/.test(code)) {
    problems.push('пустой псевдоним колонки (as "") — 42601 zero-length delimited identifier')
  }

  // 6. Триггерная функция, читающая NEW без разбора tg_op, но повешенная на delete.
  //    (проверяем только очевидное: coalesce(new.<поле>, old.<поле>))
  const m = code.match(/coalesce\(\s*new\.[a-z_]+\s*,\s*old\.[a-z_]+/i)
  if (m) problems.push(`coalesce(new.x, old.x) — в DELETE-триггере NEW не назначен: ${m[0]}`)

  if (problems.length) {
    bad++
    console.error(`✖ ${file}`)
    for (const p of problems) console.error(`    ${p}`)
  } else {
    console.log(`✔ ${file}`)
  }
}

if (bad) { console.error(`\n${bad} файл(ов) с замечаниями`); process.exit(1) }
console.log('\nвсе SQL-файлы прошли статическую проверку')
