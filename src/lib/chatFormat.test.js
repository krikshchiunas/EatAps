import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timeShort, isSameDay, dayLabel, lastSeenLabel, previewOf } from './chatFormat.js'

const iso = (d) => new Date(d).toISOString()

test('пустое время не превращается в «Invalid Date»', () => {
  assert.equal(timeShort(null), '')
  assert.equal(timeShort(undefined), '')
  assert.equal(lastSeenLabel(null), '')
})

test('день определяется по календарю, а не по разнице в часах', () => {
  // 23:50 и 00:10 — разные дни, хотя между ними двадцать минут.
  const late = iso('2026-09-08T23:50:00')
  const early = iso('2026-09-09T00:10:00')
  assert.equal(isSameDay(late, early), false)
  assert.equal(isSameDay(late, iso('2026-09-08T08:00:00')), true)
})

test('сегодня и вчера названы словами, остальное — датой', () => {
  const now = new Date()
  const yest = new Date(); yest.setDate(now.getDate() - 1)
  assert.equal(dayLabel(now.toISOString()), 'Сегодня')
  assert.equal(dayLabel(yest.toISOString()), 'Вчера')
  assert.doesNotMatch(dayLabel('2020-03-04T12:00:00Z'), /Сегодня|Вчера/)
})

test('«был(а) в сети» смягчается по давности', () => {
  assert.match(lastSeenLabel(new Date(Date.now() - 20_000).toISOString()), /только что/)
  assert.match(lastSeenLabel(new Date(Date.now() - 25 * 60_000).toISOString()), /25 мин назад/)
  // Сутки назад — уже «вчера в HH:MM», а не «1440 мин назад».
  const yest = new Date(Date.now() - 26 * 3600_000)
  assert.match(lastSeenLabel(yest.toISOString()), /вчера|Был\(а\)/)
})

// Предпросмотр нужен цитате, меню сообщения и пересылке. Пустая строка в
// цитате выглядит как ошибка отрисовки, поэтому у каждого рода сообщения
// есть словесное описание.
test('предпросмотр называет род сообщения словами', () => {
  assert.equal(previewOf({ text: 'привет' }), 'привет')
  assert.equal(previewOf({ image_url: 'a.jpg' }), '📷 Фото')
  assert.equal(previewOf({ media: { kind: 'video' } }), '🎬 Видео')
  assert.equal(previewOf({ media: { kind: 'audio' } }), '🎤 Голосовое')
  assert.equal(previewOf({ meal_ref: {} }, 'Обед'), '🍽 Обед')
  assert.equal(previewOf({ meal_ref: {} }), '🍽 Блюдо')
})

test('предпросмотр отозванного сообщения не показывает содержимого', () => {
  assert.equal(previewOf({ text: 'секрет', unsent_at: '2026-09-09T10:00:00Z' }), 'Сообщение удалено')
  assert.equal(previewOf({ text: 'секрет', unsent: true }), 'Сообщение удалено')
})

test('предпросмотр пустоты — пустая строка, а не undefined', () => {
  assert.equal(previewOf(null), '')
  assert.equal(previewOf({}), '')
})
