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

export const strings = merge(common, auth, day, add, stats, supps, social, settings)
export const data = {}
