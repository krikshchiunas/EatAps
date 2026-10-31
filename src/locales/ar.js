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

export const strings = merge(common, auth, day, add, stats, supps, social, settings)
export const data = {}
