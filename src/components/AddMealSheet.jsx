import { useState, useEffect, useRef } from 'react'
import { MEAL_TYPES, MILKS, BASE_GROUPS, FOODS, scale, searchLocal, searchIngredients, searchOpenFoodFacts, getPortions } from '../lib/foods.js'
import { BEER_BRANDS, SPIRIT_TYPES, COCKTAILS, alcKcal } from '../lib/alcohol.js'
import { useStore } from '../store.jsx'

const round1 = (n) => +n.toFixed(1)
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
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
  { key: 'sweet', label: 'Сладкое' },
  { key: 'dish', label: 'Блюда' },
  { key: 'dessert', label: 'Десерты' },
  { key: 'fastfood', label: 'Фастфуд' },
]

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim()

// Auto meal type: count non-snack meals already added today
function autoMealType(dayMeals) {
  const nonSnack = (dayMeals || []).filter((m) => m.type !== 'snack')
  if (nonSnack.length === 0) return 'breakfast'
  if (nonSnack.length === 1) return 'lunch'
  return 'dinner'
}

export default function AddMealSheet({ date, onClose, onAdd }) {
  const { customFoods, customIngredients, recents, prefs, addCustomFood, removeCustomFood, addCustomIngredient, setPref, dayOf } = useStore()

  const [type, setType] = useState(() => autoMealType(date ? dayOf(date).meals : []))
  const [selected, setSelected] = useState(null)
  const [method, setMethod] = useState(null)
  const [grams, setGrams] = useState('150')
  const [sugar, setSugar] = useState(0)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', sugar: '' })
  const [manualKind, setManualKind] = useState('food')
  const [manualDrink, setManualDrink] = useState({ name: '', ml: '250', kcal100: '', sugar100: '', protein100: '' })
  const [mode, setMode] = useState('search')

  const [remote, setRemote] = useState([])
  const [remoteState, setRemoteState] = useState('idle')
  const [section, setSection] = useState(null)
  const abortRef = useRef(null)

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
  const custom = q
    ? customFoods.filter((f) => norm(f.name).includes(q))
    : section === 'mine'
    ? customFoods.filter((f) => f.source === 'custom')
    : section
    ? customFoods.filter((f) => f.cat === section)
    : customFoods

  const baseList = q
    ? searchLocal(query)
    : section === 'mine' || section === 'alcohol'
    ? []
    : section
    ? FOODS.filter((f) => f.cat === section && !f.builder)
    : FOODS
  const local = [...custom, ...baseList]

  useEffect(() => {
    const s = query.trim()
    if (mode !== 'search' || selected || s.length < 2) {
      setRemote([])
      setRemoteState('idle')
      return
    }
    setRemoteState('loading')
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 8000)
    const t = setTimeout(async () => {
      try {
        const results = await searchOpenFoodFacts(s, controller.signal)
        setRemote(results)
        setRemoteState(results.length ? 'done' : 'empty')
      } catch (e) {
        if (e.name !== 'AbortError') setRemoteState('error')
      } finally {
        clearTimeout(timeout)
      }
    }, 450)
    return () => {
      clearTimeout(t)
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query, mode, selected])

  const unit = selected?.unit || (selected?.cat === 'drink' ? 'мл' : 'г')
  const g = Math.max(0, num(grams))
  const effective = selected && selected.hasVariants && method ? method : selected
  const preview = effective && !selected?.builder ? scale(effective, g) : null

  const pickFood = (food) => {
    setSelected(food)
    setMethod(food.hasVariants ? food.methods[0] : null)
    setSugar(0)
    const u = food.unit || (food.cat === 'drink' ? 'мл' : 'г')
    const last = recents.find((r) => r.name === food.name && r.unit === u && r.grams)
    setGrams(last ? String(last.grams) : u === 'мл' ? '250' : '150')
  }

  // Tap on recent → open detail screen (find in DB first, else reconstruct from per-100g)
  const pickRecent = (r) => {
    const allFoods = [...customFoods, ...FOODS]
    const found = allFoods.find((f) => f.name === r.name)
    if (found) {
      pickFood(found)
    } else if (r.grams && r.grams > 0) {
      const f = 100 / r.grams
      pickFood({
        name: r.name,
        emoji: r.emoji,
        cat: r.unit === 'мл' ? 'drink' : 'dish',
        unit: r.unit || 'г',
        kcal: Math.round(r.kcal * f),
        protein: round1(r.protein * f),
        carbs: round1(r.carbs * f),
        fat: round1(r.fat * f),
      })
    } else {
      // No gram info — add directly
      onAdd({ type, name: r.name, emoji: r.emoji, grams: r.grams, unit: r.unit, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat })
      onClose()
    }
  }

  const startManual = () => {
    setManual((m) => ({ ...m, name: m.name || query.trim() }))
    setMode('manual')
  }

  const clearFood = () => {
    setSelected(null)
    setMethod(null)
    setSugar(0)
  }

  const addPreset = () => {
    if (!effective || g <= 0) return
    const s = scale(effective, g)
    const name = selected.hasVariants && method ? `${selected.name}, ${method.label.toLowerCase()}` : selected.name
    onAdd({ type, name, emoji: selected.emoji, grams: g, unit, ...s })
    if (selected.name === 'Яйцо' && method?.label === 'Глазунья на сл. масле') {
      const bg = g <= 55 ? 5 : 7.5
      onAdd({
        type,
        name: `Сливочное масло (жарка)`,
        emoji: '🧈',
        grams: bg,
        unit: 'г',
        kcal: Math.round(bg * 7.17),
        protein: +(bg * 0.009).toFixed(1),
        carbs: +(bg * 0.001).toFixed(1),
        fat: +(bg * 0.81).toFixed(1),
      })
    }
    if (isHotDrink(selected) && sugar > 0) {
      onAdd({
        type,
        name: `Сахар, ${sugar} ч.л.`,
        emoji: '🥄',
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

  const addManual = () => {
    if (manualKind === 'food') {
      if (!manual.name.trim()) return
      const entry = {
        name: manual.name.trim(),
        emoji: '🍽️',
        cat: 'dish',
        unit: 'порция',
        kind: 'composite',
        kcal: Math.round(num(manual.kcal)),
        protein: round1(num(manual.protein)),
        carbs: round1(num(manual.carbs)),
        fat: round1(num(manual.fat)),
        sugar: round1(num(manual.sugar)),
        source: 'custom',
      }
      addCustomFood(entry)
      onAdd({ type, name: entry.name, emoji: '🍽️', grams: 1, unit: 'порция', kcal: entry.kcal, protein: entry.protein, carbs: entry.carbs, fat: entry.fat })
      onClose()
    } else {
      if (!manualDrink.name.trim()) return
      const mlN = Math.max(0, num(manualDrink.ml))
      if (mlN <= 0) return
      const f = mlN / 100
      const res = {
        kcal: Math.round(num(manualDrink.kcal100) * f),
        protein: round1(num(manualDrink.protein100) * f),
        carbs: round1(num(manualDrink.sugar100) * f),
        fat: 0,
      }
      addCustomFood({
        name: manualDrink.name.trim(),
        emoji: '🥤',
        cat: 'drink',
        unit: 'мл',
        kcal: num(manualDrink.kcal100),
        protein: num(manualDrink.protein100),
        carbs: num(manualDrink.sugar100),
        fat: 0,
        sugar: num(manualDrink.sugar100),
        source: 'custom',
      })
      onAdd({ type, name: manualDrink.name.trim(), emoji: '🥤', grams: mlN, unit: 'мл', ...res })
      onClose()
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 18 }}>
          <h2 className="h2">Добавить приём пищи</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="row wrap gap8" style={{ marginBottom: 18 }}>
          {MEAL_TYPES.map((m) => (
            <button key={m.key} className={`pill ${type === m.key ? 'on' : ''}`} onClick={() => setType(m.key)}>
              <span>{m.emoji}</span> {m.label}
            </button>
          ))}
        </div>

        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>Поиск</button>
          <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Вручную</button>
        </div>

        {mode === 'search' && !selected && !alcItem && (
          <>
            <input className="input" placeholder="Найдите продукт, напр. чечевица" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12 }} />

            {!query.trim() && (
              /* 2-row horizontal grid for categories */
              <div style={{ display: 'grid', gridTemplateRows: 'repeat(2, auto)', gridAutoFlow: 'column', gridAutoColumns: 'max-content', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
                <button
                  className={`chip ${!section ? 'on' : ''}`}
                  style={!section ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}
                  onClick={() => setSection(null)}
                >Всё</button>
                {SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    className="chip"
                    style={section === s.key ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}
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

            {/* "Моё" empty state */}
            {!query.trim() && section === 'mine' && customFoods.filter((f) => f.source === 'custom').length === 0 && (
              <p className="muted" style={{ padding: '10px 0', fontSize: 14 }}>
                Пока ничего. Добавьте еду вручную — она сохранится здесь.
              </p>
            )}

            {!query.trim() && !section && recents.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <SectionLabel text="Недавнее · тап = открыть" count={null} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {recents.slice(0, 8).map((r) => (
                    <button key={'rec-' + r.name} className="meal-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => pickRecent(r)}>
                      <span className="meal-emoji">{r.emoji}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        <span className="meal-meta">{r.grams ? `${r.grams} ${r.unit} · ` : ''}{r.kcal} ккал</span>
                      </span>
                      <span style={{ color: 'var(--primary)', fontSize: 20, flex: '0 0 auto' }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {section !== 'alcohol' && local.length > 0 && (
              <>
                <SectionLabel text={query.trim() ? 'Быстрая база' : section ? SECTIONS.find((s) => s.key === section)?.label : 'Популярное'} count={local.length} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {local.slice(0, 40).map((f) => (
                    <FoodRow key={'l-' + (f.id || f.name)} f={f} onClick={() => pickFood(f)} onDelete={f.source === 'custom' ? () => removeCustomFood(f.id) : null} />
                  ))}
                </div>
              </>
            )}

            {query.trim().length >= 2 && (
              <div style={{ marginTop: 18 }}>
                <SectionLabel text="Глобальная база" count={remote.length || null} />
                {remoteState === 'loading' && <p className="muted" style={{ padding: '8px 0', fontSize: 14 }}>Ищем в базе Open Food Facts…</p>}
                {remoteState === 'error' && <p className="muted" style={{ padding: '8px 0', fontSize: 14 }}>Нет связи с глобальной базой. Локальные результаты выше или добавьте вручную.</p>}
                {remoteState === 'empty' && <p className="muted" style={{ padding: '8px 0', fontSize: 14 }}>В глобальной базе ничего не нашлось.</p>}
                {remote.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {remote.map((f, i) => (
                      <FoodRow key={'r-' + i} f={f} onClick={() => pickFood(f)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {local.length === 0 && !query.trim() && recents.length === 0 && section !== 'alcohol' && section !== 'mine' && (
              <p className="muted" style={{ padding: '10px 0' }}>Начните вводить название продукта.</p>
            )}

            {query.trim() && (
              <button className="btn soft" style={{ marginTop: 14 }} onClick={startManual}>
                Нет в списке? Добавить «{query.trim().length > 22 ? query.trim().slice(0, 22) + '…' : query.trim()}» вручную
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
          <AlcoholBuilder item={alcItem} onBack={() => setAlcItem(null)} onAdd={onAdd} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.builder === 'protein' && (
          <ProteinShakeBuilder selected={selected} prefs={prefs} setPref={setPref} onBack={clearFood} onAdd={onAdd} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.builder === 'custom' && (
          <CustomDrinkBuilder selected={selected} onBack={clearFood} onAdd={onAdd} onClose={onClose} addCustomFood={addCustomFood} type={type} />
        )}

        {mode === 'search' && selected?.builder === 'constructor' && (
          <ConstructorBuilder selected={selected} onBack={clearFood} onAdd={onAdd} onClose={onClose} addCustomFood={addCustomFood} customIngredients={customIngredients} addCustomIngredient={addCustomIngredient} type={type} />
        )}

        {mode === 'search' && selected?.kind === 'composite' && !selected.builder && (
          <CompositePortion selected={selected} onBack={clearFood} onAdd={onAdd} onClose={onClose} type={type} />
        )}

        {mode === 'search' && selected?.dairy && !selected.builder && (
          <DairyPortion selected={selected} onBack={clearFood} onAdd={onAdd} onClose={onClose} type={type} recents={recents} />
        )}

        {mode === 'search' && selected && !selected.builder && selected.kind !== 'composite' && !selected.dairy && (
          <div>
            <div className="row gap12" style={{ marginBottom: 18 }}>
              <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
              <div style={{ flex: 1 }}>
                <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
                <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={clearFood}>← выбрать другой</button>
              </div>
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
                const ps = getPortions(selected)
                return (
                  <>
                    {ps[0] && (
                      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 8px' }}>
                        Не взвешивая: {ps[0].label} ≈ {ps[0].grams} {unit}
                      </p>
                    )}
                    <input className="input" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} style={{ marginBottom: 10 }} />
                    <div className="row wrap gap8">
                      {ps.map((p) => (
                        <button key={p.label} className={`chip ${g === p.grams ? 'on' : ''}`} onClick={() => setGrams(String(p.grams))} style={g === p.grams ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>
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

            <div className="row gap8" style={{ marginBottom: 22 }}>
              <PreviewStat label="ккал" v={preview.kcal + sugar * SUGAR_TSP.kcal} />
              <PreviewStat label="белки" v={preview.protein} />
              <PreviewStat label="угл." v={round1(preview.carbs + sugar * SUGAR_TSP.carbs)} />
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
                  <label>Калории, ккал</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="350" value={manual.kcal} onChange={(e) => setManual({ ...manual, kcal: e.target.value })} />
                </div>
                <div className="row gap8">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Белки, г</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.protein} onChange={(e) => setManual({ ...manual, protein: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Углеводы, г</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.carbs} onChange={(e) => setManual({ ...manual, carbs: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Жиры, г</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.fat} onChange={(e) => setManual({ ...manual, fat: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>Сахар, г <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(необязательно)</span></label>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={manual.sugar} onChange={(e) => setManual({ ...manual, sugar: e.target.value })} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px' }}>Сохранится в разделе «Моё» для повторного использования.</p>
                <button className="btn" style={{ marginTop: 0 }} onClick={addManual} disabled={!manual.name.trim()}>Добавить</button>
              </>
            )}

            {manualKind === 'drink' && (
              <>
                <div className="field">
                  <label>Название</label>
                  <input className="input" placeholder="Напр. Домашний лимонад" value={manualDrink.name} onChange={(e) => setManualDrink({ ...manualDrink, name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Сколько выпили, мл</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="250" value={manualDrink.ml} onChange={(e) => setManualDrink({ ...manualDrink, ml: e.target.value })} />
                </div>
                <div className="row gap8">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Ккал / 100 мл</label>
                    <input className="input" type="number" inputMode="numeric" placeholder="42" value={manualDrink.kcal100} onChange={(e) => setManualDrink({ ...manualDrink, kcal100: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Сахар / 100 мл</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.sugar100} onChange={(e) => setManualDrink({ ...manualDrink, sugar100: e.target.value })} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Белки / 100 мл</label>
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={manualDrink.protein100} onChange={(e) => setManualDrink({ ...manualDrink, protein100: e.target.value })} />
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px' }}>Сохранится в разделе «Моё» — в следующий раз достаточно указать только объём.</p>
                <button className="btn" style={{ marginTop: 0 }} onClick={addManual} disabled={!manualDrink.name.trim() || !num(manualDrink.ml)}>Добавить</button>
              </>
            )}
          </div>
        )}
      </div>
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
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← назад</button>
        </div>
      </div>

      <div className="field">
        <label>Объём, мл</label>
        <input className="input" type="text" inputMode="decimal" value={ml} onChange={(e) => setMl(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="row wrap gap8">
          {quickMls.map((v) => (
            <button key={v} className={`chip ${mlN === v ? 'on' : ''}`} onClick={() => setMl(String(v))} style={mlN === v ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>
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
    onAdd({ type, name, emoji: selected.emoji, grams: base === 'milk' ? mMl : null, unit: 'мл', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Протеиновый шейк</div>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
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
    onAdd({ type, name: name.trim(), emoji: '🥤', grams: v, unit: 'мл', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Свой напиток</div>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
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
    onAdd({ type, name: finalName, emoji: selected.emoji, grams: servings, unit, ...total })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>Собери {selected.name.toLowerCase()}</div>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другое</button>
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
    onAdd({ type, name: selected.name, emoji: selected.emoji, grams: servings, unit, ...total })
    onClose()
  }
  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
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

function DairyPortion({ selected, onBack, onAdd, onClose, type, recents = [] }) {
  const [fat, setFat] = useState(String(selected.defFat))
  const last = recents.find((r) => r.name.startsWith(selected.name) && r.unit === 'г' && r.grams)
  const [grams, setGrams] = useState(last ? String(last.grams) : '200')

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
    onAdd({ type, name: `${selected.name} ${fatN}%`, emoji: selected.emoji, grams: g, unit: 'г', ...res })
    onClose()
  }

  return (
    <div>
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <span className="meal-emoji" style={{ width: 52, height: 52, fontSize: 24 }}>{selected.emoji}</span>
        <div style={{ flex: 1 }}>
          <div className="meal-name" style={{ fontSize: 18 }}>{selected.name}</div>
          <button style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550 }} onClick={onBack}>← выбрать другой</button>
        </div>
      </div>

      <div className="field">
        <label>Жирность, %</label>
        <input className="input" type="text" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="row wrap gap8">
          {selected.fats.map((v) => (
            <button key={v} className={`chip ${fatN === v ? 'on' : ''}`} onClick={() => setFat(String(v))} style={fatN === v ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>{v}%</button>
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
            <button key={p.label} className={`chip ${g === p.grams ? 'on' : ''}`} onClick={() => setGrams(String(p.grams))} style={g === p.grams ? { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' } : undefined}>
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

function SectionLabel({ text, count }) {
  return (
    <div className="row between" style={{ margin: '2px 0 8px' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{text}</span>
      {count != null && <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{count}</span>}
    </div>
  )
}

function FoodRow({ f, onClick, onDelete }) {
  let subtitle
  if (f.builder === 'constructor') subtitle = 'собрать из ингредиентов'
  else if (f.builder === 'protein') subtitle = 'рассчитать по ингредиентам'
  else if (f.builder === 'custom') subtitle = 'добавить и запомнить свой'
  else if (f.kind === 'composite') subtitle = `${f.kcal} ккал/порция · моё`
  else if (f.dairy) subtitle = 'укажите порцию и % жирности'
  else if (f.source === 'custom') subtitle = `${f.kcal} ккал · Б${f.protein} / 100 мл · мой напиток`
  else if (f.hasVariants) subtitle = `${f.methods.length} способов приготовления`
  else subtitle = `${f.kcal} ккал · Б${f.protein} У${f.carbs} Ж${f.fat} / 100 ${f.unit || 'г'}`
  const chevron = f.builder || f.hasVariants || f.kind === 'composite' || f.dairy ? '›' : '＋'
  return (
    <div className="meal-item" style={{ gap: 10 }}>
      <button style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', flex: 1, minWidth: 0 }} onClick={onClick}>
        <span className="meal-emoji">{f.emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <span className="meal-meta">{subtitle}</span>
        </span>
        <span style={{ color: 'var(--primary)', fontSize: 22, flex: '0 0 auto' }}>{chevron}</span>
      </button>
      {onDelete && (
        <button onClick={onDelete} aria-label="Удалить" style={{ color: 'var(--ink-3)', fontSize: 18, flex: '0 0 auto', padding: '0 4px' }}>✕</button>
      )}
    </div>
  )
}

function PreviewStat({ label, v }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 13, padding: '12px 6px', textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 18, fontWeight: 650 }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</div>
    </div>
  )
}
