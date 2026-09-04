// ─────────────────────────────────────────────────────────────────────────────
// Свод дня по микронутриентам: еда + добавки против нормы.
//
// Это то место, ради которого затевались foodMicros.js и supplements.js.
// Отдельный счётчик добавок бесполезен и даже вреден: он показывает «витамина C
// сегодня 300 из 500, добери ещё» человеку, который уже съел болгарский перец
// и апельсин и давно за нормой. Складывать надо оба источника.
//
// ── Что здесь решается ──────────────────────────────────────────────────────
//
// 1. СТАТУС строки. Мало / норма / закрыто / перебор / выше верхнего предела.
//    Пять состояний, а не три, потому что «закрыто» и «перебор» — это разные
//    новости, и «перебор» с «опасно много» — тоже разные.
//
// 2. НАПРАВЛЕНИЕ. Натрий и кофеин надо не добирать, а не превышать: у них
//    kind: 'limit', и полоска «40% нормы» для них означала бы «съешь ещё соли».
//
// 3. ВЕРХНИЙ ПРЕДЕЛ ИЗ ТАБЛЕТОК. UL магния, ниацина и фолиевой кислоты
//    установлен для синтетической формы. Магнием из гречки его не превысить, и
//    считать в него еду — значит пугать зря. Такие пределы (ulScope: 'supp')
//    сравниваются только с тем, что пришло из добавок.
//
// 4. ЧТО ПОКАЗЫВАТЬ. Витамины и основные минералы — всегда: их отсутствие само
//    по себе новость. Ашваганду, мелатонин и трибулус — только если человек их
//    принимает или задал себе цель. Иначе экран дня превратился бы в список из
//    семидесяти полосок, где шестьдесят всегда пустые.
//
// ── Чего здесь нет ──────────────────────────────────────────────────────────
// Никаких «у вас дефицит» и «вам нужно принимать». Дефицит определяется по
// анализам крови, а не по дневнику питания за один день: содержание в еде — не
// то же самое, что усвоенное, и один день — не то же самое, что запасы.
// Формулировки в интерфейсе держатся этой границы.
// ─────────────────────────────────────────────────────────────────────────────

import { MICRONUTRIENTS, MICRO_GROUPS, microTargets, overThreshold, OVER_RATIO } from './micronutrients.js'
import { sumFoodMicros } from './foodMicros.js'
import { sumSuppMicros } from './supplements.js'

// Порог «мало». Порог «перебора» живёт в micronutrients.overThreshold: он
// зависит от того, чья это цель — личная или справочная, — и от того, есть ли
// у вещества верхний предел.
export const LOW_RATIO = 0.7
export { OVER_RATIO }

