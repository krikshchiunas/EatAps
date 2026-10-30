// English. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './en/common.js'
import auth from './en/auth.js'
import day from './en/day.js'
import add from './en/add.js'

export const strings = merge(common, auth, day, add)
export const data = {}
