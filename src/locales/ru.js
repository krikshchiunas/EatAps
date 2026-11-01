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
import progress from './ru/progress.js'
// Названия сущностей каталога по id (см. src/lib/catalog.js). Русские —
// исходные; переводы других языков лежат в их data/ по тем же id.
import data_foods from './ru/data/foods.js'
import data_methods from './ru/data/methods.js'
import data_portions from './ru/data/portions.js'
import data_alcohol from './ru/data/alcohol.js'

export const strings = merge(common, auth, day, add, stats, supps, social, settings, ai, system, progress)
export const data = { ...data_alcohol, ...data_foods, ...data_methods, ...data_portions }
