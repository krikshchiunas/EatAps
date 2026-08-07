// Машина состояний авторизации. Здесь проверяются ровно те переходы, на
// которых раньше приложение выкидывало человека из аккаунта или мигало
// экраном входа.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PHASE, authReducer, initialAuthState, isBooting, isSignedIn, canSync } from './authState.js'

const sess = (id, token = 't1') => ({ access_token: token, user: { id, email: `${id}@x.y` } })
const run = (state, ...actions) => actions.reduce(authReducer, state)

test('старт без сессии → гость, без промежуточного мигания', () => {
  const s = run(initialAuthState(), { type: 'INITIAL_SESSION', session: null })
  assert.equal(s.phase, PHASE.ANONYMOUS)
  assert.equal(isBooting(s), false)
  assert.equal(isSignedIn(s), false)
})

test('старт с сессией не показывает интерфейс, пока данные не загружены', () => {
  const s = run(initialAuthState(), { type: 'INITIAL_SESSION', session: sess('u1') })
  assert.equal(s.phase, PHASE.LOADING_ACCOUNT_DATA)
  assert.equal(isBooting(s), true, 'экран входа и онбординг в этот момент не рендерятся')
  assert.equal(canSync(s), false, 'до загрузки в облако не пишем')

  const ready = run(s, { type: 'DATA_LOADED', userId: 'u1' })
  assert.equal(ready.phase, PHASE.READY)
  assert.equal(isBooting(ready), false)
  assert.equal(canSync(ready), true)
})

test('обновление токена не роняет пользователя и не перезапускает загрузку', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1', 'old') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  const refreshed = run(ready, { type: 'TOKEN_REFRESHED', session: sess('u1', 'new') })

  assert.equal(refreshed.phase, PHASE.READY, 'фаза не меняется')
  assert.equal(refreshed.session.access_token, 'new', 'токен обновился')
  assert.equal(isSignedIn(refreshed), true)
  assert.equal(canSync(refreshed), true)
})

test('повторный SIGNED_IN того же пользователя не перезагружает данные', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  // supabase-js присылает SIGNED_IN и при возврате на вкладку.
  const again = run(ready, { type: 'SIGNED_IN', session: sess('u1', 'refreshed') })
  assert.equal(again.phase, PHASE.READY, 'экран загрузки не показывается заново')
})

test('вход другим аккаунтом на том же устройстве перезапускает загрузку', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  const switched = run(ready, { type: 'SIGNED_IN', session: sess('u2') })
  assert.equal(switched.userId, 'u2')
  assert.equal(switched.phase, PHASE.LOADING_ACCOUNT_DATA)
  assert.equal(canSync(switched), false, 'данные B не пишутся, пока не загружены')
})

test('ответ загрузки от прошлого пользователя игнорируется', () => {
  const switched = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'SIGNED_IN', session: sess('u2') },
    { type: 'DATA_LOADED', userId: 'u1' },   // опоздавший ответ для A
  )
  assert.equal(switched.phase, PHASE.LOADING_ACCOUNT_DATA, 'B всё ещё грузится')
  assert.equal(switched.userId, 'u2')
})

test('офлайн: сессия из хранилища сохраняется, гостем человек не становится', () => {
  const s = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_OFFLINE', userId: 'u1' },
  )
  assert.equal(s.phase, PHASE.OFFLINE_WITH_CACHED_SESSION)
  assert.equal(isSignedIn(s), true)
  assert.equal(isBooting(s), false, 'приложение показывается на кэше')
  assert.equal(canSync(s), false)

  // Сеть вернулась.
  const back = run(s, { type: 'DATA_LOADED', userId: 'u1' })
  assert.equal(back.phase, PHASE.READY)
})

test('сетевой сбой в READY не выкидывает из аккаунта', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  const s = run(ready, { type: 'DATA_OFFLINE', userId: 'u1' })
  assert.equal(s.phase, PHASE.READY, 'работаем дальше, синхронизация повторится сама')
})

test('только мёртвая сессия приводит к автоматическому выходу', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  const dead = run(ready, { type: 'SESSION_INVALID', error: { category: 'session', message: 'Сессия истекла' } })
  assert.equal(dead.userId, null)
  assert.equal(dead.phase, PHASE.AUTH_ERROR)
  assert.equal(isSignedIn(dead), false)
  assert.equal(dead.error.message, 'Сессия истекла')
})

test('выход обнуляет пользователя и приватное состояние машины', () => {
  const out = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
    { type: 'SIGN_OUT_START' },
    { type: 'SIGNED_OUT' },
  )
  assert.equal(out.phase, PHASE.ANONYMOUS)
  assert.equal(out.userId, null)
  assert.equal(out.session, null)
  assert.equal(canSync(out), false)
})

