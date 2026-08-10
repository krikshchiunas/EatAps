// Адрес возврата после оплаты — место, где ошибка стоит дороже всего:
// returnUrl приходит из тела запроса, то есть полностью под контролем
// вызывающего. Прежняя проверка требовала лишь https, под неё подходил любой
// чужой домен.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeOrigin, isAllowedOrigin, CANONICAL_ORIGIN } from './origin.js'

const req = (host = 'www.eataps.com') => ({ headers: { host } })

test('чужой домен в returnUrl отбрасывается', () => {
  for (const evil of [
    'https://evil.com',
    'https://eataps.com.evil.com',
    'https://www.eataps.com.attacker.io/path',
    'https://evil.com/?x=https://www.eataps.com',
    'https://xn--eatps-8ve.com',            // похожий домен на пуникоде
    'http://www.eataps.com',                // подмена схемы на незащищённую
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.com',
  ]) {
    assert.equal(safeOrigin(req(), evil), CANONICAL_ORIGIN, `пропущено: ${evil}`)
  }
})

test('свои домены разрешены', () => {
  assert.equal(safeOrigin(req(), 'https://www.eataps.com'), 'https://www.eataps.com')
  assert.equal(safeOrigin(req(), 'https://eataps.com'), 'https://eataps.com')
  assert.equal(safeOrigin(req(), 'https://www.eataps.com/profile?tab=1'), 'https://www.eataps.com')
})

test('локальная разработка работает, но только на петлевом адресе', () => {
  assert.equal(safeOrigin(req(), 'http://localhost:5173'), 'http://localhost:5173')
  assert.equal(safeOrigin(req(), 'http://127.0.0.1:5199'), 'http://127.0.0.1:5199')
  // Чужой хост, притворяющийся локальным именем, — не петлевой адрес.
  assert.equal(safeOrigin(req(), 'http://localhost.evil.com'), CANONICAL_ORIGIN)
})

// Послабление ради разработки не должно уезжать в развёрнутое окружение: на
// боевом домене никто не возвращается после оплаты на свой localhost, а вот
// отправить туда чужую сессию Checkout — вполне рабочий сценарий.
function withEnv(vars, fn) {
  const before = {}
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try { fn() } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('в продакшене петлевой адрес больше не разрешён', () => {
  withEnv({ VERCEL_ENV: 'production' }, () => {
    assert.equal(safeOrigin(req(), 'http://localhost:5173'), CANONICAL_ORIGIN)
    assert.equal(safeOrigin(req(), 'http://127.0.0.1:5199'), CANONICAL_ORIGIN)
    assert.equal(isAllowedOrigin('http://localhost:5199'), false)
    assert.equal(isAllowedOrigin('http://127.0.0.1:3000'), false)
    // Свои домены при этом работают как раньше.
    assert.equal(safeOrigin(req(), 'https://www.eataps.com'), 'https://www.eataps.com')
    assert.equal(isAllowedOrigin('https://eataps.com'), true)
  })
})

test('превью-развёртывание — тоже не место для localhost', () => {
  withEnv({ VERCEL_ENV: 'preview' }, () => {
    assert.equal(safeOrigin(req(), 'http://localhost:5173'), CANONICAL_ORIGIN)
    assert.equal(isAllowedOrigin('http://localhost:5173'), false)
  })
})

test('vercel dev и обычный локальный запуск петлевой адрес сохраняют', () => {
  withEnv({ VERCEL_ENV: 'development' }, () => {
    assert.equal(safeOrigin(req(), 'http://localhost:5173'), 'http://localhost:5173')
    assert.equal(isAllowedOrigin('http://localhost:5173'), true)
  })
  // Не на Vercel вовсе: ориентир — NODE_ENV.
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: 'production' }, () => {
    assert.equal(safeOrigin(req(), 'http://localhost:5173'), CANONICAL_ORIGIN)
    assert.equal(isAllowedOrigin('http://localhost:5173'), false)
  })
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: undefined }, () => {
    assert.equal(safeOrigin(req(), 'http://localhost:5173'), 'http://localhost:5173')
    assert.equal(isAllowedOrigin('http://localhost:5173'), true)
  })
})

test('дополнительные домены задаются переменной окружения', () => {
  const before = process.env.ALLOWED_ORIGINS
  process.env.ALLOWED_ORIGINS = 'https://eataps-preview.vercel.app, https://staging.eataps.com/'
  try {
    assert.equal(safeOrigin(req(), 'https://eataps-preview.vercel.app'), 'https://eataps-preview.vercel.app')
    assert.equal(safeOrigin(req(), 'https://staging.eataps.com'), 'https://staging.eataps.com')
    assert.equal(safeOrigin(req(), 'https://other.vercel.app'), CANONICAL_ORIGIN)
  } finally {
    if (before === undefined) delete process.env.ALLOWED_ORIGINS
    else process.env.ALLOWED_ORIGINS = before
  }
})

test('без returnUrl берётся хост запроса, но тоже по списку', () => {
  assert.equal(safeOrigin(req('www.eataps.com'), null), 'https://www.eataps.com')
  assert.equal(safeOrigin(req('eataps.com'), undefined), 'https://eataps.com')
  // Подделанный заголовок Host не должен становиться адресом возврата.
  assert.equal(safeOrigin(req('evil.com'), null), CANONICAL_ORIGIN)
})

test('мусор и отсутствующий запрос не роняют функцию', () => {
  for (const bad of [null, undefined, '', 0, {}, [], 'не адрес']) {
    assert.equal(safeOrigin(req(), bad), CANONICAL_ORIGIN)
  }
  assert.equal(safeOrigin(undefined, undefined), CANONICAL_ORIGIN)
  assert.equal(safeOrigin({}, null), CANONICAL_ORIGIN)
})

// ── Проверка происхождения запроса (используется точкой обратной связи) ─────
test('isAllowedOrigin пропускает только свои страницы', async () => {
  const { isAllowedOrigin } = await import('./origin.js')
  assert.equal(isAllowedOrigin('https://www.eataps.com'), true)
  assert.equal(isAllowedOrigin('https://eataps.com'), true)
  assert.equal(isAllowedOrigin('http://localhost:5199'), true)
  assert.equal(isAllowedOrigin('https://www.eataps.com/profile'), true)

  for (const bad of ['https://evil.com', 'https://eataps.com.evil.com', 'http://www.eataps.com', '', null, undefined, 'мусор']) {
    assert.equal(isAllowedOrigin(bad), false, `пропущено: ${bad}`)
  }
})
