// Добавляет форму «zero» арабским формам множественного числа, где её нет.
// По правилам CLDR ноль в арабском берёт ту же форму, что «other»
// («٠ يوم» как «١٠٠ يوم»), поэтому значение копируется из «other».
// Запускать после добавления новых строк: node scripts/i18n/add-arabic-zero.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src/locales/ar')
const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.value)
let total = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const file = join(dir, f)
  const code = readFileSync(file, 'utf8')
  const ast = parse(code, { sourceType: 'module' })
  const edits = []
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ObjectExpression') {
      const props = n.properties.filter((p) => p.type === 'ObjectProperty')
      const keys = new Set(props.map(keyName))
      if (keys.has('other') && keys.has('few') && !keys.has('zero')) {
        const other = props.find((p) => keyName(p) === 'other')
        edits.push({ at: other.start, text: `zero: ${code.slice(other.value.start, other.value.end)}, ` })
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string' && k !== 'loc') visit(v)
    }
  }
  visit(ast.program)
  if (!edits.length) continue
  let out = code
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at)
  writeFileSync(file, out)
  total += edits.length
}
console.log(`zero added: ${total}`)
