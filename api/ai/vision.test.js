import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readImages, buildContent, MAX_IMAGES } from './vision.js'

const img = (data = 'AAAA', media_type = 'image/jpeg') => ({ media_type, data })

test('несколько фото принимаются одним запросом', () => {
  const r = readImages({ images: [img(), img('BBBB', 'image/png'), img('CCCC', 'image/webp')] })
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, 3)
})

test('старое тело с одним image тоже работает', () => {
  const r = readImages({ image: img() })
  assert.deepEqual(r.images, [img()])
})

test('больше MAX_IMAGES — понятная ошибка, а не молчаливое обрезание', () => {
  const r = readImages({ images: Array.from({ length: MAX_IMAGES + 1 }, () => img()) })
  assert.equal(r.error, 'too_many_images')
})

test('пустой список и чужой формат отклоняются', () => {
  assert.equal(readImages({ images: [] }).error, 'bad_image')
  assert.equal(readImages({}).error, 'bad_image')
  assert.equal(readImages({ images: [img(), img('x', 'image/gif')] }).error, 'bad_image')
  assert.equal(readImages({ images: [{ media_type: 'image/jpeg', data: 42 }] }).error, 'bad_image')
})

test('лимит считается и по сумме всех фото', () => {
  const big = 'A'.repeat(1.5 * 1024 * 1024)
  assert.equal(readImages({ images: [img(big), img(big)] }).error, undefined)
  assert.equal(readImages({ images: [img(big), img(big), img(big)] }).error, 'image_too_large')
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
