// Подпись единицы на языке интерфейса. В данных единица хранится русским
// словом ('г', 'мл', 'мг'…) — это значение, по нему считают и сравнивают, а
// не подпись. Неизвестная единица показывается как есть.
import { t } from './i18n.js'

const LABEL = {
  'г': 'units.g',
  'мл': 'units.ml',
  'шт': 'units.pcs',
  'порция': 'units.servingWord',
  'ккал': 'units.kcal',
  'кг': 'units.kg',
  'см': 'units.cm',
  'мг': 'units.mg',
  'мкг': 'units.mcg',
  'млрд КОЕ': 'units.cfu',
}

export const unitLabel = (unit) => (LABEL[unit] ? t(LABEL[unit]) : unit)
