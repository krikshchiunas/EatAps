import { writeFileSync } from 'node:fs'
import { buildDoc } from './report_core.mjs'
const d = buildDoc()
writeFileSync('/Users/denyskrikshchiunas/Projects/EatAps/audit/EATAPS_FULL_AUDIT.pdf', d.pdf.build())
console.log('PDF: страниц', d.pdf.pages.length)
