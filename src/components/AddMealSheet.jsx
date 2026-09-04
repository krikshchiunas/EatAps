import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { plural } from '../lib/text.js'
import { MILKS, BASE_GROUPS, FOODS, scale, searchLocal, searchByName, searchIngredients, searchOpenFoodFacts, getPortions, normalizeQuery, sanitizeAmount, hasMacros, macroLabel } from '../lib/foods.js'
import {
  memoryBoost, frequentFoods, recentFoods, memoryPortion,
  repeatEntry, toPer100, favoriteKey, MAX_FAVORITES,
  templateToEntries, templateTotals, recipeTotals, recipePerServing, recipeToFood,
} from '../lib/library.js'
import { BEER_BRANDS, SPIRIT_TYPES, COCKTAILS, alcKcal } from '../lib/alcohol.js'
import { useStore } from '../store.jsx'
import Toast from './Toast.jsx'
import RecipeEditorSheet from './RecipeEditorSheet.jsx'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import BarcodeScanner from './BarcodeScanner.jsx'

const round1 = (n) => +n.toFixed(1)
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Сколько строк списка показывать за раз.
const PAGE = 40
// Сколько строк показывать в каждой секции памяти.
const MEMORY_ROWS = 6
// Своих блюд и рецептов у человека немного, но каждая строка «весит» больше
// (это не продукт, а целый набор), поэтому показываем меньше — иначе они
// вытеснят с экрана поиск и память.
const TPL_ROWS = 3

// Порция, после которой стоит переспросить: обычно это лишний ноль (1500 вместо
// 150). Не запрещаем — человек мог сварить кастрюлю, — но и молчать не должны.
const HUGE_PORTION = 3000

// Необязательное поле состава. Пустое поле — это «не знаю», а не «ноль»:
// записанный ноль означал бы измеренное значение и в будущем стал бы
// неотличим от настоящего нуля (у масла сахара и правда нет).
// Возвращает null, если человек ничего не ввёл.
const optionalNum = (raw, scale = 1) => {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const v = num(s) * scale
  return Number.isFinite(v) ? round1(v) : null
}

const SUGAR_TSP = { grams: 4, kcal: 16, carbs: 4 }
const isHotDrink = (food) => {
  if (!food) return false
  if (food.emoji === '☕' || food.emoji === '🍵') return true
  const n = (food.name || '').toLowerCase().replace(/ё/g, 'е')
  return /(чай|кофе|капучино|латте|американо|эспрессо|раф|какао|матча|цикори|глинтвейн|горячий шоколад|мокко|флэт|флет|flat white|glühwein)/.test(n)
}

const SECTIONS = [
  { key: 'mine', label: 'Моё' },
  { key: 'drink', label: 'Напитки' },
  { key: 'alcohol', label: 'Алкоголь' },
  { key: 'grain', label: 'Крупы' },
  { key: 'meat', label: 'Мясо' },
  { key: 'poultry', label: 'Птица' },
  { key: 'fish', label: 'Рыба' },
  { key: 'veg', label: 'Овощи' },
  { key: 'fruit', label: 'Фрукты' },
  { key: 'dairy', label: 'Молочное' },
  { key: 'cheese', label: 'Сыры' },
  { key: 'nut', label: 'Орехи' },
  { key: 'pastry', label: 'Выпечка' },
  { key: 'sweet', label: 'Сладкое' },
  { key: 'dish', label: 'Блюда' },
  { key: 'dessert', label: 'Десерты' },
  { key: 'mcdonalds', label: 'Макдоналдс' },
  { key: 'fastfood', label: 'Фастфуд' },
]

const norm = normalizeQuery

