// ─────────────────────────────────────────────────────────────────────────────
// Сторож SQL.
//
// Настоящего Postgres в тестовом окружении нет, поэтому здесь не проверяется,
// что миграции ВЫПОЛНЯЮТСЯ. Проверяется то, что уже один раз сломалось молча
// и чего никакая сборка не ловит:
//
//   1. supabase/setup_all.sql — файл «поднять базу с нуля» — собирался руками
//      и разъехался: тело sync_friendship_from_follows() оказалось внутри
//      admin_subscriptions_apply(), тело issue_promo() — внутри
//      sync_friendship_from_follows(), а хвост admin_subscriptions_apply()
//      повис голым `insert into ... NEW.user_id` после конца файла. Никакой
//      тест этого не видел, потому что SQL никто не исполнял, а глазами файл
//      на шесть тысяч строк не читают.
//
//   2. Триггерные функции, обращающиеся к new.<поле> в DELETE-триггере, и
//      ссылки на колонки, удалённые прошлыми миграциями. Второе тоже уже
//      случилось: guard_profile_update() продолжал читать new.public_id после
//      того, как колонку удалили, и каждый UPDATE по profiles падал с 42703.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const run = (script, args = []) => {
  try {
    return { ok: true, out: execFileSync('node', [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' }) }
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') }
  }
}

test('setup_all.sql собран из источников и не разошёлся с ними', () => {
  const res = run('build-setup-all.mjs', ['--check'])
  assert.ok(res.ok, `${res.out}\nЗапустите: node scripts/build-setup-all.mjs`)
})

test('SQL-файлы проходят статическую проверку', () => {
  const res = run('check-sql.mjs')
  assert.ok(res.ok, res.out)
})

// Сплошная проверка идемпотентности: каждое создание объекта либо снабжено
// `if not exists`, либо стоит под своим же `drop … if exists`, либо спрятано
// в условный do-блок. Свойство ломается молча и НЕ ловится ни сборкой, ни
// проверкой синтаксиса, ни прогоном на чистой базе — там объектов ещё нет.
// Уже сорвало два обновления прода: 42P13 на list_posts и 42710 на политике
// "profiles select own", оба раза на середине шеститысячестрочного файла.
test('миграции переживают повторный прогон', async () => {
  const { auditIdempotency } = await import(join(ROOT, 'scripts', 'sql-idempotency.mjs'))
  const problems = auditIdempotency()
  const lines = problems.map((p) => `${p.file}: ${p.kind} ${p.what} → ${p.hint}`)
  assert.deepEqual(lines, [], 'повторный прогон setup_all.sql упадёт на этом:\n  ' + lines.join('\n  '))
})

// setup_all.sql обязан выполняться ПОВТОРНО на уже мигрированной базе — на этом
// держится вся инструкция по обновлению. Один класс ошибок ломает это молча:
// набор OUT-параметров — часть типа функции, и `create or replace` сменить его
// не умеет (42P13). Пока функцию создают один раз, проблемы нет; как только
// более поздняя миграция меняет состав колонок, РАННЕЕ создание становится миной,
// которая срабатывает только на повторном прогоне поверх живой базы.
//
// Так и вышло: list_posts получила visibility в 2026-08-25, а версия из
// 2026-08-11 осталась без drop — и весь setup_all.sql вставал на этой строке.
// На чистой базе не воспроизводится вовсе.
test('функции со сменившимся набором колонок создаются защищённо', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build-setup-all.mjs'), 'utf8')
  const list = build.slice(build.indexOf('export const SOURCES'), build.indexOf('const HEADER'))
  const sources = [...list.matchAll(/'(supabase\/[^']+)'/g)].map((m) => m[1])

  const CREATE = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s*language\s/gi
  const DROP = /drop\s+function\s+if\s+exists\s+public\.(\w+)\s*\(/gi
  const DO_BLOCK = /^do \$\$[\s\S]*?^end \$\$;/gim

  const hist = new Map()
  for (const rel of sources) {
    const code = readFileSync(join(ROOT, rel), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    const drops = [...code.matchAll(DROP)].map((m) => ({ at: m.index, name: m[1] }))
    // Создание внутри условного do-блока защищено самим условием: на базе,
    // где условие ложно, старая редакция просто не создаётся.
    const blocks = [...code.matchAll(DO_BLOCK)].map((m) => [m.index, m.index + m[0].length])

    for (const m of code.matchAll(CREATE)) {
      const shape = m[3].replace(/\s+/g, ' ').trim().toLowerCase()
      if (shape === 'trigger') continue
      const args = m[2].replace(/\s+/g, ' ').trim().toLowerCase()
      const guarded =
        drops.some((d) => d.at < m.index && d.name === m[1]) ||
        blocks.some(([a, b]) => m.index > a && m.index < b)
      const key = `${m[1]}(${args})`
      if (!hist.has(key)) hist.set(key, [])
      hist.get(key).push({ file: rel, shape, guarded })
    }
  }

  const offenders = []
  for (const [key, defs] of hist) {
    if (new Set(defs.map((d) => d.shape)).size < 2) continue
    for (const d of defs) if (!d.guarded) offenders.push(`${key} в ${d.file}`)
  }

  assert.deepEqual(offenders, [],
    'набор колонок у этих функций меняется по ходу цепочки, но раннее создание ' +
    'не защищено ни drop function if exists, ни условным do-блоком — ' +
    'повторный прогон setup_all.sql упадёт с 42P13:\n  ' + offenders.join('\n  '))
})

// Каталог — единственный документ, которому можно верить про текущее состояние
// базы. Устаревший каталог хуже отсутствующего: в него верят.
test('docs/catalog.md не разошёлся с миграциями', () => {
  const res = run('sql-catalog.mjs', ['--check'])
  assert.ok(res.ok, `${res.out}\nЗапустите: node scripts/sql-catalog.mjs`)
})

// Файлы в supabase/archive — снимки уже применённых миграций. Их прогон
// сегодня откатывает более поздние исправления (месячный CHECK на ai_usage,
// политику app_state, поддержку AI_PREMIUM). Две страховки: они не участвуют
// в сборке и падают на первой же строке, если их всё-таки вставят в SQL Editor.
test('архивные файлы не участвуют в сборке и защищены предохранителем', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build-setup-all.mjs'), 'utf8')
  assert.ok(!build.includes('supabase/archive/'), 'архивный файл попал в SOURCES')

  const dir = join(ROOT, 'supabase', 'archive')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'))
  assert.ok(files.length > 0, 'архив пуст — тест потерял смысл, удалите его')
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    const stop = sql.indexOf('raise exception')
    assert.ok(stop > -1, `${f}: нет предохранителя raise exception`)
    // Предохранитель обязан стоять ДО первого исполняемого оператора, иначе
    // часть файла успеет примениться прежде, чем он сработает.
    const firstDdl = sql.search(/^\s*(create|alter|drop|insert|update|revoke|grant)\s/im)
    assert.ok(firstDdl === -1 || stop < firstDdl, `${f}: предохранитель стоит после первого оператора`)
  }
})

// Порядок в сборке обязан совпадать с порядком применения миграций: каждая
// рассчитывает на состояние после предыдущих, и перестановка ломает установку
// молча — файл выполнится, но с другим итоговым определением функций.
test('порядок источников в сборке — по дате в имени файла', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'build-setup-all.mjs'), 'utf8')
  const list = src.slice(src.indexOf('export const SOURCES'), src.indexOf('const HEADER'))
  const files = [...list.matchAll(/'(supabase\/[^']+)'/g)].map((m) => m[1])

  // Первая миграция раньше называлась supabase/schema.sql — имя вводило в
  // заблуждение, будто это актуальная схема, хотя добрую половину её содержимого
  // отменяют более поздние файлы. Теперь источник ровно один: migrations/.
  for (const f of files) {
    assert.ok(f.startsWith('supabase/migrations/'), `источник не в migrations/: ${f}`)
  }

  const dated = files.map((f) => {
    const m = f.match(/(\d{4}-\d{2}-\d{2})/)
    assert.ok(m, `в имени миграции нет даты: ${f}`)
    return m[1]
  })
  const sorted = [...dated].sort()
  assert.deepEqual(dated, sorted, 'миграции в сборке идут не по возрастанию даты')
})

