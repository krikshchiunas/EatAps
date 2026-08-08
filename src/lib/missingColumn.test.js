// Распознавание «колонки ещё нет в базе» (pgErrors.js). Проверка стоит здесь
// не сама по себе: она защищает конкретный сценарий «фронтенд задеплоен
// раньше SQL-миграции» — добавление reactions в MSG_COLS раньше миграции
// 2026-08-08_chat_reactions.sql на несколько минут полностью ломало открытие
// чатов (запрос с несуществующей колонкой возвращает ошибку целиком, а не
// пустое значение поля). Фолбэк в supabase.js на этой функции держит чтение
// чата рабочим независимо от того, в каком порядке доехали код и SQL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMissingColumn } from './pgErrors.js'

test('распознаёт отсутствующую колонку по коду PostgreSQL', () => {
  assert.equal(isMissingColumn({ code: '42703', message: 'column messages.reactions does not exist' }), true)
})

test('распознаёт отсутствующую колонку по тексту, если кода нет', () => {
  assert.equal(isMissingColumn({ message: 'column "reactions" does not exist' }), true)
  assert.equal(isMissingColumn({ message: 'Column messages.reactions does not exist' }), true, 'регистр не важен')
})

test('не путает с другими ошибками того же рода', () => {
  assert.equal(isMissingColumn({ code: '42501', message: 'permission denied for table messages' }), false)
  assert.equal(isMissingColumn({ code: 'PGRST202', message: 'function not found' }), false)
  assert.equal(isMissingColumn({ message: 'relation "messages" does not exist' }), false, 'это отсутствующая ТАБЛИЦА, не колонка')
})

test('пустой и отсутствующий вход не бросают и не считаются совпадением', () => {
  for (const bad of [null, undefined, {}, { message: '' }, { code: null, message: null }]) {
    assert.equal(isMissingColumn(bad), false)
  }
})
