// Português. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './pt/common.js'
import auth from './pt/auth.js'
import day from './pt/day.js'
import add from './pt/add.js'
import stats from './pt/stats.js'
import supps from './pt/supps.js'
import social from './pt/social.js'

export const strings = merge(common, auth, day, add, stats, supps, social)
export const data = {}
