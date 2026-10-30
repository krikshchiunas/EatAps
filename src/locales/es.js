// Español. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './es/common.js'
import auth from './es/auth.js'
import day from './es/day.js'
import add from './es/add.js'
import stats from './es/stats.js'
import supps from './es/supps.js'

export const strings = merge(common, auth, day, add, stats, supps)
export const data = {}
