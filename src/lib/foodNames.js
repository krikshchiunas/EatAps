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
import { catalogId, isCatalogId, methodId } from './catalog.js'

const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
const own = (obj, k) => !!obj && typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k)

// Способ приготовления внутри названия: «Картофель, варёный» → «Potato,
// boiled». Внутри названия перевод идёт со строчной, кроме форм из
// methodsInline: немецкое существительное остаётся с заглавной («Kartoffeln,
// Püree»), английское «French fries» — тоже.
const lower = (s) => s.charAt(0).toLocaleLowerCase(locale()) + s.slice(1)
function methodInline(how, base) {
  const id = methodId(how)
  if (!id) return how
  const agreed = methodFor(base, id)
  if (agreed) return lower(agreed)
  const inline = dataTable('methodsInline')
  if (own(inline, id)) return inline[id]
  return lower(tData('methods', id, how))
}

// Русская форма способа согласована с русским продуктом («Свинина, варёная»),
// а перевод продукта бывает другого рода: по-испански это «Cerdo, cocido».
// Такие пары лежат в methodsFor под ключом «food_pork|method_boiled_f».
function methodFor(base, mid) {
  const fid = catalogId('foods', base)
  if (!fid || !mid) return null
  const table = dataTable('methodsFor')
  const key = `${fid}|${mid}`
  return own(table, key) ? table[key] : null
}

// «Молоко 2.5%» по-немецки — «Milch 2,5 %»: десятичный разделитель свой у
// каждого языка. Запятая между продуктом и способом в арабском — «،».
const pct = (n) => fmtNum(Number(n.replace(',', '.')), { maximumFractionDigits: 2 })
const comma = () => (isRtl() ? '، ' : ', ')

// Название продукта на языке интерфейса. Разбор названия: каталожное русское название,
// «Название 2.5%», «Название, способ». Всё остальное — своё название
// человека — показывается как записано.
// Главное — само название: если человек (или старая версия приложения)
// переименовал запись, id из каталога не должен вернуть прежнее имя.
export function foodName(name, foodId) {
  const id = catalogId('foods', name) || (!name && isCatalogId('foods', foodId) ? foodId : null)
  if (id) return tData('foods', id, name)
  if (!name || getLang() === SOURCE_LANG) return name

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

// Название продукта каталога по его id — на языке интерфейса.
export const catalogName = (id) => tData('foods', id, id)

// Название записи дневника: по id каталога, если он есть, иначе по тексту.
export const entryName = (entry) => (entry ? foodName(entry.name, entry.foodId) : '')

// Способ приготовления на кнопке выбора: «Варёный» → «Boiled». base — продукт,
// к которому способ относится: от него зависит род («Patata cocida»).
export function methodLabel(label, base) {
  const mid = methodId(label)
  if (!mid) return label
  return cap(methodFor(base, mid) ?? tData('methods', mid, label))
}

// Подпись порции или единицы ингредиента: «стакан», «1 шт», «ломтик».
export function portionLabel(label) {
  if (!label) return label
  const id = catalogId('portions', label)
  if (id) return tData('portions', id, label)
  // «2 шт», «1 ломтик» — число и слово по отдельности.
  const m = /^(\d+(?:[.,]\d+)?) (.+)$/.exec(label)
  if (m) {
    const wid = catalogId('portions', m[2])
    if (wid) return `${m[1]} ${tData('portions', wid, m[2])}`
  }
  return label
}

// Названия видов алкоголя и групп («Водка», «Виски»).
export function alcLabel(label) {
  const id = catalogId('alcohol', label)
  return id ? tData('alcohol', id, label) : label
}
