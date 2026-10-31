// Türkçe. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './tr/common.js'
import auth from './tr/auth.js'
import day from './tr/day.js'
import add from './tr/add.js'
import stats from './tr/stats.js'
import supps from './tr/supps.js'
import social from './tr/social.js'
import settings from './tr/settings.js'
import ai from './tr/ai.js'
import system from './tr/system.js'
import data_alcohol from './tr/data/alcohol.js'
import data_foods from './tr/data/foods.js'
import data_methods from './tr/data/methods.js'
import data_micros from './tr/data/micros.js'
import data_portions from './tr/data/portions.js'
import data_supps from './tr/data/supps.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = { ...data_alcohol, ...data_foods, ...data_methods, ...data_micros, ...data_portions, ...data_supps }