test('во время выхода интерфейс аккаунта не показывается', () => {
  const s = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
    { type: 'SIGN_OUT_START' },
  )
  assert.equal(isBooting(s), true)
  assert.equal(isSignedIn(s), false)
})

// ── Восстановление пароля ───────────────────────────────────────────────────

test('ссылка сброса пароля не считается обычным входом', () => {
  const s = run(initialAuthState(), { type: 'PASSWORD_RECOVERY', session: sess('u1') })
  assert.equal(s.phase, PHASE.PASSWORD_RECOVERY)
  assert.equal(s.recovering, true)
  assert.equal(canSync(s), false, 'данные аккаунта не грузятся и не пишутся')
})

test('после смены пароля начинается обычная загрузка данных', () => {
  const s = run(initialAuthState(),
    { type: 'PASSWORD_RECOVERY', session: sess('u1') },
    { type: 'RECOVERY_COMPLETED' },
  )
  assert.equal(s.recovering, false)
  assert.equal(s.phase, PHASE.LOADING_ACCOUNT_DATA)
})

test('SIGNED_IN во время recovery не выводит из режима смены пароля', () => {
  const s = run(initialAuthState(),
    { type: 'PASSWORD_RECOVERY', session: sess('u1') },
    { type: 'SIGNED_IN', session: sess('u1', 'updated') },
  )
  assert.equal(s.phase, PHASE.PASSWORD_RECOVERY)
  assert.equal(s.recovering, true)
})

// ── Форма входа ─────────────────────────────────────────────────────────────

test('неудачный вход возвращает гостя в гостевое состояние', () => {
  const s = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: null },
    { type: 'SIGN_IN_START' },
    { type: 'SIGN_IN_SETTLED', error: { category: 'auth', message: 'Неверный email или пароль' } },
  )
  assert.equal(s.phase, PHASE.ANONYMOUS)
  assert.equal(s.error.message, 'Неверный email или пароль')
})

test('успешное действие без сессии (магическая ссылка) не подвешивает фазу', () => {
  const s = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: null },
    { type: 'SIGN_IN_START' },
    { type: 'SIGN_IN_SETTLED', error: null },
  )
  assert.equal(s.phase, PHASE.ANONYMOUS, 'гостевой кэш продолжит сохраняться')
})

test('опоздавший SIGN_IN_SETTLED не сбивает уже начавшуюся загрузку', () => {
  const s = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: null },
    { type: 'SIGN_IN_START' },
    { type: 'SIGNED_IN', session: sess('u1') },
    { type: 'SIGN_IN_SETTLED', error: null },
  )
  assert.equal(s.phase, PHASE.LOADING_ACCOUNT_DATA)
  assert.equal(s.userId, 'u1')
})

test('таймаут инициализации оставляет офлайн-режим, а не выкидывает в гости', () => {
  const s = run(initialAuthState(), { type: 'INIT_TIMEOUT', session: sess('u1') })
  assert.equal(s.phase, PHASE.OFFLINE_WITH_CACHED_SESSION)
  assert.equal(isSignedIn(s), true)

  const noSession = run(initialAuthState(), { type: 'INIT_TIMEOUT', session: null })
  assert.equal(noSession.phase, PHASE.ANONYMOUS)
})

test('повторный INITIAL_SESSION (StrictMode, вторая подписка) ничего не ломает', () => {
  const once = run(initialAuthState(), { type: 'INITIAL_SESSION', session: sess('u1') })
  const loaded = run(once, { type: 'DATA_LOADED', userId: 'u1' })
  const twice = run(loaded, { type: 'INITIAL_SESSION', session: sess('u1') })
  assert.equal(twice.phase, PHASE.READY, 'загрузка не начинается заново')
  assert.deepEqual(twice, loaded)
})

test('USER_UPDATED от другого пользователя игнорируется', () => {
  const ready = run(initialAuthState(),
    { type: 'INITIAL_SESSION', session: sess('u1') },
    { type: 'DATA_LOADED', userId: 'u1' },
  )
  const s = run(ready, { type: 'USER_UPDATED', session: sess('u2') })
  assert.equal(s.userId, 'u1')
})

test('неизвестное событие не меняет состояние', () => {
  const s = run(initialAuthState(), { type: 'INITIAL_SESSION', session: null })
  assert.deepEqual(authReducer(s, { type: 'ЧТО_ТО_НОВОЕ' }), s)
})
