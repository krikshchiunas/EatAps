// ─────────────────────────────────────────────────────────────────────────────
// Названия продуктов на языке интерфейса.
//
// В дневнике, избранном и шаблонах хранится исходное название из базы — оно же
// ключ: по нему находятся микронутриенты, порции, история, по нему же
// nutrition.js отличает сахар от крупы. Поэтому переводится только показ, а
// записанное остаётся прежним. Своё название человека («Бабушкин борщ») или
// товар из Open Food Facts в таблицах не найдутся и покажутся как есть — ровно
// так, как их записали.
//
// Часть названий складывается из кусков прямо при добавлении: «Картофель,
// варёный», «Молоко 2.5%», «Сахар, 2 ч.л.». Их тоже разбираем на части, иначе
// у человека с английским интерфейсом половина дневника осталась бы русской.
// ─────────────────────────────────────────────────────────────────────────────
import { t, tData, dataTable, getLang, locale, fmtNum, isRtl, SOURCE_LANG } from './i18n.js'

const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)

// Способ приготовления в названии записан со строчной («Картофель, варёный»),
// а в таблице ключи — как на кнопках, с заглавной. Строчная копия таблицы —
// одна на язык. Внутри названия перевод тоже идёт со строчной («Potato,
// boiled»), кроме слов из methodsInline: немецкое существительное остаётся
// с заглавной («Kartoffeln, Püree»), английское «French fries» — тоже.
let inlineFor = null
let inlineMap = null
const lower = (s) => s.charAt(0).toLocaleLowerCase(locale()) + s.slice(1)
function methodInline(how, base) {
  const table = dataTable('methods')
  if (!table) return how
  if (inlineFor !== getLang()) {
    const keep = dataTable('methodsInline') || {}
    inlineMap = {}
    for (const [k, v] of Object.entries(table)) {
      const key = k.toLowerCase()
      inlineMap[key] = keep[key] ?? lower(v)
    }
    inlineFor = getLang()
  }
  const agreed = methodFor(base, how)
  return agreed ? lower(agreed) : inlineMap[how] ?? how
}

// Русская форма способа согласована с русским продуктом («Свинина, варёная»),
// а перевод продукта бывает другого рода: по-испански это «Cerdo, cocido».
// Такие пары лежат в methodsFor под ключом «Свинина|варёная».
function methodFor(base, how) {
  if (!base || !how) return null
  return dataTable('methodsFor')?.[`${base}|${how.toLowerCase()}`] ?? null
}

// «Молоко 2.5%» по-немецки — «Milch 2,5 %»: десятичный разделитель свой у
// каждого языка. Запятая между продуктом и способом в арабском — «،».
const pct = (n) => fmtNum(Number(n.replace(',', '.')), { maximumFractionDigits: 2 })
const comma = () => (isRtl() ? '، ' : ', ')

export function foodName(name) {
  if (!name || getLang() === SOURCE_LANG) return name
  const exact = tData('foods', name)
  if (exact !== name) return exact

  // «Молоко 2.5%», «Absolut 40%» — жирность или крепость после названия.
  let m = /^(.+) (\d+(?:[.,]\d+)?)%$/.exec(name)
  if (m) return `${foodName(m[1])} ${pct(m[2])}%`

  // Сахар к горячему напитку и протеиновый шейк — их название собирает лист
  // добавления вместе с числом.
  m = /^Сахар, (\d+(?:[.,]\d+)?) ч\.л\.$/.exec(name)
  if (m) return t('foodPattern.sugarTsp', { n: m[1] })
  m = /^Протеиновый шейк на молоке (\d+(?:[.,]\d+)?) мл$/.exec(name)
  if (m) return t('foodPattern.shakeMilk', { n: m[1] })

  // «Своя водка» — крепкий напиток, для которого человек сам ввёл крепость.
  m = /^Сво[яйеё] (.+)$/.exec(name)
  if (m) {
    const label = alcLabel(cap(m[1]))
    if (label !== cap(m[1])) return t('foodPattern.ownSpirit', { name: label })
  }

  // «Картофель, варёный» — продукт и способ приготовления.
  const i = name.lastIndexOf(', ')
  if (i > 0) {
    const base = name.slice(0, i)
    const how = name.slice(i + 2)
    const b = foodName(base)
    const h = methodInline(how, base)
    if (b !== base || h !== how) return `${b}${comma()}${h}`
  }
  return name
}

// Способ приготовления на кнопке выбора: «Варёный» → «Boiled». base — продукт,
// к которому способ относится: от него зависит род («Patata cocida»).
export const methodLabel = (label, base) => cap(methodFor(base, label) ?? tData('methods', label))

// Подпись порции или единицы ингредиента: «стакан», «1 шт», «ломтик».
export function portionLabel(label) {
  if (!label || getLang() === SOURCE_LANG) return label
  const exact = tData('portions', label)
  if (exact !== label) return exact
  // «2 шт», «1 ломтик» — число и слово по отдельности.
  const m = /^(\d+(?:[.,]\d+)?) (.+)$/.exec(label)
  if (m) {
    const word = tData('portions', m[2])
    if (word !== m[2]) return `${m[1]} ${word}`
  }
  return label
}

// Названия видов алкоголя и групп («Водка», «Виски»).
export const alcLabel = (label) => tData('alcohol', label)
