// ─────────────────────────────────────────────────────────────────────────────
// Каталог канонических сущностей EatAps: продукты базы, способы приготовления,
// порции, виды алкоголя. У каждой — стабильный id (food_oatmeal, method_boiled,
// portion_glass, alcohol_vodka), который не меняется никогда.
//
// Названия на всех языках, включая русский, лежат в словарях по id:
// src/locales/<код>/data/<таблица>.js. Русское название — исходное: именно
// оно записано в дневниках, избранном и шаблонах у старых записей. Поэтому
// здесь живёт слой совместимости «старое русское название → id»: запись,
// сделанная год назад, находит свой продукт и показывается на языке человека.
//
// Чего здесь нет и не будет: перевода произвольных пользовательских названий.
// «Бабушкин борщ» в каталоге не найдётся и покажется так, как его назвали.
// ─────────────────────────────────────────────────────────────────────────────
import ruFoods from '../locales/ru/data/foods.js'
import ruMethods from '../locales/ru/data/methods.js'
import ruPortions from '../locales/ru/data/portions.js'
import ruAlcohol from '../locales/ru/data/alcohol.js'
import legacyNames from '../data/legacyNames.js'

export const TABLES = ['foods', 'methods', 'portions', 'alcohol']

const RU = {
  foods: ruFoods.foods,
  methods: ruMethods.methods,
  portions: ruPortions.portions,
  alcohol: ruAlcohol.alcohol,
}

// Объекты-словари строятся без прототипа: ключ из пользовательского ввода
// («__proto__», «constructor») не должен найти ничего, кроме своих данных.
const dict = () => Object.create(null)
const fold = (s) => String(s).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

const byName = {}
const byFold = {}
for (const table of TABLES) {
  byName[table] = dict()
  byFold[table] = dict()
  for (const [id, name] of Object.entries(RU[table])) {
    byName[table][name] = id
    byFold[table][fold(name)] ??= id
  }
  for (const [name, id] of Object.entries(legacyNames[table] || {})) {
    byName[table][name] ??= id
    byFold[table][fold(name)] ??= id
  }
}

const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)

// Это id сущности таблицы?
export const isCatalogId = (table, id) => !!RU[table] && own(RU[table], id)

// Название или id → id; null, если в каталоге такого нет (своё блюдо
// человека, товар по штрихкоду, ответ ИИ без совпадения).
export function catalogId(table, nameOrId) {
  if (!RU[table] || typeof nameOrId !== 'string' || !nameOrId) return null
  if (own(RU[table], nameOrId)) return nameOrId
  if (own(byName[table], nameOrId)) return byName[table][nameOrId]
  const f = fold(nameOrId)
  return own(byFold[table], f) ? byFold[table][f] : null
}

// id → исходное (русское) название. Оно же записывается в name новой записи:
// так дневник остаётся читаемым для старых версий приложения и синхронизации.
export const canonicalName = (table, id) => (isCatalogId(table, id) ? RU[table][id] : null)

// Все id таблицы — для поиска и тестов полноты переводов.
export const catalogIds = (table) => Object.keys(RU[table] || {})

// Метод приготовления по его записи внутри названия («варёная») — без учёта
// регистра: на кнопке он с заглавной, в названии — со строчной.
export const methodId = (how) => catalogId('methods', how)

// Ссылка на каталог для записи дневника по её названию:
//   «Овсяные хлопья сухие»   → { foodId }
//   «Картофель, варёный»     → { foodId: картофель, methodId: варёный }
//   «Молоко 2.5%»            → { foodId: молоко }
// null — название не каталожное.
export function catalogRef(name) {
  if (typeof name !== 'string' || !name) return null
  const exact = catalogId('foods', name)
  if (exact) return { foodId: exact }
  const pct = /^(.+) (\d+(?:[.,]\d+)?)%$/.exec(name)
  if (pct) {
    const base = catalogId('foods', pct[1])
    if (base) return { foodId: base }
  }
  const i = name.lastIndexOf(', ')
  if (i > 0) {
    const base = catalogId('foods', name.slice(0, i))
    const how = methodId(name.slice(i + 2))
    if (base && how) return { foodId: base, methodId: how }
  }
  return null
}

// Запись из каталога получает стабильный id продукта (и способа
// приготовления): он связывает её с базой независимо от языка. name остаётся
// каноническим русским — его читают старые версии приложения, синхронизация
// и экспорт. Своё название человека каталожным не станет: catalogRef его не
// узнает, и id снимается. Ссылка пересчитывается при КАЖДОЙ записи, в том числе
// при правке: переименованная запись не должна тянуть за собой чужой id.
export function withCatalogRef(food) {
  if (!food || typeof food !== 'object') return food
  const { foodId: _f, methodId: _m, ...rest } = food
  const ref = catalogRef(food.name)
  return ref ? { ...rest, ...ref } : rest
}
