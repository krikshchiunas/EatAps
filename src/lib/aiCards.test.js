// ИИ на всех языках: язык ответа в промпте, карточки → записи по id каталога,
// ошибки на языке интерфейса.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { setLang, LANGS, SOURCE_LANG, t } from './i18n.js'
import { aiCardFood } from './aiCards.js'
import { buildSystemPrompt } from './aiPrompt.js'
import { sendChat, sendPhoto, AIError } from './aiClient.js'
import { foodName } from './foodNames.js'

after(() => { delete globalThis.fetch; return setLang(SOURCE_LANG, { persist: false }) })
const CYR = /[а-яё]/i
const sys = (lang) => buildSystemPrompt({ tone: 'calm', sub: { tier: 'FREE', status: 'active' }, lang })

test('промпт: язык интерфейса каждого языка реестра, сообщение главнее', () => {
  for (const l of LANGS) {
    const p = sys(l.code)
    assert.ok(p.includes(`${l.englishName} — ${l.name}`), l.code)
    assert.match(p, /Отвечай на языке последнего сообщения/, `${l.code}: язык сообщения главнее (английский вопрос при немецком интерфейсе — английский ответ)`)
    assert.match(p, /только фото/, `${l.code}: фото без подписи — на языке интерфейса`)
    assert.match(p, /"reply", "ask" и "name"/, `${l.code}: карточки и вопросы на языке ответа`)
    assert.match(p, /Имя Carrot не переводится/)
  }
  for (const bad of [undefined, '', 'xx', 'de-DE; DROP', '__proto__', '<script>']) assert.doesNotMatch(sys(bad), /Интерфейс приложения/)
})

test('карточка ИИ с продуктом базы на любом языке → каноническая запись с id', async () => {
  const cases = [
    ['Haferflocken', 'food_rolled_oats_dry'], ['Oat milk', 'food_oat_milk'], ['حليب الشوفان', 'food_oat_milk'],
    ['Yulaf sütü', 'food_oat_milk'], ['Leche de avena', 'food_oat_milk'], ['Leite de aveia', 'food_oat_milk'], ['Овсянка', 'food_oatmeal'],
  ]
  for (const [name, id] of cases) {
    const food = await aiCardFood({ name }, 'Блюдо')
    assert.equal(food.foodId, id, name)
    assert.equal(food.aiName, name)
  }
})

test('после смены языка запись из ИИ показывается на новом языке', async () => {
  const food = await aiCardFood({ name: 'Haferflocken' }, 'x') // ответ на немецком
  try {
    await setLang('en', { persist: false })
    assert.equal(foodName(food.name), 'Rolled oats, dry')
    await setLang('tr', { persist: false })
    assert.doesNotMatch(foodName(food.name), CYR)
  } finally { await setLang(SOURCE_LANG, { persist: false }) }
})

test('без уверенного совпадения название остаётся как у ИИ', async () => {
  assert.deepEqual(await aiCardFood({ name: 'Bowl mit Lachs, Reis und Avocado' }, 'x'), { name: 'Bowl mit Lachs, Reis und Avocado' })
  assert.deepEqual(await aiCardFood({ name: 'haferfloken' }, 'x'), { name: 'haferfloken' }, 'опечатка — не совпадение')
  assert.deepEqual(await aiCardFood({ name: '   ' }, 'Блюдо'), { name: 'Блюдо' })
  assert.deepEqual(await aiCardFood(null, 'Блюдо'), { name: 'Блюдо' })
  assert.equal((await aiCardFood({ name: 'x'.repeat(500) }, 'y')).name.length, 80)
})

test('клиент: язык уходит на сервер, ошибки — на языке интерфейса', async () => {
  const session = { access_token: 'tok' }
  let lastBody = null
  const reply = (status, data) => async (url, init) => { lastBody = JSON.parse(init.body); return { ok: status < 400, status, json: async () => data } }
  try {
    for (const l of LANGS) {
      await setLang(l.code, { persist: false })
      globalThis.fetch = reply(200, { reply: 'ok' })
      await sendChat({ history: [], context: {}, prefs: {}, session })
      assert.equal(lastBody.lang, l.code)

      const expectErr = async (fn, text) => {
        const e = await fn().then(() => null, (x) => x)
        assert.ok(e instanceof AIError, l.code)
        assert.equal(e.message, text, l.code)
        if (l.code !== 'ru') assert.doesNotMatch(e.message, CYR, `${l.code}: ${e.message}`)
      }
      globalThis.fetch = reply(502, { error: 'upstream', message: 'Upstream failed (сервер)' })
      await expectErr(() => sendChat({ history: [], context: {}, prefs: {}, session }), t('ai.err.upstream'))
      await expectErr(() => sendPhoto({ image: {}, context: {}, prefs: {}, session }), t('ai.err.upstream_photo'))
      globalThis.fetch = reply(500, { error: 'something_new', message: 'Внутренняя ошибка' })
      await expectErr(() => sendChat({ history: [], context: {}, prefs: {}, session }), t('ai.genericError'))
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
      await expectErr(() => sendChat({ history: [], context: {}, prefs: {}, session }), t('ai.err.offline'))
      await expectErr(() => sendChat({ history: [], context: {}, prefs: {}, session: null }), t('ai.err.unauthorized'))
    }
  } finally { await setLang(SOURCE_LANG, { persist: false }) }
})
