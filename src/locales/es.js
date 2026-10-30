// Español. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './es/common.js'
import auth from './es/auth.js'
import day from './es/day.js'

export const strings = merge(common, auth, day)
export const data = {}
