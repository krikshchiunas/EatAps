// Deutsch. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './de/common.js'
import auth from './de/auth.js'
import day from './de/day.js'
import add from './de/add.js'
import stats from './de/stats.js'
import supps from './de/supps.js'
import social from './de/social.js'
import settings from './de/settings.js'
import ai from './de/ai.js'
import system from './de/system.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = {}
