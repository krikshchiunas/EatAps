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
import { readFileSync } from 'node:fs'
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

// Порядок в сборке обязан совпадать с порядком применения миграций: каждая
// рассчитывает на состояние после предыдущих, и перестановка ломает установку
// молча — файл выполнится, но с другим итоговым определением функций.
test('порядок источников в сборке — по дате в имени файла', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'build-setup-all.mjs'), 'utf8')
  const list = src.slice(src.indexOf('export const SOURCES'), src.indexOf('const HEADER'))
  const files = [...list.matchAll(/'(supabase\/[^']+)'/g)].map((m) => m[1])

  assert.equal(files[0], 'supabase/schema.sql', 'схема обязана идти первой')

  const dated = files.slice(1).map((f) => {
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
