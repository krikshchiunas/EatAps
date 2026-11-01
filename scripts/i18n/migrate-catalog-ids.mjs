// Одноразовая миграция: таблицы переводов продуктов, способов приготовления,
// порций и алкоголя переключаются с ключа «русское название» на стабильный id.
//
// Запускалась один раз; оставлена в репозитории как документ того, как id
// были получены (из английского названия, со стабильной дедупликацией).
// Повторный запуск на уже мигрированных файлах ничего не сломает: он
// откажется работать, увидев id вместо русских ключей.
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LANGS = ['en', 'de', 'es', 'pt', 'tr', 'ar']
const TABLES = ['foods', 'methods', 'portions', 'alcohol']
const PREFIX = { foods: 'food', methods: 'method', portions: 'portion', alcohol: 'alcohol' }

const load = async (lang, t) => (await import(join(ROOT, `src/locales/${lang}/data/${t}.js`))).default
const slug = (s) => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48).replace(/_+$/, '')
const CYR = /[Ѐ-ӿ]/
const gender = (ru) => (/(ая|яя)$/i.test(ru) ? 'f' : /(ое|ее)$/i.test(ru) ? 'n' : /(ые|ие)$/i.test(ru) ? 'pl' : 'm')

const { FOODS } = await import(join(ROOT, 'src/lib/foods.js'))
const i18n = await import(join(ROOT, 'src/lib/i18n.js'))
const { foodName } = await import(join(ROOT, 'src/lib/foodNames.js'))

const old = {}
for (const lang of LANGS) {
  old[lang] = {}
  for (const t of TABLES) old[lang][t] = await load(lang, t)
}
if (Object.keys(old.en.foods.foods).some((k) => /^food_/.test(k))) {
  console.error('already migrated')
  process.exit(1)
}

// ── Канонические русские имена в порядке появления ───────────────────────────
const canon = {
  foods: [...new Set([...Object.keys(old.en.foods.foods), ...FOODS.map((f) => f.name)])],
  methods: Object.keys(old.en.methods.methods),
  portions: Object.keys(old.en.portions.portions),
  alcohol: Object.keys(old.en.alcohol.alcohol),
}

// Английское имя для id: из таблицы, а для имён-шаблонов («Сыр лёгкий 30%»)
// и брендов — тем же foodName, что показывает его человеку.
await i18n.setLang('en', { persist: false })
const enName = (table, ru) => {
  const v = old.en[table][table][ru]
  if (v) return v
  if (table === 'foods') return foodName(ru)
  return ru
}

const ids = {}
const legacy = {}
for (const table of TABLES) {
  ids[table] = {}
  legacy[table] = {}
  const used = new Set()
  const byLower = new Map()
  for (const ru of canon[table]) {
    const lower = ru.toLocaleLowerCase('ru')
    if (byLower.has(lower)) {
      // «Джин-тоник» и «Джин-Тоник» — одно и то же имя: один id, второе
      // написание уходит в список старых названий.
      legacy[table][ru] = byLower.get(lower)
      continue
    }
    let base = `${PREFIX[table]}_${slug(enName(table, ru)) || 'item'}`
    if (table === 'methods' && used.has(base)) base = `${base}_${gender(ru)}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`
    used.add(id)
    ids[table][ru] = id
    byLower.set(lower, id)
  }
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const header = {
  foods: '// Названия продуктов базы по стабильному id. Русское название — исходное:\n// оно же хранится в дневнике у старых записей и сопоставляется с id через\n// эту таблицу (см. src/lib/catalog.js). id не меняются никогда.',
  methods: '// Способы приготовления по id: подпись на кнопке. methodsInline — форма\n// внутри названия («Kartoffeln, Püree»), methodsFor — форма, согласованная\n// с родом продукта («food_pork|method_boiled_f» → «cocido» по-испански).',
  portions: '// Подписи порций и единиц ингредиентов по id.',
  alcohol: '// Виды крепкого алкоголя по id. Бренды и коктейли — в foods.',
}

function writeTable(lang, table, entries, extra = {}) {
  const lines = [header[table], 'export default {', `  ${table}: {`]
  for (const [id, v] of entries) lines.push(`    ${id}: ${q(v)},`)
  lines.push('  },')
  for (const [name, obj] of Object.entries(extra)) {
    lines.push(`  ${name}: {`)
    for (const [k, v] of Object.entries(obj)) lines.push(`    ${q(k)}: ${q(v)},`)
    lines.push('  },')
  }
  lines.push('}')
  writeFileSync(join(ROOT, `src/locales/${lang}/data/${table}.js`), lines.join('\n') + '\n')
}

const ruEntries = (table) => Object.entries(ids[table]).map(([ru, id]) => [id, ru])
for (const table of TABLES) writeTable('ru', table, ruEntries(table))

const methodId = (how) => {
  const hit = Object.keys(ids.methods).find((k) => k.toLocaleLowerCase('ru') === how.toLocaleLowerCase('ru'))
  return hit ? ids.methods[hit] : null
}
const foodId = (ru) => ids.foods[ru] || legacy.foods[ru] || null

for (const lang of LANGS) {
  await i18n.setLang(lang, { persist: false })
  for (const table of TABLES) {
    const src = old[lang][table][table]
    const entries = []
    for (const [ru, id] of Object.entries(ids[table])) {
      let v = src[ru]
      if (v == null && table === 'foods') {
        const shown = foodName(ru)
        if (shown !== ru) v = shown
      }
      if (v != null) entries.push([id, v])
    }
    const extra = {}
    if (table === 'methods') {
      const inline = old[lang].methods.methodsInline || {}
      extra.methodsInline = Object.fromEntries(Object.entries(inline).map(([k, v]) => [methodId(k), v]).filter(([k]) => k))
      const forMap = old[lang].methods.methodsFor || {}
      extra.methodsFor = {}
      for (const [k, v] of Object.entries(forMap)) {
        const [base, how] = k.split('|')
        const f = foodId(base)
        const m = methodId(how)
        if (!f || !m) throw new Error(`methodsFor ${lang}: ${k}`)
        extra.methodsFor[`${f}|${m}`] = v
      }
    }
    writeTable(lang, table, entries, extra)
  }
}

// Старые написания → id.
const lines = [
  '// @i18n-data-file',
  '// Старые и альтернативные русские написания канонических сущностей → id.',
  '// Основное русское название живёт в src/locales/ru/data/<table>.js; здесь —',
  '// написания, которые уже могли попасть в дневники людей. Удалять строки',
  '// отсюда нельзя: старая запись перестанет узнаваться.',
  'export default {',
]
for (const table of TABLES) {
  lines.push(`  ${table}: {`)
  for (const [ru, id] of Object.entries(legacy[table])) lines.push(`    ${q(ru)}: ${q(id)},`)
  lines.push('  },')
}
lines.push('}')
writeFileSync(join(ROOT, 'src/data/legacyNames.js'), lines.join('\n') + '\n')
console.log(Object.fromEntries(TABLES.map((t) => [t, Object.keys(ids[t]).length])), 'legacy', Object.fromEntries(TABLES.map((t) => [t, Object.keys(legacy[t]).length])))
