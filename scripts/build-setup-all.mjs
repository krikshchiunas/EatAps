// Собирает supabase/setup_all.sql из schema.sql и миграций.
//
// Раньше файл склеивался руками, и в его шапке стояла просьба «править нужно
// ИХ, а не копию». Просьба работает ровно до первой забытой пересборки: после
// неё установка с нуля получает базу БЕЗ последней миграции, то есть с уже
// исправленными где-то ещё дырами. Скрипт снимает этот вопрос.
//
//   node scripts/build-setup-all.mjs
//
// Порядок файлов задан ниже явно и по датам не выводится: две миграции от
// 2026-08-08 и три от 2026-08-25 сортируются по имени не так, как должны
// выполняться.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const ORDER = [
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
  'supabase/migrations/2026-08-28_audit_fixes.sql',
  'supabase/migrations/2026-08-28_profile_rework.sql',
]

const HEADER = `-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ПОЛНАЯ УСТАНОВКА БАЗЫ, ОДИН ФАЙЛ.
--
-- Что это: schema.sql и все миграции, склеенные в правильном порядке.
-- Вставить целиком в Supabase → SQL Editor → Run. Одного прогона достаточно.
--
-- ФАЙЛ СОБИРАЕТСЯ СКРИПТОМ. Править нужно исходники из списка внизу шапки, а
-- потом выполнить:
--
--     node scripts/build-setup-all.mjs
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
--     колонкой. Единственный адрес человека — ник, он же username. Ранее
--     розданные коды перестают работать; свой ник видно в «Профиль →
--     Редактировать профиль», там же он меняется.
--
--   • Заявки в друзья исчезают как класс. Принятые дружбы превращаются в две
--     подписки и остаются дружбами, незакрытые заявки — в одностороннюю
--     подписку заявителя. Дальше друзьями становятся те, кто подписан друг на
--     друга; дневник питания и личные сообщения открываются им же.
--
--   • Миграция 2026-08-28 закрывает утечку: до неё на app_state действовали
--     ДВЕ select-политики, и друг читал строку состояния целиком — вес, рост,
--     возраст, пол, настроение, самочувствие, заметку дня. Друзьям остаётся
--     friend_state(); дневник целиком видит только принятый тренер.
--
-- После прогона выполните supabase/verify.sql — 85 проверок, только чтение,
-- supabase/verify_social.sql — 31 проверка социального графа,
-- supabase/verify_nickname.sql — 24 проверки ника и дружбы и
-- supabase/verify_audit_fixes.sql — проверки исправлений аудита.
-- Все строки должны быть ✔.
--
-- ВНИМАНИЕ, миграция социального графа меняет модель приватности: имя, аватар
-- и username становятся видны любому авторизованному пользователю, а
-- существующие «Мысли» — подписчикам, а не только друзьям. Обоснование — в
-- шапке 2026-08-25_social_graph.sql.
--
-- Файл собран из этих источников, править нужно ИХ, а не копию:
${ORDER.map((p) => `--   ${p}`).join('\n')}
-- ═══════════════════════════════════════════════════════════════════════════

`

export function buildSetupAll() {
  const parts = [HEADER]
  for (const rel of ORDER) {
    const body = readFileSync(resolve(root, rel), 'utf8')
    parts.push(
      '\n\n',
      '-- ###########################################################################\n',
      `-- ИСТОЧНИК: ${rel}\n`,
      '-- ###########################################################################\n\n',
      body.endsWith('\n') ? body : body + '\n',
    )
  }
  return parts.join('')
}

// Пересборка — ТОЛЬКО при запуске файла как команды.
//
// Иначе побочный эффект при импорте: supabase/schema.test.js берёт отсюда
// ORDER, и на импорте файл перезаписывался — то есть тесты сначала чинили
// схему, а потом проверяли её и всегда проходили. Ровно так и вышло при первом
// прогоне: проверки на находки аудита оказались тавтологией и «проходили» даже
// на схеме, где все дыры на месте.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  writeFileSync(resolve(root, 'supabase/setup_all.sql'), buildSetupAll())
  console.log(`build-setup-all: ${ORDER.length} файл(ов) → supabase/setup_all.sql`)
}
