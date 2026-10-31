// English. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './en/common.js'
import auth from './en/auth.js'
import day from './en/day.js'
import add from './en/add.js'
import stats from './en/stats.js'
import supps from './en/supps.js'
import social from './en/social.js'
import settings from './en/settings.js'
import ai from './en/ai.js'
import system from './en/system.js'
import data_alcohol from './en/data/alcohol.js'
import data_foods from './en/data/foods.js'
import data_methods from './en/data/methods.js'
import data_micros from './en/data/micros.js'
import data_portions from './en/data/portions.js'
import data_supps from './en/data/supps.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = { ...data_alcohol, ...data_foods, ...data_methods, ...data_micros, ...data_portions, ...data_supps }