// Последняя по времени версия функции — та, что реально будет в базе. Именно
// её и надо проверять на ссылки в удалённые колонки: ранние версии в истории
// законны и переписывать их нельзя.
test('в итоговой версии guard_profile_update нет ссылок на удалённый public_id', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')
  const marker = 'create or replace function public.guard_profile_update()'
  const last = all.lastIndexOf(marker)
  assert.ok(last > -1, 'guard_profile_update не найдена в setup_all.sql')

  const nextFn = all.indexOf('create or replace function', last + marker.length)
  const body = all.slice(last, nextFn === -1 ? undefined : nextFn)
  assert.ok(!/\bnew\.public_id\b|\bold\.public_id\b/.test(body),
    'последняя версия guard_profile_update всё ещё читает public_id — каждый UPDATE по profiles будет падать с 42703')
})

// Дружба обязана считаться по подпискам во ВСЕХ местах, где раньше читалась
// строка friendships: расхождение этих двух определений и было причиной, по
// которой пара могла переписываться, но не видеть дневник друг друга.
test('политика чтения app_state опирается на is_friend_with, а не на строку friendships', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')
  const marker = 'create policy "state select self, friends or coach" on public.app_state'
  const last = all.lastIndexOf(marker)
  assert.ok(last > -1, 'политика чтения app_state не найдена')

  const body = all.slice(last, all.indexOf(';', all.indexOf('coach_links', last)) + 1)
  assert.match(body, /is_friend_with/, 'политика дневника должна спрашивать is_friend_with')
  assert.ok(!/from public\.friendships/.test(body),
    'политика дневника всё ещё читает таблицу friendships — при потерянной гонке доступ разойдётся с правом переписки')
})

