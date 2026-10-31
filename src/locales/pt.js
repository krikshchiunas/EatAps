// Português. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './pt/common.js'
import auth from './pt/auth.js'
import day from './pt/day.js'
import add from './pt/add.js'
import stats from './pt/stats.js'
import supps from './pt/supps.js'
import social from './pt/social.js'
import settings from './pt/settings.js'
import ai from './pt/ai.js'
import system from './pt/system.js'
import data_foods from './pt/data/foods.js'
import data_methods from './pt/data/methods.js'
import data_portions from './pt/data/portions.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = { ...data_foods, ...data_methods, ...data_portions }
