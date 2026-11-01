// @i18n-data-file — таблицы букв, окончаний и раскладок для нормализации поиска.
// ─────────────────────────────────────────────────────────────────────────────
// Нормализация текста для поиска на всех семи языках.
//
// Одно намерение человек набирает по-разному: с умлаутом и без, «ß» и «ss»,
// турецкую «ı» латинской «i», арабское слово с огласовками и без, цифры
// арабские и латинские, «hot-dog», «hot dog» и «hotdog». Всё это должно вести
// к одной и той же строке — и запрос, и названия в индексе проходят ровно
// этот конвейер.
//
// Что делается (по порядку):
//   1. Цифры: арабско-индийские (٠–٩) и персидские (۰–۹) → 0–9; «2,5» → «2.5».
//   2. Регистр: toLowerCase без локали — турецкая «İ» даёт «i̇», точку снимает
//      шаг 3. Особые буквы: ı→i, ß→ss, œ→oe, æ→ae, ø→o, ł→l, đ→d.
//   3. NFD и снятие всех комбинируемых знаков: á→a, ü→u, ç→c, ş→s, ğ→g,
//      ñ→n, ã→a, ё→е, й→и. Снятие у «ñ» сознательное: «pina» набирают чаще,
//      чем «piña», а пар еды, которые различает только тильда, в базе нет.
//      Точное написание с диакритикой всё равно выигрывает — см. exact в rank.js.
//   4. Арабский: огласовки (ташкиль), надстрочный алиф и татвиль убираются;
//      أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, персидские ک/ی → ك/ي.
//   5. Апострофы (’ ' ` ʼ) склеивают слово: «women’s» → «womens».
//   6. Остальная пунктуация, дефисы, слэши → пробел; «%» и точка между
//      цифрами остаются («молоко 3.2%» — осмысленный запрос).
//   7. Пробелы схлопываются.
//
// Над-нормализации нет: буквы не заменяются «похожими» между разными словами
// (молоко ≠ малако здесь; сближение по звучанию — отдельный слабый тир).
// ─────────────────────────────────────────────────────────────────────────────

const COMBINING = /[̀-ͯ]/g
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g
const APOSTROPHES = /['’‘`ʼʹ′]/g
const LETTERS = {
  ı: 'i', ß: 'ss', œ: 'oe', æ: 'ae', ø: 'o', ł: 'l', đ: 'd', þ: 'th', ð: 'd',
  أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي', ة: 'ه', ؤ: 'و', ئ: 'ي', ک: 'ك', ی: 'ي', ە: 'ه',
}
const LETTER_RE = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'g')
// Всё, что не буква, не цифра, не «%» и не точка — разделитель.
const SEPARATORS = /[^\p{L}\p{N}%.]+/gu

const MAX_INPUT = 200

