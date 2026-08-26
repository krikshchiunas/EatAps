// Распознавание ошибок Postgres/PostgREST — вынесено отдельно и без
// зависимостей, чтобы проверяться тестами без загрузки supabase.js (тот
// читает import.meta.env.VITE_SUPABASE_URL при импорте и падает под простым
// node --test, где Vite ничего не подставляет).

// «Колонки нет в базе» — типичный симптом, когда фронтенд задеплоен раньше
// SQL-миграции, добавляющей эту колонку. Отличать от «таблицы нет» и от
// прочих ошибок того же семейства важно: у каждой свой смысл и своя реакция.
//
// Одно и то же «колонки нет» приходит ДВУМЯ разными способами, и раньше здесь
// был опознан только первый:
//
//   • SELECT — список колонок уходит в Postgres, и ошибку возвращает он:
//     код 42703, «column messages.reactions does not exist». Именно так
//     ломалось открытие чатов до миграции 2026-08-08_chat_reactions.
//   • INSERT/UPDATE — до Postgres дело не доходит: PostgREST сверяет ключи
//     тела запроса со своим кэшем схемы и отвечает сам, кодом PGRST204 и
//     текстом «Could not find the 'visibility' column of 'posts' in the
//     schema cache». Ни кода 42703, ни слов «does not exist» в нём нет.
//
// Из-за второго случая фолбэк в createPost не срабатывал, и публикация мысли
// на базе без миграции социального графа падала с «Что-то пошло не так»
// вместо тихого повтора без visibility.
export function isMissingColumn(error) {
  const code = error?.code
  if (code === '42703' || code === 'PGRST204') return true
  const message = error?.message || ''
  return /column .* does not exist/i.test(message)
    || /could not find the .* column .* in the schema cache/i.test(message)
}
