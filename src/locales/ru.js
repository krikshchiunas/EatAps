// Русский — исходный язык. Новая строка появляется здесь первой, остальные
// языки повторяют те же ключи (это проверяет src/lib/i18n.test.js).
import { merge } from './merge.js'
import common from './ru/common.js'
import auth from './ru/auth.js'
import day from './ru/day.js'
import system from './ru/system.js'

export const strings = merge(common, auth, day, system)
export const data = {}
