// Публичный ID: главное свойство — его нельзя перебрать.
//
// Раньше коды выдавались подряд (AA000001, AA000002…), и перебор от первого
// находил всех зарегистрированных пользователей. Тесты ниже держат ровно это:
// старый формат больше не считается идентификатором, пространство значений
// велико, а описание формата в базе и на клиенте не разъезжается.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH, PUBLIC_ID_RE,
  normalizePublicId, isPublicId, formatPublicId,
} from './publicId.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const VALID = '7K4M9XPQ2RTV'

// ── Перебор ──────────────────────────────────────────────────────────────────

test('последовательные ID старого формата больше не являются публичным ID', () => {
  // Ровно тот перебор, которым можно было получить список всех пользователей.
  for (let n = 1; n <= 50; n++) {
    const legacy = 'AA' + String(n).padStart(6, '0')
    assert.equal(isPublicId(legacy), false, `принят перечислимый ID: ${legacy}`)
    assert.equal(normalizePublicId(legacy), null)
  }
  for (const legacy of ['AA000001', 'AB000042', 'ZZ999999', 'aa000001']) {
    assert.equal(isPublicId(legacy), false, `принят перечислимый ID: ${legacy}`)
  }
})

test('пространство значений слишком велико для перебора', () => {
  assert.equal(PUBLIC_ID_ALPHABET.length, 32, 'алфавит из 32 символов')
  assert.equal(PUBLIC_ID_LENGTH, 12)
  assert.equal(new Set(PUBLIC_ID_ALPHABET).size, 32, 'символы в алфавите не повторяются')

  // 32^12 = 2^60. Меньше брать нельзя: при 2^32 перебор становится реальным.
  const keyspace = Math.log2(PUBLIC_ID_ALPHABET.length) * PUBLIC_ID_LENGTH
  assert.equal(keyspace, 60)
  assert.ok(keyspace >= 60, 'не сокращайте длину или алфавит без пересчёта рисков')
})

test('соседние по счётчику значения не дают соседних ID', () => {
  // Формат не выводится из порядкового номера: у валидного кода нет «следующего»,
  // который получался бы прибавлением единицы к числовой части, — числовой части
  // просто нет.
  assert.equal(isPublicId('000000000001'), true, 'цифры сами по себе допустимы')
  assert.equal(isPublicId('000000000002'), true)
  // …но выдаются они случайно, поэтому знание одного кода ничего не говорит о
  // другом. Здесь мы фиксируем лишь то, что генератор в базе не последователен —
  // см. проверку отсутствия nextval ниже.
  assert.equal(PUBLIC_ID_RE.source, '^[0-9A-HJKMNP-TV-Z]{12}$')
})

// ── Нормализация ввода ───────────────────────────────────────────────────────

test('разделители, пробелы и регистр не мешают найти друга', () => {
  for (const variant of [VALID, '7k4m9xpq2rtv', '7K4M-9XPQ-2RTV', '7k4m 9xpq 2rtv', ' 7K4M-9XPQ-2RTV ']) {
    assert.equal(normalizePublicId(variant), VALID, `не разобран: ${variant}`)
  }
})

test('неоднозначные буквы сворачиваются, как их пишут от руки', () => {
  assert.equal(normalizePublicId('0K4M9XPQ2RTV'), '0K4M9XPQ2RTV')
  assert.equal(normalizePublicId('OK4M9XPQ2RTV'), '0K4M9XPQ2RTV', 'O читается как ноль')
  assert.equal(normalizePublicId('oK4M9XPQ2RTV'), '0K4M9XPQ2RTV')
  assert.equal(normalizePublicId('IK4M9XPQ2RTV'), '1K4M9XPQ2RTV', 'I читается как единица')
  assert.equal(normalizePublicId('lK4M9XPQ2RTV'), '1K4M9XPQ2RTV', 'строчная L — тоже единица')
})

test('U в алфавит не входит и отклоняется, а не угадывается', () => {
  assert.equal(normalizePublicId('7K4U9XPQ2RTV'), null)
})