export function fold(input) {
  let s = String(input ?? '')
  if (s.length > MAX_INPUT) s = s.slice(0, MAX_INPUT)
  s = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(LETTER_RE, (c) => LETTERS[c])
    .normalize('NFD')
    .replace(COMBINING, '')
    .normalize('NFC')
    .replace(ARABIC_MARKS, '')
    .replace(LETTER_RE, (c) => LETTERS[c])
    .replace(APOSTROPHES, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(SEPARATORS, ' ')
  // Точка, не стоящая между цифрами, — пунктуация. Без lookbehind: его нет в
  // Safari до 16.4, и ошибка разбора уронила бы весь модуль.
  s = s.replace(/\./g, (m, i, str) => (/\d/.test(str[i - 1] || '') && /\d/.test(str[i + 1] || '') ? '.' : ' '))
  return s.replace(/\s+/g, ' ').trim()
}

export const tokens = (folded) => (folded ? folded.split(' ') : [])
export const compact = (folded) => folded.replace(/ /g, '')

const CYR = /[а-я]/
const ARABIC = /[ء-ي]/
export const scriptOf = (s) => (CYR.test(s) ? 'cyr' : ARABIC.test(s) ? 'arab' : /[a-z]/.test(s) ? 'latn' : 'other')

// ── Лёгкий стемминг ─────────────────────────────────────────────────────────
// Отрезаем ОДНО окончание, и только если остаётся достаточно длинная основа.
// Этого хватает, чтобы «бананы» нашли «банан», «oats» — «oat», «Tomaten» —
// «Tomate», «elmalar» — «elma», «التفاح» — «تفاح», и мало, чтобы склеить
// разные продукты. Язык запроса неизвестен, поэтому правила — по письменности.
const CYR_ENDINGS = ['ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ой', 'ей', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ов', 'ев', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'а', 'я', 'ы', 'и', 'о', 'е', 'у', 'ю', 'ь']
const LAT_ENDINGS = ['leri', 'lari', 'ler', 'lar', 'ies', 'oes', 'es', 'en', 'er', 's', 'e', 'n', 'i', 'u']
const AR_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال']
const AR_SUFFIXES = ['ات', 'ون', 'ين', 'ان', 'ه', 'ي']

export function stem(token) {
  if (!token || /\d/.test(token)) return token
  if (CYR.test(token)) {
    if (token.length < 5) return token
    for (const e of CYR_ENDINGS) if (token.endsWith(e) && token.length - e.length >= 4) return token.slice(0, -e.length)
    return token
  }
  if (ARABIC.test(token)) {
    let t = token
    for (const p of AR_PREFIXES) if (t.startsWith(p) && t.length - p.length >= 3) { t = t.slice(p.length); break }
    for (const e of AR_SUFFIXES) if (t.endsWith(e) && t.length - e.length >= 3) { t = t.slice(0, -e.length); break }
    return t
  }
  if (token.length < 5) return token
  for (const e of LAT_ENDINGS) if (token.endsWith(e) && token.length - e.length >= 4) return token.slice(0, -e.length)
  return token
}

// ── Транслитерация ──────────────────────────────────────────────────────────
// Кириллица → латиница: человек в латинской раскладке набирает «ovsyanka»,
// «ovsianka», «ovseanka» — все они в одной-двух правках от «ovsyanka».
const CYR_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}
export function cyrToLat(folded) {
  if (!CYR.test(folded)) return ''
  let out = ''
  for (const ch of folded) out += CYR_LAT[ch] ?? ch
  return out
}

// Латиница → кириллица: мост для родственных слов (banana → банана, tofu →
// тофу). Полноценным переводом не является — для него есть словари.
const LAT_CYR = [
  ['shch', 'щ'], ['tsch', 'ч'], ['sch', 'ш'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'],
  ['ts', 'ц'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'йо'], ['ye', 'е'], ['ee', 'и'],
  ['oo', 'у'], ['ck', 'к'], ['ph', 'ф'], ['th', 'т'], ['j', 'й'], ['x', 'кс'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'],
  ['g', 'г'], ['h', 'х'], ['i', 'и'], ['k', 'к'], ['l', 'л'], ['m', 'м'],
  ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'],
  ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['y', 'и'], ['z', 'з'],
]
export function latToCyr(folded) {
  if (!/[a-z]/.test(folded)) return ''
  let out = ''
  let i = 0
  while (i < folded.length) {
    let hit = null
    for (const pair of LAT_CYR) {
      if (folded.startsWith(pair[0], i)) { hit = pair; break }
    }
    if (hit) { out += hit[1]; i += hit[0].length } else { out += folded[i]; i += 1 }
  }
  return fold(out)
}

// ── Не та раскладка ─────────────────────────────────────────────────────────
// «jdczyrf» — это «овсянка», набранная в английской раскладке, «щфе» — «oat»
// в русской. Частая ошибка на телефоне с двумя клавиатурами.
const QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,."
const JCUKEN = 'йцукенгшщзхъфывапролджэячсмитьбю'
const L2C = Object.create(null)
const C2L = Object.create(null)
for (let i = 0; i < QWERTY.length; i++) {
  L2C[QWERTY[i]] = JCUKEN[i]
  C2L[JCUKEN[i]] = QWERTY[i]
}
// raw — запрос до нормализации: «;» и «[» в нём ещё буквы ж и х.
export function swapLayout(raw) {
  const s = String(raw ?? '').toLowerCase().slice(0, MAX_INPUT)
  if (!s.trim()) return ''
  const cyr = CYR.test(s)
  const lat = /[a-z]/.test(s)
  if (cyr === lat) return '' // смесь или ни того ни другого — не раскладка
  let out = ''
  for (const ch of s) out += (cyr ? C2L[ch] : L2C[ch]) ?? ch
  return fold(out)
}

// ── Сближение по звучанию (русский) ─────────────────────────────────────────
// «малако» → «молоко», «карова» → «корова»: безударные гласные и удвоенные
// буквы схлопываются. Используется только как самый слабый тир.
const PHONE = { о: 'а', е: 'и', я: 'а', ю: 'у', ы: 'и', э: 'и', ъ: '', ь: '' }
export function phoneticKey(word) {
  let out = ''
  for (const ch of word) {
    const mapped = PHONE[ch] !== undefined ? PHONE[ch] : ch
    if (!mapped) continue
    if (out[out.length - 1] !== mapped) out += mapped
  }
  return out
}
