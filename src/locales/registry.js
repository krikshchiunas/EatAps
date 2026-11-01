// ─────────────────────────────────────────────────────────────────────────────
// Реестр языков — единственный источник правды о том, какие языки есть.
//
// Отсюда читают:
//   • src/lib/i18n.js — выбор, загрузка пакета, Intl-локаль, направление;
//   • vite-plugin-i18n-boot (vite.config.js) — встраивает в index.html реестр
//     и функции выбора языка ниже, чтобы <html lang/dir> встали ДО загрузки
//     приложения и аварийный экран говорил на языке человека;
//   • scripts/inject-precache.mjs — проверяет, что пакет каждого языка попал
//     в офлайн-кэш, и роняет сборку, если нет;
//   • тесты и E2E — перебирают языки отсюда, а не из своего списка.
//
// Новый язык добавляется ОДНОЙ записью здесь + папкой src/locales/<code>/ +
// загрузчиком в LOADERS (src/lib/i18n.js). Всё остальное подхватится, а чего
// не хватает — скажут тесты (см. docs/i18n.md).
//
// code       — ключ языка в хранилище и в папке словарей. Менять нельзя: он
//              записан у людей в localStorage.
// matches    — теги браузера, которые ведут на этот язык. Точное совпадение
//              («pt-PT») сильнее совпадения по основе («pt-*»), поэтому
//              европейский португальский можно будет добавить отдельной записью,
//              не трогая бразильский.
// intlLocale — локаль для Intl (числа, даты, множественное число). У арабского
//              цифры латинские: числа в приложении вводятся ими, и «١٢٠ ккал»
//              рядом с «120 г» читается хуже любой из записей.
// name       — название на самом языке: человек, случайно включивший незнакомый
//              язык, должен найти свой, не умея прочитать ни одной подписи.
// ─────────────────────────────────────────────────────────────────────────────

