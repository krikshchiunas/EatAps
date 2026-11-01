// ─────────────────────────────────────────────────────────────────────────────
// Обмен данными: экспорт отчёта и импорт чужой истории.
//
// Экспорт нужен, чтобы дневник можно было показать врачу, диетологу или тренеру
// и чтобы данные не были заперты в приложении. Два формата:
//   • CSV — построчно все приёмы пищи, открывается в Excel/Numbers/Sheets;
//   • HTML-отчёт для печати — сводка за период; человек печатает его в PDF
//     системным диалогом. Своей PDF-библиотеки не тянем: она весит сотни
//     килобайт и попала бы в офлайн-бандл ради функции, которая нужна изредка.
//
// Импорт снимает барьер перехода с MyFitnessPal и подобных: там экспорт — CSV.
// Колонки у всех разные, поэтому: определяем разделитель, ищем колонки по
// набору синонимов, показываем предпросмотр и только потом пишем в состояние.
// Ничего не импортируем молча — человек должен увидеть, что именно приедет.
// ─────────────────────────────────────────────────────────────────────────────
import { keyOf } from './date.js'
import { dayNutrients } from './stats.js'
import { effectiveMealId } from './meals.js'
import { t, fmtNum } from './i18n.js'
import { unitLabel } from './units.js'
import { entryName } from './foodNames.js'
import { wellbeingLabel } from './insights.js'
import { fold } from './search/normalize.js'
import { matchCatalogFoodSync } from './search/index.js'
import { canonicalName } from './catalog.js'
import { FOODS } from './foods.js'

// ── CSV: экспорт ──────────────────────────────────────────────────────────────

// Экранирование по RFC 4180 + защита от формульной инъекции: ячейка, начинающаяся
// с = + - @, в Excel/Sheets исполняется как формула. Имя продукта из Open Food
// Facts вполне может начинаться с «-», поэтому предваряем апострофом.
function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

// Подпись приёма пищи на языке интерфейса.
function mealLabel(id, day) {
  if (id === 'std:other') return t('exchange.mealOther')
  if (typeof id === 'string' && id.startsWith('std:')) return t(`meal.${id.slice(4)}`)
  return (day?.mealSections || []).find((s) => s.id === id)?.customName || t('exchange.mealDefault')
}

const col = (k) => t(`exchange.col.${k}`)
const unitCell = (u) => unitLabel(u || 'г')

// Построчный экспорт: одна строка = один съеденный продукт. Всё — на языке
// интерфейса: файл открывает врач или тренер, а не приложение. Названия
// продуктов базы — тоже на нём (entryName); свои — как названы.
export function buildMealsCsv(days, keys) {
  const rows = [['date', 'meal', 'food', 'amount', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'sugar', 'satFat'].map(col)]
  for (const k of keys) {
    const day = days?.[k]
    for (const m of day?.meals || []) {
      rows.push([
        k,
        mealLabel(effectiveMealId(m), day),
        entryName(m),
        m.grams ?? '',
        unitCell(m.unit),
        m.kcal ?? '',
        m.protein ?? '',
        m.carbs ?? '',
        m.fat ?? '',
        // Пустая ячейка честнее нуля: значит «не измерено», а не «сахара нет».
        Number.isFinite(Number(m.sugar)) ? m.sugar : '',
        Number.isFinite(Number(m.satFat)) ? m.satFat : '',
      ])
    }
  }
  return toCsv(rows)
}

// Посуточный экспорт: итоги дня, вес, активность, самочувствие.
export function buildDaysCsv(days, keys, targetsFor) {
  const rows = [['date', 'kcal', 'kcalTarget', 'protein', 'carbs', 'fat', 'weight', 'activity', 'wellbeing', 'inStats'].map(col)]
  for (const k of keys) {
    const day = days?.[k]
    if (!day?.meals?.length && day?.weight == null) continue
    const n = dayNutrients(day?.meals || [])
    const target = targetsFor ? targetsFor(k, day) : null
    rows.push([
      k,
      Math.round(n.kcal),
      target?.calories ?? '',
      Math.round(n.protein * 10) / 10,
      Math.round(n.carbs * 10) / 10,
      Math.round(n.fat * 10) / 10,
      day?.weight ?? '',
      day?.activity ?? '',
      (day?.wellbeing || []).map(wellbeingLabel).join(' · '),
      day?.statsExcluded ? t('common.no') : t('common.yes'),
    ])
  }
  return toCsv(rows)
}

