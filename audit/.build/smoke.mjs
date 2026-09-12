import { Doc, C } from './layout.mjs'
import { writeFileSync } from 'node:fs'
const d = new Doc()
d.h1('Проверка кириллицы и вёрстки')
d.p('Обычный абзац с русским текстом, ёжиком и умлаутами: Müsli, café. Проверяем перенос по словам на достаточно длинной строке, чтобы она точно не поместилась в одну строку и переехала на следующую.')
d.h2('Таблица')
d.table(
  [{ t: 'ID', w: 1 }, { t: 'Severity', w: 1.2 }, { t: 'Описание', w: 5 }],
  [['SEC-001', { t: 'P1 HIGH', sev: 'P1' }, 'Обход дневного лимита AI параллельными запросами'],
   ['DB-001', { t: 'P2', sev: 'P2' }, 'setup_all.sql разошёлся с миграциями']]
)
d.note('Врезка с пояснением. Проверяем фон, полоску слева и перенос.', { title: 'Важно' })
d.code('const x = 1\nawait reserve(user.id, reserved, period)  // резерв')
writeFileSync('smoke.pdf', d.pdf.build())
console.log('готово, страниц:', d.pageNo)
