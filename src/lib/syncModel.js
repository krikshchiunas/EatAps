// ─────────────────────────────────────────────────────────────────────────────
// Модель синхронизируемого состояния и детерминированное слияние.
//
// Всё пользовательское состояние по-прежнему живёт одним JSONB-блобом в
// app_state.state — архитектуру мы не меняем. Меняется правило записи: раньше
// устройство целиком перезаписывало блоб своей копией («кто последним открыл
// приложение, тот и прав»), из-за чего правки с другого устройства исчезали.
// Теперь блоб сливается по сущностям.
//
// Как это устроено:
//   • у каждой сущности с ID (продукт, секция приёма, свой продукт/ингредиент)
//     есть метка updatedAt — HLC-строка (см. hlc.js);
//   • у скалярных полей (тема, профиль, настройки, настроение/заметка дня)
//     метки лежат рядом, в state.meta — сами поля не меняют форму, поэтому
//     старые читатели (stats, HistoryScreen, FriendAccount) ничего не замечают;
//   • удаления фиксируются тумбстоунами в state.meta.tombstones, а не просто
//     исчезновением записи — иначе удаление на телефоне «воскресало» из копии
//     ноутбука при следующем слиянии.
//
// Обратная совместимость: состояние без meta и без updatedAt читается как есть,
// метки у него считаются нулевыми — то есть любая новая правка их перебивает,
// а данные не теряются. Ничего переписывать в базе заранее не нужно.
// ─────────────────────────────────────────────────────────────────────────────
import { ZERO_TS, compareTs, isTs, maxTs, tsMillis } from './hlc.js'
import { normalizeName } from './text.js'

export const STATE_VERSION = 2

// Ключи, которые уезжают в облако. subscription сюда НЕ входит: её источник
// истины — таблица subscriptions, которую пишет только вебхук Stripe.
export const SYNC_KEYS = ['profile', 'theme', 'days', 'customFoods', 'customIngredients', 'favorites', 'templates', 'recipes', 'supplements', 'recents', 'prefs', 'meta']

// Тумбстоуны старше этого срока выбрасываем: иначе meta растёт бесконечно.
// Устройство, пролежавшее офлайн дольше, может «воскресить» удалённую запись —
// цена за ограниченный размер блоба, срок выбран с большим запасом.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function emptyMeta() {
  return { v: STATE_VERSION, profileTs: ZERO_TS, themeTs: ZERO_TS, prefsTs: {}, dayFieldTs: {}, tombstones: {} }
}

export function blankDay() {
  // supps — принятые за день добавки. Отдельный список, а не строки в meals:
  // у них нет калорий и они не относятся ни к какому приёму пищи, а попав в
  // meals, они сломали бы и суммы дня, и статистику, и карточку «поделиться».
  return { meals: [], mealSections: [], supps: [], mood: null, wellbeing: [], note: '' }
}

// Скаляры дня — поля, которые версионируются каждое своим временем в
// meta.dayFieldTs. Правка веса на телефоне не должна конфликтовать с отметкой
// самочувствия на компьютере, поэтому у каждого поля метка отдельная.
//
// weight / activity — вес и режим ЭТОГО дня: цели по калориям пересчитываются
// на каждый день из них (см. lib/body.js).
// statsExcluded / statsConfirmed — решение человека, учитывать ли день в
// статистике (см. lib/stats.js).
// activityScore — непрерывный балл ползунка активности 0..100. Он ЗДЕСЬ
// обязателен: стор его пишет (setDayActivityScore), body.js считает по нему
// множитель к расходу, то есть от него зависит цель по калориям на этот день.
// Пока его тут не было, поле выживало только на честном слове спреда в
// mergeDay: метка времени для него терялась при первом же слиянии, а день, где
// человек ТОЛЬКО двинул ползунок, считался пустым и удалялся вместе с целью.
// strength — «сегодня была силовая». Отдельный флаг, а не часть ползунка
// ходьбы: штанга и шаги — разные траты, и цель по калориям поднимает именно он
// (см. STRENGTH_FACTOR_BONUS в body.js). Как и всё, от чего зависит цель, поле
// обязано быть здесь: иначе его метка терялась бы при слиянии, а день, где
// человек только отметил тренировку, считался бы пустым.
export const DAY_SCALARS = ['mood', 'wellbeing', 'note', 'weight', 'activity', 'activityScore', 'strength', 'statsExcluded', 'statsConfirmed']

