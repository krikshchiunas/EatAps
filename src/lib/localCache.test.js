// Локальный кэш: разделение по пользователю и перенос данных со старой схемы.
// Это место, где ошибка означает «человек увидел чужой дневник» или «история
// пропала при обновлении приложения», поэтому проверяем в том числе поломанное
// и недоступное хранилище.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Простейший localStorage до импорта модуля — модуль читает его лениво.
function installStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    get length() { return map.size },
    _map: map,
  }
  return map
}

installStorage()
const { readCache, writeCache, clearCache, hasCache, migrateLegacyCache, GUEST } = await import('./localCache.js')

test('кэши разных пользователей не пересекаются', () => {
  installStorage()
  writeCache('userA', { state: { profile: { name: 'Аня' } }, revision: 4, dirty: false })
  writeCache('userB', { state: { profile: { name: 'Борис' } }, revision: 9, dirty: true })

  assert.equal(readCache('userA').state.profile.name, 'Аня')
  assert.equal(readCache('userB').state.profile.name, 'Борис')
  assert.equal(readCache('userA').revision, 4)
  assert.equal(readCache('userB').dirty, true)

  clearCache('userA')
  assert.equal(readCache('userA'), null, 'выход стёр данные A')
  assert.equal(readCache('userB').state.profile.name, 'Борис', 'данные B не задеты')
})

test('гостевой кэш отделён от пользовательского', () => {
  installStorage()
  writeCache(GUEST, { state: { profile: { name: 'Гость' } }, revision: 0, dirty: true })
  assert.equal(hasCache(GUEST), true)
  assert.equal(hasCache('userA'), false)
})

test('повреждённый JSON читается как «кэша нет», а не роняет запуск', () => {
  const map = installStorage()
  map.set('eataps:state:userA', '{это не json')
  assert.equal(readCache('userA'), null)
})

test('запись без state игнорируется', () => {
  const map = installStorage()
  map.set('eataps:state:userA', JSON.stringify({ revision: 3 }))
  assert.equal(readCache('userA'), null)
})

test('перенос старой схемы: данные достаются владельцу из eataps:lastUid', () => {
  const map = installStorage({
    'eataps:v1': JSON.stringify({ profile: { name: 'Аня' }, days: { '2026-08-06': { meals: [] } } }),
    'eataps:sync': '1754500000000',
    'eataps:lastUid': 'userA',
  })

  migrateLegacyCache()

  assert.equal(readCache('userA').state.profile.name, 'Аня', 'история не потеряна')
  assert.equal(readCache('userA').dirty, true, 'помечено к отправке в облако')
  assert.equal(map.has('eataps:v1'), false, 'старые ключи убраны')
  assert.equal(map.has('eataps:lastUid'), false)
  assert.equal(map.has('eataps:sync'), false)
})

test('перенос старой схемы без lastUid отдаёт данные гостю', () => {
  installStorage({ 'eataps:v1': JSON.stringify({ profile: { name: 'Гость' } }) })
  migrateLegacyCache()
  assert.equal(readCache(GUEST).state.profile.name, 'Гость')
})

test('перенос идемпотентен и не затирает уже существующий новый кэш', () => {
  const map = installStorage({
    'eataps:v1': JSON.stringify({ profile: { name: 'Старое' } }),
    'eataps:lastUid': 'userA',
  })
  writeCache('userA', { state: { profile: { name: 'Новое' } }, revision: 7, dirty: false })

  migrateLegacyCache()
  assert.equal(readCache('userA').state.profile.name, 'Новое', 'свежий кэш важнее старого ключа')
  assert.equal(map.has('eataps:v1'), false)

  migrateLegacyCache() // повторный запуск ничего не делает
  assert.equal(readCache('userA').state.profile.name, 'Новое')
})

test('недоступное хранилище (приватный режим) не роняет приложение', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('QuotaExceededError') },
    removeItem() { throw new Error('SecurityError') },
  }
  assert.doesNotThrow(() => migrateLegacyCache())
  assert.equal(readCache('userA'), null)
  assert.equal(writeCache('userA', { state: {}, revision: 0, dirty: false }), false)
  assert.doesNotThrow(() => clearCache('userA'))
})

test('переполнение хранилища при переносе не удаляет старые ключи', () => {
  const map = new Map(Object.entries({ 'eataps:v1': JSON.stringify({ profile: { name: 'Аня' } }) }))
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: (k) => { map.delete(k) },
  }
  migrateLegacyCache()
  assert.equal(map.has('eataps:v1'), true, 'данные не выброшены, пока копия не удалась')
})