// ─────────────────────────────────────────────────────────────────────────────
// Путь вложения обязан принадлежать автору строки, которая на него ссылается.
//
// Повод: предикат чтения вложений сначала проверял только «ты участник
// сообщения». Но image_url задаёт КЛИЕНТ (send_conversation_message принимает
// его параметром), поэтому нападающий отправлял сообщение самому себе, подставив
// чужой путь, — и получал подпись на чужое фото. Та же подделка через удаление
// сообщения позволяла удалить чужой файл: очередь уборки разбирает service_role,
// которому политики хранилища не писаны.
//
// Проверяем итоговые редакции: в базе окажутся именно они.
test('чтение вложений проверяет владельца пути, а не только участие', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')

  for (const [fn, owner] of [
    ['can_read_chat_image', 'm.sender'],
    ['can_read_post_image', 'p.user_id'],
  ]) {
    const marker = `create or replace function public.${fn}(`
    const last = all.lastIndexOf(marker)
    assert.ok(last > -1, `${fn} не найдена`)
    const body = all.slice(last, all.indexOf('$$;', last))

    assert.match(body, /media_path_owner/,
      `${fn} не проверяет владельца пути: достаточно приложить чужой путь к своей ` +
      'строке, чтобы получить подпись на чужой файл')
    assert.ok(body.includes(owner),
      `${fn} не сверяет владельца пути с ${owner}`)
  }
})

test('уборка складывает в очередь только файлы автора строки', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')

  for (const fn of ['queue_post_image_cleanup', 'queue_message_image_cleanup']) {
    const marker = `create or replace function public.${fn}()`
    const last = all.lastIndexOf(marker)
    assert.ok(last > -1, `${fn} не найдена`)
    const body = all.slice(last, all.indexOf('$$;', last))
    assert.match(body, /media_path_owner/,
      `${fn} кладёт в очередь путь без проверки владельца — подделав его, ` +
      'можно добиться удаления чужого файла')
  }
})