// ── Ключи тумбстоунов ────────────────────────────────────────────────────────
export const tombMeal = (date, id) => `d:${date}:m:${id}`
export const tombSection = (date, id) => `d:${date}:s:${id}`
export const tombCustomFood = (id) => `cf:${id}`
export const tombCustomIngredient = (id) => `ci:${id}`
export const tombFavorite = (id) => `fav:${id}`
export const tombTemplate = (id) => `tpl:${id}`
export const tombRecipe = (id) => `rcp:${id}`
export const tombSupp = (date, id) => `d:${date}:p:${id}`
export const tombSupplement = (id) => `sup:${id}`

// ── Нормализация ─────────────────────────────────────────────────────────────
// Приводит любой вход (пустой, легаси, повреждённый, чужой) к рабочей форме.
// Никогда не бросает: сломанный кусок отбрасывается, остальное выживает.

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const arr = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (typeof v === 'string' ? v : '')

function normalizeTsMap(v) {
  const out = {}
  if (!isObj(v)) return out
  for (const k in v) if (isTs(v[k])) out[k] = v[k]
  return out
}

function normalizeEntity(e) {
  if (!isObj(e)) return null
  const id = e.id != null ? String(e.id) : null
  if (!id) return null
  return isTs(e.updatedAt) ? { ...e, id } : { ...e, id, updatedAt: ZERO_TS }
}