// UTF-8 BOM: без него Excel на Windows открывает кириллицу крокозябрами.
export function csvBlob(text) {
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
}

// ── Импорт CSV ────────────────────────────────────────────────────────────────

// Разделитель определяем по первой строке: MyFitnessPal отдаёт запятые,
// европейские выгрузки — точку с запятой, некоторые — табы.
export function detectDelimiter(headerLine) {
  const counts = [',', ';', '\t'].map((d) => [d, (headerLine.match(new RegExp(`\\${d}`, 'g')) || []).length])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

// Разбор строки CSV с учётом кавычек и удвоенных кавычек внутри.
export function parseCsvLine(line, delim) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  // Снимаем защитный апостроф, который сами же ставим при экспорте.
  return out.map((c) => c.trim().replace(/^'(?=[=+\-@])/, ''))
}

// Синонимы колонок: наш экспорт на любом из семи языков (его заголовки
// совпадают с exchange.col в словарях — это проверяет exchange.test.js),
// MyFitnessPal и частые варианты других трекеров. Сравнение — после
// нормализации (регистр, диакритика, пунктуация).
/* @i18n-data */
const COLUMN_SYNONYMS = {
  date: ['дата', 'день', 'date', 'day', 'datum', 'fecha', 'data', 'tarih', 'التاريخ'],
  meal: ['приём пищи', 'прием пищи', 'категория', 'meal', 'meal type', 'mahlzeit', 'comida', 'refeição', 'öğün', 'الوجبة'],
  name: ['продукт', 'название', 'name', 'food', 'food name', 'item', 'description', 'lebensmittel', 'alimento', 'besin', 'الطعام'],
  grams: ['количество', 'вес', 'amount', 'quantity', 'serving', 'grams', 'weight', 'menge', 'cantidad', 'quantidade', 'miktar', 'الكمية'],
  unit: ['единица', 'unit', 'units', 'measure', 'einheit', 'unidad', 'unidade', 'birim', 'الوحدة'],
  kcal: ['ккал', 'калории', 'kcal', 'calories', 'energy', 'cals', 'kalorien', 'calorías', 'calorias', 'kalori', 'السعرات (kcal)', 'السعرات'],
  protein: ['белки', 'белки, г', 'protein', 'protein (g)', 'protein, g', 'eiweiß', 'eiweiß, g', 'proteínas', 'proteínas, g', 'البروتين', 'البروتين، غ'],
  carbs: ['углеводы', 'углеводы, г', 'carbs', 'carbs, g', 'carbohydrates', 'carbohydrates (g)', 'kohlenhydrate', 'kohlenhydrate, g', 'carbohidratos', 'carbohidratos, g', 'carboidratos', 'carboidratos, g', 'karbonhidrat', 'karbonhidrat, g', 'الكربوهيدرات', 'الكربوهيدرات، غ'],
  fat: ['жиры', 'жиры, г', 'fat', 'fat (g)', 'fat, g', 'fett', 'fett, g', 'grasas', 'grasas, g', 'gorduras', 'gorduras, g', 'yağ', 'yağ, g', 'الدهون', 'الدهون، غ'],
  sugar: ['сахар', 'сахар, г', 'sugar', 'sugars', 'sugar, g', 'zucker', 'zucker, g', 'azúcar', 'azúcar, g', 'açúcar', 'açúcar, g', 'şeker', 'şeker, g', 'السكر', 'السكر، غ'],
  satFat: ['насыщ. жиры, г', 'насыщенные жиры', 'saturated fat', 'saturated fat, g', 'sat fat', 'gesättigte fettsäuren, g', 'grasas saturadas, g', 'gorduras saturadas, g', 'doymuş yağ, g', 'الدهون المشبعة، غ'],
}
const FOLDED_SYNONYMS = Object.fromEntries(Object.entries(COLUMN_SYNONYMS).map(([k, v]) => [k, v.map(fold)]))

const cleanHeader = (h) => fold(h)

// Сопоставление «наше поле → индекс колонки». Точное совпадение приоритетнее
// частичного, иначе «Сахар, г» мог бы уехать в колонку «Углеводы». Порядок
// проверки полей важен: насыщенные жиры раньше просто жиров.
export function mapColumns(header) {
  const cleaned = header.map(cleanHeader)
  const map = {}
  const taken = new Set()
  const fields = ['satFat', ...Object.keys(FOLDED_SYNONYMS).filter((f) => f !== 'satFat')]
  for (const field of fields) {
    const names = FOLDED_SYNONYMS[field]
    let idx = cleaned.findIndex((h, i) => !taken.has(i) && names.includes(h))
    if (idx === -1) idx = cleaned.findIndex((h, i) => !taken.has(i) && names.some((n) => h.startsWith(n)))
    if (idx !== -1) { map[field] = idx; taken.add(idx) }
  }
  return map
}

// Дата в разных форматах: 2026-03-01, 01.03.2026, 03/01/2026 (US).
export function parseDate(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/) // ДД.ММ.ГГГГ
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/) // ММ/ДД/ГГГГ — формат MyFitnessPal
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : keyOf(d)
}

