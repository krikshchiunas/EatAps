// Разбор адреса вложения — граница доверия: полученный путь уходит прямо в
// запрос на подпись. Поэтому проверяется не только счастливый путь, но и
// попытки увести подпись на чужой объект.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { objectPathFrom, isSafeObjectPath, signedUrl, clearSignedUrlCache } from './storageUrl.js'

const PUB = 'https://abcdefgh.supabase.co/storage/v1/object/public'

test('публичный адрес превращается в путь внутри бакета', () => {
  assert.equal(
    objectPathFrom(`${PUB}/chat-images/11111111-1111-4111-8111-111111111111/photo.jpg`, 'chat-images'),
    '11111111-1111-4111-8111-111111111111/photo.jpg',
  )
  assert.equal(
    objectPathFrom(`${PUB}/post-images/22222222-2222-4222-8222-222222222222/pic.jpg`, 'post-images'),
    '22222222-2222-4222-8222-222222222222/pic.jpg',
  )
})

test('путь, сохранённый без адреса, принимается как есть', () => {
  assert.equal(objectPathFrom('conv/user/file.webm', 'dm-media'), 'conv/user/file.webm')
})

test('подписанный и авторизованный адреса тоже разбираются', () => {
  const base = 'https://abcdefgh.supabase.co/storage/v1/object'
  assert.equal(objectPathFrom(`${base}/sign/chat-images/a/b.jpg`, 'chat-images'), 'a/b.jpg')
  assert.equal(objectPathFrom(`${base}/authenticated/chat-images/a/b.jpg`, 'chat-images'), 'a/b.jpg')
})

test('чужой бакет не подписывается', () => {
  // Иначе в поле картинки записи можно было бы подсунуть путь к вложению
  // переписки и получить подпись на него мимо политики чтения записей.
  assert.equal(objectPathFrom(`${PUB}/chat-images/a/b.jpg`, 'post-images'), null)
  assert.equal(objectPathFrom(`${PUB}/dm-media/a/b/c.mp4`, 'chat-images'), null)
})

test('выход вверх по дереву отклоняется', () => {
  assert.equal(objectPathFrom(`${PUB}/chat-images/../../secret.jpg`, 'chat-images'), null)
  assert.equal(objectPathFrom(`${PUB}/chat-images/a/../../b.jpg`, 'chat-images'), null)
  assert.equal(objectPathFrom('../../etc/passwd', 'chat-images'), null)
  assert.equal(objectPathFrom('a/../b', 'chat-images'), null)
  // И то же самое в процентном кодировании: разбор идёт ПОСЛЕ декодирования.
  assert.equal(objectPathFrom(`${PUB}/chat-images/%2e%2e/%2e%2e/x.jpg`, 'chat-images'), null)
})

test('мусор и пустые значения отклоняются', () => {
  for (const bad of [null, undefined, '', 42, {}, [], 'javascript:alert(1)', 'data:image/png;base64,AAA']) {
    assert.equal(objectPathFrom(bad, 'chat-images'), null, `принято: ${JSON.stringify(bad)}`)
  }
})

test('адрес без части storage не разбирается', () => {
  assert.equal(objectPathFrom('https://evil.example/chat-images/a/b.jpg', 'chat-images'), null)
})

test('isSafeObjectPath отсекает пустые сегменты и слишком глубокие пути', () => {
  assert.equal(isSafeObjectPath('a/b.jpg'), true)
  assert.equal(isSafeObjectPath('a//b.jpg'), false)
  assert.equal(isSafeObjectPath('/a/b.jpg'), false)
  assert.equal(isSafeObjectPath('a/b/c/d/e/f/g.jpg'), false)
  assert.equal(isSafeObjectPath('a/b c.jpg'), false)
  assert.equal(isSafeObjectPath('a'.repeat(600)), false)
})

// ── Подпись и кэш ────────────────────────────────────────────────────────────
function fakeClient(onSign) {
  return {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path, ttl) => onSign(bucket, path, ttl),
      }),
    },
  }
}

test('подпись запрашивается один раз на объект, а не на каждый показ', async () => {
  clearSignedUrlCache()
  let calls = 0
  const client = fakeClient((b, p) => { calls++; return { data: { signedUrl: `signed:${b}/${p}` } } })
  const url = `${PUB}/chat-images/a/b.jpg`

  const first = await signedUrl(client, 'chat-images', url)
  const second = await signedUrl(client, 'chat-images', url)
  assert.equal(first, 'signed:chat-images/a/b.jpg')
  assert.equal(second, first)
  assert.equal(calls, 1, 'подпись запрошена повторно — лента давала бы лишний запрос на каждый рендер')
})

test('одновременные запросы на один объект не плодят подписей', async () => {
  clearSignedUrlCache()
  let calls = 0
  const client = fakeClient(async (b, p) => {
    calls++
    await new Promise((r) => setTimeout(r, 5))
    return { data: { signedUrl: `signed:${p}` } }
  })
  const url = `${PUB}/chat-images/a/b.jpg`
  const all = await Promise.all([1, 2, 3, 4].map(() => signedUrl(client, 'chat-images', url)))
  assert.deepEqual(new Set(all), new Set(['signed:a/b.jpg']))
  assert.equal(calls, 1, 'на четыре одновременных показа ушло больше одной подписи')
})

test('отказ в подписи возвращает null и не кэшируется', async () => {
  clearSignedUrlCache()
  let calls = 0
  const client = fakeClient(() => { calls++; return { error: { message: 'нет доступа' } } })
  const url = `${PUB}/chat-images/a/b.jpg`
  assert.equal(await signedUrl(client, 'chat-images', url), null)
  assert.equal(await signedUrl(client, 'chat-images', url), null)
  assert.equal(calls, 2, 'отказ закэширован — доступ, выданный позже, не подхватился бы')
})

test('без клиента и с негодным адресом подпись не запрашивается', async () => {
  clearSignedUrlCache()
  let calls = 0
  const client = fakeClient(() => { calls++; return { data: { signedUrl: 'x' } } })
  assert.equal(await signedUrl(null, 'chat-images', `${PUB}/chat-images/a/b.jpg`), null)
  assert.equal(await signedUrl(client, 'chat-images', 'мусор'), null)
  assert.equal(calls, 0)
})
