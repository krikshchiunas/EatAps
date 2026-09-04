// Пропсы, которые компонент ИСПОЛЬЗУЕТ, но не объявил.
//
// Сборка такую ошибку не видит: `onAddMany is not defined` — это исключение во
// время работы, и падает оно уже у человека, по нажатию кнопки. Ровно так и
// случилось: App передавал onAddMany, в сигнатуре AddMealSheet его не было, и
// добавление блюда молча ничего не делало.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENTS = join(ROOT, 'components')

// Имена пропсов-колбэков: их легко забыть объявить и невозможно поймать глазами.
const CALLBACK = /^on[A-Z]/

// В одном файле обычно несколько компонентов (AddMealSheet и его экраны).
// Собираем пропсы ВСЕХ функций файла: проверяем не «чей это проп», а более
// простое и надёжное — вызывается ли onXxx, которого в файле не объявлено
// нигде. Именно так выглядела реальная ошибка.
function destructuredProps(src) {
  const names = []
  for (const m of src.matchAll(/function \w+\(\{([\s\S]*?)\}\)\s*\{/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.split('=')[0].split(':')[0].trim()
      if (n) names.push(n)
    }
  }
  return names.length ? names : null
}

test('каждый onXxx, который компонент вызывает, объявлен в его сигнатуре', () => {
  const files = readdirSync(COMPONENTS).filter((f) => f.endsWith('.jsx'))
  const problems = []

  for (const file of files) {
    const src = readFileSync(join(COMPONENTS, file), 'utf8')
    const declared = destructuredProps(src)
    if (!declared) continue
    const body = src

    // Вызовы вида onFoo(...) и onFoo?.(...) — то есть проп применяют как функцию.
    // Обращения через точку (h.onReply()) — это метод чужого объекта, не проп.
    const used = new Set()
    for (const m of body.matchAll(/(?<![.\w])(on[A-Z]\w*)\s*(\?\.)?\(/g)) used.add(m[1])

    for (const name of used) {
      if (!CALLBACK.test(name)) continue
      // Локально объявленные (const onFoo = …) или пришедшие из другого объекта —
      // не пропсы, их пропускаем.
      const localDecl = new RegExp(`(const|let|function)\\s+${name}\\b`).test(body)
      if (localDecl || declared.includes(name)) continue
      problems.push(`${file}: вызывается ${name}(), но такого пропа в файле не объявлено`)
    }
  }

  assert.deepEqual(problems, [], problems.join('\n'))
})
