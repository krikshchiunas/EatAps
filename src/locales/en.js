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

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = {}
