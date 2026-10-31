// ─────────────────────────────────────────────────────────────────────────────
// Витамины и минералы за период: сколько каждого в среднем приходит за день.
//
// Это тот же свод, что карточка «Добавки и витамины» на экране дня
// (microSummary.js), только растянутый на неделю, месяц или год. Поэтому и
// правила здесь те же, а не похожие:
//   • еда и добавки складываются. Статистика «только из еды» показала бы
//     человеку, который каждый день пьёт витамин D, честное на вид «мало» — и он
//     пошёл бы за второй банкой;
//   • норма — по полу, возрасту и личным целям (microTargets);
//   • статус строки — из microRow, слово в слово как на экране дня.
//
// ── По каким дням считается среднее ─────────────────────────────────────────
// Ровно по тем, что и вся остальная статистика: дни с едой, не исключённые
// вручную и не «внесённые наполовину» (stats.countsInStats). Список дней
// приходит снаружи — из computeStats().loggedKeys, — чтобы «заполнено 5 из 7»
// наверху экрана и знаменатель средних здесь не могли разойтись.
//
// Среднее за день — сумма по этим дням, делённая на их число. Пустые дни нулями
// не идут: неделя, где заполнены три дня, иначе показала бы витаминов вдвое
// меньше, чем человек на самом деле ест.
//
// ── Почему, кроме среднего, считаются дни ───────────────────────────────────
// Среднее прячет режим. Говяжья печень раз в неделю даёт средний витамин A
// «в норме», хотя шесть дней из семи его было мало. Для жирорастворимых
// витаминов, которые организм запасает, среднее и правда главное число, для
// витамина C — нет. Поэтому рядом со средним живёт «норма закрыта в N из M
// дней»: два числа вместе не дают обмануться ни одному из них.
//
// ── Чего здесь нет ──────────────────────────────────────────────────────────
// Того же, чего нет на экране дня: никаких «у вас дефицит». Содержание в
// съеденном — не усвоенное, а дневник — не анализ крови.
// ─────────────────────────────────────────────────────────────────────────────

import { MICRONUTRIENTS, MICRO_GROUPS, microTargets } from './micronutrients.js'
import { microsForEntry } from './foodMicros.js'
import { microRow, STATUS } from './microSummary.js'
import { normalizeName } from './text.js'

// Сколько источников показывать у строки: «больше всего дали».
export const SOURCES_LIMIT = 3

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const listOf = (v) => (Array.isArray(v) ? v : [])

// Источник — продукт или добавка, сгруппированные по названию. Добавки живут в
// своём пространстве имён: «Коллаген» из банки и «коллаген» из холодца — это
// разные источники, и склеивать их в одну строку значило бы соврать, откуда
// что пришло.
function sourceOf(map, id, name, emoji, supp) {
  let s = map.get(id)
  if (!s) {
    s = { names: new Map(), emoji: '', supp, values: {} }
    map.set(id, s)
  }
  s.names.set(name, (s.names.get(name) || 0) + 1)
  if (!s.emoji && emoji) s.emoji = emoji
  return s
}

// Человекочитаемое имя — самое частое написание (как в рейтинге продуктов).
function displayName(names) {
  let best = ''
  let n = -1
  for (const [name, c] of names) {
    if (c > n) {
      n = c
      best = name
    }
  }
  return best
}

