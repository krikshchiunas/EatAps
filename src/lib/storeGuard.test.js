// Всё, что компонент берёт из стора, стор обязан отдавать.
//
// Родня propsGuard, но для другой дыры. propsGuard ловит проп, который вызвали
// внутри файла, не объявив в сигнатуре. Здесь — случай пострашнее: компонент
// достаёт из стора `addSupp`, а стор его не публикует. Сборка молчит, тесты
// молчат, экран рисуется. Ошибка вылезает только в тот момент, когда человек
// нажимает кнопку: «addSupp is not a function» — и приложение падает целиком,
// потому что это исключение в обработчике React.
//
// Проверяем ровно это: имена, разобранные из useStore(), присутствуют либо в
// объекте value, который стор кладёт в контекст, либо в форме состояния
// (её стор подмешивает туда спредом).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = readFileSync(join(ROOT, 'store.jsx'), 'utf8')

// Блок между `const value = useMemo(() => ({` и закрывающим `}), [`.
function exposedKeys() {
  const start = STORE.indexOf('const value = useMemo(() => ({')
  assert.notEqual(start, -1, 'в сторе больше нет объекта value — проверку надо переписать')
  const end = STORE.indexOf('}), [', start)
  const block = STORE.slice(start, end)
  const keys = new Set()
  for (const m of block.matchAll(/^\s{4}(?:\.\.\.)?([a-zA-Z_$][\w$]*)\s*[,:]/gm)) keys.add(m[1])

  // `...state` подмешивает всю форму состояния: days, meta и прочее приходят
  // оттуда и в объекте value по именам не перечислены.
  const es = STORE.indexOf('const empty = {')
  const eb = STORE.slice(es, STORE.indexOf('\n}', es))
  for (const m of eb.matchAll(/^\s{2}([a-zA-Z_$][\w$]*)\s*:/gm)) keys.add(m[1])
  return keys
}

// Что компоненты разбирают из стора: `const { a, b } = useStore()` и
// `const store = useStore()` + `const { a, b } = store`.
function usedNames(src) {
  const names = new Set()
  // [^{}] намеренно: без этого ленивый [\s\S]*? прыгает через пол-файла и
  // «находит» разбор стора там, где его нет, — в захват попадают комментарии
  // и куски чужого кода.
  const patterns = [/const\s*\{([^{}]*?)\}\s*=\s*useStore\(\)/g, /const\s*\{([^{}]*?)\}\s*=\s*store\b/g]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      // Внутри разбора живут комментарии-разделители («// тело и режим дня») —
      // они не имена.
      const body = m[1].replace(/\/\/[^\n]*/g, '')
      for (const raw of body.split(',')) {
        // `dayOf: getDay` — из стора берётся ЛЕВОЕ имя.
        const name = raw.split(':')[0].split('=')[0].trim()
        if (name && /^[a-zA-Z_$][\w$]*$/.test(name)) names.add(name)
      }
    }
  }
  return [...names]
}

test('каждое имя из useStore() стор действительно отдаёт', () => {
  const keys = exposedKeys()
  const dir = join(ROOT, 'components')
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'))
  const missing = []

  for (const file of [...files.map((f) => join(dir, f)), join(ROOT, 'App.jsx')]) {
    const src = readFileSync(file, 'utf8')
    for (const name of usedNames(src)) {
      if (!keys.has(name)) missing.push(`${file.split('/').pop()}: стор не отдаёт «${name}»`)
    }
  }

  assert.deepEqual(missing, [], missing.join('\n'))
})

test('действия для добавок опубликованы стором', () => {
  // Отдельно и по именам: карточка добавок вызывает их из обработчиков, где
  // отсутствующая функция роняет весь экран дня, а не только себя.
  const keys = exposedKeys()
  for (const name of ['addSupp', 'removeSupp', 'editSupp', 'saveStackItem', 'removeStackItem', 'setMicroGoal', 'supplements', 'microGoals']) {
    assert.ok(keys.has(name), `стор не отдаёт «${name}» — кнопка уронит экран`)
  }
})
