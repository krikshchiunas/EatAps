// ─────────────────────────────────────────────────────────────────────────────
// Статические проверки итоговой схемы (supabase/setup_all.sql).
//
// Зачем это в тестах, если есть verify.sql. verify.sql выполняется в базе, то
// есть руками и по желанию — а именно этого и не произошло. Находка №1 аудита
// (две select-политики на app_state, друг читал строку состояния целиком)
// прожила три недели и четырнадцать коммитов, хотя проверка №29 в verify.sql
// ловит её дословно. Инструмент был, привычки его запускать — нет.
//
// Здесь те же инварианты выражены разбором текста схемы, поэтому они
// проверяются на каждом `npm test` и на каждом прогоне CI. Это не замена
// verify.sql (текст SQL не равен состоянию базы), а второй, дешёвый слой:
// такие ошибки видно ещё до деплоя.
//
// Разбор намеренно примитивный — regexp по потоку операторов. Полноценный
// парсер PostgreSQL сюда не втащить, а для инвариантов вида «сколько политик
// осталось живыми» этого достаточно.
// ─────────────────────────────────────────────────────────────────────────────
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORDER } from '../scripts/build-setup-all.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(resolve(root, 'supabase/setup_all.sql'), 'utf8')

// Текст без комментариев: '--' внутри строк в этой схеме не встречается.
const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

// ── Живые политики ───────────────────────────────────────────────────────────
// Проходим по потоку drop/create в порядке следования: политика жива, если её
// создали и после этого не удалили.
function livePolicies() {
  const re = /(drop policy if exists|create policy)\s+"([^"]+)"\s+on\s+(public\.\w+|storage\.objects)/gi
  const alive = new Map() // "table\0name" → true
  let m
  while ((m = re.exec(code))) {
    const key = `${m[3]}\u0000${m[2]}`
    if (m[1].toLowerCase().startsWith('drop')) alive.delete(key)
    else alive.set(key, true)
  }
  return [...alive.keys()].map((k) => {
    const [table, name] = k.split('\u0000')
    return { table, name }
  })
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Последнее совпадение, а не первое. Это принципиально: и функции, и политики
// в схеме переопределяются миграциями, и действует ВСЕГДА последнее
// определение. Разбор, берущий первое, читает состояние трёхнедельной давности
// — то есть ровно ту версию, в которой находки аудита ещё живы.
function lastMatch(re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let last = null
  let m
  while ((m = g.exec(code))) last = m
  return last
}

// Команда политики (select/insert/update/delete) — из последнего её создания.
function commandOf(table, name) {
  const m = lastMatch(new RegExp(
    `create policy\\s+"${escapeRe(name)}"\\s+on\\s+${escapeRe(table)}\\s+for\\s+(\\w+)`, 'gi',
  ))
  return m ? m[1].toLowerCase() : null
}

// Тело политики (выражение внутри using/with check) из её последнего создания.
//
// Границу ищем счётчиком скобок, а не регуляркой: тело бывает и однострочным
// (`using (bucket_id = 'chat-images');`), и на двадцать строк. Нежадный
// `[\s\S]*?` до `\n  );` на однострочном теле «проскакивал» дальше и захватывал
// соседние политики — из-за чего тест сначала обвинил бакеты в том, чего в них
// нет.
function policyBody(table, name, clause = 'using') {
  const m = lastMatch(new RegExp(
    `create policy\\s+"${escapeRe(name)}"\\s+on\\s+${escapeRe(table)}`, 'gi',
  ))
  if (!m) return null
  const head = code.slice(m.index, m.index + 4000)
  const at = head.search(new RegExp(`\\b${clause}\\s*\\(`, 'i'))
  if (at === -1) return null

  let i = head.indexOf('(', at)
  const start = i + 1
  let depth = 0
  for (; i < head.length; i++) {
    if (head[i] === '(') depth++
    else if (head[i] === ')') {
      depth--
      if (depth === 0) return head.slice(start, i)
    }
  }
  return null
}

