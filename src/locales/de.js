// Deutsch. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './de/common.js'
import auth from './de/auth.js'
import day from './de/day.js'
import add from './de/add.js'
import stats from './de/stats.js'
import supps from './de/supps.js'

export const strings = merge(common, auth, day, add, stats, supps)
export const data = {}