// mealId — обязателен: продукт всегда добавляется в конкретный приём пищи
// (секцию), выбранный на дневном экране. mealType — 'breakfast'/'lunch'/... для
// стандартных секций (undefined для пользовательских) — сохраняется в записи
// продукта как легаси-совместимое поле type, источник истины — mealId.
export default function AddMealSheet({ onClose, onAdd, onAddMany, onRemove, mealId, mealLabel, mealType }) {
  const {
    customFoods, customIngredients, recents, favorites, foodMemory, prefs,
    addCustomFood, removeCustomFood, addCustomIngredient, toggleFavorite, setPref,
    templates, recipes, removeTemplate, saveRecipe, removeRecipe,
  } = useStore()
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  const type = mealType
  const emit = (payload) => onAdd({ mealId, ...payload })
  const [selected, setSelected] = useState(null)
  // Экраны своих блюд и рецептов. Держим отдельно от selected: у продукта из
  // базы, набора строк и кастрюли на шесть порций — разные экраны и разный смысл.
  const [openTpl, setOpenTpl] = useState(null)
  const [openRcp, setOpenRcp] = useState(null)
  const [editRcp, setEditRcp] = useState(null) // null | recipe | 'new'
  const [method, setMethod] = useState(null)
  const [grams, setGrams] = useState('150')
  const [sugar, setSugar] = useState(0)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState({ name: '', portion: '', kcal: '', protein: '', carbs: '', sugar: '', fat: '', satFat: '' })
  const [manualBasis, setManualBasis] = useState('per100') // 'per100' | 'perPortion'
  const [manualKind, setManualKind] = useState('food')
  const [manualDrink, setManualDrink] = useState({ name: '', ml: '250', kcal: '', protein: '', carbs: '', sugar: '', fat: '', satFat: '', caffeine: '' })
  const [drinkBasis, setDrinkBasis] = useState('per100') // 'per100' | 'perServing'
  const [mode, setMode] = useState('search')
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState(null)

  // Тост может нести действие «Отменить», поэтому это не строка, а объект.
  // Временем жизни и разметкой заведует сам Toast.
  const showToast = (msg, undo) => setToast({ msg, undo, at: Date.now() })

  const [remote, setRemote] = useState([])
  const [remoteState, setRemoteState] = useState('idle')
  const [section, setSection] = useState(null)
  // Счётчик «повторить запрос»: меняется по кнопке и перезапускает эффект поиска.
  const [retryTick, setRetryTick] = useState(0)
  // Сколько строк списка показано. Раньше выдача жёстко обрезалась сороковой
  // записью и до остального нельзя было добраться вообще никак.
  const [limit, setLimit] = useState(PAGE)
  // Прокрутка листа. Человек уходит вглубь списка, открывает продукт, решает,
  // что не тот, и возвращается — он обязан вернуться на то же место, а не в
  // начало трёхтысячепиксельного списка. Экран продукта всегда открывается
  // сверху: иначе имя и кнопка «выбрать другой» оказывались за краем.
  // Элемент листа берём у useSheetDrag — второй ref на тот же узел не нужен.
  const sheetEl = () => sheetProps.ref?.current || null
  const listScroll = useRef(0)

  // Alcohol sub-state
  const [alcSubTab, setAlcSubTab] = useState('beer')
  const [alcItem, setAlcItem] = useState(null)
  const [alcQuery, setAlcQuery] = useState('')

  // Reset alcohol state when leaving alcohol section
  useEffect(() => {
    if (section !== 'alcohol') {
      setAlcSubTab('beer')
      setAlcItem(null)
      setAlcQuery('')
    }
  }, [section])

  const q = norm(query)

  // Личная надбавка к релевантности: частота, свежесть, избранное. Ограничена
  // сверху (см. MEMORY_BOOST_MAX) — поднимает продукт внутри тира совпадения и
  // не может вытащить наверх нерелевантный.
  const boost = useMemo(() => memoryBoost(foodMemory, favorites), [foodMemory, favorites])
  const favKeys = useMemo(() => new Set(favorites.map((f) => favoriteKey(f))), [favorites])

  // Свои продукты ищутся вместе с базой, а не отдельным списком с примитивным
  // «включает подстроку»: иначе «мой борщь» с опечаткой не находился, а точное
  // совпадение из базы уезжало вниз под неточное своё.
  const searchPool = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const f of [...customFoods, ...FOODS]) {
      const k = favoriteKey(f)
      if (seen.has(k)) continue // свой продукт перекрывает одноимённый из базы
      seen.add(k)
      out.push(f)
    }
    return out
  }, [customFoods])

  const local = useMemo(() => {
    if (q) return searchLocal(query, { items: searchPool, boost })
    if (section === 'alcohol') return []
    if (section === 'mine') return customFoods.filter((f) => f.source === 'custom')
    if (section) return searchPool.filter((f) => f.cat === section && !f.builder)
    return searchPool
  }, [q, query, section, searchPool, customFoods, boost])

  // ── Память: избранное / часто / недавно ────────────────────────────────────
  // Три РАЗНЫХ списка, не один «популярное». Избранное человек выбрал сам,
  // «часто» посчитано по журналу приёмов, «недавно» — просто последние.
  // Пересечения убираем, чтобы один и тот же продукт не занимал три строки.
  // Избранного может быть до MAX_FAVORITES (60). Показывать все сразу нельзя:
  // стена из шестидесяти строк вытолкнула бы «часто» и «недавнее» за экран, и
  // главный ответ на вопрос «что человек сейчас ест» стал бы недоступен.
  const [favLimit, setFavLimit] = useState(MEMORY_ROWS)
  const [tplLimit, setTplLimit] = useState(TPL_ROWS)
  // Своё нужно находить поиском, а не только листая секции: человек, который
  // сварил борщ и назвал рецепт «Борщ», наберёт «борщ» — и обязан увидеть СВОЙ,
  // а не одноимённый из общей базы.
  const tplFound = useMemo(() => (q ? searchByName(templates, query) : []), [q, query, templates])
  const rcpFound = useMemo(() => (q ? searchByName(recipes, query) : []), [q, query, recipes])
  const [rcpLimit, setRcpLimit] = useState(TPL_ROWS)
  const favoriteRows = useMemo(
    () => favorites.map((f) => ({ food: f, key: favoriteKey(f), grams: memoryPortion(foodMemory, f) })),
    [favorites, foodMemory],
  )
  const frequentRows = useMemo(
    () => frequentFoods(foodMemory, { limit: MEMORY_ROWS }).filter((e) => !favKeys.has(e.key)),
    [foodMemory, favKeys],
  )
  const recentRows = useMemo(() => {
    const shown = new Set([...favKeys, ...frequentRows.map((e) => e.key)])
    return recentFoods(foodMemory, { limit: MEMORY_ROWS, exclude: shown })
  }, [foodMemory, favKeys, frequentRows])

  const hasMemory = favoriteRows.length > 0 || frequentRows.length > 0 || recentRows.length > 0

  // Новый запрос или другая категория — список начинается заново.
  useEffect(() => { setLimit(PAGE) }, [q, section])

  // Кэш ответов глобальной базы на время жизни листа. Человек стирает букву и
  // возвращает её обратно — в сеть за тем же ответом лезть незачем. Кэш живёт
  // вместе с листом и умирает вместе с ним: устаревших данных не накопит.
  const remoteCache = useRef(new Map())

  useEffect(() => {
    const s = query.trim()
    if (mode !== 'search' || selected || s.length < 2) {
      setRemote([])
      setRemoteState('idle')
      return
    }
    const key = norm(s)
    const cached = remoteCache.current.get(key)
    if (cached) {
      setRemote(cached)
      setRemoteState(cached.length ? 'done' : 'empty')
      return
    }
    // Результаты ПРЕДЫДУЩЕГО запроса убираем сразу. Иначе, пока идёт новый
    // запрос (а если он упадёт — то и после), под новым словом продолжали
    // висеть чужие находки, подписанные как результат поиска. На их месте
    // показываются скелеты: место занято, но данные не врут.
    setRemote([])

    // alive закрывает целый класс гонок: ответ на устаревший запрос (пришедший
    // позже нового) больше не может перезаписать свежие результаты.
    let alive = true
    const controller = new AbortController()
    // «Ищем…» показываем ПОСЛЕ паузы, а не на каждое нажатие клавиши: при
    // быстром наборе надпись мигала на каждой букве и запрос уходил зря.
    const t = setTimeout(async () => {
      if (!alive) return
      setRemoteState('loading')
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 8000)
      try {
        const results = await searchOpenFoodFacts(s, controller.signal)
        if (!alive) return
        if (remoteCache.current.size > 40) remoteCache.current.clear()
        remoteCache.current.set(key, results)
        setRemote(results)
        setRemoteState(results.length ? 'done' : 'empty')
      } catch {
        // Обрыв по таймауту раньше молча оставлял «Ищем…» навсегда: отмена
        // приходила как AbortError, а его обработчик игнорировал. Теперь
        // отличаем свой таймаут от отмены при новом запросе.
        if (alive && (timedOut || !controller.signal.aborted)) {
          setRemoteState(navigator.onLine === false ? 'offline' : 'error')
        }
      } finally {
        clearTimeout(timeout)
      }
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
      controller.abort()
    }
  }, [query, mode, selected, retryTick])

  const unit = selected?.unit || (selected?.cat === 'drink' ? 'мл' : 'г')
  const g = Math.max(0, num(grams))
  const chosen = selected && selected.hasVariants && method ? method : selected
  // Глобальная база знает калорийность заметно чаще, чем БЖУ. Раньше пробел
  // заполнялся нулями и выглядел как факт. Теперь пробел виден, а человек может
  // переписать три числа с этикетки — это его собственные данные, а не наша
  // догадка. Пустое поле так и остаётся неизвестным.
  const [fill, setFill] = useState({ protein: '', carbs: '', fat: '' })
  const needFill = !!chosen && !chosen.builder && !hasMacros(chosen)
  const effective = useMemo(() => {
    if (!needFill) return chosen
    const v = (raw) => { const n = num(raw); return String(raw).trim() === '' ? null : (Number.isFinite(n) && n >= 0 ? n : null) }
    return { ...chosen, protein: v(fill.protein), carbs: v(fill.carbs), fat: v(fill.fat) }
  }, [chosen, needFill, fill])
  const preview = effective && !selected?.builder ? scale(effective, g) : null

  // ── Быстрое добавление ─────────────────────────────────────────────────────
  // Повтор привычной порции одним касанием. Количество НЕ выдумывается: берётся
  // привычная порция (медиана последних) или прошлое количество, и то и другое
  // — настоящие числа из журнала. Если ни того ни другого нет, кнопки нет и
  // человек попадает на обычный экран количества.
  const lastQuick = useRef({ key: '', at: 0 })

  const quickAdd = (payload, label) => {
    if (!payload?.name) return
    // Случайный двойной тап по одной и той же строке не должен записывать
    // продукт дважды. Осознанный повтор через полсекунды — записывает.
    const key = `${payload.name}|${payload.grams}`
    const now = Date.now()
    if (lastQuick.current.key === key && now - lastQuick.current.at < 600) return
    lastQuick.current = { key, at: now }

    const id = onAdd({ mealId, type, ...payload })
    const amount = payload.grams > 0 ? `${payload.grams} ${payload.unit || 'г'}` : `${payload.kcal} ккал`
    showToast(
      `${label || payload.name} · ${amount}`,
      id && onRemove ? () => { onRemove(id); showToast('Отменено') } : null,
    )
  }

  // Быстрое добавление из строки памяти (частое/недавнее): повторяем снимок
  // последнего приёма, пересчитанный на привычную порцию.
  const quickAddMemory = (entry) => {
    const payload = repeatEntry(entry)
    if (payload) quickAdd(payload)
  }

  // Быстрое добавление из избранного: продукт хранится «на 100», порцию берём
  // из памяти. Памяти нет — открываем экран количества, ничего не додумывая.
  // Вызывается только когда привычная порция известна: кнопки быстрого
  // добавления без количества у строки просто нет (см. MemoryRow).
  const quickAddFavorite = (fav, grams) => {
    quickAdd({ ...scale(fav, grams), name: fav.name, emoji: fav.emoji, unit: fav.unit || 'г', cat: fav.cat, grams })
  }

  // Закрепить/снять. В избранном продукт хранится «на 100 г/мл» — в том же
  // виде, что и в базе, поэтому его можно и открыть, и пересчитать на порцию.
  const toggleFav = (food, { fromLog = false } = {}) => {
    const product = fromLog ? toPer100(food) : food
    if (!product) return
    const res = toggleFavorite(product)
    if (res === 'full') {
      showToast(`В избранном максимум ${MAX_FAVORITES} — открепите ненужное`)
      return
    }
    showToast(res === 'added' ? 'В избранном' : 'Убрано из избранного')
  }

  // Добавить блюдо из шаблона — сразу всеми строками, как оно и было записано.
  const addTemplate = (tpl) => {
    const entries = templateToEntries(tpl, mealId).map((e) => ({ ...e, type }))
    if (!entries.length) return
    const n = entries.length
    if (onAddMany) onAddMany(entries, `${tpl.name} · ${n} ${plural(n, 'продукт', 'продукта', 'продуктов')}`)
    else entries.forEach((e) => onAdd(e))
    onClose()
  }

  // Рецепт добавляется ОДНОЙ строкой: съеденное количество порций от кастрюли.
  // Дробное допустимо — полтарелки это 0.5, а не «примерно половина».
  const addRecipe = (recipe, servingsEaten) => {
    const food = recipeToFood(recipe, servingsEaten, mealId)
    if (!food) return
    onAdd({ ...food, type })
    onClose()
  }

  const pickFood = (food) => {
    listScroll.current = sheetEl()?.scrollTop || 0
    setSelected(food)
    setMethod(food.hasVariants ? food.methods[0] : null)
    setSugar(0)
    const u = food.unit || (food.cat === 'drink' ? 'мл' : 'г')
    // Привычная порция из памяти (медиана последних) — она устойчивее, чем
    // «сколько было в последний раз»: одна разовая тарелка её не сдвигает.
    // Памяти нет — прежний список недавних, затем нейтральное значение.
    const remembered = memoryPortion(foodMemory, { name: food.name, unit: u })
    const last = remembered || recents.find((r) => r.name === food.name && r.unit === u && r.grams)?.grams
    setGrams(last ? String(last) : u === 'мл' ? '250' : '150')
  }

  // Тап по строке памяти → экран количества. Сначала ищем канонический продукт
  // в базе: у него есть способы приготовления, подсказки порций и категория.
  // Не нашли (например, продукт со способом приготовления в названии или из
  // глобальной базы) — восстанавливаем «на 100» из снимка приёма.
  const openMemory = (entry) => {
    const found = searchPool.find((f) => favoriteKey(f) === entry.key)
    if (found) { pickFood(found); return }
    const per100 = toPer100(entry.snapshot)
    if (per100) { pickFood(per100); return }
    // Количество неизвестно (порция рецепта) — пересчитать не на что,
    // повторяем запись как есть.
    quickAddMemory(entry)
  }

  const startManual = () => {
    setManual((m) => ({ ...m, name: m.name || query.trim() }))
    setMode('manual')
  }

  // ── Штрихкод ───────────────────────────────────────────────────────────────
  // Считанный товар попадает ровно на тот же экран количества, что и продукт,
  // выбранный поиском, — отдельной ветки добавления у сканера нет.
  const pickScanned = (food) => {
    setScanning(false)
    setMode('search')
    setQuery('')
    setSection(null)
    setAlcItem(null)
    setMethod(null)
    setSugar(0)
    setSelected(food)
    // Порция с упаковки, если производитель её указал. Поле открыто для правки —
    // человек всё равно съедает не «порцию по ГОСТу», а сколько съел.
    const fallback = food.unit === 'мл' ? '250' : '100'
    setGrams(food.defaultGrams ? String(food.defaultGrams) : fallback)
  }

  // Товара нет в базе (или у него нет состава) — уходим на ручной ввод. Если
  // название удалось узнать, оно уже подставлено: повторно его никто не печатает.
  const manualFromScan = (name, drink) => {
    setScanning(false)
    setSelected(null)
    setMode('manual')
    setManualKind(drink ? 'drink' : 'food')
    if (drink) setManualDrink((d) => ({ ...d, name: name || d.name }))
    else setManual((m) => ({ ...m, name: name || m.name }))
  }

  const clearFood = () => {
    setSelected(null)
    setMethod(null)
    setSugar(0)
  }

  // Открыли продукт — показываем его с начала; вернулись в список — возвращаем
  // человека туда, где он был. Слой раскладки уже посчитан, поэтому позиция
  // восстанавливается без видимого прыжка.
  useLayoutEffect(() => {
    const el = sheetEl()
    if (!el) return
    el.scrollTop = selected || alcItem ? 0 : listScroll.current
  }, [selected, alcItem])

  // Другой продукт — другие цифры с этикетки.
  useEffect(() => { setFill({ protein: '', carbs: '', fat: '' }) }, [selected])

  const addPreset = () => {
    if (!effective || g <= 0) return
    const s = scale(effective, g)
    const name = selected.hasVariants && method ? `${selected.name}, ${method.label.toLowerCase()}` : selected.name
    emit({ type, name, emoji: selected.emoji, grams: g, unit, cat: selected.cat, ...s })
    if (selected.name === 'Яйцо' && method?.label === 'Глазунья на сл. масле') {
      const bg = g <= 55 ? 5 : 7.5
      emit({
        type,
        name: `Сливочное масло (жарка)`,
        emoji: '🧈',
        cat: 'oil',
        grams: bg,
        unit: 'г',
        kcal: Math.round(bg * 7.17),
        protein: +(bg * 0.009).toFixed(1),
        carbs: +(bg * 0.001).toFixed(1),
        fat: +(bg * 0.81).toFixed(1),
      })
    }
    if (isHotDrink(selected) && sugar > 0) {
      emit({
        type,
        name: `Сахар, ${sugar} ч.л.`,
        emoji: '🥄',
        cat: 'sweet',
        grams: sugar * SUGAR_TSP.grams,
        unit: 'г',
        kcal: sugar * SUGAR_TSP.kcal,
        protein: 0,
        carbs: sugar * SUGAR_TSP.carbs,
        fat: 0,
      })
    }
    onClose()
  }

  // Сохраняет продукт в «Моё» (customFoods). БЕЗ добавления в приём пищи.
  // Хранение — всегда per 100 (г или мл). Если введено «за штуку/порцию»,
  // приводим к per100 через размер порции.
  const saveToMine = () => {
    if (manualKind === 'food') {
      const nm = manual.name.trim()
      if (!nm) return
      const portion = Math.max(0, num(manual.portion))
      // basis=perPortion → значения относятся ко всей порции → делим на portion*100 → per100
      let scale = 1
      if (manualBasis === 'perPortion') {
        if (portion <= 0) return
        scale = 100 / portion
      }
      const entry = {
        name: nm,
        emoji: '🍽️',
        cat: 'dish',
        unit: 'г',
        kcal: Math.round(num(manual.kcal) * scale),
        protein: round1(num(manual.protein) * scale),
        carbs: round1(num(manual.carbs) * scale),
        fat: round1(num(manual.fat) * scale),
        source: 'custom',
      }
      const sugar = optionalNum(manual.sugar, scale)
      // Ввели явно — помечаем. Ноль, введённый руками, это факт, а не пробел.
      if (sugar != null) { entry.sugar = sugar; entry.sugarSrc = 'measured' }
      const satFat = optionalNum(manual.satFat, scale)
      if (satFat != null) entry.satFat = satFat
      addCustomFood(entry)
      setManual({ name: '', portion: '', kcal: '', protein: '', carbs: '', sugar: '', fat: '', satFat: '' })
      showToast('Сохранено в «Моё»')
    } else {
      const nm = manualDrink.name.trim()
      if (!nm) return
      const ml = Math.max(0, num(manualDrink.ml))
      let scale = 1
      if (drinkBasis === 'perServing') {
        if (ml <= 0) return
        scale = 100 / ml
      }
      const drink = {
        name: nm,
        emoji: '🥤',
        cat: 'drink',
        unit: 'мл',
        kcal: Math.round(num(manualDrink.kcal) * scale),
        protein: round1(num(manualDrink.protein) * scale),
        carbs: round1(num(manualDrink.carbs) * scale),
        fat: round1(num(manualDrink.fat) * scale),
        source: 'custom',
      }
      for (const [key, raw] of [['sugar', manualDrink.sugar], ['satFat', manualDrink.satFat], ['caffeine', manualDrink.caffeine]]) {
        const v = optionalNum(raw, scale)
        if (v != null) drink[key] = v
      }
      if (drink.sugar != null) drink.sugarSrc = 'measured'
      addCustomFood(drink)
      setManualDrink({ name: '', ml: '250', kcal: '', protein: '', carbs: '', sugar: '', fat: '', satFat: '', caffeine: '' })
      showToast('Сохранено в «Моё»')
    }
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      {/* Подтверждение добавления. Разметка — в общем Toast: этот же тост
          показывает и главный экран, после того как лист закроется. */}
      <Toast toast={toast} onDone={() => setToast(null)} />

      {editRcp && (
        <RecipeEditorSheet
          recipe={editRcp}
          onSave={(r, updated) => { saveRecipe(r); showToast(updated ? `«${r.name}» обновлён` : `«${r.name}» сохранён`) }}
          onClose={() => setEditRcp(null)}
        />
      )}
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Добавить в «{mealLabel}»</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>Поиск</button>
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Вручную</button>
          <button className="seg-scan" onClick={() => setScanning(true)} aria-label="Сканировать штрихкод" title="Сканировать штрихкод">📷</button>
        </div>

        {mode === 'search' && !selected && !alcItem && !openTpl && !openRcp && (
          <>
            <input
              className="input"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Поиск продукта"
              placeholder="Найдите продукт, напр. чечевица"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Enter на мобильной клавиатуре должен убирать её и показывать
              // результаты, а не отправлять форму и перезагружать экран.
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
              style={{ marginBottom: 12 }}
            />

            {!query.trim() && (
              /* 2-row horizontal grid for categories */
              <div style={{ display: 'grid', gridTemplateRows: 'repeat(2, auto)', gridAutoFlow: 'column', gridAutoColumns: 'max-content', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
                <button
                  className={`chip ${!section ? 'on' : ''}`}
                  onClick={() => setSection(null)}
                >Всё</button>
                {SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    className={`chip ${section === s.key ? 'on' : ''}`}
                    onClick={() => setSection(section === s.key ? null : s.key)}
                  >{s.label}</button>
                ))}
              </div>
            )}

            {/* Alcohol section */}
            {!query.trim() && section === 'alcohol' && (
              <AlcoholSection
                subTab={alcSubTab}
                setSubTab={setAlcSubTab}
                alcQuery={alcQuery}
                setAlcQuery={setAlcQuery}
                onPick={(item) => setAlcItem(item)}
              />
            )}

            {/* «Моё» — место, где человек управляет тем, что создал сам:
                блюда, рецепты и свои продукты. Здесь же единственный вход в
                создание рецепта, когда рецептов ещё нет: если показывать его
                только внутри секции «Рецепты», первый рецепт завести неоткуда. */}
            {!query.trim() && section === 'mine' && (
              <div style={{ marginBottom: 6 }}>
                <button
                  className="btn soft"
                  style={{ height: 44, marginBottom: 14 }}
                  onClick={() => setEditRcp('new')}
                >＋ Новый рецепт</button>

                {templates.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <SectionLabel text="Мои блюда" count={templates.length} />
                    {templates.map((t) => {
                      const tot = templateTotals(t)
                      return (
                        <MemoryRow
                          key={t.id}
                          emoji={t.emoji || '🍽️'}
                          name={t.name}
                          meta={`${t.items.length} ${plural(t.items.length, 'продукт', 'продукта', 'продуктов')}`}
                          quickLabel={`${tot.kcal} ккал`}
                          onQuick={() => addTemplate(t)}
                          onOpen={() => setOpenTpl(t)}
                        />
                      )
                    })}
                  </div>
                )}

                {recipes.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <SectionLabel text="Рецепты" count={recipes.length} />
                    {recipes.map((r) => (
                      <MemoryRow
                        key={r.id}
                        emoji={r.emoji || '🍲'}
                        name={r.name}
                        meta={`${recipePerServing(r).kcal} ккал / порция`}
                        quickLabel="1 порция"
                        onQuick={() => addRecipe(r, 1)}
                        onOpen={() => setOpenRcp(r)}
                      />
                    ))}
                  </div>
                )}

                {customFoods.filter((f) => f.source === 'custom').length > 0 && (
                  <SectionLabel text="Свои продукты" count={null} />
                )}
                {templates.length === 0 && recipes.length === 0 && customFoods.filter((f) => f.source === 'custom').length === 0 && (
                  <p className="muted" style={{ padding: '10px 0', fontSize: 14, lineHeight: 1.5 }}>
                    Пока пусто. Сохраните приём пищи как блюдо из меню «⋯», заведите рецепт кнопкой выше
                    или добавьте продукт вручную — всё окажется здесь.
                  </p>
                )}
              </div>
            )}

            {q && (tplFound.length > 0 || rcpFound.length > 0) && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Моё" count={tplFound.length + rcpFound.length} />
                {tplFound.map((t) => {
                  const tot = templateTotals(t)
                  return (
                    <MemoryRow
                      key={'q-tpl-' + t.id}
                      emoji={t.emoji || '🍽️'}
                      name={t.name}
                      meta={`блюдо · ${t.items.length} ${plural(t.items.length, 'продукт', 'продукта', 'продуктов')} · ${tot.kcal} ккал`}
                      quickLabel={`${tot.kcal} ккал`}
                      onQuick={() => addTemplate(t)}
                      onOpen={() => setOpenTpl(t)}
                    />
                  )
                })}
                {rcpFound.map((r) => (
                  <MemoryRow
                    key={'q-rcp-' + r.id}
                    emoji={r.emoji || '🍲'}
                    name={r.name}
                    meta={`рецепт · ${recipePerServing(r).kcal} ккал / порция`}
                    quickLabel="1 порция"
                    onQuick={() => addRecipe(r, 1)}
                    onOpen={() => setOpenRcp(r)}
                  />
                ))}
              </div>
            )}

            {/* Свои блюда и рецепты — то, что человек собрал сам. Стоят выше
                памяти: блюдо экономит больше всего касаний (три продукта одним
                нажатием), а рецепт — единственный способ записать «одну тарелку
                из кастрюли», не пересчитывая ничего в уме. */}
            {!query.trim() && !section && templates.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Мои блюда" count={templates.length} />
                {templates.slice(0, tplLimit).map((t) => {
                  const tot = templateTotals(t)
                  return (
                    <MemoryRow
                      key={t.id}
                      emoji={t.emoji || '🍽️'}
                      name={t.name}
                      // Калории — только на кнопке. Раньше «391 ккал» стояло и
                      // в подписи, и на кнопке: строка от этого переносилась
                      // на две, а второе число ничего не добавляло.
                      meta={`${t.items.length} ${plural(t.items.length, 'продукт', 'продукта', 'продуктов')}`}
                      quickLabel={`${tot.kcal} ккал`}
                      onQuick={() => addTemplate(t)}
                      onOpen={() => setOpenTpl(t)}
                    />
                  )
                })}
                {templates.length > tplLimit && (
                  <button
                    onClick={() => setTplLimit((n) => n + TPL_ROWS)}
                    style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, padding: '10px 0', minHeight: 44 }}
                  >Ещё {templates.length - tplLimit}</button>
                )}
              </div>
            )}

            {!query.trim() && !section && recipes.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Рецепты" count={recipes.length} />
                {recipes.slice(0, rcpLimit).map((r) => {
                  const per = recipePerServing(r)
                  return (
                    <MemoryRow
                      key={r.id}
                      emoji={r.emoji || '🍲'}
                      name={r.name}
                      meta={`${per.kcal} ккал / порция`}
                      quickLabel="1 порция"
                      onQuick={() => addRecipe(r, 1)}
                      onOpen={() => setOpenRcp(r)}
                    />
                  )
                })}
                {recipes.length > rcpLimit && (
                  <button
                    onClick={() => setRcpLimit((n) => n + TPL_ROWS)}
                    style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, padding: '10px 0', minHeight: 44 }}
                  >Ещё {recipes.length - rcpLimit}</button>
                )}
                <button
                  onClick={() => setEditRcp('new')}
                  style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, padding: '10px 0', minHeight: 44 }}
                >＋ Новый рецепт</button>
              </div>
            )}

            {/* Память: три разных списка. Избранное человек закрепил сам,
                «часто» посчитано по журналу приёмов, «недавнее» — последнее.
                Смешивать их в одно «популярное» нельзя: это разные ответы на
                разные вопросы. */}
            {!query.trim() && !section && favoriteRows.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Избранное" count={null} />
                {favoriteRows.slice(0, favLimit).map(({ food, key, grams }) => (
                  <MemoryRow
                    key={'fav-' + key}
                    emoji={food.emoji}
                    name={food.name}
                    meta={grams > 0 ? `${grams} ${food.unit || 'г'} · ${scale(food, grams).kcal} ккал` : `${food.kcal} ккал / 100 ${food.unit || 'г'}`}
                    quickLabel={grams > 0 ? `${grams} ${food.unit || 'г'}` : null}
                    onQuick={() => quickAddFavorite(food, grams)}
                    onOpen={() => pickFood(food)}
                    favorite
                    onFav={() => toggleFav(food)}
                  />
                ))}
                {favoriteRows.length > favLimit && (
                  <button
                    onClick={() => setFavLimit((n) => n + MEMORY_ROWS)}
                    style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, padding: '10px 0', minHeight: 44 }}
                  >Ещё {favoriteRows.length - favLimit} в избранном</button>
                )}
              </div>
            )}

            {!query.trim() && !section && frequentRows.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Часто едите" count={null} />
                {frequentRows.map((e) => (
                  <MemoryRow
                    key={'freq-' + e.key}
                    emoji={e.emoji}
                    name={e.name}
                    meta={memoryMeta(e)}
                    quickLabel={quickLabelFor(e)}
                    onQuick={() => quickAddMemory(e)}
                    onOpen={() => openMemory(e)}
                    favorite={favKeys.has(e.key)}
                    onFav={canFavorite(e) ? () => toggleFav(e.snapshot, { fromLog: true }) : null}
                  />
                ))}
              </div>
            )}

            {!query.trim() && !section && recentRows.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <SectionLabel text="Недавнее" count={null} />
                {recentRows.map((e) => (
                  <MemoryRow
                    key={'rec-' + e.key}
                    emoji={e.emoji}
                    name={e.name}
                    meta={memoryMeta(e)}
                    quickLabel={quickLabelFor(e)}
                    onQuick={() => quickAddMemory(e)}
                    onOpen={() => openMemory(e)}
                    favorite={favKeys.has(e.key)}
                    onFav={canFavorite(e) ? () => toggleFav(e.snapshot, { fromLog: true }) : null}
                  />
                ))}
              </div>
            )}

            {section !== 'alcohol' && local.length > 0 && (
              <>
                <SectionLabel
                  text={query.trim() ? 'Найдено' : section ? SECTIONS.find((s) => s.key === section)?.label : 'Вся база'}
                  count={local.length}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {local.slice(0, limit).map((f) => {
                    // Быстрое добавление даём только там, где количество известно
                    // из личной истории, и только для простых продуктов: у блюда
                    // с конструктором или способами приготовления «одним касанием»
                    // не бывает — там сначала нужен выбор.
                    const simple = !f.builder && !f.hasVariants && f.kind !== 'composite' && !f.dairy
                    const g = simple ? memoryPortion(foodMemory, f) : null
                    return (
                      <FoodRow
                        key={'l-' + (f.id || f.name)}
                        f={f}
                        onClick={() => pickFood(f)}
                        onDelete={f.source === 'custom' ? () => removeCustomFood(f.id) : null}
                        favorite={favKeys.has(favoriteKey(f))}
                        onFav={simple ? () => toggleFav(f) : null}
                        quickLabel={g > 0 ? `${g} ${f.unit || 'г'}` : null}
                        onQuick={g > 0 ? () => quickAdd({ ...scale(f, g), name: f.name, emoji: f.emoji, unit: f.unit || 'г', cat: f.cat, grams: g }) : null}
                      />
                    )
                  })}
                </div>
                {local.length > limit && (
                  <button
                    className="btn soft"
                    style={{ marginTop: 12 }}
                    onClick={() => setLimit((n) => n + PAGE)}
                  >Показать ещё {Math.min(PAGE, local.length - limit)} из {local.length - limit}</button>
                )}
              </>
            )}

            {query.trim().length >= 2 && (
              <div style={{ marginTop: 18 }}>
                <SectionLabel text="Глобальная база" count={remote.length || null} />
                {remoteState === 'loading' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }} aria-live="polite">
                    {[0, 1, 2].map((i) => <SkeletonRow key={i} />)}
                  </div>
                )}
                {/* Понятная причина и понятное действие вместо технической ошибки. */}
                {(remoteState === 'error' || remoteState === 'offline') && (
                  <div style={{ padding: '8px 0' }}>
                    <p className="muted" style={{ fontSize: 14, margin: '0 0 10px' }}>
                      {remoteState === 'offline'
                        ? 'Нет интернета. Своё и найденное выше доступны без сети.'
                        : 'Глобальная база не ответила. Результаты выше — из вашей базы.'}
                    </p>
                    <button className="chip" onClick={() => setRetryTick((n) => n + 1)}>Повторить</button>
                  </div>
                )}
                {remoteState === 'empty' && (
                  <p className="muted" style={{ padding: '8px 0', fontSize: 14 }}>В глобальной базе ничего не нашлось.</p>
                )}
                {remote.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {remote.map((f, i) => (
                      <FoodRow
                        key={'r-' + i}
                        f={f}
                        onClick={() => pickFood(f)}
                        favorite={favKeys.has(favoriteKey(f))}
                        onFav={() => toggleFav(f)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ничего не нашлось — это рабочий сценарий, а не тупик.
                Показываем, что можно сделать дальше, а не «нет результатов». */}
            {query.trim().length >= 2 && local.length === 0 && remote.length === 0 && remoteState !== 'loading' && (
              <div style={{ marginTop: 18 }}>
                <p className="meal-name" style={{ margin: '0 0 6px' }}>Не нашли «{clip(query.trim())}»</p>
                <p className="muted" style={{ fontSize: 14, margin: '0 0 12px' }}>
                  {query.trim().split(/\s+/).length > 1
                    ? 'Попробуйте короче — одно слово вместо нескольких, или без бренда.'
                    : 'Проверьте написание или попробуйте более общее название.'}
                </p>
                <div className="row wrap gap8" style={{ marginBottom: 12 }}>
                  {query.trim().split(/\s+/).length > 1 && (
                    <button className="chip" onClick={() => setQuery(query.trim().split(/\s+/)[0])}>
                      Искать «{clip(query.trim().split(/\s+/)[0], 16)}»
                    </button>
                  )}
                  <button className="chip" onClick={() => { setQuery(''); setSection(null) }}>Показать категории</button>
                  <button className="chip" onClick={() => setScanning(true)}>📷 Сканировать штрихкод</button>
                </div>
              </div>
            )}

            {local.length === 0 && !query.trim() && !hasMemory && section !== 'alcohol' && section !== 'mine' && (
              <p className="muted" style={{ padding: '10px 0' }}>Начните вводить название продукта.</p>
            )}

            {/* Ручной ввод — всегда доступный выход, когда базы не хватило.
                Название уже набрано: печатать его второй раз не нужно. */}
            {query.trim() && (
              <button className="btn soft" style={{ marginTop: 14 }} onClick={startManual}>
                Нет в списке? Добавить «{clip(query.trim())}» вручную
              </button>
            )}

            {!query.trim() && section !== 'alcohol' && (
              <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 18, textAlign: 'center' }}>
                Глобальные данные — Open Food Facts (значения на 100 г)
              </p>
            )}
          </>
        )}

        {/* Alcohol builder */}
        {mode === 'search' && alcItem && (
          <AlcoholBuilder item={alcItem} onBack={() => setAlcItem(null)} onAdd={emit} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.builder === 'protein' && (
          <ProteinShakeBuilder selected={selected} prefs={prefs} setPref={setPref} onBack={clearFood} onAdd={emit} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.builder === 'custom' && (
          <CustomDrinkBuilder selected={selected} onBack={clearFood} onAdd={emit} onClose={onClose} addCustomFood={addCustomFood} type={type} />
        )}

        {mode === 'search' && openTpl && (
          <TemplateScreen
            tpl={openTpl}
            onBack={() => setOpenTpl(null)}
            onAdd={() => addTemplate(openTpl)}
            onDelete={() => { removeTemplate(openTpl.id); setOpenTpl(null); showToast('Блюдо удалено') }}
          />
        )}

        {mode === 'search' && openRcp && (
          <RecipeScreen
            recipe={openRcp}
            onBack={() => setOpenRcp(null)}
            onAdd={(n) => addRecipe(openRcp, n)}
            onEdit={() => { setEditRcp(openRcp); setOpenRcp(null) }}
            onDelete={() => { removeRecipe(openRcp.id); setOpenRcp(null); showToast('Рецепт удалён') }}
          />
        )}

        {mode === 'search' && selected?.builder === 'constructor' && (
          <ConstructorBuilder selected={selected} onBack={clearFood} onAdd={emit} onClose={onClose} addCustomFood={addCustomFood} customIngredients={customIngredients} addCustomIngredient={addCustomIngredient} type={type} />
        )}

        {mode === 'search' && selected?.kind === 'composite' && !selected.builder && (
          <CompositePortion selected={selected} onBack={clearFood} onAdd={emit} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.dairy && !selected.builder && (
          <DairyPortion
            selected={selected}
            onBack={clearFood}
            onAdd={emit}
            onClose={onClose}
            type={type}
            remembered={memoryPortion(foodMemory, { name: selected.name, unit: selected.unit || 'г' })}
          />
        )}

        {mode === 'search' && selected && !selected.builder && selected.kind !== 'composite' && !selected.dairy && (
          <div>
            <div className="row gap12" style={{ marginBottom: 18 }}>
              <FoodThumb key={selected.photo || selected.name} food={selected} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
                <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={clearFood}>← выбрать другой</button>
              </div>
              <button
                onClick={() => toggleFav(selected)}
                aria-label={favKeys.has(favoriteKey(selected)) ? 'Убрать из избранного' : 'Добавить в избранное'}
                aria-pressed={favKeys.has(favoriteKey(selected))}
                style={{
                  width: 44, height: 44, flex: '0 0 auto', fontSize: 20,
                  color: favKeys.has(favoriteKey(selected)) ? 'var(--primary)' : 'var(--ink-3)',
                }}
              >{favKeys.has(favoriteKey(selected)) ? '★' : '☆'}</button>
            </div>

            {selected.hasVariants && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginBottom: 10, fontWeight: 500 }}>Способ приготовления</label>
                <div className="row wrap gap8">
                  {selected.methods.map((m) => (
                    <button
                      key={m.label}
                      className={`pill ${method?.label === m.label ? 'on' : ''}`}
                      onClick={() => setMethod(m)}
                      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '8px 14px', lineHeight: 1.25 }}
                    >
                      <span style={{ fontSize: 15 }}>{m.label}</span>
                      <span style={{ fontSize: 11, opacity: 0.75 }} className="tabular">{m.kcal} ккал</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label>{unit === 'мл' ? 'Объём, мл' : 'Порция, грамм'}</label>
              {(() => {
                const base = getPortions(selected)
                // Привычная порция человека — первой и подписанной «как обычно»:
                // это его собственное измеренное число, а не наша усреднённая
                // «тарелка». Дубли по весу убираем, поле остаётся открытым для
                // правки — подсказка не подменяет фактическое количество.
                const mine = memoryPortion(foodMemory, { name: selected.name, unit })
                const ps = mine > 0
                  ? [{ label: 'как обычно', grams: mine }, ...base.filter((p) => p.grams !== mine)].slice(0, 6)
                  : base
                return (
                  <>
                    {base[0] && (
                      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 8px' }}>
                        Не взвешивая: {base[0].label} ≈ {base[0].grams} {unit}
                      </p>
                    )}
                    <input
                      className="input" type="text" inputMode="decimal" value={grams}
                      onChange={(e) => setGrams(sanitizeAmount(e.target.value))}
                      aria-label={unit === 'мл' ? 'Объём, мл' : 'Порция, грамм'}
                      style={{ marginBottom: 10 }}
                    />
                    {g > HUGE_PORTION && (
                      <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 10px' }}>
                        {g} {unit} — это много. Проверьте, не лишний ли ноль.
                      </p>
                    )}
                    <div className="row wrap gap8">
                      {ps.map((p) => (
                        <button key={p.label} className={`chip ${g === p.grams ? 'on' : ''}`} onClick={() => setGrams(String(p.grams))}>
                          {p.label} · {p.grams} {unit}
                        </button>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>

            {isHotDrink(selected) && (
              <div className="field">
                <div className="row between" style={{ alignItems: 'center' }}>
                  <div>
                    <label style={{ marginBottom: 2 }}>Сахар, ч.л.</label>
                    <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>Сколько ложек положили в напиток</p>
                  </div>
                  <Stepper value={sugar} set={setSugar} min={0} />
                </div>
                {sugar > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0 0' }}>
                    🥄 {sugar} ч.л. ≈ {sugar * SUGAR_TSP.grams} г · +{sugar * SUGAR_TSP.kcal} ккал · +{sugar * SUGAR_TSP.carbs} г сахара
                  </p>
                )}
              </div>
            )}

            {needFill && (
              <div className="card" style={{ padding: 14, marginBottom: 14, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
                <div style={{ fontSize: 14, fontWeight: 550, marginBottom: 2 }}>БЖУ нет в базе</div>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 10px' }}>
                  Известна только калорийность. Впишите с этикетки, на 100 {unit} — или оставьте пустым, тогда останется «неизвестно».
                </p>
                <div className="row gap8">
                  <input className="input" type="number" inputMode="decimal" placeholder="Белки" aria-label={`Белки на 100 ${unit}`}
                    value={fill.protein} onChange={(e) => setFill({ ...fill, protein: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                  <input className="input" type="number" inputMode="decimal" placeholder="Углеводы" aria-label={`Углеводы на 100 ${unit}`}
                    value={fill.carbs} onChange={(e) => setFill({ ...fill, carbs: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                  <input className="input" type="number" inputMode="decimal" placeholder="Жиры" aria-label={`Жиры на 100 ${unit}`}
                    value={fill.fat} onChange={(e) => setFill({ ...fill, fat: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                </div>
              </div>
            )}

            <div className="row gap8" style={{ marginBottom: 22 }}>
              <PreviewStat label="ккал" v={preview.kcal + sugar * SUGAR_TSP.kcal} />
              <PreviewStat label="белки" v={preview.protein} />
              <PreviewStat label="угл." v={preview.carbs == null ? null : round1(preview.carbs + sugar * SUGAR_TSP.carbs)} />
              <PreviewStat label="жиры" v={preview.fat} />
            </div>
            <button className="btn" onClick={addPreset} disabled={g <= 0}>Добавить {preview.kcal + sugar * SUGAR_TSP.kcal} ккал</button>
          </div>
        )}

        {mode === 'manual' && (
          <div>
            <div className="seg" style={{ marginBottom: 18 }}>
              <button className={manualKind === 'food' ? 'on' : ''} onClick={() => setManualKind('food')}>🍽️ Еда</button>
              <button className={manualKind === 'drink' ? 'on' : ''} onClick={() => setManualKind('drink')}>🥤 Напиток</button>
            </div>

            {manualKind === 'food' && (
              <>
                <div className="field">
                  <label>Название</label>
                  <input className="input" placeholder="Напр. Домашний борщ" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
                </div>

                <div className="field">
                  <label>Значения указаны</label>
                  <div className="seg">
                    <button className={manualBasis === 'per100' ? 'on' : ''} onClick={() => setManualBasis('per100')}>На 100 г</button>
                    <button className={manualBasis === 'perPortion' ? 'on' : ''} onClick={() => setManualBasis('perPortion')}>За порцию</button>
                  </div>
                </div>

                {manualBasis === 'perPortion' && (
                  <div className="field">
                    <label>Размер порции, г</label>
                    <input className="input" type="number" inputMode="numeric" placeholder="150" value={manual.portion} onChange={(e) => setManual({ ...manual, portion: e.target.value })} />
                  </div>
                )}

                <div className="field">
                  <label>Калории, ккал</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="350" value={manual.kcal} onChange={(e) => setManual({ ...manual, kcal: e.target.value })} />
                </div>

                <div className="field">
                  <label>Белки, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.protein} onChange={(e) => setManual({ ...manual, protein: e.target.value })} />
                </div>

                <div className="field">
                  <label>Углеводы, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.carbs} onChange={(e) => setManual({ ...manual, carbs: e.target.value })} />
                </div>
                <div className="field" style={{ marginLeft: 18, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                  <label>из них сахар, г <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.sugar} onChange={(e) => setManual({ ...manual, sugar: e.target.value })} />
                </div>

                <div className="field">
                  <label>Жиры, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.fat} onChange={(e) => setManual({ ...manual, fat: e.target.value })} />
                </div>
                <div className="field" style={{ marginLeft: 18, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                  <label>из них насыщенные, г <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.satFat} onChange={(e) => setManual({ ...manual, satFat: e.target.value })} />
                </div>

                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px' }}>Сохранится в разделе «Моё» — потом сможете добавить в приём.</p>
                <button className="btn" style={{ marginTop: 0 }} onClick={saveToMine} disabled={!manual.name.trim() || (manualBasis === 'perPortion' && !num(manual.portion))}>Сохранить</button>
              </>
            )}

            {manualKind === 'drink' && (
              <>
                <div className="field">
                  <label>Название</label>
                  <input className="input" placeholder="Напр. Домашний лимонад" value={manualDrink.name} onChange={(e) => setManualDrink({ ...manualDrink, name: e.target.value })} />
                </div>

                <div className="field">
                  <label>Значения указаны</label>
                  <div className="seg">
                    <button className={drinkBasis === 'per100' ? 'on' : ''} onClick={() => setDrinkBasis('per100')}>На 100 мл</button>
                    <button className={drinkBasis === 'perServing' ? 'on' : ''} onClick={() => setDrinkBasis('perServing')}>За объём</button>
                  </div>
                </div>

                {drinkBasis === 'perServing' && (
                  <div className="field">
                    <label>Объём, мл</label>
                    <input className="input" type="number" inputMode="numeric" placeholder="250" value={manualDrink.ml} onChange={(e) => setManualDrink({ ...manualDrink, ml: e.target.value })} />
                  </div>
                )}

                <div className="field">
                  <label>Калории, ккал</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="42" value={manualDrink.kcal} onChange={(e) => setManualDrink({ ...manualDrink, kcal: e.target.value })} />
                </div>

                <div className="field">
                  <label>Белки, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.protein} onChange={(e) => setManualDrink({ ...manualDrink, protein: e.target.value })} />
                </div>

                <div className="field">
                  <label>Углеводы, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.carbs} onChange={(e) => setManualDrink({ ...manualDrink, carbs: e.target.value })} />
                </div>
                <div className="field" style={{ marginLeft: 18, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                  <label>из них сахар, г <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.sugar} onChange={(e) => setManualDrink({ ...manualDrink, sugar: e.target.value })} />
                </div>

                <div className="field">
                  <label>Жиры, г</label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.fat} onChange={(e) => setManualDrink({ ...manualDrink, fat: e.target.value })} />
                </div>
                <div className="field" style={{ marginLeft: 18, borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                  <label>из них насыщенные, г <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.satFat} onChange={(e) => setManualDrink({ ...manualDrink, satFat: e.target.value })} />
                </div>

                <div className="field">
                  <label>Кофеин, мг <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.caffeine} onChange={(e) => setManualDrink({ ...manualDrink, caffeine: e.target.value })} />
                </div>

                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px' }}>Сохранится в разделе «Моё» — потом сможете добавить, указав объём.</p>
                <button className="btn" style={{ marginTop: 0 }} onClick={saveToMine} disabled={!manualDrink.name.trim() || (drinkBasis === 'perServing' && !num(manualDrink.ml))}>Сохранить</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Сканер живёт рядом с листом, а не внутри: лист двигает transform, и
          position:fixed внутри него отсчитывался бы от листа, а не от экрана. */}
      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onFound={pickScanned}
          onManual={manualFromScan}
        />
      )}
    </div>
  )
}

// ── Alcohol section (shown when section === 'alcohol') ──────────────────────

function AlcoholSection({ subTab, setSubTab, alcQuery, setAlcQuery, onPick }) {
  const nq = norm(alcQuery)

  const filteredCocktails = nq
    ? COCKTAILS.filter((c) => norm(c.name).includes(nq) || (c.nameEn || '').toLowerCase().includes(nq))
    : COCKTAILS

  return (
    <div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={subTab === 'beer' ? 'on' : ''} onClick={() => setSubTab('beer')}>🍺 Пиво</button>
        <button className={subTab === 'spirits' ? 'on' : ''} onClick={() => setSubTab('spirits')}>🥃 Крепкое</button>
        <button className={subTab === 'cocktails' ? 'on' : ''} onClick={() => setSubTab('cocktails')}>🍹 Коктейли</button>
      </div>

      {subTab === 'beer' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>Выберите марку — укажите объём и % алкоголя.</p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {BEER_BRANDS.map((b) => (
              <button key={b.name} className="meal-item" style={{ textAlign: 'left', width: '100%' }}
                onClick={() => onPick({ ...b, category: 'beer', emoji: b.na ? '🫗' : '🍺', defaultMl: 330 })}>
                <span className="meal-emoji">{b.na ? '🫗' : '🍺'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="meal-name" style={{ display: 'block' }}>{b.name}{b.na ? ' (безалкогольное)' : ''}</span>
                  <span className="meal-meta">{b.alc}% · {b.kcal100} ккал/100 мл</span>
                </span>
                <span style={{ color: 'var(--primary)', fontSize: 20 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {subTab === 'spirits' && (
        <div>
          {SPIRIT_TYPES.map((st) => (
            <div key={st.key} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>{st.emoji} {st.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {st.brands.map((brand) => (
                  <button key={brand} className="meal-item" style={{ textAlign: 'left', width: '100%' }}
                    onClick={() => onPick({ name: brand, category: 'spirit', spiritLabel: st.label, emoji: st.emoji, defaultAlc: st.defaultAlc, defaultMl: 50 })}>
                    <span className="meal-emoji">{st.emoji}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="meal-name" style={{ display: 'block' }}>{brand}</span>
                      <span className="meal-meta">{st.label} · обычно {st.defaultAlc}%</span>
                    </span>
                    <span style={{ color: 'var(--primary)', fontSize: 20 }}>›</span>
                  </button>
                ))}
                <button className="meal-item" style={{ textAlign: 'left', width: '100%' }}
                  onClick={() => onPick({ name: `Своя ${st.label.toLowerCase()}`, category: 'spirit', spiritLabel: st.label, emoji: st.emoji, defaultAlc: st.defaultAlc, defaultMl: 50, custom: true })}>
                  <span className="meal-emoji">{st.emoji}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="meal-name" style={{ display: 'block' }}>Своя {st.label.toLowerCase()}</span>
                    <span className="meal-meta">Ввести % вручную</span>
                  </span>
                  <span style={{ color: 'var(--primary)', fontSize: 20 }}>›</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {subTab === 'cocktails' && (
        <div>
          <input className="input" placeholder="Поиск на русском или English" value={alcQuery} onChange={(e) => setAlcQuery(e.target.value)} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filteredCocktails.map((c) => (
              <button key={c.name} className="meal-item" style={{ textAlign: 'left', width: '100%' }}
                onClick={() => onPick({ ...c, category: 'cocktail', defaultMl: 200 })}>
                <span className="meal-emoji">{c.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="meal-name" style={{ display: 'block' }}>{c.name}</span>
                  <span className="meal-meta">{c.nameEn} · {c.alc}% · {c.kcal100} ккал/100 мл</span>
                </span>
                <span style={{ color: 'var(--primary)', fontSize: 20 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Alcohol builder (after item is selected) ────────────────────────────────

function AlcoholBuilder({ item, onBack, onAdd, onClose, type }) {
  const [ml, setMl] = useState(String(item.defaultMl || 100))
  const [alcPct, setAlcPct] = useState(String(item.alc ?? item.defaultAlc ?? 40))
  const [kcalCustom, setKcalCustom] = useState('')

  const mlN = Math.max(0, num(ml))
  const alcN = Math.max(0, num(alcPct))

  let kcalAuto
  if (item.kcal100 != null) {
    kcalAuto = Math.round(item.kcal100 * mlN / 100)
  } else {
    kcalAuto = alcKcal(mlN, alcN)
  }
  const kcalFinal = kcalCustom !== '' ? Math.round(num(kcalCustom)) : kcalAuto

  const add = () => {
    if (mlN <= 0) return
    const displayName = item.category === 'beer'
      ? item.name
      : item.category === 'cocktail'
      ? item.name
      : `${item.name} ${alcN}%`
    onAdd({ type, name: displayName, emoji: item.emoji, grams: mlN, unit: 'мл', kcal: kcalFinal, protein: 0, carbs: 0, fat: 0 })
    onClose()
  }

  const quickMls = item.category === 'beer'
    ? [150, 250, 330, 500]
    : item.category === 'cocktail'
    ? [100, 150, 200, 300]
    : [30, 50, 75, 100]

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{item.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>{item.name}</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← назад</button>
        </div>
      </div>

      <div className="field">
        <label>Объём, мл</label>
        <input className="input" type="text" inputMode="decimal" value={ml} onChange={(e) => setMl(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="row wrap gap8">
          {quickMls.map((v) => (
            <button key={v} className={`chip ${mlN === v ? 'on' : ''}`} onClick={() => setMl(String(v))}>
              {v} мл
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>% алкоголя</label>
        <input className="input" type="text" inputMode="decimal" value={alcPct} onChange={(e) => setAlcPct(e.target.value)} />
      </div>

      <div className="field">
        <label>Калории, ккал <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно — считаем автоматически)</span></label>
        <input
          className="input"
          type="number"
          inputMode="numeric"
          placeholder={`≈ ${kcalAuto} (авто)`}
          value={kcalCustom}
          onChange={(e) => setKcalCustom(e.target.value)}
        />
      </div>

      <div className="row gap8" style={{ marginBottom: 22 }}>
        <PreviewStat label="ккал" v={kcalFinal} />
        <PreviewStat label="мл" v={mlN} />
        <PreviewStat label="алк.%" v={alcN} />
      </div>

      <button className="btn" onClick={add} disabled={mlN <= 0}>Добавить {kcalFinal} ккал</button>
    </div>
  )
}

// ── Existing sub-components ─────────────────────────────────────────────────

function ProteinShakeBuilder({ selected, prefs, setPref, onBack, onAdd, onClose, type }) {
  const [base, setBase] = useState('water')
  const [powder, setPowder] = useState('30')
  const [per100, setPer100] = useState(prefs.proteinPer100 ? String(prefs.proteinPer100) : '75')
  const [kcalPer100, setKcalPer100] = useState(prefs.powderKcalPer100 ? String(prefs.powderKcalPer100) : '')
  const [milkKey, setMilkKey] = useState('3.2')
  const [milkMl, setMilkMl] = useState('250')

  const pG = Math.max(0, num(powder))
  const pp = Math.max(0, num(per100))
  const pk = Math.max(0, num(kcalPer100))
  const mMl = Math.max(0, num(milkMl))
  const milk = MILKS.find((m) => m.key === milkKey) || MILKS[0]

  let kcal = (pG * pk) / 100
  let protein = (pG * pp) / 100
  let carbs = 0
  let fat = 0
  if (base === 'milk') {
    const f = mMl / 100
    kcal += milk.kcal * f
    protein += milk.protein * f
    carbs += milk.carbs * f
    fat += milk.fat * f
  }
  const res = { kcal: Math.round(kcal), protein: +protein.toFixed(1), carbs: +carbs.toFixed(1), fat: +fat.toFixed(1) }
  const valid = pG > 0 && pp > 0 && pk > 0 && (base === 'water' || mMl > 0)

  const add = () => {
    if (!valid) return
    if (pp !== prefs.proteinPer100) setPref('proteinPer100', pp)
    if (pk !== prefs.powderKcalPer100) setPref('powderKcalPer100', pk)
    const name = base === 'milk' ? `Протеиновый шейк на молоке ${mMl} мл` : 'Протеиновый шейк на воде'
    onAdd({ type, name, emoji: selected.emoji, cat: selected.cat, grams: base === 'milk' ? mMl : null, unit: 'мл', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Протеиновый шейк</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
        </div>
      </div>

      <label style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginBottom: 10, fontWeight: 500 }}>Основа</label>
      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={base === 'water' ? 'on' : ''} onClick={() => setBase('water')}>💧 Вода</button>
        <button className={base === 'milk' ? 'on' : ''} onClick={() => setBase('milk')}>🥛 Молоко</button>
      </div>

      {base === 'milk' && (
        <>
          <div className="field">
            <label>Сколько молока, мл</label>
            <input className="input" type="number" inputMode="numeric" value={milkMl} onChange={(e) => setMilkMl(e.target.value)} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginBottom: 10, fontWeight: 500 }}>Жирность молока</label>
            <div className="row wrap gap8">
              {MILKS.map((m) => (
                <button key={m.key} className={`pill ${milkKey === m.key ? 'on' : ''}`} onClick={() => setMilkKey(m.key)}>{m.label}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label>Сколько порошка протеина, г</label>
        <input className="input" type="number" inputMode="numeric" value={powder} onChange={(e) => setPowder(e.target.value)} />
      </div>
      <div className="row gap8">
        <div className="field" style={{ flex: 1 }}>
          <label>Белка на 100 г (с банки)</label>
          <input className="input" type="number" inputMode="numeric" value={per100} onChange={(e) => setPer100(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Ккал на 100 г (с банки)</label>
          <input className="input" type="number" inputMode="numeric" placeholder="380" value={kcalPer100} onChange={(e) => setKcalPer100(e.target.value)} />
        </div>
      </div>

      <div className="row gap8" style={{ margin: '4px 0 22px' }}>
        <PreviewStat label="ккал" v={res.kcal} />
        <PreviewStat label="белки" v={res.protein} />
        <PreviewStat label="угл." v={res.carbs} />
        <PreviewStat label="жиры" v={res.fat} />
      </div>
      <button className="btn" onClick={add} disabled={!valid}>Добавить {res.kcal} ккал</button>
    </div>
  )
}

function CustomDrinkBuilder({ selected, onBack, onAdd, onClose, addCustomFood, type }) {
  const [name, setName] = useState('')
  const [kcal100, setKcal100] = useState('')
  const [sugar100, setSugar100] = useState('')
  const [protein100, setProtein100] = useState('')
  const [ml, setMl] = useState('250')

  const v = Math.max(0, num(ml))
  const f = v / 100
  const res = {
    kcal: Math.round(num(kcal100) * f),
    protein: round1(num(protein100) * f),
    carbs: round1(num(sugar100) * f),
    fat: 0,
  }
  const valid = name.trim() && kcal100 !== '' && v > 0

  const add = () => {
    if (!valid) return
    addCustomFood({
      name: name.trim(),
      emoji: '🥤',
      cat: 'drink',
      unit: 'мл',
      kcal: num(kcal100),
      protein: num(protein100),
      carbs: num(sugar100),
      fat: 0,
      sugar: num(sugar100),
      source: 'custom',
    })
    onAdd({ type, name: name.trim(), emoji: '🥤', cat: 'drink', grams: v, unit: 'мл', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Свой напиток</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Введите данные с этикетки на 100 мл — напиток сохранится, и в следующий раз нужно будет указать только объём.</p>

      <div className="field">
        <label>Название</label>
        <input className="input" placeholder="Напр. Домашний лимонад" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row gap8">
        <div className="field" style={{ flex: 1 }}>
          <label>Ккал / 100 мл</label>
          <input className="input" type="number" inputMode="numeric" placeholder="42" value={kcal100} onChange={(e) => setKcal100(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Сахар / 100 мл</label>
          <input className="input" type="number" inputMode="decimal" placeholder="10" value={sugar100} onChange={(e) => setSugar100(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Белок / 100 мл</label>
          <input className="input" type="number" inputMode="decimal" placeholder="0" value={protein100} onChange={(e) => setProtein100(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Сколько выпили, мл</label>
        <input className="input" type="number" inputMode="numeric" value={ml} onChange={(e) => setMl(e.target.value)} />
      </div>

      <div className="row gap8" style={{ margin: '4px 0 22px' }}>
        <PreviewStat label="ккал" v={res.kcal} />
        <PreviewStat label="сахар" v={res.carbs} />
        <PreviewStat label="белки" v={res.protein} />
      </div>
      <button className="btn" onClick={add} disabled={!valid}>Сохранить и добавить {res.kcal} ккал</button>
    </div>
  )
}

function Stepper({ value, set, min = 0, suffix }) {
  return (
    <div className="row gap8" style={{ alignItems: 'center' }}>
      <button className="iconbtn" onClick={() => set(Math.max(min, value - 1))} aria-label="Меньше">−</button>
      <span className="tabular" style={{ minWidth: 54, textAlign: 'center', fontWeight: 600 }}>{value}{suffix ? ` ${suffix}` : ''}</span>
      <button className="iconbtn" onClick={() => set(value + 1)} aria-label="Больше">+</button>
    </div>
  )
}

function ConstructorBuilder({ selected, onBack, onAdd, onClose, addCustomFood, customIngredients = [], addCustomIngredient, type }) {
  const group = BASE_GROUPS[selected.baseGroup] || BASE_GROUPS.bread
  const [baseName, setBaseName] = useState(selected.preset?.base || group.items[0].name)
  const [slices, setSlices] = useState(selected.preset?.slices || 1)
  const [items, setItems] = useState([])
  const [name, setName] = useState(selected.name)
  const [servings, setServings] = useState(1)
  const [ingQuery, setIngQuery] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [ci, setCi] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', grams: '50' })

  const bread = group.items.find((b) => b.name === baseName) || group.items[0]
  const baseGrams = slices * bread.each
  const baseMacros = scale(bread, baseGrams)

  const withMacros = items.map((it) => {
    const grams = it.count * it.each
    return { ...it, grams, m: scale(it, grams) }
  })

  const perUnit = withMacros.reduce(
    (a, it) => ({
      kcal: a.kcal + it.m.kcal,
      protein: round1(a.protein + it.m.protein),
      carbs: round1(a.carbs + it.m.carbs),
      fat: round1(a.fat + it.m.fat),
    }),
    { ...baseMacros }
  )
  perUnit.kcal = Math.round(perUnit.kcal)

  const total = {
    kcal: Math.round(perUnit.kcal * servings),
    protein: round1(perUnit.protein * servings),
    carbs: round1(perUnit.carbs * servings),
    fat: round1(perUnit.fat * servings),
  }

  const addIngredient = (ing) => {
    setItems((prev) => {
      const ex = prev.find((p) => p.name === ing.name)
      if (ex) return prev.map((p) => (p.name === ing.name ? { ...p, count: p.count + 1 } : p))
      return [...prev, { ...ing, count: ing.def }]
    })
    setIngQuery('')
  }
  const setCount = (n, c) => {
    if (c <= 0) return setItems((prev) => prev.filter((p) => p.name !== n))
    setItems((prev) => prev.map((p) => (p.name === n ? { ...p, count: c } : p)))
  }

  const nq = ingQuery.trim().toLowerCase().replace(/ё/g, 'е')
  const customMatches = nq ? customIngredients.filter((i) => i.name.toLowerCase().replace(/ё/g, 'е').includes(nq)) : []
  const suggestions = ingQuery.trim() ? [...customMatches, ...searchIngredients(ingQuery).slice(0, 8)] : []

  const addCustom = () => {
    const nm = ci.name.trim()
    if (!nm) return
    const grams = Math.max(1, num(ci.grams) || 50)
    const ing = {
      name: nm,
      kcal: num(ci.kcal),
      protein: num(ci.protein),
      carbs: num(ci.carbs),
      fat: num(ci.fat),
      each: grams,
      unitName: 'порция',
      def: 1,
      emoji: '🍽️',
      custom: true,
    }
    addCustomIngredient?.(ing)
    addIngredient(ing)
    setCi({ name: '', kcal: '', protein: '', carbs: '', fat: '', grams: '50' })
    setShowCustom(false)
  }

  const unit = selected.unit || 'шт'

  const finish = () => {
    const finalName = name.trim() || selected.name
    addCustomFood({
      name: finalName,
      emoji: selected.emoji,
      cat: selected.cat || 'dish',
      unit,
      kind: 'composite',
      kcal: perUnit.kcal,
      protein: perUnit.protein,
      carbs: perUnit.carbs,
      fat: perUnit.fat,
      recipe: { base: baseName, slices, items: items.map((i) => ({ name: i.name, count: i.count })) },
      source: 'custom',
    })
    onAdd({ type, name: finalName, emoji: selected.emoji, cat: selected.cat || 'dish', grams: servings, unit, ...total })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Собери {selected.name.toLowerCase()}</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другое</button>
        </div>
      </div>

      <label style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginBottom: 10, fontWeight: 500 }}>{group.label}</label>
      <div className="row wrap gap8" style={{ marginBottom: 14 }}>
        {group.items.map((b) => (
          <button key={b.name} className={`pill ${baseName === b.name ? 'on' : ''}`} onClick={() => setBaseName(b.name)}>{b.name}</button>
        ))}
      </div>
      <div className="row between" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{group.countLabel}</span>
        <Stepper value={slices} set={setSlices} min={1} />
      </div>

      <label style={{ display: 'block', fontSize: 14, color: 'var(--ink-2)', marginBottom: 10, fontWeight: 500 }}>Начинка</label>
      {withMacros.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {withMacros.map((it) => (
            <div key={it.name} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.emoji} {it.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{it.count} {it.unitName} · {it.grams} г · {it.m.kcal} ккал</div>
              </div>
              <Stepper value={it.count} set={(c) => setCount(it.name, c)} min={0} />
            </div>
          ))}
        </div>
      )}
      <input className="input" placeholder="Добавьте ингредиент, напр. салями" value={ingQuery} onChange={(e) => setIngQuery(e.target.value)} style={{ marginBottom: suggestions.length ? 8 : 12 }} />
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {suggestions.map((ing) => (
            <button key={ing.name} className="meal-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => addIngredient(ing)}>
              <span className="meal-emoji">{ing.emoji}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="meal-name" style={{ display: 'block' }}>{ing.name}{ing.custom ? ' · моё' : ''}</span>
                <span className="meal-meta">по умолчанию {ing.def} {ing.unitName} · {ing.kcal} ккал/100 г</span>
              </span>
              <span style={{ color: 'var(--primary)', fontSize: 22 }}>＋</span>
            </button>
          ))}
        </div>
      )}

      {!showCustom ? (
        <button className="btn soft" style={{ height: 44, marginBottom: 18 }} onClick={() => setShowCustom(true)}>＋ Добавить свой ингредиент</button>
      ) : (
        <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Свой ингредиент</span>
            <button style={{ fontSize: 13, color: 'var(--ink-3)' }} onClick={() => setShowCustom(false)}>отмена</button>
          </div>
          <input className="input" placeholder="Название (напр. бабушкина котлета)" value={ci.name} onChange={(e) => setCi({ ...ci, name: e.target.value })} style={{ marginBottom: 8 }} />
          <div className="row gap8" style={{ marginBottom: 8 }}>
            <input className="input" type="number" inputMode="numeric" placeholder="ккал/100г" value={ci.kcal} onChange={(e) => setCi({ ...ci, kcal: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <input className="input" type="number" inputMode="decimal" placeholder="Б/100г" value={ci.protein} onChange={(e) => setCi({ ...ci, protein: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          </div>
          <div className="row gap8" style={{ marginBottom: 8 }}>
            <input className="input" type="number" inputMode="decimal" placeholder="У/100г" value={ci.carbs} onChange={(e) => setCi({ ...ci, carbs: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <input className="input" type="number" inputMode="decimal" placeholder="Ж/100г" value={ci.fat} onChange={(e) => setCi({ ...ci, fat: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <input className="input" type="number" inputMode="numeric" placeholder="грамм" value={ci.grams} onChange={(e) => setCi({ ...ci, grams: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 10px' }}>Все КБЖУ — необязательны, заполните что знаете. «Грамм» — сколько кладёте в блюдо.</p>
          <button className="btn" style={{ height: 44 }} onClick={addCustom} disabled={!ci.name.trim()}>Добавить и запомнить</button>
        </div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
        <div className="row between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>В одной {unit === 'шт' ? 'штуке' : unit === 'порция' ? 'порции' : unit}</span>
          <span className="tabular" style={{ fontWeight: 680, fontSize: 18 }}>{perUnit.kcal} ккал</span>
        </div>
        <div className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Б{perUnit.protein} · У{perUnit.carbs} · Ж{perUnit.fat}</div>
      </div>

      <div className="field">
        <label>Название (сохранится)</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой бутерброд с салями" />
      </div>

      <div className="row between" style={{ margin: '4px 0 18px' }}>
        <span style={{ fontSize: 15, fontWeight: 550 }}>Сколько съел, {unit}</span>
        <Stepper value={servings} set={setServings} min={1} />
      </div>

      <button className="btn" onClick={finish}>Сохранить и добавить {total.kcal} ккал</button>
    </div>
  )
}

function CompositePortion({ selected, onBack, onAdd, onClose, type }) {
  const [servings, setServings] = useState(1)
  const total = {
    kcal: Math.round(selected.kcal * servings),
    protein: round1(selected.protein * servings),
    carbs: round1(selected.carbs * servings),
    fat: round1(selected.fat * servings),
  }
  const unit = selected.unit || 'шт'
  const add = () => {
    onAdd({ type, name: selected.name, emoji: selected.emoji, cat: selected.cat, grams: servings, unit, ...total })
    onClose()
  }
  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
        </div>
      </div>
      <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>В одной порции: {selected.kcal} ккал · Б{selected.protein} У{selected.carbs} Ж{selected.fat}</span>
      </div>
      <div className="row between" style={{ margin: '4px 0 18px' }}>
        <span style={{ fontSize: 15, fontWeight: 550 }}>Сколько съел, {unit}</span>
        <Stepper value={servings} set={setServings} min={1} />
      </div>
      <div className="row gap8" style={{ marginBottom: 22 }}>
        <PreviewStat label="ккал" v={total.kcal} />
        <PreviewStat label="белки" v={total.protein} />
        <PreviewStat label="угл." v={total.carbs} />
        <PreviewStat label="жиры" v={total.fat} />
      </div>
      <button className="btn" onClick={add}>Добавить {total.kcal} ккал</button>
    </div>
  )
}

// remembered — привычная порция из памяти по журналу приёмов. Раньше здесь был
// свой поиск по списку недавних, да ещё и по началу строки: «Молоко» цепляло
// «Молоко сгущённое», и в поле подставлялся вес другого продукта.
function DairyPortion({ selected, onBack, onAdd, onClose, type, remembered }) {
  const [fat, setFat] = useState(String(selected.defFat))
  const [grams, setGrams] = useState(remembered > 0 ? String(remembered) : '200')

  const fatN = Math.max(0, num(fat))
  const g = Math.max(0, num(grams))
  const per100 = {
    protein: selected.protein,
    carbs: selected.carbs,
    fat: fatN,
    kcal: Math.round(4 * selected.protein + 4 * selected.carbs + 9 * fatN),
  }
  const res = scale(per100, g)
  const valid = String(fat).trim() !== '' && g > 0

  const add = () => {
    if (!valid) return
    onAdd({ type, name: `${selected.name} ${fatN}%`, emoji: selected.emoji, cat: selected.cat, grams: g, unit: 'г', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
          <button className="tap44" style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
        </div>
      </div>

      <div className="field">
        <label>Жирность, %</label>
        <input className="input" type="text" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="row wrap gap8">
          {selected.fats.map((v) => (
            <button key={v} className={`chip ${fatN === v ? 'on' : ''}`} onClick={() => setFat(String(v))}>{v}%</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Порция, грамм</label>
        {getPortions(selected)[0] && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 8px' }}>
            Не взвешивая: {getPortions(selected)[0].label} ≈ {getPortions(selected)[0].grams} г
          </p>
        )}
        <input className="input" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="row wrap gap8">
          {getPortions(selected).map((p) => (
            <button key={p.label} className={`chip ${g === p.grams ? 'on' : ''}`} onClick={() => setGrams(String(p.grams))}>
              {p.label} · {p.grams} г
            </button>
          ))}
        </div>
      </div>

      <div className="row gap8" style={{ margin: '4px 0 22px' }}>
        <PreviewStat label="ккал" v={res.kcal} />
        <PreviewStat label="белки" v={res.protein} />
        <PreviewStat label="угл." v={res.carbs} />
        <PreviewStat label="жиры" v={res.fat} />
      </div>
      <button className="btn" onClick={add} disabled={!valid}>Добавить {res.kcal} ккал</button>
    </div>
  )
}

// ── Строка памяти ────────────────────────────────────────────────────────────
// Три зоны касания, каждая не меньше 44 px: звезда, тело строки (открыть) и
// кнопка быстрого добавления. Кнопка быстрого добавления показывается только
// когда количество реально известно — она подписана этим количеством, чтобы
// человек видел, что именно запишется, ДО нажатия.
function MemoryRow({ emoji, name, meta, quickLabel, onQuick, onOpen, favorite, onFav }) {
  return (
    <div className="meal-item" style={{ gap: 8 }}>
      {onFav ? (
        <button
          onClick={onFav}
          aria-label={favorite ? `Убрать «${name}» из избранного` : `Добавить «${name}» в избранное`}
          aria-pressed={favorite}
          style={{
            width: 40, height: 44, flex: '0 0 auto', fontSize: 17, lineHeight: 1,
            color: favorite ? 'var(--primary)' : 'var(--ink-3)',
          }}
        >{favorite ? '★' : '☆'}</button>
      ) : (
        <span style={{ width: 40, flex: '0 0 auto' }} />
      )}
      <button
        onClick={onOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', flex: 1, minWidth: 0, minHeight: 44 }}
      >
        <span className="meal-emoji">{emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span className="meal-meta">{meta}</span>
        </span>
      </button>
      {quickLabel && (
        <button
          onClick={onQuick}
          aria-label={`Записать «${name}», ${quickLabel}`}
          className="chip"
          style={{ flex: '0 0 auto', minHeight: 44, padding: '10px 12px', fontWeight: 600, color: 'var(--primary)' }}
        >＋ {quickLabel}</button>
      )}
    </div>
  )
}

// Подпись строки памяти. Показываем привычную порцию и её калорийность —
// столько, чтобы узнать продукт, и не столько, чтобы читать таблицу.
function memoryMeta(e) {
  const repeat = repeatEntry(e)
  if (repeat?.grams > 0) return `${repeat.grams} ${e.unit} · ${repeat.kcal} ккал`
  if (repeat) return `${repeat.kcal} ккал`
  return `${e.uses} ${plural(e.uses, 'раз', 'раза', 'раз')}`
}

// Подпись кнопки быстрого добавления — только если количество известно.
function quickLabelFor(e) {
  const g = e.typicalGrams ?? e.lastGrams
  return g > 0 ? `${g} ${e.unit}` : null
}

// Закрепить можно то, что переводится «на 100»: без количества пересчитать
// продукт не из чего, а выдумывать значения нельзя.
const canFavorite = (e) => Number(e?.snapshot?.grams) > 0


// Скелет строки вместо спиннера: место под результат занимается сразу, и
// список не прыгает, когда ответ приходит.
function SkeletonRow() {
  return (
    <div className="meal-item" style={{ gap: 12 }}>
      <span className="meal-emoji" style={{ opacity: 0.4 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', height: 12, width: '58%', borderRadius: 6, background: 'var(--surface-2)', marginBottom: 7 }} />
        <span style={{ display: 'block', height: 10, width: '34%', borderRadius: 5, background: 'var(--surface-2)' }} />
      </span>
    </div>
  )
}

const clip = (s, n = 22) => (s.length > n ? s.slice(0, n) + '…' : s)

function SectionLabel({ text, count }) {
  return (
    <div className="row between" style={{ margin: '2px 0 8px' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{text}</span>
      {count != null && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{count}</span>}
    </div>
  )
}

// Подпись по БЖУ. Если база не знает ни одного из трёх — так и пишем, а не
// рисуем нули: «Б0 У0 Ж0» человек читает как измеренный факт, а это отсутствие
// данных. Известное частично показываем через общий macroLabel с прочерками.
const macroText = (f) => (hasMacros(f) ? macroLabel(f) : 'БЖУ не указаны')

function FoodRow({ f, onClick, onDelete, favorite, onFav, quickLabel, onQuick }) {
  let subtitle
  if (f.builder === 'constructor') subtitle = 'собрать из ингредиентов'
  else if (f.builder === 'protein') subtitle = 'рассчитать по ингредиентам'
  else if (f.builder === 'custom') subtitle = 'добавить и запомнить свой'
  else if (f.kind === 'composite') subtitle = `${f.kcal} ккал/порция · моё`
  else if (f.dairy) subtitle = 'укажите порцию и % жирности'
  // Свой продукт: единица берётся из самого продукта. Раньше здесь были жёстко
  // зашиты «100 мл» и «мой напиток» — собственное БЛЮДО подписывалось как
  // напиток и в чужих единицах.
  else if (f.source === 'custom') subtitle = `${f.kcal} ккал · ${macroText(f)} / 100 ${f.unit || 'г'} · моё`
  else if (f.hasVariants) subtitle = `${f.methods.length} способов приготовления`
  else subtitle = `${f.kcal} ккал · ${macroText(f)} / 100 ${f.unit || 'г'}`
  const chevron = f.builder || f.hasVariants || f.kind === 'composite' || f.dairy ? '›' : '＋'
  return (
    <div className="meal-item" style={{ gap: 8 }}>
      {onFav && (
        <button
          onClick={onFav}
          aria-label={favorite ? `Убрать «${f.name}» из избранного` : `Добавить «${f.name}» в избранное`}
          aria-pressed={favorite}
          style={{ width: 34, height: 44, flex: '0 0 auto', fontSize: 17, lineHeight: 1, color: favorite ? 'var(--primary)' : 'var(--ink-3)' }}
        >{favorite ? '★' : '☆'}</button>
      )}
      <button style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', flex: 1, minWidth: 0, minHeight: 44 }} onClick={onClick}>
        <span className="meal-emoji">{f.emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <span className="meal-meta">{subtitle}</span>
        </span>
        {!quickLabel && <span style={{ color: 'var(--primary)', fontSize: 22, flex: '0 0 auto' }}>{chevron}</span>}
      </button>
      {quickLabel && (
        <button
          onClick={onQuick}
          aria-label={`Записать «${f.name}», ${quickLabel}`}
          className="chip"
          style={{ flex: '0 0 auto', minHeight: 44, padding: '10px 12px', fontWeight: 600, color: 'var(--primary)' }}
        >＋ {quickLabel}</button>
      )}
      {onDelete && (
        <button onClick={onDelete} aria-label={`Удалить «${f.name}»`} style={{ color: 'var(--ink-3)', fontSize: 18, flex: '0 0 auto', width: 32, height: 44 }}>✕</button>
      )}
    </div>
  )
}

// Плитка выбранного продукта. У товара со штрихкодом Open Food Facts обычно
// есть фото упаковки — показываем его вместо эмодзи. Фото нет, не загрузилось
// или человек офлайн — остаётся ровно прежняя плитка с эмодзи: размер тот же,
// интерфейс не прыгает.
const THUMB = 52

function FoodThumb({ food }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="meal-emoji" style={{ width: THUMB, height: THUMB, fontSize: 24, overflow: 'hidden', padding: 0 }}>
      {food.photo && !failed ? (
        // Размер в пикселях, а не в процентах: плитка — grid с выравниванием по
        // центру, её потомок не растягивается, и проценту не от чего считаться —
        // фото вылезало вверх (у бутылок оно вытянутое) и обрезалось по этикетке.
        <img
          src={food.photo}
          alt=""
          loading="lazy"
          width={THUMB}
          height={THUMB}
          onError={() => setFailed(true)}
          style={{ width: THUMB, height: THUMB, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        food.emoji
      )}
    </span>
  )
}

// v === null означает «неизвестно» — это не ноль, и выглядеть нулём не должно.
function PreviewStat({ label, v }) {
  const unknown = v == null
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 13, padding: '12px 6px', textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 650, color: unknown ? 'var(--ink-3)' : undefined }}>{unknown ? '—' : v}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</div>
    </div>
  )
}

// Экран своего блюда: что именно добавится и сколько это калорий.
//
// Блюдо кладёт в день СРАЗУ НЕСКОЛЬКО строк, поэтому показать состав до
// нажатия обязательно: иначе человек добавляет вслепую и потом удаляет три
// записи по одной.
function TemplateScreen({ tpl, onBack, onAdd, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const tot = templateTotals(tpl)
  const n = tpl.items.length

  return (
    <div>
      <div className="row gap12" style={{ alignItems: 'center', marginBottom: 14 }}>
        <span className="meal-emoji" style={{ width: 44, height: 44, fontSize: 20 }}>{tpl.emoji || '🍽️'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{tpl.name}</div>
          <button onClick={onBack} className="tap44" style={{ fontSize: 13.5, color: 'var(--primary)', fontWeight: 550, minHeight: 32 }}>← выбрать другое</button>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Состав · {n}</span>
          <span className="tabular" style={{ fontWeight: 680, fontSize: 18 }}>{tot.kcal} ккал</span>
        </div>
        {tpl.items.map((m, i) => (
          <div key={m.id || i} className="row between" style={{ padding: '5px 0', gap: 10 }}>
            <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.emoji} {m.name}</span>
            <span className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto' }}>
              {m.grams ? `${m.grams} ${m.unit || 'г'}` : `${m.kcal} ккал`}
            </span>
          </div>
        ))}
        <div className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8 }}>{macroLabel(tot)}</div>
      </div>

      <button className="btn" onClick={onAdd}>
        Добавить {n} {plural(n, 'продукт', 'продукта', 'продуктов')}
      </button>

      {/* Удаление — приглушённая ссылка, а не вторая большая кнопка. Рядом с
          главным действием кнопка того же веса читается как равноправный
          выбор, и по ней промахиваются. Подтверждение — на месте, чтобы
          случайное касание ничего не стёрло. */}
      {confirmDelete ? (
        <div className="row gap12" style={{ marginTop: 16 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={onDelete}>Удалить</button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{ fontSize: 14, color: 'var(--ink-3)', minHeight: 44, padding: '0 12px' }}
          >Удалить блюдо</button>
        </div>
      )}
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '6px 0 0', lineHeight: 1.45, textAlign: 'center' }}>
        Удаление блюда не трогает уже записанное в дневнике.
      </p>
    </div>
  )
}

// Экран рецепта: сколько порций от кастрюли съедено.
//
// Рецепт — это ОДНА строка в дневнике, в отличие от блюда. Кастрюля делится на
// порции один раз, при сохранении; здесь человек говорит только «сколько я
// съел», и дробные значения обязаны работать: полтарелки — обычное дело.
function RecipeScreen({ recipe, onBack, onAdd, onEdit, onDelete }) {
  const [servings, setServings] = useState('1')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const n = Math.max(0, num(servings))
  const per = recipePerServing(recipe)
  const eaten = {
    kcal: Math.round(per.kcal * n),
    protein: per.protein == null ? null : round1(per.protein * n),
    carbs: per.carbs == null ? null : round1(per.carbs * n),
    fat: per.fat == null ? null : round1(per.fat * n),
  }

  return (
    <div>
      <div className="row gap12" style={{ alignItems: 'center', marginBottom: 14 }}>
        <span className="meal-emoji" style={{ width: 44, height: 44, fontSize: 20 }}>{recipe.emoji || '🍲'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{recipe.name}</div>
          <button onClick={onBack} className="tap44" style={{ fontSize: 13.5, color: 'var(--primary)', fontWeight: 550, minHeight: 32 }}>← выбрать другой</button>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
        <div className="row between">
          <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>
            Вся кастрюля · {recipe.items.length} {plural(recipe.items.length, 'ингредиент', 'ингредиента', 'ингредиентов')}
          </span>
          <span className="tabular" style={{ fontWeight: 650 }}>{recipeTotals(recipe).kcal} ккал</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
          {recipe.servings} {plural(recipe.servings, 'порция', 'порции', 'порций')} по {per.kcal} ккал
          {per.grams > 0 ? ` · ≈${per.grams} г` : ''}
        </div>
      </div>

      {recipe.notes && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{recipe.notes}</p>
      )}

      <div className="field">
        <label>Сколько порций съели</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={servings}
          onChange={(e) => setServings(sanitizeAmount(e.target.value))}
        />
        <div className="row wrap gap8" style={{ marginTop: 10 }}>
          {['0.5', '1', '1.5', '2'].map((v) => (
            <button key={v} className={`chip ${servings === v ? 'on' : ''}`} onClick={() => setServings(v)}>
              {v.replace('.', ',')}
            </button>
          ))}
        </div>
      </div>

      <div className="row gap8" style={{ margin: '4px 0 22px' }}>
        <PreviewStat label="ккал" v={eaten.kcal} />
        <PreviewStat label="белки" v={eaten.protein} />
        <PreviewStat label="угл." v={eaten.carbs} />
        <PreviewStat label="жиры" v={eaten.fat} />
      </div>

      <button className="btn" onClick={() => onAdd(n)} disabled={!(n > 0)}>Добавить {eaten.kcal} ккал</button>

      {/* Правка и удаление — второстепенные действия одной строкой. Три
          одинаковые кнопки в столбик заставляют выбирать там, где выбор
          очевиден: человек пришёл записать съеденное. */}
      {confirmDelete ? (
        <div className="row gap12" style={{ marginTop: 16 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={onDelete}>Удалить</button>
        </div>
      ) : (
        <div className="row between" style={{ marginTop: 14 }}>
          <button onClick={onEdit} style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, minHeight: 44, padding: '0 4px' }}>
            Изменить рецепт
          </button>
          <button onClick={() => setConfirmDelete(true)} style={{ fontSize: 14, color: 'var(--ink-3)', minHeight: 44, padding: '0 4px' }}>
            Удалить
          </button>
        </div>
      )}
    </div>
  )
}
