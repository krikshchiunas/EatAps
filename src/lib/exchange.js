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

const MEAL_LABEL = {
  'std:breakfast': 'Завтрак',
  'std:lunch': 'Обед',
  'std:dinner': 'Ужин',
  'std:snack': 'Перекус',
  'std:other': 'Без категории',
}

// Построчный экспорт: одна строка = один съеденный продукт.
export function buildMealsCsv(days, keys) {
  const rows = [[
    'Дата', 'Приём пищи', 'Продукт', 'Количество', 'Единица',
    'Ккал', 'Белки, г', 'Углеводы, г', 'Жиры, г', 'Сахар, г', 'Насыщ. жиры, г',
  ]]
  for (const k of keys) {
    const day = days?.[k]
    for (const m of day?.meals || []) {
      const id = effectiveMealId(m)
      rows.push([
        k,
        MEAL_LABEL[id] || (day?.mealSections || []).find((s) => s.id === id)?.customName || 'Приём пищи',
        m.name,
        m.grams ?? '',
        m.unit || 'г',
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
  const rows = [[
    'Дата', 'Ккал', 'Цель ккал', 'Белки, г', 'Углеводы, г', 'Жиры, г',
    'Вес, кг', 'Активность', 'Самочувствие', 'Учтён в статистике',
  ]]
  for (const k of keys) {
    const day = days?.[k]
    if (!day?.meals?.length && day?.weight == null) continue
    const n = dayNutrients(day?.meals || [])
    const t = targetsFor ? targetsFor(k, day) : null
    rows.push([
      k,
      Math.round(n.kcal),
      t?.calories ?? '',
      Math.round(n.protein * 10) / 10,
      Math.round(n.carbs * 10) / 10,
      Math.round(n.fat * 10) / 10,
      day?.weight ?? '',
      day?.activity ?? '',
      (day?.wellbeing || []).join(' · '),
      day?.statsExcluded ? 'нет' : 'да',
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

// Синонимы колонок. MyFitnessPal англоязычный, наш экспорт — русский;
// поддерживаем оба, плюс частые варианты из других трекеров.
const COLUMN_SYNONYMS = {
  date: ['дата', 'date', 'day', 'день'],
  meal: ['приём пищи', 'прием пищи', 'meal', 'meal type', 'категория'],
  name: ['продукт', 'название', 'name', 'food', 'food name', 'item', 'description'],
  grams: ['количество', 'вес', 'amount', 'quantity', 'serving', 'grams', 'weight'],
  unit: ['единица', 'unit', 'units', 'measure'],
  kcal: ['ккал', 'калории', 'kcal', 'calories', 'energy', 'cals'],
  protein: ['белки', 'белки, г', 'protein', 'protein (g)'],
  carbs: ['углеводы', 'углеводы, г', 'carbs', 'carbohydrates', 'carbohydrates (g)'],
  fat: ['жиры', 'жиры, г', 'fat', 'fat (g)'],
  sugar: ['сахар', 'сахар, г', 'sugar', 'sugars'],
  satFat: ['насыщ. жиры, г', 'насыщенные жиры', 'saturated fat', 'sat fat'],
}

const cleanHeader = (h) => h.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

// Сопоставление «наше поле → индекс колонки». Точное совпадение приоритетнее
// частичного, иначе «Сахар, г» мог бы уехать в колонку «Углеводы».
export function mapColumns(header) {
  const cleaned = header.map(cleanHeader)
  const map = {}
  for (const [field, names] of Object.entries(COLUMN_SYNONYMS)) {
    let idx = cleaned.findIndex((h) => names.includes(h))
    if (idx === -1) idx = cleaned.findIndex((h) => names.some((n) => h.startsWith(n)))
    if (idx !== -1) map[field] = idx
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

const MEAL_ALIASES = [
  ['std:breakfast', ['завтрак', 'breakfast']],
  ['std:lunch', ['обед', 'lunch']],
  ['std:dinner', ['ужин', 'dinner']],
  ['std:snack', ['перекус', 'snack', 'snacks']],
]

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

// Разбор CSV в структуру дней. Ничего не пишет — возвращает предпросмотр:
// { days, stats:{rows, imported, skipped, dateRange}, warnings, columns }.
export function parseImportCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '')
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    return { ok: false, error: 'Файл пустой или в нём только заголовок.' }
  }

  const delim = detectDelimiter(lines[0])
  const header = parseCsvLine(lines[0], delim)
  const cols = mapColumns(header)

  const missing = []
  if (cols.date == null) missing.push('дата')
  if (cols.name == null) missing.push('название продукта')
  if (cols.kcal == null) missing.push('калории')
  if (missing.length) {
    return {
      ok: false,
      error: `Не нашли обязательные колонки: ${missing.join(', ')}.`,
      header,
    }
  }

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
      if (warnings.length < 5) warnings.push(`Строка ${i + 1}: пропущена (нет даты, названия или калорий).`)
      continue
    }

    const meal = {
      name,
      emoji: '📥',
      mealId: cols.meal != null ? parseMeal(cells[cols.meal]) : 'std:other',
      unit: (cols.unit != null && cells[cols.unit]?.trim()) || 'г',
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
    warnings.push(`В файле больше ${IMPORT_MAX_ROWS} строк — импортированы первые ${IMPORT_MAX_ROWS}.`)
  }

  if (imported === 0) {
    return { ok: false, error: 'Не удалось разобрать ни одной строки. Проверьте формат файла.', header, warnings }
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
