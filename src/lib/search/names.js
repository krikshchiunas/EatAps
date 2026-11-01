// ─────────────────────────────────────────────────────────────────────────────
// Названия и синонимы на ВСЕХ языках — для поиска. Ленивый чанк: грузится
// после старта (или при первом открытии поиска) и кэшируется service worker'ом
// для офлайна (scripts/inject-precache.mjs проверяет это при сборке).
//
// Поиск не ограничен языком интерфейса: немецкий интерфейс находит
// «овсянку», арабский — «oat milk». Для этого нужны словари всех языков сразу,
// а пакет языка интерфейса содержит только свой.
// ─────────────────────────────────────────────────────────────────────────────
import enF from '../../locales/en/data/foods.js'
import deF from '../../locales/de/data/foods.js'
import esF from '../../locales/es/data/foods.js'
import ptF from '../../locales/pt/data/foods.js'
import trF from '../../locales/tr/data/foods.js'
import arF from '../../locales/ar/data/foods.js'
import enS from '../../locales/en/data/supps.js'
import deS from '../../locales/de/data/supps.js'
import esS from '../../locales/es/data/supps.js'
import ptS from '../../locales/pt/data/supps.js'
import trS from '../../locales/tr/data/supps.js'
import arS from '../../locales/ar/data/supps.js'
import aliases from './aliases.js'

export default {
  foods: { en: enF.foods, de: deF.foods, es: esF.foods, pt: ptF.foods, tr: trF.foods, ar: arF.foods },
  supps: { en: enS.supps, de: deS.supps, es: esS.supps, pt: ptS.supps, tr: trS.supps, ar: arS.supps },
  aliases,
}