// Бакеты вложений обязаны быть закрыты, а у чтения обязан быть предикат.
// Политика без условия — `using (bucket_id = '…')` — и была исходной дырой.
//
// Смотрим ПОСЛЕДНЮЮ редакцию каждой политики: ранние в файле законны (их
// отменяют более поздние drop/create), и запрещать их — значит требовать
// переписывания истории миграций.
test('бакеты вложений закрыты, а у чтения есть предикат', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')

  const lastPublicFlag = all.lastIndexOf("where id in ('chat-images', 'post-images')")
  assert.ok(lastPublicFlag > -1, 'нет перевода бакетов вложений в закрытые')
  const flagBlock = all.slice(all.lastIndexOf('update storage.buckets', lastPublicFlag), lastPublicFlag)
  assert.match(flagBlock, /public\s*=\s*false/, 'бакеты вложений остались публичными')

  // Итоговая политика чтения для каждого бакета — последняя в файле.
  const POLICY = /create policy "([^"]+)" on storage\.objects\s+for select using \(([\s\S]*?)\);/g
  const finalFor = new Map()
  for (const m of all.matchAll(POLICY)) {
    const body = m[2]
    for (const bucket of ['chat-images', 'post-images', 'dm-media']) {
      if (body.includes(`'${bucket}'`)) finalFor.set(bucket, { name: m[1], body })
    }
  }

  for (const [bucket, checker] of [
    ['chat-images', 'can_read_chat_image'],
    ['post-images', 'can_read_post_image'],
    ['dm-media', 'is_conversation_member'],
  ]) {
    const pol = finalFor.get(bucket)
    assert.ok(pol, `нет политики чтения для ${bucket}`)
    assert.ok(pol.body.includes(checker),
      `итоговая политика чтения ${bucket} («${pol.name}») не проверяет ничего, кроме имени бакета — ` +
      'файл отдаётся любому, включая невошедшего')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Смена типа колонки, на которую ссылается политика RLS.
//
// Postgres отказывается это делать: 0A000 «cannot alter type of a column used
// in a policy definition». Коварство в том, что НА ПУСТОЙ БАЗЕ ошибки нет —
// политики к этому моменту ещё не создано, ALTER проходит. Она появляется
// только там, где предыдущие миграции уже применены, то есть ровно на проде.
//
// Так и случилось: 2026-09-09_social_graph_v2 переводила posts.visibility из
// перечисления в text, а политика "posts select" читает эту колонку напрямую —
// и весь setup_all.sql обрывался на этой строке.
//
// Проверяем: перед каждой сменой типа колонки, которую читает политика, эта
// политика должна быть снята.
test('смена типа колонки не упирается в политику, которая её читает', () => {
  const all = readFileSync(join(ROOT, 'supabase', 'setup_all.sql'), 'utf8')

  // Все политики и колонки, которые они упоминают в своём условии.
  const POLICY = /create policy "([^"]+)" on public\.(\w+)([\s\S]*?);\s*\n/g
  const policiesOf = new Map() // table → [{ name, at, body }]
  for (const m of all.matchAll(POLICY)) {
    const [, name, table] = m
    if (!policiesOf.has(table)) policiesOf.set(table, [])
    policiesOf.get(table).push({ name, at: m.index, body: m[3] })
  }

  const ALTER_TYPE = /alter table public\.(\w+)\s+alter column (\w+) type\b/g
  const offenders = []

  for (const m of all.matchAll(ALTER_TYPE)) {
    const [, table, column] = m
    const at = m.index

    // Политики этой таблицы, созданные РАНЬШЕ и читающие эту колонку.
    const blocking = (policiesOf.get(table) || []).filter((p) => (
      p.at < at && new RegExp(`\\b${column}\\b`).test(p.body)
    ))
    if (!blocking.length) continue

    // Для каждой — между её созданием и ALTER должен быть drop.
    for (const p of blocking) {
      const between = all.slice(p.at, at)
      const dropped = new RegExp(
        `drop policy if exists "${p.name}" on public\\.${table}`,
      ).test(between)
      if (!dropped) {
        offenders.push(
          `${table}.${column}: политика "${p.name}" читает колонку и не снята перед сменой типа`,
        )
      }
    }
  }

  assert.deepEqual([...new Set(offenders)], [],
    'Postgres откажет с 0A000 «cannot alter type of a column used in a policy ' +
    'definition». На пустой базе это не воспроизводится — только на той, где ' +
    'политика уже создана, то есть на проде:\n  ' + [...new Set(offenders)].join('\n  '))
})