export const STATUS = {
  NONE: 'none',   // сегодня ноль
  LOW: 'low',     // меньше 70% нормы
  OK: 'ok',       // 70–100%
  DONE: 'done',   // норма закрыта
  OVER: 'over',   // заметно больше нормы
  LIMIT: 'limit', // для kind:'limit' — вышли за ориентир (натрий, кофеин)
  UL: 'ul',       // выше верхнего допустимого уровня
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Сколько ещё «можно» до верхнего предела. Для ulScope:'supp' считается от
// добавок: еда в этот предел не входит.
function ulState(def, fromFood, fromSupp) {
  if (def.ul == null) return { ul: null, ulUsed: 0, overUl: false }
  const used = def.ulScope === 'supp' ? fromSupp : fromFood + fromSupp
  return { ul: def.ul, ulUsed: used, overUl: used > def.ul }
}

function statusOf(def, total, target, overUl, personal) {
  if (overUl) return STATUS.UL
  if (def.kind === 'limit') {
    // Ориентир превышен — единственная новость, которая тут бывает.
    // «Мало натрия» человеку сообщать не надо: это не цель.
    if (target > 0 && total > target) return STATUS.LIMIT
    return total > 0 ? STATUS.OK : STATUS.NONE
  }
  if (total <= 0) return STATUS.NONE
  if (!(target > 0)) return STATUS.OK // цели нет — просто показываем количество
  const pct = total / target
  if (pct < LOW_RATIO) return STATUS.LOW
  if (pct < 1) return STATUS.OK
  const over = overThreshold(def, target, personal)
  return over != null && total > over ? STATUS.OVER : STATUS.DONE
}

// ── Одна строка свода ────────────────────────────────────────────────────────
export function microRow(def, { food = 0, supp = 0, target = null, personal = false }) {
  const fromFood = def.fromFood ? num(food) : 0
  const fromSupp = num(supp)
  const total = Math.round((fromFood + fromSupp) * 1000) / 1000
  const goal = target != null && target > 0 ? target : null
  const { ul, ulUsed, overUl } = ulState(def, fromFood, fromSupp)
  const status = statusOf(def, total, goal || 0, overUl, personal)
  return {
    key: def.key,
    def,
    fromFood,
    fromSupp,
    total,
    target: goal,
    // Сколько осталось до нормы. Отрицательное значение осмысленно: «уже на
    // 200 мг больше» — это ровно тот ответ, ради которого всё считалось.
    remaining: goal != null ? Math.round((goal - total) * 1000) / 1000 : null,
    pct: goal != null && goal > 0 ? total / goal : null,
    // Цель поставил человек или это справочная норма. От этого зависит и
    // порог перебора, и формулировка на экране.
    personal,
    ul,
    ulUsed,
    ulScope: def.ulScope,
    overUl,
    status,
  }
}

// ── Свод целиком ─────────────────────────────────────────────────────────────
//
// meals — записи еды за день (day.meals);
// supps — принятые добавки за день (day.supps);
// profile — для норм по полу и возрасту;
// goals — личные цели (prefs.microGoals): решение человека сильнее справочника;
// stackKeys — что человек держит в своём стеке. Нужно ровно затем, чтобы
//   показывать строку креатина у того, кто пьёт креатин, и не показывать её
//   всем остальным.
export function buildMicroSummary({ meals = [], supps = [], profile = null, goals = {}, stackKeys = null } = {}) {
  const fromFood = sumFoodMicros(meals)
  const fromSupp = sumSuppMicros(supps)
  const targets = microTargets(profile, goals)
  const inStack = stackKeys instanceof Set ? stackKeys : new Set(stackKeys || [])

  const rows = []
  for (const def of MICRONUTRIENTS) {
    const row = microRow(def, {
      food: fromFood.values[def.key],
      supp: fromSupp.values[def.key],
      target: targets[def.key],
      personal: Number(goals?.[def.key]) > 0,
    })
    // Что попадает на экран. Необязательные показываем, только когда они
    // действительно про этого человека: он их принимает, задал себе цель или
    // уже что-то получил сегодня.
    row.shown = !def.optional
      || row.total > 0
      || inStack.has(def.key)
      || Number(goals?.[def.key]) > 0
    rows.push(row)
  }

  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
  const shown = rows.filter((r) => r.shown)

  const groups = MICRO_GROUPS
    .map((g) => {
      const list = shown.filter((r) => r.def.group === g.key)
      return {
        ...g,
        rows: list,
        // «Закрыто N из M» считаем только по тем, у кого есть цель И кого
        // вообще нужно набирать: натрий в этом счёте не участвует.
        done: list.filter((r) => r.def.kind !== 'limit' && (r.status === STATUS.DONE || r.status === STATUS.OVER || r.status === STATUS.UL)).length,
        total: list.filter((r) => r.def.kind !== 'limit' && r.target != null).length,
      }
    })
    .filter((g) => g.rows.length > 0)

  // Предупреждения — то, что нельзя оставить внутри свёрнутой карточки.
  // Порядок важен: сначала то, чего слишком много, потом дублирование.
  const alerts = []
  for (const r of shown) {
    if (r.status === STATUS.UL) {
      alerts.push({
        key: r.key,
        level: 'high',
        // Единица стоит у ОБОИХ чисел. «600 — выше предела 350 мг» читается так,
        // будто у первого числа единица другая, и человек начинает гадать.
        text: r.ulScope === 'supp'
          ? `${r.def.label}: из добавок ${fmtShort(r.ulUsed)} ${r.def.unit} при верхнем пределе ${fmtShort(r.ul)} ${r.def.unit}.`
          : `${r.def.label}: ${fmtShort(r.total)} ${r.def.unit} при верхнем пределе ${fmtShort(r.ul)} ${r.def.unit}.`,
      })
    } else if (r.status === STATUS.LIMIT) {
      alerts.push({ key: r.key, level: 'mid', text: `${r.def.label}: ${fmtShort(r.total)} ${r.def.unit} при ориентире ${fmtShort(r.target)} ${r.def.unit}.` })
    }
  }
  // Отдельная новость: норму закрыла ЕДА, а добавка сверху оказалась лишней.
  // Это главный вопрос, ради которого всё считалось, — «а надо ли мне пить».
  for (const r of shown) {
    if (r.def.kind === 'limit') continue
    if (r.fromSupp <= 0 || r.target == null) continue
    if (r.fromFood >= r.target && r.status === STATUS.OVER) {
      alerts.push({
        key: r.key,
        level: 'low',
        text: `${r.def.label}: норму закрыла еда (${fmtShort(r.fromFood)} ${r.def.unit}) — добавка сегодня была лишней.`,
      })
    }
  }

  return {
    rows,
    byKey,
    shown,
    groups,
    alerts,
    targets,
    // Насколько можно верить итогам. covered/total — сколько записей еды
    // удалось разобрать; всё остальное в дне посчитано не было, и молчать об
    // этом нельзя (см. foodMicros.js).
    coverage: {
      covered: fromFood.covered,
      total: fromFood.total,
      byCategory: fromFood.byCategory,
      ratio: fromFood.total > 0 ? fromFood.covered / fromFood.total : 1,
    },
    suppCount: fromSupp.count,
  }
}

// Короткое число для текста предупреждения. Полное форматирование с единицами
// живёт в micronutrients.formatMicro — здесь нужен только компактный вид.
function fmtShort(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2
  const fixed = n.toFixed(digits)
  const text = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return text.replace('.', ',')
}

// ── «Сколько мне ещё нужно» для одной добавки ────────────────────────────────
// Отвечает на вопрос, который человек задаёт перед тем, как проглотить
// капсулу: с учётом уже съеденного, эта доза добьёт норму, закроет её ровно
// или уведёт за предел?
//
// Возвращает по каждому веществу добавки:
//   before / after — сколько было и станет,
//   verdict — 'fills' (в пределах нормы), 'completes' (закроет норму),
//             'excess' (уведёт заметно выше нормы), 'ul' (за верхний предел).
export function previewSupplement(summary, provides) {
  const out = []
  for (const key in provides || {}) {
    const row = summary?.byKey?.[key]
    if (!row) continue
    const add = Number(provides[key]) || 0
    if (add <= 0) continue
    const after = row.total + add
    const target = row.target
    const ulAfter = row.def.ul != null
      && (row.def.ulScope === 'supp' ? row.fromSupp + add : after) > row.def.ul
    const over = overThreshold(row.def, target, row.personal)
    let verdict = 'fills'
    if (ulAfter) verdict = 'ul'
    else if (row.def.kind === 'limit') verdict = target != null && after > target ? 'excess' : 'fills'
    else if (over != null && after > over) verdict = 'excess'
    else if (target != null && after >= target) verdict = 'completes'
    // fromFood уезжает вместе с прикидкой: без него нельзя отличить «норму уже
    // закрыла еда» от «еда добрала половину, а капсула перебросит через верх» —
    // а это два разных совета.
    out.push({ key, def: row.def, before: row.total, fromFood: row.fromFood, add, after, target, verdict })
  }
  // Сначала то, что важно увидеть: перебор, потом закрытие нормы, потом всё
  // остальное — по величине вклада относительно нормы.
  const order = { ul: 0, excess: 1, completes: 2, fills: 3 }
  return out.sort((a, b) => {
    const d = order[a.verdict] - order[b.verdict]
    if (d !== 0) return d
    const ra = a.target ? a.add / a.target : 0
    const rb = b.target ? b.add / b.target : 0
    return rb - ra
  })
}
