// ─────────────────────────────────────────────────────────────────────────────
// Нечёткий поиск: устойчивость к опечаткам + ранжирование.
//
// Раньше поиск был бинарным: либо слово начинается с запроса, либо содержит его.
// «гречнвая» или «малако» не находили ничего, а найденное шло в порядке базы —
// длинное составное блюдо могло стоять выше самого продукта.
//
// Здесь два механизма:
//   1. Расстояние Дамерау-Левенштейна (правки + перестановка соседних букв —
//      самая частая опечатка при быстром наборе: «малкоо»). Считается с ранним
//      выходом: как только стало ясно, что правок больше допустимого, бросаем.
//   2. Скоринг: точное совпадение > начало строки > начало слова > вхождение >
//      опечатка. При равенстве короткое название выигрывает у длинного.
//
// Порог правок зависит от длины слова: в коротком слове одна правка меняет
// смысл («сок» → «сом»), в длинном — почти наверняка опечатка.
// ─────────────────────────────────────────────────────────────────────────────

// Максимум допустимых правок для слова такой длины.
export function maxDistanceFor(term) {
  const n = term.length
  if (n <= 3) return 0 // «сок», «чай» — правки запрещены
  if (n <= 6) return 1
  return 2
}

// Расстояние Дамерау-Левенштейна с ограничением. Возвращает точное расстояние,
// либо max + 1, если оно заведомо больше (дальше считать незачем).
export function editDistance(a, b, max = 2) {
  if (a === b) return 0
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > max) return max + 1
  if (al === 0) return bl
  if (bl === 0) return al

  let prev2 = null
  let prev = new Array(bl + 1)
  let cur = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j

  for (let i = 1; i <= al; i++) {
    cur[0] = i
    // Полоса вокруг диагонали: за её пределами расстояние гарантированно > max.
    const from = Math.max(1, i - max)
    const to = Math.min(bl, i + max)
    if (from > 1) cur[from - 1] = max + 1
    let best = max + 1

    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(
        cur[j - 1] + 1, // вставка
        prev[j] + 1, // удаление
        prev[j - 1] + cost, // замена
      )
      // Перестановка соседних символов: «малкоо» → «молоко».
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur[j] = v
      if (v < best) best = v
    }
    if (to < bl) cur[to + 1] = max + 1
    if (best > max) return max + 1

    prev2 = prev
    prev = cur
    cur = new Array(bl + 1)
  }

  const d = prev[bl]
  return d > max ? max + 1 : d
}

// Слово считается опечаткой запроса, если правок не больше допустимого.
// Возвращает расстояние или null.
export function fuzzyWordDistance(word, term) {
  const max = maxDistanceFor(term)
  if (max === 0) return word === term ? 0 : null
  // Слово сильно длиннее запроса — сравниваем его НАЧАЛО: человек набирает
  // «гречнев», продукт называется «гречневая каша».
  const candidate = word.length > term.length + max ? word.slice(0, term.length + max) : word
  const d = editDistance(candidate, term, max)
  return d <= max ? d : null
}

const splitWords = (text) => text.split(/[^0-9a-zа-я%]+/i).filter(Boolean)

// ── Редукция безударных гласных ──────────────────────────────────────────────
// Самая частая русская опечатка — не случайный промах по клавише, а письмо
// «как слышится»: «малако», «карова», «сметанна». В таком слове правок сразу
// две-три, и порог Дамерау-Левенштейна (одна правка на шесть букв) их не
// прощает — по-настоящему частый случай оставался ненайденным.
//
// Поэтому перед сравнением обе строки сводятся к «звучанию»: гласные,
// неразличимые в безударной позиции, схлопываются в один символ, удвоенные
// буквы — в одну. «молоко» и «малако» превращаются в одно и то же «малака».
const PHONE = { о: 'а', е: 'и', ё: 'и', я: 'а', ю: 'у', ы: 'и', э: 'и', й: 'и', ъ: '', ь: '' }
export function phoneticKey(word) {
  let out = ''
  for (const ch of word) {
    const mapped = PHONE[ch] !== undefined ? PHONE[ch] : ch
    if (!mapped) continue
    if (out[out.length - 1] !== mapped) out += mapped
  }
  return out
}