test('мусор не роняет разбор и не проходит за ID', () => {
  for (const bad of [null, undefined, '', 0, 42, {}, [], 'не адрес', '7K4M9XPQ2RT', '7K4M9XPQ2RTVX', '@@@@@@@@@@@@']) {
    assert.equal(normalizePublicId(bad), null, `пропущено: ${String(bad)}`)
    assert.equal(isPublicId(bad), false)
  }
})

test('UUID не принимается за публичный ID', () => {
  // Важно для sendFriendRequest: там сначала пробуется публичный ID, и UUID
  // обязан провалиться в свою ветку, а не быть искалеченным нормализацией.
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
  assert.equal(normalizePublicId(uuid), null)
  assert.equal(isPublicId(uuid), false)
})

// ── Показ ────────────────────────────────────────────────────────────────────

test('на экране ID сгруппирован, но в базу уходит канонический вид', () => {
  assert.equal(formatPublicId(VALID), '7K4M-9XPQ-2RTV')
  assert.equal(normalizePublicId(formatPublicId(VALID)), VALID, 'показ и разбор обратимы')
  assert.equal(formatPublicId('7k4m9xpq2rtv'), '7K4M-9XPQ-2RTV')
  // Нераспознанное не форматируем молча — показываем как есть.
  assert.equal(formatPublicId('AA000001'), 'AA000001')
  assert.equal(formatPublicId(null), '')
})

// ── База и клиент описывают один и тот же формат ─────────────────────────────
// Если они разойдутся, клиент будет отправлять коды, которых база не выдаёт, —
// и «добавить друга» перестанет работать без единой ошибки в логах.

test('schema.sql и миграция описывают тот же формат, что и клиент', () => {
  const migration = read('supabase/migrations/2026-08-09_unpredictable_public_id.sql')
  const schema = read('supabase/schema.sql')

  for (const [name, sql] of [['миграция', migration], ['schema.sql', schema]]) {
    assert.ok(sql.includes(PUBLIC_ID_ALPHABET), `${name}: алфавит разошёлся с publicId.js`)
    assert.ok(sql.includes(PUBLIC_ID_RE.source), `${name}: регулярное выражение разошлось с publicId.js`)
    assert.ok(sql.includes('for i in 1..12 loop'), `${name}: длина кода разошлась с PUBLIC_ID_LENGTH`)
    assert.ok(sql.includes('gen_random_uuid()'), `${name}: генератор должен брать случайность из ядра`)
  }
})

test('в базе не осталось последовательного генератора', () => {
  const schema = read('supabase/schema.sql')
  const migration = read('supabase/migrations/2026-08-09_unpredictable_public_id.sql')

  assert.ok(!schema.includes('nextval'), 'schema.sql снова выдаёт ID по счётчику')
  assert.ok(!/create sequence[^;]*public_id_seq/.test(schema), 'последовательность создаётся заново')
  assert.ok(migration.includes('drop sequence if exists public.public_id_seq'), 'последовательность не удалена')
})

test('миграция перевыдаёт старые ID и закрепляет формат', () => {
  const migration = read('supabase/migrations/2026-08-09_unpredictable_public_id.sql')
  assert.ok(
    /update public\.profiles\s+set public_id = public\.generate_public_id\(\)\s+where public_id !~/.test(migration),
    'старые последовательные коды должны быть перевыданы',
  )
  assert.ok(migration.includes('profiles_public_id_format'), 'формат не закреплён ограничением')
})

test('поиск по ID нормализует ввод на сервере, а не доверяет клиенту', () => {
  for (const p of ['supabase/schema.sql', 'supabase/migrations/2026-08-09_unpredictable_public_id.sql']) {
    const sql = read(p)
    assert.ok(
      sql.includes('public_id = public.normalize_public_id(p_public_id)'),
      `${p}: find_user_by_public_id должен нормализовать ввод сам`,
    )
    assert.ok(!sql.includes("upper(trim(p_public_id))"), `${p}: осталась старая нормализация`)
  }
})