// days      — store.days;
// dayKeys   — дни, по которым считать среднее (computeStats().loggedKeys);
// profile   — для норм по полу и возрасту;
// goals     — личные нормы (prefs.microGoals);
// stackKeys — вещества из стека добавок: строку креатина видит тот, кто пьёт
//             креатин, а не все подряд (как на экране дня).
export function computeMicroStats(days, dayKeys, { profile = null, goals = {}, stackKeys = null } = {}) {
  const D = days && typeof days === 'object' ? days : {}
  const keys = listOf(dayKeys).filter((k) => D[k] && typeof D[k] === 'object')
  const n = keys.length
  const targets = microTargets(profile, goals)
  const inStack = stackKeys instanceof Set ? stackKeys : new Set(stackKeys || [])

  const food = {} // ключ → сумма из еды за все дни
  const supp = {} // ключ → сумма из добавок за все дни
  // ключ → [итог дня по каждому дню]. Нужен для «норма закрыта в N из M»:
  // из суммы за период этого не вытащить.
  const perDay = Object.fromEntries(MICRONUTRIENTS.map((d) => [d.key, []]))
  const sources = new Map()
  let entries = 0
  let covered = 0
  let byCategory = 0

  for (const k of keys) {
    const day = D[k]
    const dayFood = {}
    const daySupp = {}

    for (const e of listOf(day.meals)) {
      if (!e || !e.name) continue
      entries += 1
      const { values, confidence } = microsForEntry(e)
      // Неопознанная запись не равна нулю витаминов — она просто не
      // посчитана, и об этом экран скажет отдельно (см. coverage).
      if (confidence === 'unknown') continue
      covered += 1
      if (confidence === 'category') byCategory += 1
      const src = sourceOf(sources, 'food:' + normalizeName(e.name), e.name, e.emoji, false)
      for (const key in values) {
        const v = num(values[key])
        if (v <= 0) continue
        dayFood[key] = (dayFood[key] || 0) + v
        src.values[key] = (src.values[key] || 0) + v
      }
    }

    for (const e of listOf(day.supps)) {
      if (!e || typeof e !== 'object') continue
      const provides = e.provides && typeof e.provides === 'object' ? e.provides : {}
      // Пустое имя не подменяем русским словом: подпись подставит экран.
      const label = e.name || ''
      let src = null
      for (const key in provides) {
        const v = num(provides[key])
        if (v <= 0) continue
        daySupp[key] = (daySupp[key] || 0) + v
        if (!src) {
          src = sourceOf(sources, 'supp:' + normalizeName(label), label, e.emoji || '💊', true)
          if (e.suppId && !src.suppId) src.suppId = e.suppId
        }
        src.values[key] = (src.values[key] || 0) + v
      }
    }

    for (const def of MICRONUTRIENTS) {
      const f = def.fromFood ? dayFood[def.key] || 0 : 0
      const s = daySupp[def.key] || 0
      food[def.key] = (food[def.key] || 0) + f
      supp[def.key] = (supp[def.key] || 0) + s
      perDay[def.key].push(f + s)
    }
  }

  // Источники нутриента: кто сколько дал за весь период и какую долю итога.
  // Доля — от суммы еды и добавок, поэтому у витамина D рядом с лососем честно
  // стоит банка, которая дала ему девять десятых.
  const sourcesFor = (def) => {
    const rows = []
    let all = 0
    for (const s of sources.values()) {
      if (!s.supp && !def.fromFood) continue
      const v = s.values[def.key] || 0
      if (v <= 0) continue
      all += v
      rows.push({ name: displayName(s.names), emoji: s.emoji || (s.supp ? '💊' : '🍽️'), supp: s.supp, ...(s.suppId ? { suppId: s.suppId } : {}), total: v })
    }
    return rows
      .sort((a, b) => b.total - a.total)
      .slice(0, SOURCES_LIMIT)
      .map((r) => ({ ...r, perDay: n ? r.total / n : 0, share: all > 0 ? r.total / all : 0 }))
  }

  const rows = MICRONUTRIENTS.map((def) => {
    const goal = Number(goals?.[def.key])
    const personal = Number.isFinite(goal) && goal > 0
    const row = microRow(def, {
      food: n ? food[def.key] / n : 0,
      supp: n ? supp[def.key] / n : 0,
      target: targets[def.key],
      personal,
    })
    const daily = perDay[def.key]
    const t = row.target
    return {
      ...row,
      // Норму закрывали (для «добираем») или ориентир превышали (для «не
      // превышать») — по дням, а не в среднем. null там, где сравнивать не с
      // чем: у вещества нет нормы.
      daysDone: t != null && def.kind !== 'limit' ? daily.filter((v) => v >= t).length : null,
      daysOver: t != null && def.kind === 'limit' ? daily.filter((v) => v > t).length : null,
      daysWith: daily.filter((v) => v > 0).length,
      sources: sourcesFor(def),
      // Что попадает на экран — правило экрана дня: витамины и основные
      // минералы всегда (их отсутствие само по себе новость), остальное —
      // только если оно про этого человека.
      shown: !def.optional || row.total > 0 || inStack.has(def.key) || personal,
    }
  })

  const shown = rows.filter((r) => r.shown)
  const isDone = (r) => r.status === STATUS.DONE || r.status === STATUS.OVER || r.status === STATUS.UL
  const groups = MICRO_GROUPS
    .map((g) => {
      const list = shown.filter((r) => r.def.group === g.key)
      return {
        ...g,
        rows: list,
        // Как на экране дня: «закрыто N из M» — только среди того, что
        // набирают и у чего есть норма. Натрий в этом счёте не участвует.
        done: list.filter((r) => r.def.kind !== 'limit' && isDone(r)).length,
        total: list.filter((r) => r.def.kind !== 'limit' && r.target != null).length,
      }
    })
    .filter((g) => g.rows.length > 0)

  return {
    days: n,
    rows,
    byKey: Object.fromEntries(rows.map((r) => [r.key, r])),
    groups,
    done: groups.reduce((s, g) => s + g.done, 0),
    total: groups.reduce((s, g) => s + g.total, 0),
    // Насколько можно верить средним: сколько записей еды за период удалось
    // разобрать. Всё неразобранное в средние не вошло вовсе.
    coverage: {
      covered,
      total: entries,
      byCategory,
      ratio: entries > 0 ? covered / entries : 1,
    },
  }
}