// Баллы за один термин. -1 — не совпало вовсе.
// name — нормализованное название (без alias): совпадение по названию ценнее,
// чем по синониму, иначе синонимы вытаскивают наверх случайные продукты.
function scoreTerm(text, name, term, allowFuzzy) {
  if (name === term) return 1000

  const nameWords = splitWords(name)
  // Совпадение с ЦЕЛЫМ первым словом сильнее совпадения с его началом.
  //
  // Без этой ступени запрос «лук» находил сначала «Луковый суп», а не «Лук
  // репчатый»: обе записи начинаются на «лук», балл выходил одинаковым, и
  // тай-брейк по длине поднимал суп — он на символ короче. Для человека,
  // который собирает рецепт, это не мелочь: он кладёт в кастрюлю суп вместо
  // луковицы. «Лук» — это ровно первое слово названия, а «луковый» — нет.
  if (nameWords[0] === term) return 700
  if (name.startsWith(term)) return 600
  if (text.startsWith(term)) return 500

  if (nameWords.some((w) => w === term)) return 400
  if (nameWords.some((w) => w.startsWith(term))) return 350

  const textWords = splitWords(text)
  if (textWords.some((w) => w.startsWith(term))) return 300
  // Подстрока ВНУТРИ слова считается совпадением только для длинных запросов.
  //
  // На двух-трёх буквах это чистый шум: «щи» находились в «Плов тёщин», «ин» —
  // в «свинина». Пока вокруг есть сильные совпадения, шум незаметен, но в
  // коротком списке (свои блюда и рецепты) он всплывает на первое место, и
  // человек видит первым заведомо не то. Начала слов ловятся ступенями выше.
  if (term.length >= 4 && text.includes(term)) return 150

  if (!allowFuzzy) return -1

  let best = -1
  for (const w of nameWords) {
    const d = fuzzyWordDistance(w, term)
    if (d != null) best = Math.max(best, 120 - d * 40)
  }
  if (best < 0) {
    for (const w of textWords) {
      const d = fuzzyWordDistance(w, term)
      if (d != null) best = Math.max(best, 90 - d * 40)
    }
  }

  // Последний рубеж — сравнение по звучанию. Балл ниже обычной опечатки:
  // совпадение здесь слабее, и точные попадания обязаны стоять выше.
  if (best < 0) {
    const key = phoneticKey(term)
    if (key.length >= 3) {
      for (const w of nameWords) {
        const wk = phoneticKey(w)
        if (wk === key) { best = Math.max(best, 80); continue }
        // Одна правка поверх редукции — «сметанна» против «сметана».
        if (Math.abs(wk.length - key.length) <= 1 && editDistance(wk, key, 1) <= 1) best = Math.max(best, 60)
      }
    }
  }
  return best
}

// Совпадение по синониму слабее совпадения по самому запросу.
//
// Без этого поиск «плов тёщин» показывал первым «Плов»: синоним «плов» давал
// ему точное совпадение (1000 баллов), запись «Плов тёщин» получала за тот же
// запрос ровно столько же, и тай-брейк по длине ставил короткое имя выше. То
// есть точное совпадение со ВСЕМ запросом проигрывало совпадению с его частью.
// Коэффициент опускает синонимы на отдельную полку: любое попадание по самому
// запросу теперь сильнее любого попадания по синониму.
export const SYNONYM_FACTOR = 0.75

// Итоговый балл записи по набору терминов (запрос + его синонимы).
// Берём ЛУЧШИЙ термин, а не сумму: иначе продукт, случайно совпавший с двумя
// слабыми синонимами, обгонял бы точное попадание в название.
// primaryCount — сколько первых терминов являются самим запросом (сам запрос и
// его кириллическая запись), остальные считаются синонимами.
export function scoreEntry(text, name, terms, allowFuzzy = true, primaryCount = 1) {
  let best = -1
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i]
    if (!t) continue
    const raw = scoreTerm(text, name, t, allowFuzzy)
    if (raw < 0) continue
    const s = i < primaryCount ? raw : raw * SYNONYM_FACTOR
    if (s > best) best = s
  }
  if (best < 0) return -1
  // Тай-брейк: при равном балле короткое название выигрывает («Рис» перед
  // «Рис с овощами и курицей»). Вклад заведомо меньше шага между тирами.
  return best - Math.min(name.length, 60) * 0.1
}

// ── Персонализация ───────────────────────────────────────────────────────────
// Личная история должна поднимать продукт ВНУТРИ его тира релевантности и
// никогда — между тирами. Иначе поиск ломается ровно так, как ломаться не
// должен: человек часто ест греческий йогурт, набирает «банан» — и первым ему
// показывают йогурт.
//
// Поэтому потолок надбавки (9) меньше самого узкого разрыва между тирами (10),
// а сами тиры отстоят друг от друга на 50 и больше. Надбавка живёт в том же
// поддиапазоне, что и тай-брейк по длине названия (до 6), и физически не может
// перевести запись через границу тира. Продукт, не совпавший с запросом вовсе,
// не получает надбавки — его в выдаче просто нет.
export const MEMORY_BOOST_MAX = 9

// Отсортированный по релевантности поиск.
// items: массив; toText(item) → строка для поиска; toName(item) → название;
// boost(item) → 0..1, доля личной надбавки (частота/свежесть/избранное).
// Двухпроходный: сначала быстрый строгий проход, и только если он дал мало
// результатов — дорогой нечёткий. Так набор текста не тормозит на каждой букве.
export function rankedSearch(items, terms, { toText, toName, minResults = 3, boost, primaryCount = 1 } = {}) {
  const prepared = items.map((item) => ({ item, text: toText(item), name: toName(item) }))
  const bonus = boost
    ? (item) => Math.max(0, Math.min(1, boost(item) || 0)) * MEMORY_BOOST_MAX
    : () => 0

  const collect = (allowFuzzy) => {
    const out = []
    for (const p of prepared) {
      const s = scoreEntry(p.text, p.name, terms, allowFuzzy, primaryCount)
      if (s > 0) out.push({ item: p.item, s: s + bonus(p.item) })
    }
    return out
  }

  const strict = collect(false)
  if (strict.length >= minResults) {
    strict.sort((a, b) => b.s - a.s)
    return strict.map((x) => x.item)
  }

  const loose = collect(true)
  loose.sort((a, b) => b.s - a.s)
  return loose.map((x) => x.item)
}
