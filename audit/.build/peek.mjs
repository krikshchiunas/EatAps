// Собирает PDF только из выбранных страниц — для визуальной проверки вёрстки.
import { writeFileSync } from 'node:fs'
const want = process.argv.slice(2).map(Number)
const mod = await import('./report_core.mjs')
const d = mod.buildDoc()
d.pdf.pages = want.map((n) => d.pdf.pages[n - 1]).filter(Boolean)
writeFileSync(`peek.pdf`, d.pdf.build())
console.log('страниц в выборке:', d.pdf.pages.length)
