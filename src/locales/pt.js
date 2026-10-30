// Português. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './pt/common.js'
import auth from './pt/auth.js'
import day from './pt/day.js'
import add from './pt/add.js'

export const strings = merge(common, auth, day, add)
export const data = {}
