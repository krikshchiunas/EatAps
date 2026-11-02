// Статическая проверка переводов: чистая кодовая база проходит, а типичные
// ошибки разработчика — ловятся. Если этот тест падает на первом пункте, в
// исходниках появилась непереведённая строка или неверный ключ (см. вывод).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkAll, checkFile } from './check-source.mjs'

test('в исходниках нет непереведённых строк и неверных ключей', () => {
  const problems = checkAll()
  assert.deepEqual(problems, [], problems.map((p) => `${p.file}:${p.line} [${p.rule}] ${p.text}`).join('\n'))
})

const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'))
const check = (name, code) => {
  const f = join(dir, name)
  writeFileSync(f, code)
  return checkFile(f).map((p) => `${p.rule}:${p.text}`)
}

test('ловит: текст в JSX, атрибуты, фразы в сообщениях, неверные ключи', () => {
  assert.ok(check('a.jsx', 'export const A = () => <button>Save changes</button>').some((x) => x.startsWith('jsx-text')))
  assert.ok(check('b.jsx', 'export const B = () => <input placeholder="Your name" />').some((x) => x.startsWith('jsx-attr')))
  assert.ok(check('c.jsx', 'export const C = () => <img alt="Profile photo" />').some((x) => x.startsWith('jsx-attr')))
  assert.ok(check('d.jsx', 'export const D = () => <i aria-label={"Close"} />').some((x) => x.startsWith('jsx-attr')))
  assert.ok(check('e.js', 'alert("Something went wrong")').some((x) => x.startsWith('message-literal')))
  assert.ok(check('f.js', 'setError("Не удалось сохранить")').some((x) => x.startsWith('message-literal') || x.startsWith('script-literal')))
  assert.ok(check('g.js', 'const s = "Добавить продукт"').some((x) => x.startsWith('script-literal')))
  assert.ok(check('h.js', "import { t } from './i18n.js'; t('settings.titel')").some((x) => x === 'unknown-key:settings.titel'))
  assert.ok(check('i.js', "t(`nosuch.section.${x}`)").some((x) => x.startsWith('unknown-key-prefix')))
  assert.ok(check('j.js', "const KEY = 'day.noSuchKey'").some((x) => x.startsWith('unknown-key')))
  assert.ok(check('k.js', 'const s = "مرحبا بك"').some((x) => x.startsWith('script-literal')))
})

test('пропускает: ключи, бренды, значки, коды единиц, логи, помеченные данные', () => {
  assert.deepEqual(check('ok1.jsx', "export const A = () => <><b>{t('common.save')}</b><span>EatAps</span><span>Carrot 🥕</span><i>i</i><span>·</span></>"), [])
  assert.deepEqual(check('ok2.js', "const u = 'г'; const v = 'мл'; console.log('отладка'); log.warn('сбой синхронизации')"), [])
  assert.deepEqual(check('ok3.js', "const NAME = /* @i18n-data */ 'Овсянка'"), [])
  assert.deepEqual(check('ok4.js', "// @i18n-data-file — справочник\nexport const X = ['Гречка', 'Рис']"), [])
  assert.deepEqual(check('ok5.jsx', 'export const A = () => <input placeholder="name@mail.com" type="email" />'), [])
  assert.deepEqual(check('ok6.js', "t(`micro.status.${k}`); t(cond ? 'common.yes' : 'common.no')"), [])
  rmSync(dir, { recursive: true, force: true })
})
