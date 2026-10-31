// Español. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './es/common.js'
import auth from './es/auth.js'
import day from './es/day.js'
import add from './es/add.js'
import stats from './es/stats.js'
import supps from './es/supps.js'
import social from './es/social.js'
import settings from './es/settings.js'
import ai from './es/ai.js'
import system from './es/system.js'
import data_alcohol from './es/data/alcohol.js'
import data_foods from './es/data/foods.js'
import data_methods from './es/data/methods.js'
import data_micros from './es/data/micros.js'
import data_portions from './es/data/portions.js'
import data_supps from './es/data/supps.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = { ...data_alcohol, ...data_foods, ...data_methods, ...data_micros, ...data_portions, ...data_supps }