// Тело SQL-функции из её ПОСЛЕДНЕГО create — именно оно и действует.
// Ищем строго `create … function public.name(`, иначе lastIndexOf цепляется за
// `grant execute on function public.name(...)` ниже по файлу.
function functionBody(name) {
  const m = lastMatch(new RegExp(
    `create (?:or replace )?function\\s+${escapeRe(name)}\\s*\\(`, 'gi',
  ))
  if (!m) return null
  const from = m.index
  const open = code.indexOf('$$', from)
  if (open === -1) return null
  const close = code.indexOf('$$', open + 2)
  return close === -1 ? code.slice(from) : code.slice(from, close + 2)
}

test('setup_all.sql пересобран из актуального списка миграций', () => {
  for (const rel of ORDER) {
    assert.ok(sql.includes(`-- ИСТОЧНИК: ${rel}`), `${rel} не попал в setup_all.sql — запустите node scripts/build-setup-all.mjs`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-01. Главная находка аудита.
//
// Миграция тренеров создала вторую select-политику на app_state под НОВЫМ
// именем, не удалив старую. PostgreSQL объединяет permissive-политики через OR,
// поэтому действующим правилом стало «self ИЛИ друг ИЛИ тренер» — и friend_state()
// вместе с friendView.js перестали быть границей: чужой вес, рост, возраст,
// пол, настроение и заметки дня читались прямым select.
// ─────────────────────────────────────────────────────────────────────────────
test('на app_state ровно одна политика чтения', () => {
  const selects = livePolicies()
    .filter((p) => p.table === 'public.app_state')
    .filter((p) => commandOf(p.table, p.name) === 'select')

  assert.equal(
    selects.length, 1,
    `на app_state должна остаться одна SELECT-политика, найдено ${selects.length}: ` +
    `${selects.map((p) => `"${p.name}"`).join(', ')}. ` +
    'Несколько permissive-политик складываются через OR — вместе они шире каждой из них.',
  )
})

test('политика чтения app_state не открывает состояние друзьям', () => {
  // Друг получает выборку через friend_state(); прямое чтение строки состояния
  // ему не положено — там вес, рост, возраст, пол, настроение и заметки дня.
  const body = policyBody('public.app_state', 'own state select')
  assert.ok(body, 'политика "own state select" не найдена')
  assert.ok(!/friendships/i.test(body), 'в политике не должно быть ветки по friendships')
  assert.ok(!/is_friend_with/i.test(body), 'в политике не должно быть ветки по is_friend_with')
  assert.ok(/coach_links/i.test(body), 'доступ тренера к дневнику клиента должен сохраниться')
  assert.ok(/is_blocked_between/i.test(body), 'блокировка обязана перекрывать доступ тренера')
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-03. В LIKE символ «_» означает «любой один символ». Ввод не
// экранировался, а «_» разрешён в никах — поэтому search_users('___')
// совпадал со всеми никами и превращал поиск в выгрузку базы.
// ─────────────────────────────────────────────────────────────────────────────
test('search_users экранирует спецсимволы LIKE', () => {
  const body = functionBody('public.search_users')
  assert.ok(body, 'функция search_users не найдена')
  assert.ok(/escape\s+'\\'/.test(body), 'у LIKE должен быть объявлен escape-символ')
  assert.ok(/replace\(/.test(body), 'спецсимволы LIKE должны экранироваться заменой')
  assert.ok(body.includes("'\\_'"),
    'подчёркивание обязано экранироваться — иначе search_users(\'___\') матчит все ники')
  assert.ok(body.includes("'\\%'"), 'процент обязан экранироваться')
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-04. Политика follows отдавала таблицу целиком любому авторизованному:
// один запрос выгружал весь социальный граф без учёта блокировок.
// ─────────────────────────────────────────────────────────────────────────────
test('follows не читается целиком любым авторизованным', () => {
  const body = policyBody('public.follows', 'follows select')
  assert.ok(body, 'политика "follows select" не найдена')
  assert.ok(!/auth\.role\(\)\s*=\s*'authenticated'/.test(body),
    'весь граф не должен отдаваться любому вошедшему — только свои строки')
  assert.ok(/auth\.uid\(\)/.test(body), 'политика должна ограничивать выборку своими строками')
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-05. is_banned() существовала с августа, но не вызывалась ни в одной
// политике: забаненный публиковал, комментировал, писал в личку и подписывался.
// ─────────────────────────────────────────────────────────────────────────────
test('бан проверяется на записи, а не только в поддержке', () => {
  for (const [policy, table] of [
    ['posts insert own', 'public.posts'],
    ['post comments insert own', 'public.post_comments'],
    ['messages insert', 'public.messages'],
    ['follows insert own', 'public.follows'],
  ]) {
    const re = new RegExp(`create policy "${policy}" on ${table.replace('.', '\\.')}[\\s\\S]*?with check \\(([\\s\\S]*?)\\n\\s*\\);`, 'gi')
    let last = null
    let m
    while ((m = re.exec(code))) last = m[1]
    assert.ok(last, `политика "${policy}" не найдена`)
    assert.ok(/is_banned/.test(last), `политика "${policy}" должна проверять бан`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DATA-01. Дружба материализуется триггером по follows. При одновременной
// взаимной подписке обе транзакции не видели строку друг друга (READ COMMITTED),
// и дружба не создавалась вовсе — либо создавалась дважды.
// ─────────────────────────────────────────────────────────────────────────────
test('материализация дружбы защищена от гонки', () => {
  const body = functionBody('public.sync_friendship_from_follows')
  assert.ok(body, 'функция sync_friendship_from_follows не найдена')
  assert.ok(/pg_advisory_xact_lock/.test(body),
    'проверка встречной подписки обязана идти под блокировкой на пару')
  assert.ok(/least\(/.test(body) && /greatest\(/.test(body),
    'ключ блокировки должен строиться из пары в фиксированном порядке')
  assert.ok(/create unique index if not exists friendships_pair_key/i.test(code),
    'дубль дружбы должен быть невозможен на уровне индекса')
})

// ─────────────────────────────────────────────────────────────────────────────
// Общие инварианты, на которых держится вся модель доступа.
// ─────────────────────────────────────────────────────────────────────────────
test('у всех SECURITY DEFINER функций закреплён search_path', () => {
  const bad = []
  const re = /create (?:or replace )?function\s+(public\.\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)(\$\$|\$fn\$|\$body\$)/gi
  let m
  while ((m = re.exec(code))) {
    const head = m[3]
    if (/security\s+definer/i.test(head) && !/set\s+search_path/i.test(head)) bad.push(m[1])
  }
  assert.deepEqual([...new Set(bad)], [],
    'SECURITY DEFINER без set search_path — путь к подмене таблиц через схему поиска')
})

test('таблицы с приватными данными не отдают всё любому вошедшему', () => {
  // auth.role() = 'authenticated' в политике SELECT означает «таблица открыта
  // всем». Иногда это осознанно, но каждый такой случай должен быть здесь
  // назван — иначе следующий появится незамеченным, как это было с follows.
  const allowed = new Set()
  const stillOpen = livePolicies()
    .filter((p) => commandOf(p.table, p.name) === 'select')
    .filter((p) => {
      const body = policyBody(p.table, p.name)
      return body && /auth\.role\(\)\s*=\s*'authenticated'/.test(body)
    })
    .map((p) => `${p.table}."${p.name}"`)
    .filter((x) => !allowed.has(x))

  assert.deepEqual(stillOpen, [], 'эти таблицы читаются целиком любым вошедшим')
})

test('у notifications нет INSERT-политики — уведомления пишет только сервер', () => {
  const inserts = livePolicies()
    .filter((p) => p.table === 'public.notifications')
    .filter((p) => commandOf(p.table, p.name) === 'insert')
  assert.deepEqual(inserts, [],
    'клиент не должен уметь создавать уведомления — это защита строится на ОТСУТСТВИИ политики')
})

test('клиент не может писать в friendships напрямую', () => {
  // Дружба даёт право переписки и доступ к дневнику. Строку пишет только
  // триггер по follows; INSERT из клиента был бы выпиской себе доступа.
  const writes = livePolicies()
    .filter((p) => p.table === 'public.friendships')
    .filter((p) => ['insert', 'update', 'delete'].includes(commandOf(p.table, p.name)))
  assert.deepEqual(writes, [], 'у friendships должны остаться только права на чтение')
})
