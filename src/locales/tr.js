// Türkçe. Ключи те же, что в ru.js; чего здесь нет, покажется по-русски.
import { merge } from './merge.js'
import common from './tr/common.js'
import auth from './tr/auth.js'
import day from './tr/day.js'

export const strings = merge(common, auth, day)
export const data = {}
