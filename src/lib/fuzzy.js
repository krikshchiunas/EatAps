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
  if (name.startsWith(term)) return 600
  if (text.startsWith(term)) return 500

  const nameWords = splitWords(name)
  if (nameWords.some((w) => w.startsWith(term))) return 350

  const textWords = splitWords(text)
  if (textWords.some((w) => w.startsWith(term))) return 300
  if (text.includes(term)) return 150

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

// Итоговый балл записи по набору терминов (запрос + его синонимы).
// Берём ЛУЧШИЙ термин, а не сумму: иначе продукт, случайно совпавший с двумя
// слабыми синонимами, обгонял бы точное попадание в название.
export function scoreEntry(text, name, terms, allowFuzzy = true) {
  let best = -1
  for (const t of terms) {
    if (!t) continue
    const s = scoreTerm(text, name, t, allowFuzzy)
    if (s > best) best = s
  }
  if (best < 0) return -1
  // Тай-брейк: при равном балле короткое название выигрывает («Рис» перед
  // «Рис с овощами и курицей»). Вклад заведомо меньше шага между тирами.
  return best - Math.min(name.length, 60) * 0.1
}

// Отсортированный по релевантности поиск.
// items: массив; toText(item) → строка для поиска; toName(item) → название.
// Двухпроходный: сначала быстрый строгий проход, и только если он дал мало
// результатов — дорогой нечёткий. Так набор текста не тормозит на каждой букве.
export function rankedSearch(items, terms, { toText, toName, minResults = 3 } = {}) {
  const prepared = items.map((item) => ({ item, text: toText(item), name: toName(item) }))

  const strict = []
  for (const p of prepared) {
    const s = scoreEntry(p.text, p.name, terms, false)
    if (s > 0) strict.push({ item: p.item, s })
  }
  if (strict.length >= minResults) {
    strict.sort((a, b) => b.s - a.s)
    return strict.map((x) => x.item)
  }

  const loose = []
  for (const p of prepared) {
    const s = scoreEntry(p.text, p.name, terms, true)
    if (s > 0) loose.push({ item: p.item, s })
  }
  loose.sort((a, b) => b.s - a.s)
  return loose.map((x) => x.item)
}
