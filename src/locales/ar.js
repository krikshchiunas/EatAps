// العربية. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './ar/common.js'
import auth from './ar/auth.js'
import day from './ar/day.js'
import add from './ar/add.js'

export const strings = merge(common, auth, day, add)
export const data = {}
