// Deutsch. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './de/common.js'
import auth from './de/auth.js'
import day from './de/day.js'

export const strings = merge(common, auth, day)
export const data = {}