/* @i18n-data */
const MEAL_ALIASES = [
  ['std:breakfast', ['завтрак', 'breakfast', 'frühstück', 'desayuno', 'café da manhã', 'kahvaltı', 'فطور', 'إفطار']],
  ['std:lunch', ['обед', 'lunch', 'mittagessen', 'almuerzo', 'comida', 'almoço', 'öğle yemeği', 'غداء']],
  ['std:dinner', ['ужин', 'dinner', 'abendessen', 'cena', 'jantar', 'akşam yemeği', 'عشاء']],
  ['std:snack', ['перекус', 'snack', 'snacks', 'zwischenmahlzeit', 'merienda', 'tentempié', 'lanche', 'ara öğün', 'atıştırmalık', 'وجبة خفيفة']],
].map(([id, names]) => [id, names.map(fold)])

function parseMeal(raw) {
  const s = cleanHeader(String(raw || ''))
  if (!s) return 'std:other'
  for (const [id, names] of MEAL_ALIASES) {
    if (names.some((n) => s.includes(n))) return id
  }
  return 'std:other'
}

// «1,5» → 1.5; «250 g» → 250; мусор → null.
function parseNum(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export const IMPORT_MAX_ROWS = 20000

// Разбор CSV в структуру дней. Ничего не пишет — возвращает предпросмотр.
// Чтобы продукты базы узнавались на всех языках, перед разбором стоит
// дождаться loadSearchNames() (src/lib/search/index.js); без него узнаются
// русские названия и названия на языке интерфейса.
// { days, stats:{rows, imported, skipped, dateRange}, warnings, columns }.
export function parseImportCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '')
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    return { ok: false, error: 'empty' }
  }

  const delim = detectDelimiter(lines[0])
  const header = parseCsvLine(lines[0], delim)
  const cols = mapColumns(header)

  const missing = []
  if (cols.date == null) missing.push('date')
  if (cols.name == null) missing.push('food')
  if (cols.kcal == null) missing.push('kcal')
  if (missing.length) return { ok: false, error: 'missingColumns', missing, header }

  const days = {}
  const warnings = []
  let imported = 0
  let skipped = 0
  let minDate = null
  let maxDate = null

  const limit = Math.min(lines.length, IMPORT_MAX_ROWS + 1)
  for (let i = 1; i < limit; i++) {
    const cells = parseCsvLine(lines[i], delim)
    const dateKey = parseDate(cells[cols.date])
    const name = (cells[cols.name] || '').trim()
    const kcal = parseNum(cells[cols.kcal])

    if (!dateKey || !name || kcal == null) {
      skipped += 1
      if (warnings.length < 5) warnings.push({ code: 'rowSkipped', row: i + 1 })
      continue
    }

    // Название продукта базы на любом языке («Haferflocken, trocken» из
    // немецкой выгрузки) → каноническая запись с id: после импорта она
    // показывается на языке человека. Своё — как записано.
    const catalog = matchCatalogFoodSync(name, FOODS)
    const meal = {
      name: catalog ? canonicalName('foods', catalog) : name,
      ...(catalog ? { foodId: catalog } : {}),
      emoji: '📥',
      mealId: cols.meal != null ? parseMeal(cells[cols.meal]) : 'std:other',
      unit: parseUnit(cols.unit != null ? cells[cols.unit] : ''),
      grams: cols.grams != null ? parseNum(cells[cols.grams]) : null,
      kcal: Math.round(kcal),
      protein: cols.protein != null ? parseNum(cells[cols.protein]) ?? 0 : 0,
      carbs: cols.carbs != null ? parseNum(cells[cols.carbs]) ?? 0 : 0,
      fat: cols.fat != null ? parseNum(cells[cols.fat]) ?? 0 : 0,
      imported: true,
    }
    // Сахар и насыщенные жиры пишем ТОЛЬКО если они реально были в файле:
    // ноль здесь означал бы «измерено и равно нулю» (см. stats.js realSugar).
    if (cols.sugar != null) {
      const v = parseNum(cells[cols.sugar])
      if (v != null) meal.sugar = v
    }
    if (cols.satFat != null) {
      const v = parseNum(cells[cols.satFat])
      if (v != null) meal.satFat = v
    }

    if (!days[dateKey]) days[dateKey] = { meals: [] }
    days[dateKey].meals.push(meal)
    imported += 1
    if (!minDate || dateKey < minDate) minDate = dateKey
    if (!maxDate || dateKey > maxDate) maxDate = dateKey
  }

  if (lines.length - 1 > IMPORT_MAX_ROWS) {
    warnings.push({ code: 'tooManyRows', n: IMPORT_MAX_ROWS })
  }

  if (imported === 0) {
    return { ok: false, error: 'nothingParsed', header, warnings }
  }

  return {
    ok: true,
    days,
    columns: cols,
    header,
    warnings,
    stats: {
      rows: lines.length - 1,
      imported,
      skipped,
      days: Object.keys(days).length,
      from: minDate,
      to: maxDate,
    },
  }
}

// Единица из файла → наш код единицы. «g», «gr», «г», «غ» — граммы.
/* @i18n-data */
const UNIT_ALIASES = { г: 'г', гр: 'г', g: 'г', gr: 'г', gram: 'г', grams: 'г', غ: 'г', غرام: 'г', мл: 'мл', ml: 'мл', مل: 'мл', шт: 'шт', pc: 'шт', pcs: 'шт', stk: 'шт', adet: 'шт' }
function parseUnit(raw) {
  const u = fold(raw)
  return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, u) ? UNIT_ALIASES[u] : u || 'г'
}

// Текст ошибки или предупреждения импорта на языке интерфейса.
export function importErrorText(res) {
  if (!res || res.ok) return ''
  if (res.error === 'missingColumns') {
    return t('exchange.err.missingColumns', { cols: (res.missing || []).map(col).join(', ') })
  }
  return t(`exchange.err.${res.error === 'empty' ? 'empty' : 'nothingParsed'}`)
}
export function importWarningText(w) {
  if (w?.code === 'rowSkipped') return t('exchange.err.rowSkipped', { row: w.row })
  if (w?.code === 'tooManyRows') return t('exchange.err.tooManyRows', { n: fmtNum(w.n) })
  return ''
}
