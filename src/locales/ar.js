// العربية. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './ar/common.js'
import auth from './ar/auth.js'
import day from './ar/day.js'
import add from './ar/add.js'
import stats from './ar/stats.js'
import supps from './ar/supps.js'
import social from './ar/social.js'
import settings from './ar/settings.js'
import ai from './ar/ai.js'
import system from './ar/system.js'
import data_alcohol from './ar/data/alcohol.js'
import data_foods from './ar/data/foods.js'
import data_methods from './ar/data/methods.js'
import data_micros from './ar/data/micros.js'
import data_portions from './ar/data/portions.js'
import data_supps from './ar/data/supps.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = { ...data_alcohol, ...data_foods, ...data_methods, ...data_micros, ...data_portions, ...data_supps }
