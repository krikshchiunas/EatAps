import { useState, useMemo } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { FOODS, scale, searchLocal, sanitizeAmount, macroLabel, getPortions } from '../lib/foods.js'
import { makeRecipe, recipeTotals, recipePerServing, MAX_RECIPE_ITEMS } from '../lib/library.js'

const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const EMOJI = ['🍲', '🥘', '🍜', '🥗', '🍝', '🍛', '🥧', '🍰', '🥣', '🍚', '🫕', '🥙']

// Что можно положить в рецепт. Считается один раз: FOODS не меняется, а
// фильтровать пятьсот записей заново на каждый рендер незачем.
const INGREDIENT_POOL = FOODS.filter(
  (f) => !f.builder && f.kind !== 'composite' && f.kcal != null && Number(f.kcal) >= 0,
)

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
    })),
  )

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
    return searchLocal(q, { items: INGREDIENT_POOL }).filter((f) => !chosen.has(f.name)).slice(0, 6)
  }, [query, chosenNames])

  const addRow = (food) => {
    if (rows.length >= MAX_RECIPE_ITEMS) return
    const start = getPortions(food)?.[0]?.grams || food.defaultGrams || 100
    setRows((p) => [...p, {
      key: 'r' + Date.now() + Math.random(),
      name: food.name,
      emoji: food.emoji || '🍽️',
      unit: food.unit || 'г',
      grams: String(start),
      per100: { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat },
    }])
    setQuery('')
  }

  // Черновик рецепта из текущих полей — по нему же считается предпросмотр,
  // поэтому показанное и сохранённое не могут разойтись.
  const draft = useMemo(() => {
    const items = rows
      .filter((r) => num(r.grams) > 0)
      .map((r) => ({ name: r.name, emoji: r.emoji, unit: r.unit, grams: num(r.grams), ...scale(r.per100, num(r.grams)) }))
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
          <h2 className="h2">{editing ? 'Изменить рецепт' : 'Новый рецепт'}</h2>
          <button className="iconbtn" onClick={tryClose} aria-label="Закрыть">✕</button>
        </div>

        {confirmExit && (
          <div className="card" style={{ padding: 14, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            {/* Фраза целиком условная: «Рецепт не сохранён… потерять ИХ» —
                рассогласование, а склеивать предложение из кусков нельзя. */}
            <p style={{ fontSize: 14.5, lineHeight: 1.5, margin: '0 0 12px' }}>
              {editing
                ? 'Изменения не сохранены. Выйти и потерять их?'
                : 'Рецепт не сохранён. Выйти и потерять его?'}
            </p>
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmExit(false)}>Остаться</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={close}>Выйти</button>
            </div>
          </div>
        )}

        <div className="field">
          <label>Название</label>
          <input className="input" placeholder="Напр. Борщ" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label>Значок</label>
          {/* Одна прокручиваемая строка, а не сетка на три ряда: выбор значка —
              мелочь, и он не должен выталкивать ингредиенты за нижний край
              экрана. Тот же приём, что у чипов категорий в поиске. */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {EMOJI.map((e) => (
              <button
                key={e}
                className={`chip ${emoji === e ? 'on' : ''}`}
                style={{ fontSize: 18, flex: '0 0 auto', minWidth: 52 }}
                aria-label={`Значок ${e}`}
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
              >{e}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Ингредиенты{rows.length > 0 ? ` · ${rows.length}` : ''}</label>
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Найдите продукт, напр. свёкла"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
            disabled={rows.length >= MAX_RECIPE_ITEMS}
          />
          {rows.length >= MAX_RECIPE_ITEMS && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0 0' }}>
              Больше {MAX_RECIPE_ITEMS} ингредиентов в один рецепт не поместится.
            </p>
          )}
          {results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.map((f) => (
                <button
                  key={f.name}
                  onClick={() => addRow(f)}
                  className="row between"
                  style={{ width: '100%', minHeight: 44, padding: '8px 4px', textAlign: 'left', gap: 10 }}
                >
                  <span style={{ fontSize: 14.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.emoji} {f.name}
                  </span>
                  <span style={{ color: 'var(--primary)', fontSize: 20, flex: '0 0 auto' }}>＋</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, padding: '4px 0 18px' }}>
            Добавьте то, что кладёте в кастрюлю. Вес — как на весах, до готовки.
          </p>
        ) : (
          <div className="card" style={{ padding: 12, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            {rows.map((r, i) => {
              const g = num(r.grams)
              const m = g > 0 ? scale(r.per100, g) : null
              return (
                <div key={r.key} className="row gap8" style={{ alignItems: 'center', padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.emoji} {r.name}
                    <span className="tabular" style={{ color: 'var(--ink-3)', fontSize: 12.5, display: 'block' }}>
                      {m ? `${m.kcal} ккал` : 'укажите вес'}
                    </span>
                  </span>
                  <input
                    className="input tabular"
                    type="number"
                    inputMode="numeric"
                    aria-label={`Вес: ${r.name}`}
                    value={r.grams}
                    onChange={(e) => {
                      const v = sanitizeAmount(e.target.value)
                      setRows((p) => p.map((x) => (x.key === r.key ? { ...x, grams: v } : x)))
                    }}
                    style={{ width: 78, flex: '0 0 auto', textAlign: 'right', height: 44 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto', width: 18 }}>{r.unit}</span>
                  <button
                    onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                    aria-label={`Убрать ${r.name}`}
                    style={{ width: 34, minHeight: 44, flex: '0 0 auto', color: 'var(--ink-3)', fontSize: 17 }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        )}

        <div className="field">
          <label>Сколько порций получилось</label>
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
              <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Вся кастрюля</span>
              <span className="tabular" style={{ fontWeight: 650 }}>{total.kcal} ккал{total.grams > 0 ? ` · ${total.grams} г` : ''}</span>
            </div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Одна порция</span>
              <span className="tabular" style={{ fontWeight: 680, fontSize: 18 }}>{per.kcal} ккал</span>
            </div>
            <div className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              {macroLabel(per)}{per.grams > 0 ? ` · ≈${per.grams} г` : ''}
            </div>
          </div>
        )}

        <div className="field">
          <label>Заметки (необязательно)</label>
          <textarea
            className="input"
            rows={2}
            placeholder="Напр. варить 40 минут, солить в конце"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            style={{ resize: 'none', fontFamily: 'inherit' }}
          />
        </div>

        <button className="btn" onClick={submit} disabled={!valid}>
          {editing ? 'Сохранить изменения' : 'Сохранить рецепт'}
        </button>
      </div>
    </div>
  )
}
