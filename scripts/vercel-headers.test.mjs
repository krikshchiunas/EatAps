// Заголовки, с которыми Vercel отдаёт приложение. Permissions-Policy
// «camera=()» запрещает камеру всем, включая сам сайт: getUserMedia падает с
// NotAllowedError ещё до вопроса браузера, и сканер штрихкодов показывает
// «Нет доступа к камере», какие бы разрешения человек ни давал. Ровно так
// сканер и не работал в продакшене с самого появления — локально и в E2E
// заголовков Vercel нет, поэтому заметить это можно было только здесь.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
const headers = Object.fromEntries(config.headers.flatMap((h) => h.headers).map((h) => [h.key.toLowerCase(), h.value]))

const directive = (policy, feature) => {
  const m = new RegExp(`(?:^|,)\\s*${feature}=\\(([^)]*)\\)`).exec(policy || '')
  return m ? m[1].trim() : null
}

test('камера разрешена самому сайту — иначе сканер штрихкодов не включится', () => {
  const camera = directive(headers['permissions-policy'], 'camera')
  assert.ok(camera === null || /\bself\b/.test(camera), `Permissions-Policy: camera=(${camera})`)
})

test('микрофон и геолокация по-прежнему закрыты: они приложению не нужны', () => {
  assert.equal(directive(headers['permissions-policy'], 'microphone'), '')
  assert.equal(directive(headers['permissions-policy'], 'geolocation'), '')
})
