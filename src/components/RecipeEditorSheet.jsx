import { useState, useMemo } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { FOODS, scale, searchLocal, sanitizeAmount, macroLabel, getPortions, unitLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { catalogId } from '../lib/catalog.js'
import { t } from '../lib/i18n.js'
import { makeRecipe, recipeTotals, recipePerServing, MAX_RECIPE_ITEMS } from '../lib/library.js'
import { productsAsFoods, productAsFood, productById, productsForBase, ownProductsFirst } from '../lib/myProducts.js'
import { useStore } from '../store.jsx'

const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const EMOJI = ['🍲', '🥘', '🍜', '🥗', '🍝', '🍛', '🥧', '🍰', '🥣', '🍚', '🫕', '🥙']

// Что можно положить в рецепт. Считается один раз: FOODS не меняется, а
// фильтровать пятьсот записей заново на каждый рендер незачем.
const INGREDIENT_POOL = FOODS.filter(
  (f) => !f.builder && f.kind !== 'composite' && f.kcal != null && Number(f.kcal) >= 0,
)
const POOL_BY_ID = new Map(INGREDIENT_POOL.filter((f) => f.foodId).map((f) => [f.foodId, f]))

// Значения продукта на 100 г, которые едут в строку рецепта. Сахар, насыщенные
// жиры и клетчатка — только если известны: «не знаем» не должно стать нулём.
function per100Of(food) {
  const out = { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat }
  for (const k of ['sugar', 'satFat', 'fiber']) if (food[k] != null) out[k] = food[k]
  return out
}

// Строка рецепта из продукта: базы или своего. productId — чей это продукт,
// baseId — вариантом какого продукта базы он является (у продукта базы это
// он сам). По этим двум ссылкам строка и переключается «мой ↔ обычный».
function rowFrom(food, grams, key) {
  return {
    key,
    name: food.name,
    emoji: food.emoji || '🍽️',
    unit: food.unit || 'г',
    grams: String(grams),
    per100: per100Of(food),
    productId: food.source === 'product' ? food.productId : null,
    baseId: food.source === 'product' ? food.baseId || null : food.foodId || catalogId('foods', food.name),
  }
}

// Абсолютные значения ингредиента → значения на 100 г. Неизвестное (null)
// таковым и остаётся: делить «мы не знаем» бессмысленно, а `null * 100 / g`
// молча даёт ноль.
function back100(it) {
  const g = Number(it.grams)
  const per = (v) => (v == null || !Number.isFinite(Number(v)) ? null : g > 0 ? (Number(v) * 100) / g : Number(v))
  return { kcal: per(it.kcal), protein: per(it.protein), carbs: per(it.carbs), fat: per(it.fat) }
}

// Редактор рецепта: кастрюля из ингредиентов, поделённая на порции.
//
// Ключевое отличие от «своего блюда»: блюдо — это НАБОР записей, который
// попадает в дневник как есть. Рецепт варится один раз на несколько порций, и
// в дневник идёт ОДНА строка — столько, сколько человек съел. Поэтому здесь
// есть число порций, а у блюда его нет.
//
// Ингредиенты хранятся в АБСОЛЮТНЫХ значениях на положенное количество, а не
// на 100 г: пересчёт делается один раз здесь, дальше рецепт просто суммируется
// и не копит ошибку округления (см. lib/library.js).
export default function RecipeEditorSheet({ recipe, onSave, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const editing = recipe && recipe !== 'new' ? recipe : null

  const [name, setName] = useState(editing?.name || '')
  const [emoji, setEmoji] = useState(editing?.emoji || '🍲')
  const [servings, setServings] = useState(String(editing?.servings || 4))
  const [notes, setNotes] = useState(editing?.notes || '')
  const [query, setQuery] = useState('')
  // Строки редактора держат исходный продукт (на 100 г) и положенный вес —
  // так вес можно менять сколько угодно раз без потери точности.
  const [rows, setRows] = useState(() =>
    (editing?.items || []).map((it, i) => ({
      key: 'r' + i,
      name: it.name,
      emoji: it.emoji,
      unit: it.unit || 'г',
      grams: String(it.grams || 100),
      // У сохранённого рецепта абсолютные значения — возвращаем их к 100 г.
      // Неизвестное (null) обратный пересчёт тоже обязан сохранить: без этой
      // проверки `null * 100 / grams` давало 0, и открытие рецепта на правку
      // молча превращало «БЖУ неизвестны» в «БЖУ нулевые».
      per100: back100(it),
      productId: it.productId || null,
      // У рецептов, сохранённых до «Моих продуктов», ссылки нет — продукт
      // базы узнаём по названию.
      baseId: it.baseId || (it.productId ? null : catalogId('foods', it.name)),
    })),
  )
  const { products } = useStore()
  // Свои продукты идут в поиск вместе с базой. Пул пересобирается только при
  // смене списка продуктов: индекс поиска кэшируется по массиву.
  const productFoods = useMemo(() => productsAsFoods(products), [products])
  const pool = useMemo(() => [...productFoods, ...INGREDIENT_POOL], [productFoods])

  // В рецепт кладут СЫРЫЕ продукты, поэтому берём базовые значения продукта, а
  // не способ приготовления. Исключаем только конструкторы («Бутерброд»,
  // «Салат») — у них нет собственных КБЖУ, они сами собираются из частей.
  //
  // Раньше здесь отсеивались ещё hasVariants и dairy — и это выкидывало из
  // рецептов ровно самое нужное: картофель, яйцо, курицу, молоко, творог. На
  // запрос «картофель» первым оставался «Картофель фри», 312 ккал вместо 82.
  //
  // Зависимость — имена уже положенных ингредиентов, а НЕ весь массив строк.
  // Веса на выдачу не влияют, но `rows` меняется от каждого нажатия в поле
  // веса, и поиск (7 мс по базе) перезапускался на каждый набранный символ.
  // Склеиваем имена через разделитель, невозможный в названии продукта: через
  // пробел «Лук репчатый» распался бы на два имени и перестал бы отсеиваться.
  const chosenNames = rows.map((r) => r.name).join('\u0000')
  const results = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    const chosen = new Set(chosenNames ? chosenNames.split('\u0000') : [])
    return ownProductsFirst(searchLocal(q, { items: pool })).filter((f) => !chosen.has(f.name)).slice(0, 6)
  }, [query, chosenNames, pool])

  const addRow = (food) => {
    if (rows.length >= MAX_RECIPE_ITEMS) return
    const start = getPortions(food)?.[0]?.grams || food.defaultGrams || 100
    setRows((p) => [...p, rowFrom(food, start, 'r' + Date.now() + Math.random())])
    setQuery('')
  }

  // «Мой ↔ обычный»: тот же ингредиент другим продуктом, вес остаётся.
  // У своего продукта — его продукт базы; у продукта базы — свои продукты,
  // которые на него ссылаются (сыр Гауда → «Гауда 45% · Ламбер»).
  const swapsFor = (r) => {
    if (r.productId) {
      const own = productById(products, r.productId)
      const base = POOL_BY_ID.get(own?.baseId || r.baseId)
      return base ? [{ food: base, mine: false }] : []
    }
    return productsForBase(products, r.baseId).slice(0, 3)
      .map((p) => ({ food: productAsFood(p), mine: true }))
      .filter((x) => x.food)
  }
  const swapRow = (r, food) => {
    setRows((p) => p.map((x) => (x.key === r.key ? rowFrom(food, x.grams, x.key) : x)))
  }

  // Черновик рецепта из текущих полей — по нему же считается предпросмотр,
  // поэтому показанное и сохранённое не могут разойтись.
  const draft = useMemo(() => {
    const items = rows
      .filter((r) => num(r.grams) > 0)
      .map((r) => {
        const item = { name: r.name, emoji: r.emoji, unit: r.unit, grams: num(r.grams), ...scale(r.per100, num(r.grams)) }
        if (r.productId) item.productId = r.productId
        if (r.baseId) item.baseId = r.baseId
        return item
      })
    return makeRecipe({ name: name.trim() || '—', emoji, servings: num(servings) || 1, items, notes })
  }, [rows, name, emoji, servings, notes])

  const total = draft ? recipeTotals(draft) : null
  const per = draft ? recipePerServing(draft) : null
  const valid = name.trim().length > 0 && draft?.items.length > 0 && num(servings) >= 1

  const submit = () => {
    if (!valid) return
    const built = makeRecipe({ name: name.trim(), emoji, servings: num(servings), items: draft.items, notes })
    if (!built) return
    onSave(editing ? { ...built, id: editing.id } : built, Boolean(editing))
    close()
  }

  // Собранный, но не сохранённый рецепт нельзя терять по случайному касанию.
  //
  // Экран длинный: название, значок, шесть ингредиентов с весами, порции,
  // заметки. Тап мимо листа закрывал его молча и стирал всё разом — а промах
  // мимо шторки на телефоне дело обычное. Спрашиваем, и только если человек
  // подтвердил, выходим.
  const dirty = editing
    ? name.trim() !== editing.name || notes !== (editing.notes || '') || num(servings) !== editing.servings ||
      rows.length !== (editing.items || []).length ||
      rows.some((r, i) => r.name !== editing.items[i]?.name || num(r.grams) !== editing.items[i]?.grams)
    : Boolean(name.trim() || rows.length || notes.trim())
  const [confirmExit, setConfirmExit] = useState(false)
  const tryClose = () => { if (dirty) setConfirmExit(true); else close() }

  // stopPropagation обязателен: редактор открывается ПОВЕРХ листа добавления и
  // его шторка вложена в шторку листа. Без остановки всплытия тап мимо
  // редактора доходил до родителя, тот закрывался и уносил редактор вместе с
  // несохранённым рецептом — мимо всякого подтверждения.
  const onBackdrop = (e) => { e.stopPropagation(); tryClose() }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={onBackdrop}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{editing ? t('add.editRecipe') : t('add.newRecipe')}</h2>
          <button className="iconbtn" onClick={tryClose} aria-label={t('common.close')}>✕</button>
        </div>

        {confirmExit && (
          <div className="card" style={{ padding: 14, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            {/* Фраза целиком условная: «Рецепт не сохранён… потерять ИХ» —
                рассогласование, а склеивать предложение из кусков нельзя. */}
            <p style={{ fontSize: 14.5, lineHeight: 1.5, margin: '0 0 12px' }}>
              {editing ? t('recipe.unsavedChanges') : t('recipe.unsaved')}
            </p>
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmExit(false)}>{t('recipe.stay')}</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={close}>{t('recipe.leave')}</button>
            </div>
          </div>
        )}

        <div className="field">
          <label>{t('template.name')}</label>
          <input className="input" placeholder={t('recipe.namePh')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('recipe.icon')}</label>
          {/* Одна прокручиваемая строка, а не сетка на три ряда: выбор значка —
              мелочь, и он не должен выталкивать ингредиенты за нижний край
              экрана. Тот же приём, что у чипов категорий в поиске. */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {EMOJI.map((e) => (
              <button
                key={e}
                className={`chip ${emoji === e ? 'on' : ''}`}
                style={{ fontSize: 18, flex: '0 0 auto', minWidth: 52 }}
                aria-label={t('recipe.iconAria', { e })}
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
              >{e}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('recipe.ingredients')}{rows.length > 0 ? ` · ${rows.length}` : ''}</label>
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t('recipe.searchPh')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
            disabled={rows.length >= MAX_RECIPE_ITEMS}
          />
          {rows.length >= MAX_RECIPE_ITEMS && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0 0' }}>
              {t('recipe.tooMany', { max: MAX_RECIPE_ITEMS })}
            </p>
          )}
          {results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.map((f) => (
                <button
                  key={(f.productId ? 'p:' : '') + f.name}
                  onClick={() => addRow(f)}
                  className="row between"
                  style={{ width: '100%', minHeight: 44, padding: '8px 4px', textAlign: 'start', gap: 10 }}
                >
                  <span style={{ fontSize: 14.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.emoji} {foodName(f.name)}
                    {f.source === 'product' && <span style={{ color: 'var(--primary)', fontSize: 12.5, fontWeight: 600 }}> · {t('products.tag')}</span>}
                  </span>
                  <span style={{ color: 'var(--primary)', fontSize: 20, flex: '0 0 auto' }}>＋</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, padding: '4px 0 18px' }}>
            {t('recipe.empty')}
          </p>
        ) : (
          <div className="card" style={{ padding: 12, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            {rows.map((r, i) => {
              const g = num(r.grams)
              const m = g > 0 ? scale(r.per100, g) : null
              const swaps = swapsFor(r)
              return (
                <div key={r.key} style={{ padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div className="row gap8" style={{ alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.emoji} {foodName(r.name)}
                    <span className="tabular" style={{ color: 'var(--ink-3)', fontSize: 12.5, display: 'block' }}>
                      {m ? t('units.kcalN', { n: m.kcal }) : t('recipe.enterWeight')}
                      {r.productId ? ` · ${t('products.tag')}` : ''}
                    </span>
                  </span>
                  <input
                    className="input tabular"
                    type="number"
                    inputMode="numeric"
                    aria-label={t('recipe.weightAria', { name: foodName(r.name) })}
                    value={r.grams}
                    onChange={(e) => {
                      const v = sanitizeAmount(e.target.value)
                      setRows((p) => p.map((x) => (x.key === r.key ? { ...x, grams: v } : x)))
                    }}
                    style={{ width: 78, flex: '0 0 auto', textAlign: 'end', height: 44 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto', width: 18 }}>{unitLabel(r.unit)}</span>
                  <button
                    onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                    aria-label={t('recipe.removeAria', { name: foodName(r.name) })}
                    style={{ width: 34, minHeight: 44, flex: '0 0 auto', color: 'var(--ink-3)', fontSize: 17 }}
                  >✕</button>
                </div>
                {/* Свой продукт вместо обычного — и обратно. Вес тот же: это
                    тот же ингредиент, просто с цифрами с другой этикетки. */}
                {swaps.length > 0 && (
                  <div className="row wrap gap8" style={{ marginTop: 4 }}>
                    {swaps.map(({ food, mine }) => {
                      const label = mine ? food.name : foodName(food.name)
                      return (
                        <button
                          key={(mine ? 'p:' : 'b:') + (food.productId || food.foodId || food.name)}
                          className="chip"
                          onClick={() => swapRow(r, food)}
                          aria-label={t('recipe.swapAria', { from: foodName(r.name), to: label })}
                          style={{ fontSize: 13, maxWidth: '100%', minWidth: 0 }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            ⇄ {mine ? t('recipe.swapMine', { name: label }) : t('recipe.swapBase', { name: label })}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}

        <div className="field">
          <label>{t('recipe.servings')}</label>
          <input
            className="input tabular"
            type="number"
            inputMode="numeric"
            value={servings}
            onChange={(e) => setServings(sanitizeAmount(e.target.value))}
          />
          <div className="row wrap gap8" style={{ marginTop: 10 }}>
            {['2', '4', '6', '8'].map((v) => (
              <button key={v} className={`chip ${servings === v ? 'on' : ''}`} onClick={() => setServings(v)}>{v}</button>
            ))}
          </div>
        </div>

        {total && per && draft.items.length > 0 && (
          <div className="card" style={{ padding: 14, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            <div className="row between">
              <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{t('recipe.wholePot')}</span>
              <span className="tabular" style={{ fontWeight: 650 }}>{t('units.kcalN', { n: total.kcal })}{total.grams > 0 ? ` · ${t('units.gN', { n: total.grams })}` : ''}</span>
            </div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t('recipe.oneServing')}</span>
              <span className="tabular" style={{ fontWeight: 680, fontSize: 18 }}>{t('units.kcalN', { n: per.kcal })}</span>
            </div>
            <div className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              {macroLabel(per)}{per.grams > 0 ? ` · ≈${t('units.gN', { n: per.grams })}` : ''}
            </div>
          </div>
        )}

        <div className="field">
          <label>{t('recipe.notes')}</label>
          <textarea
            className="input"
            rows={2}
            placeholder={t('recipe.notesPh')}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            style={{ resize: 'none', fontFamily: 'inherit' }}
          />
        </div>

        <button className="btn" onClick={submit} disabled={!valid}>
          {editing ? t('recipe.saveChanges') : t('recipe.save')}
        </button>
      </div>
    </div>
  )
}
