// Сборка supabase/setup_all.sql из исходников.
//
// Зачем скрипт, а не ручная склейка: собранный вручную файл РАЗЪЕХАЛСЯ —
// тело sync_friendship_from_follows() оказалось внутри admin_subscriptions_apply(),
// тело issue_promo() — внутри sync_friendship_from_follows(), а хвост
// admin_subscriptions_apply() повис после конца профильной миграции голым
// `insert into public.subscriptions ... NEW.user_id`. То есть файл «полной
// установки» не выполнялся вовсе, и поднять базу с нуля по нему было нельзя.
//
// Ошибка такого рода не ловится чтением: она видна только тем, что порядок
// в файле перестал совпадать с порядком в источниках. Поэтому склейка теперь
// детерминированная, а порядок задан ровно одним списком ниже.
//
// Запуск: node scripts/build-setup-all.mjs
// Проверка в CI/локально: node scripts/build-setup-all.mjs --check
// (--check ничего не пишет, а падает, если файл разошёлся с источниками).

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p) => join(root, p)

// ПОРЯДОК ОБЯЗАТЕЛЕН. Каждая миграция рассчитывает на состояние базы после
// предыдущих; перестановка ломает установку молча.
export const SOURCES = [
  'supabase/schema.sql',
  'supabase/migrations/2026-08-06_account_sync.sql',
  'supabase/migrations/2026-08-07_friend_privacy.sql',
  'supabase/migrations/2026-08-08_hardening.sql',
  'supabase/migrations/2026-08-08_chat_reactions.sql',
  'supabase/migrations/2026-08-09_unpredictable_public_id.sql',
  'supabase/migrations/2026-08-11_profile_and_thoughts.sql',
  'supabase/migrations/2026-08-23_moderation_and_coach.sql',
  'supabase/migrations/2026-08-23_challenges.sql',
  'supabase/migrations/2026-08-24_ai_usage.sql',
  'supabase/migrations/2026-08-25_promo_codes.sql',
  'supabase/migrations/2026-08-25_admin_views.sql',
  'supabase/migrations/2026-08-25_social_graph.sql',
  'supabase/migrations/2026-08-26_nickname_identity.sql',
  'supabase/migrations/2026-08-26_ai_premium_tier.sql',
  'supabase/migrations/2026-08-26_daily_usage_and_premium_admin.sql',
  'supabase/migrations/2026-08-26_admin_subscriptions_writable.sql',
  'supabase/migrations/2026-08-28_profile_rework.sql',
  'supabase/migrations/2026-09-05_social_hardening.sql',
]

const HEADER = `-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ПОЛНАЯ УСТАНОВКА БАЗЫ, ОДИН ФАЙЛ.
--
-- ⚠ ФАЙЛ СОБИРАЕТСЯ АВТОМАТИЧЕСКИ. Не правьте его руками — правки затрёт
--   следующая сборка, а ручная склейка уже однажды разъехалась и оставила
--   файл невыполнимым. Правьте ИСТОЧНИКИ (список ниже) и запускайте
--       node scripts/build-setup-all.mjs
--
-- Что это: schema.sql и все миграции, склеенные в правильном порядке.
-- Вставить целиком в Supabase → SQL Editor → Run. Одного прогона достаточно.
--
-- Безопасно для базы с данными. Файл идемпотентен целиком:
--   • таблицы создаются через create table if not exists;
--   • политики и функции — через drop/create или create or replace;
--   • бэкфилл прочтения сообщений срабатывает только при первом появлении
--     колонки read_at;
--   • перевыдача публичных ID трогает только коды старого формата.
-- Повторный прогон ничего не ломает и не перевыдаёт заново.
--
-- ЗАМЕТНЫЕ ПОСЛЕДСТВИЯ ПРОГОНА:
--
--   • Публичные ID (7K4M-9XPQ-2RTV и старые AA000001) удаляются вместе с
--     колонкой. Единственный адрес человека — ник, он же username.
--
--   • Заявки в друзья исчезают как класс. Друзьями становятся те, кто подписан
--     друг на друга; дневник питания и личные сообщения открываются им же.
--
--   • Дружба перестаёт быть таблицей-источником: права считаются по подпискам
--     (2026-09-05_social_hardening), а строка friendships остаётся только
--     якорем уведомления «теперь вы друзья».
--
-- После прогона выполните supabase/verify.sql, supabase/verify_social.sql и
-- supabase/verify_nickname.sql — все строки должны быть ✔.
--
-- Файл собран из этих источников, править нужно ИХ, а не копию:
`

function build() {
  const parts = [
    HEADER + SOURCES.map((s) => `--   ${s}`).join('\n') +
    '\n-- ═══════════════════════════════════════════════════════════════════════════\n',
  ]
  for (const src of SOURCES) {
    const body = readFileSync(rel(src), 'utf8').replace(/\s+$/, '')
    parts.push(
      '\n\n-- ###########################################################################\n' +
      `-- ИСТОЧНИК: ${src}\n` +
      '-- ###########################################################################\n\n' +
      body + '\n',
    )
  }
  return parts.join('')
}

const out = build()
const target = rel('supabase/setup_all.sql')

if (process.argv.includes('--check')) {
  let current = null
  try { current = readFileSync(target, 'utf8') } catch {}
  if (current !== out) {
    console.error('supabase/setup_all.sql разошёлся с источниками. Запустите: node scripts/build-setup-all.mjs')
    process.exit(1)
  }
  console.log('supabase/setup_all.sql совпадает с источниками ✔')
} else {
  writeFileSync(target, out)
  console.log(`supabase/setup_all.sql собран из ${SOURCES.length} файлов, ${out.split('\n').length} строк`)
}