function normalizeEntities(list) {
  const out = []
  const seen = new Set()
  for (const raw of arr(list)) {
    const e = normalizeEntity(raw)
    if (!e || seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

// Вес дня: только осмысленное число. Мусор и опечатки («7 кг», «750») привели бы
// к бессмысленной цели по калориям, поэтому не сохраняем их вовсе.
const WEIGHT_MIN = 20
const WEIGHT_MAX = 400
const ACTIVITY_KEYS = ['sedentary', 'light', 'moderate', 'high']

function normWeight(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= WEIGHT_MIN && n <= WEIGHT_MAX ? Math.round(n * 10) / 10 : null
}

function normActivity(v) {
  return ACTIVITY_KEYS.includes(v) ? v : null
}

// Балл ползунка: только целое 0..100. Всё остальное — мусор, а мусор здесь
// означает неверный множитель к расходу и, значит, неверную цель по калориям.
function normActivityScore(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : null
}

function normalizeDay(raw) {
  const d = isObj(raw) ? raw : {}
  return {
    ...d,
    meals: normalizeEntities(d.meals),
    mealSections: normalizeEntities(d.mealSections),
    supps: normalizeEntities(d.supps),
    mood: d.mood ?? null,
    wellbeing: arr(d.wellbeing).filter((t) => typeof t === 'string'),
    note: str(d.note),
    weight: normWeight(d.weight),
    activity: normActivity(d.activity),
    activityScore: normActivityScore(d.activityScore),
    strength: d.strength === true,
    // Флаги учёта в статистике: строго булевы, чтобы не было «то ли есть, то ли нет».
    statsExcluded: d.statsExcluded === true,
    statsConfirmed: d.statsConfirmed === true,
  }
}

// Ключ недавнего продукта — имя И единица. По одному имени «Молоко, 250 мл» и
// «Молоко, 200 г» схлопывались в одну запись, и одна из них молча пропадала.
// normalizeName приводит регистр, ё и лишние пробелы: раньше стор искал по
// точному имени, а нормализация — по lowercase, поэтому «Банан» и «банан»
// жили в списке двумя строками и при первом же слиянии одна из них исчезала.
export function recentKey(r) {
  return `${normalizeName(r?.name)}|${r?.unit || 'г'}`
}

const recentCount = (r) => {
  const n = Number(r?.count)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1
}

function normalizeRecents(list) {
  const out = []
  const byKey = new Map()
  for (const r of arr(list)) {
    if (!isObj(r) || typeof r.name !== 'string') continue
    const key = recentKey(r)
    const ts = Number.isFinite(r.ts) ? r.ts : 0
    const prev = byKey.get(key)
    // Дубли одного продукта складываем по счётчику, а не теряем: счётчик —
    // это «сколько раз ел», и выбрасывать его вместе с записью нельзя.
    const count = Math.max(recentCount(r), prev ? recentCount(prev) : 0)
    if (prev && prev.ts >= ts) {
      if (count !== recentCount(prev)) {
        const merged = { ...prev, count }
        byKey.set(key, merged)
        out[out.indexOf(prev)] = merged
      }
      continue
    }
    const entry = { ...r, ts, count }
    byKey.set(key, entry)
    if (prev) out[out.indexOf(prev)] = entry
    else out.push(entry)
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 40)
}

export function normalizeState(raw) {
  const s = isObj(raw) ? raw : {}
  const meta = isObj(s.meta) ? s.meta : {}

  const days = {}
  if (isObj(s.days)) {
    for (const date in s.days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      days[date] = normalizeDay(s.days[date])
    }
  }

  const dayFieldTs = {}
  if (isObj(meta.dayFieldTs)) {
    for (const date in meta.dayFieldTs) {
      const m = normalizeTsMap(meta.dayFieldTs[date])
      if (Object.keys(m).length) dayFieldTs[date] = m
    }
  }

  return {
    profile: isObj(s.profile) ? s.profile : null,
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : null,
    days,
    customFoods: normalizeEntities(s.customFoods),
    customIngredients: normalizeEntities(s.customIngredients),
    favorites: normalizeEntities(s.favorites),
    // Шаблоны приёмов и рецепты — обычные сущности с id и меткой времени,
    // сливаются тем же правилом, что избранное и свои продукты.
    templates: normalizeEntities(s.templates),
    recipes: normalizeEntities(s.recipes),
    // Стек добавок — то, что человек принимает регулярно. Сущность с id и
    // меткой, как избранное: список собран руками, и терять его при слиянии
    // двух устройств нельзя.
    supplements: normalizeEntities(s.supplements),
    recents: normalizeRecents(s.recents),
    prefs: isObj(s.prefs) ? { ...s.prefs } : {},
    meta: {
      v: STATE_VERSION,
      profileTs: isTs(meta.profileTs) ? meta.profileTs : ZERO_TS,
      themeTs: isTs(meta.themeTs) ? meta.themeTs : ZERO_TS,
      prefsTs: normalizeTsMap(meta.prefsTs),
      dayFieldTs,
      tombstones: normalizeTsMap(meta.tombstones),
    },
  }
}

// Только синхронизируемые ключи — то, что уходит в app_state.state.
export function pickSyncable(state) {
  const n = normalizeState(state)
  const out = {}
  for (const k of SYNC_KEYS) out[k] = n[k]
  return out
}

// ── Слияние ──────────────────────────────────────────────────────────────────

function mergeTombstones(a, b) {
  const out = { ...a }
  for (const k in b) out[k] = maxTs(out[k], b[k])

  // Точка отсчёта для сборки мусора — САМЫЙ СВЕЖИЙ тумбстоун, а не Date.now().
  // Это важно: слияние обязано быть детерминированным. С часами устройства два
  // телефона из одних и тех же входных данных получали бы разные наборы
  // тумбстоунов (и, как следствие, разное состояние), а устройство со сбитыми
  // часами могло вычистить вообще все удаления и «воскресить» их.
  let newest = 0
  for (const k in out) newest = Math.max(newest, tsMillis(out[k]))
  const cutoff = newest - TOMBSTONE_TTL_MS
  for (const k in out) if (tsMillis(out[k]) < cutoff) delete out[k]
  return out
}

// Объединяем два списка сущностей по ID: для каждого ID побеждает запись с
// более новой меткой. Затем выкидываем то, что было удалено ПОЗЖЕ последней
// правки — так удаление не воскресает, а повторное создание с тем же ID
// (если случится) переживает старое удаление.
function mergeEntities(a, b, tombstones, keyOf) {
  const byId = new Map()
  for (const e of a) byId.set(e.id, e)
  for (const e of b) {
    const prev = byId.get(e.id)
    if (!prev || compareTs(e.updatedAt, prev.updatedAt) > 0) byId.set(e.id, e)
  }
  const out = []
  for (const e of byId.values()) {
    const dead = tombstones[keyOf(e.id)]
    if (dead && compareTs(dead, e.updatedAt) >= 0) continue
    out.push(e)
  }
  return out
}

// Скаляр с внешней меткой: новее — выигрывает; при равных метках берём base
// (для одинаковых меток значения совпадают — метка уникальна по устройству).
function mergeScalar(baseVal, baseTs, incVal, incTs) {
  if (compareTs(incTs, baseTs) > 0) return { value: incVal, ts: incTs }
  if (compareTs(baseTs, incTs) > 0) return { value: baseVal, ts: baseTs }
  return { value: baseVal ?? incVal ?? null, ts: maxTs(baseTs, incTs) }
}

function mergeDay(base, inc, date, baseFieldTs, incFieldTs, tombstones) {
  const b = base || blankDay()
  const i = inc || blankDay()
  const bt = baseFieldTs || {}
  const it = incFieldTs || {}

  const day = {
    ...b,
    ...i,
    meals: mergeEntities(b.meals, i.meals, tombstones, (id) => tombMeal(date, id)),
    mealSections: mergeEntities(b.mealSections, i.mealSections, tombstones, (id) => tombSection(date, id)),
    supps: mergeEntities(b.supps, i.supps, tombstones, (id) => tombSupp(date, id)),
  }

  const fieldTs = {}
  for (const f of DAY_SCALARS) {
    const r = mergeScalar(b[f], bt[f], i[f], it[f])
    day[f] = r.value
    if (isTs(r.ts) && r.ts !== ZERO_TS) fieldTs[f] = r.ts
  }
  // Пустые значения приводим к канону, чтобы merge был идемпотентным.
  day.wellbeing = arr(day.wellbeing)
  day.note = str(day.note)
  day.mood = day.mood ?? null
  day.weight = normWeight(day.weight)
  day.activity = normActivity(day.activity)
  day.activityScore = normActivityScore(day.activityScore)
  day.strength = day.strength === true
  day.statsExcluded = day.statsExcluded === true
  day.statsConfirmed = day.statsConfirmed === true

  return { day, fieldTs }
}

function mergeProfile(base, inc) {
  const r = mergeScalar(base.profile, base.meta.profileTs, inc.profile, inc.meta.profileTs)
  // Легаси без меток: непустой профиль всегда лучше пустого — иначе первый же
  // вход с чистого устройства обнулил бы анкету в облаке.
  if (r.ts === ZERO_TS) return { profile: base.profile || inc.profile || null, ts: ZERO_TS }
  return { profile: r.value ?? null, ts: r.ts }
}

function mergePrefs(base, inc) {
  const value = { ...base.prefs }
  const ts = { ...base.meta.prefsTs }
  for (const k in inc.prefs) {
    const bTs = base.meta.prefsTs[k]
    const iTs = inc.meta.prefsTs[k]
    if (!(k in value) || compareTs(iTs, bTs) > 0) {
      value[k] = inc.prefs[k]
      if (isTs(iTs)) ts[k] = iTs
    }
  }
  return { prefs: value, prefsTs: ts }
}

// Слияние недавних. Свежесть берём у более новой записи, а СЧЁТЧИК — максимум
// из двух: раньше побеждала запись целиком, и «съел 17 раз» на телефоне
// затиралось значением «съел 3 раза» с ноутбука — история частоты обнулялась
// при каждой синхронизации. Максимум, а не сумма: оба устройства ведут счёт по
// одному и тому же журналу приёмов, сложение посчитало бы одно и то же дважды.
function mergeRecents(a, b) {
  const byKey = new Map()
  for (const r of [...a, ...b]) {
    const key = recentKey(r)
    const prev = byKey.get(key)
    if (!prev) { byKey.set(key, r); continue }
    const winner = r.ts > prev.ts ? r : prev
    const count = Math.max(recentCount(r), recentCount(prev))
    byKey.set(key, count === recentCount(winner) ? winner : { ...winner, count })
  }
  return [...byKey.values()].sort((x, y) => y.ts - x.ts).slice(0, 40)
}

// Слияние двух состояний. Операция детерминирована: любые два устройства из
// одинаковой пары входов получат идентичный результат (метки HLC уникальны и
// содержат ID устройства, поэтому «ничья» означает буквально одно и то же
// значение). Порядок аргументов важен только для легаси-данных без меток, где
// приоритет отдаётся base — состоянию с сервера.
export function mergeState(baseRaw, incomingRaw) {
  const base = normalizeState(baseRaw)
  const inc = normalizeState(incomingRaw)

  const tombstones = mergeTombstones(base.meta.tombstones, inc.meta.tombstones)

  const days = {}
  const dayFieldTs = {}
  for (const date of new Set([...Object.keys(base.days), ...Object.keys(inc.days)])) {
    const { day, fieldTs } = mergeDay(
      base.days[date], inc.days[date], date,
      base.meta.dayFieldTs[date], inc.meta.dayFieldTs[date],
      tombstones,
    )
    // День, в котором ничего не осталось и ничего не заполнено, не храним —
    // иначе удаление последнего продукта оставляло бы пустые дни навсегда.
    if (isDayEmpty(day)) continue
    days[date] = day
    if (Object.keys(fieldTs).length) dayFieldTs[date] = fieldTs
  }

  const { profile, ts: profileTs } = mergeProfile(base, inc)
  const themeR = mergeScalar(base.theme, base.meta.themeTs, inc.theme, inc.meta.themeTs)
  const { prefs, prefsTs } = mergePrefs(base, inc)

  return {
    profile,
    theme: themeR.value ?? null,
    days,
    customFoods: mergeEntities(base.customFoods, inc.customFoods, tombstones, tombCustomFood),
    customIngredients: mergeEntities(base.customIngredients, inc.customIngredients, tombstones, tombCustomIngredient),
    favorites: mergeEntities(base.favorites, inc.favorites, tombstones, tombFavorite),
    templates: mergeEntities(base.templates, inc.templates, tombstones, tombTemplate),
    recipes: mergeEntities(base.recipes, inc.recipes, tombstones, tombRecipe),
    supplements: mergeEntities(base.supplements, inc.supplements, tombstones, tombSupplement),
    recents: mergeRecents(base.recents, inc.recents),
    prefs,
    meta: { v: STATE_VERSION, profileTs, themeTs: themeR.ts, prefsTs, dayFieldTs, tombstones },
  }
}

// День считается пустым, только если в нём нет НИЧЕГО из того, что человек мог
// внести. Вес и активность здесь обязательны: взвесился, но не поел — это
// заполненный день, и выбросить его значило бы потерять точку графика веса.
// Пометка «не учитывать в статистике» тоже удерживает день: она осмысленна
// ровно для дня, где еда есть, но само решение стирать нельзя.
export function isDayEmpty(day) {
  const d = day || {}
  return (
    !(d.meals || []).length &&
    !(d.mealSections || []).length &&
    // Добавки удерживают день так же, как еда: «сегодня ничего не ел, но выпил
    // витамины» — это заполненный день, и стирать его при слиянии нельзя.
    !(d.supps || []).length &&
    d.mood == null &&
    !(d.wellbeing || []).length &&
    !str(d.note).trim() &&
    d.weight == null &&
    d.activity == null &&
    d.activityScore == null &&
    d.strength !== true &&
    d.statsExcluded !== true
  )
}

// Сравнение синхронизируемой части — чтобы не гнать в сеть пустые сохранения.
export function sameSyncable(a, b) {
  return JSON.stringify(pickSyncable(a)) === JSON.stringify(pickSyncable(b))
}

// ── Помощники записи (используются стором при мутациях) ──────────────────────

export function withMeta(state) {
  return state.meta ? state : { ...state, meta: emptyMeta() }
}

// Пометить сущность как изменённую.
export function stamp(clock, entity) {
  return { ...entity, updatedAt: clock.tick() }
}

// Записать тумбстоун удаления.
export function addTombstone(meta, key, ts) {
  return { ...meta, tombstones: { ...meta.tombstones, [key]: ts } }
}

export function setDayFieldTs(meta, date, field, ts) {
  const forDate = { ...(meta.dayFieldTs[date] || {}), [field]: ts }
  return { ...meta, dayFieldTs: { ...meta.dayFieldTs, [date]: forDate } }
}

export function setPrefTs(meta, key, ts) {
  return { ...meta, prefsTs: { ...meta.prefsTs, [key]: ts } }
}

// «Сбросить профиль и данные» для аккаунта. Просто обнулить состояние нельзя:
// при следующем слиянии всё вернулось бы с сервера. Поэтому каждая запись
// получает тумбстоун с новой меткой — удаление становится фактом, который
// доедет до остальных устройств и переживёт их старые копии.
export function clearedState(state, ts) {
  const s = normalizeState(state)
  const tombstones = { ...s.meta.tombstones }

  for (const date in s.days) {
    for (const m of s.days[date].meals) tombstones[tombMeal(date, m.id)] = ts
    for (const sec of s.days[date].mealSections) tombstones[tombSection(date, sec.id)] = ts
    for (const su of s.days[date].supps) tombstones[tombSupp(date, su.id)] = ts
  }
  for (const f of s.customFoods) tombstones[tombCustomFood(f.id)] = ts
  for (const i of s.customIngredients) tombstones[tombCustomIngredient(i.id)] = ts
  for (const f of s.favorites) tombstones[tombFavorite(f.id)] = ts
  for (const t of s.templates) tombstones[tombTemplate(t.id)] = ts
  for (const r of s.recipes) tombstones[tombRecipe(r.id)] = ts
  for (const su of s.supplements) tombstones[tombSupplement(su.id)] = ts

  // Настройки не удаляются, а обнуляются с новой меткой: удаление ключа merge
  // бы не заметил (он объединяет ключи), а null перебьёт старое значение.
  const prefs = {}
  const prefsTs = {}
  for (const k in s.prefs) { prefs[k] = null; prefsTs[k] = ts }

  return {
    profile: null,
    theme: s.theme,
    days: {},
    customFoods: [],
    customIngredients: [],
    favorites: [],
    templates: [],
    recipes: [],
    supplements: [],
    recents: [],
    prefs,
    meta: { v: STATE_VERSION, profileTs: ts, themeTs: s.meta.themeTs, prefsTs, dayFieldTs: {}, tombstones },
  }
}
