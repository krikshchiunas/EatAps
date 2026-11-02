import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readImages, buildContent } from './vision.js'
import { maxPhotosForTier, MAX_PHOTOS_ANY } from '../../src/lib/aiBudget.js'

const img = (data = 'AAAA', media_type = 'image/jpeg') => ({ media_type, data })

test('несколько фото принимаются одним запросом', () => {
  const r = readImages({ images: [img(), img('BBBB', 'image/png'), img('CCCC', 'image/webp')] }, 3)
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, 3)
})

test('старое тело с одним image тоже работает', () => {
  const r = readImages({ image: img() })
  assert.deepEqual(r.images, [img()])
})

const many = (n) => ({ images: Array.from({ length: n }, () => img()) })

test('лимит фото по тарифу: Free 1, Carrot+ 3, Pro 5, Premium 10', () => {
  assert.equal(maxPhotosForTier('FREE'), 1)
  assert.equal(maxPhotosForTier('AI'), 3)
  assert.equal(maxPhotosForTier('AI_PLUS'), 5)
  assert.equal(maxPhotosForTier('AI_PREMIUM'), 10)
  assert.equal(maxPhotosForTier('что-то непонятное'), 1)
  assert.equal(MAX_PHOTOS_ANY, 10)
})

test('сверх лимита тарифа — понятная ошибка, а не молчаливое обрезание', () => {
  for (const tier of ['FREE', 'AI', 'AI_PLUS', 'AI_PREMIUM']) {
    const max = maxPhotosForTier(tier)
    assert.equal(readImages(many(max), max).error, undefined, tier)
    const over = readImages(many(max + 1), max)
    assert.equal(over.error, 'too_many_images', tier)
    assert.equal(over.max, max)
  }
})

test('без указания лимита — одно фото, как на бесплатном', () => {
  assert.equal(readImages(many(1)).error, undefined)
  assert.equal(readImages(many(2)).error, 'too_many_images')
})

test('10 фото по сжатой доле клиента влезают в серверный лимит', async () => {
  const { PHOTO_PAYLOAD_BUDGET } = await import('../../src/lib/aiClient.js')
  const share = Math.floor(PHOTO_PAYLOAD_BUDGET / 10)
  const body = { images: Array.from({ length: 10 }, () => img('A'.repeat(share))) }
  assert.equal(readImages(body, 10).error, undefined)
})

test('пустой список и чужой формат отклоняются', () => {
  assert.equal(readImages({ images: [] }).error, 'bad_image')
  assert.equal(readImages({}).error, 'bad_image')
  assert.equal(readImages({ images: [img(), img('x', 'image/gif')] }, 5).error, 'bad_image')
  assert.equal(readImages({ images: [{ media_type: 'image/jpeg', data: 42 }] }, 5).error, 'bad_image')
})

test('лимит считается и по сумме всех фото', () => {
  const big = 'A'.repeat(1.5 * 1024 * 1024)
  assert.equal(readImages({ images: [img(big), img(big)] }, 10).error, undefined)
  assert.equal(readImages({ images: [img(big), img(big), img(big)] }, 10).error, 'image_too_large')
})

test('лишние поля из тела в модель не уходят', () => {
  const r = readImages({ images: [{ ...img(), url: 'https://evil' }] })
  assert.deepEqual(r.images, [img()])
})

test('несколько фото подписаны по номерам, текст — в конце', () => {
  const content = buildContent([img('A'), img('B')], 'вопрос')
  assert.deepEqual(content.map((c) => c.type), ['text', 'image', 'text', 'image', 'text'])
  assert.equal(content[0].text, 'Фото 1:')
  assert.equal(content[2].text, 'Фото 2:')
  assert.equal(content.at(-1).text, 'вопрос')
})

test('одно фото без лишней подписи', () => {
  const content = buildContent([img('A')], 'вопрос')
  assert.deepEqual(content.map((c) => c.type), ['image', 'text'])
})
