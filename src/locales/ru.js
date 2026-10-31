// Русский — исходный язык. Новая строка появляется здесь первой, остальные
// языки повторяют те же ключи (это проверяет src/lib/i18n.test.js).
import { merge } from './merge.js'
import common from './ru/common.js'
import auth from './ru/auth.js'
import day from './ru/day.js'
import add from './ru/add.js'
import stats from './ru/stats.js'
import supps from './ru/supps.js'
import social from './ru/social.js'
import settings from './ru/settings.js'
import ai from './ru/ai.js'
import system from './ru/system.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system)
export const data = {}