export var LANGUAGES = [
  { code: 'ru', name: 'Русский', englishName: 'Russian', dir: 'ltr', intlLocale: 'ru-RU', matches: ['ru', 'ru-*'], enabled: true },
  { code: 'en', name: 'English', englishName: 'English', dir: 'ltr', intlLocale: 'en-GB', matches: ['en', 'en-*'], enabled: true },
  { code: 'de', name: 'Deutsch', englishName: 'German', dir: 'ltr', intlLocale: 'de-DE', matches: ['de', 'de-*'], enabled: true },
  { code: 'es', name: 'Español', englishName: 'Spanish', dir: 'ltr', intlLocale: 'es-ES', matches: ['es', 'es-*'], enabled: true },
  // Перевод бразильский: «você», «celular», «café da manhã». Код остаётся «pt»
  // (он уже сохранён у людей), а pt-PT, когда появится, встанет рядом отдельной
  // записью с matches: ['pt-PT', 'pt-AO', …].
  { code: 'pt', name: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', dir: 'ltr', intlLocale: 'pt-BR', matches: ['pt', 'pt-*'], enabled: true },
  { code: 'tr', name: 'Türkçe', englishName: 'Turkish', dir: 'ltr', intlLocale: 'tr-TR', matches: ['tr', 'tr-*'], enabled: true },
  { code: 'ar', name: 'العربية', englishName: 'Arabic', dir: 'rtl', intlLocale: 'ar-u-nu-latn', matches: ['ar', 'ar-*'], enabled: true },
]

// Исходный язык: на нём пишутся строки и хранятся названия продуктов базы.
// Он вшит в основной бандл и подстраховывает любой ключ, которого нет в пакете.
export var SOURCE_LANG = 'ru'
// Язык первого запуска, если языка устройства у нас нет (французский,
// итальянский, польский…): английский поймут чаще прочих.
export var FALLBACK_LANG = 'en'
// Единственный ключ хранения выбранного языка.
export var LANG_KEY = 'eataps:lang'
// Ключи, по которым узнаётся установка, созданная до появления языков. Такой
// человек читал EatAps по-русски — переключать его на язык браузера посреди
// привычного дневника было бы сюрпризом.
export var LEGACY_INSTALL_KEYS = ['eataps:v1']
export var LEGACY_INSTALL_PREFIXES = ['eataps:state:']

// ── Функции ниже встраиваются в index.html как есть (Function#toString). ──────
// Поэтому они написаны на ES5, без замыканий на модуль и без импортов: всё,
// что им нужно, приходит аргументами. Менять стиль нельзя — см. тест
// «функции выбора языка пригодны для встраивания» в i18n.test.js.

// Тег браузера → код поддерживаемого языка или ''.
// Сначала точное совпадение с любым тегом реестра, потом совпадение по основе
// («de-AT» → «de-*»). Регистр и «_» вместо «-» не важны.
export function matchLanguage(tag, langs) {
  var t = String(tag == null ? '' : tag).trim().replace(/_/g, '-').toLowerCase()
  if (!t) return ''
  var base = t.split('-')[0]
  var i, j, m
  for (i = 0; i < langs.length; i++) {
    if (langs[i].enabled === false) continue
    for (j = 0; j < langs[i].matches.length; j++) {
      if (langs[i].matches[j].toLowerCase() === t) return langs[i].code
    }
  }
  for (i = 0; i < langs.length; i++) {
    if (langs[i].enabled === false) continue
    for (j = 0; j < langs[i].matches.length; j++) {
      m = langs[i].matches[j].toLowerCase()
      if (m === base || m === base + '-*') return langs[i].code
    }
  }
  return ''
}

// Сохранённое значение → код языка или ''. Понимает старые и испорченные
// форматы: «de», « DE », «de-DE», JSON {"code":"de"} и '"de"'. Всё прочее —
// пусто (а не исключение): кривое значение не должно ронять запуск.
export function readStoredLanguage(raw, langs) {
  if (raw == null) return ''
  var s = String(raw).trim()
  if (!s || s.length > 64) return ''
  if (s.charAt(0) === '{' || s.charAt(0) === '"') {
    try {
      var v = JSON.parse(s)
      s = v && typeof v === 'object' ? String(v.code || v.lang || '') : String(v)
    } catch (e) {
      return ''
    }
  }
  var i
  for (i = 0; i < langs.length; i++) {
    if (langs[i].enabled !== false && langs[i].code.toLowerCase() === s.toLowerCase()) return langs[i].code
  }
  return matchLanguage(s, langs)
}

// Язык запуска. Порядок:
//   1. язык, сохранённый на устройстве (выбранный человеком или определённый
//      при первом запуске) — он главнее всего, включая язык телефона;
//   2. установка старше языков (есть данные, нет выбора) — русский;
//   3. первый поддерживаемый язык из настроек устройства (navigator.languages);
//   4. английский.
// env: { stored, legacyInstall, preferred[], langs, source, fallback }
export function detectLanguage(env) {
  var langs = env.langs
  var saved = readStoredLanguage(env.stored, langs)
  if (saved) return saved
  if (env.legacyInstall) return env.source
  var prefs = env.preferred || []
  for (var i = 0; i < prefs.length; i++) {
    var code = matchLanguage(prefs[i], langs)
    if (code) return code
  }
  return env.fallback
}

// Есть ли в хранилище данные установки, созданной до появления языков.
// storage — localStorage или его подобие ({ length, key(i) }).
export function hasLegacyInstall(storage, keys, prefixes) {
  try {
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i) || ''
      if (keys.indexOf(k) !== -1) return true
      for (var j = 0; j < prefixes.length; j++) if (k.indexOf(prefixes[j]) === 0) return true
    }
  } catch (e) {}
  return false
}

// Языки устройства в порядке предпочтения.
export function deviceLanguages(nav) {
  if (!nav) return []
  if (nav.languages && nav.languages.length) return Array.prototype.slice.call(nav.languages)
  return nav.language ? [nav.language] : []
}
