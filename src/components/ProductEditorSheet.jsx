import { useState, useMemo, useEffect, useRef, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { useStore } from '../store.jsx'
import { searchLocal, sanitizeAmount, unitLabel, macroLabel } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { t } from '../lib/i18n.js'
import { checkManualFood } from '../lib/manualFood.js'
import { useSearchNames } from '../lib/useSearchNames.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import { useBarcodeAI } from '../lib/useBarcodeAI.js'
import { applyCheck, fillDraft } from '../lib/barcodeAI.js'
import {
  normalizeProduct, productDraftFrom, findProductByBarcode, productLabel, cleanBarcode, MAX_PRODUCTS,
} from '../lib/myProducts.js'

import { BASE_POOL, baseFoodOf, ProductThumb } from './ProductRow.jsx'

const BarcodeScanner = lazyWithReload(() => import('./BarcodeScanner.jsx'))

// ─────────────────────────────────────────────────────────────────────────────
// Свой продукт: товар с полки — название, бренд, цифры с этикетки, штрихкод,
// вес пачки и, главное, «разновидностью чего» он является.
//
// Эта ссылка на продукт базы — то, ради чего раздел существует: в рецепте
// можно положить и «просто Гауду», и именно свою, и переключаться между ними,
// не теряя вес. Поэтому редактор сам предлагает подходящий продукт базы по
// названию — выбрать его можно одним касанием, а можно и не выбирать.
//
// Лист открывается поверх других листов и push-панелей, поэтому живёт в
// портале со своим слоем (как LegalSheet): у .push-screen есть transform, и
// position:fixed внутри считался бы от панели, а не от экрана.
// ─────────────────────────────────────────────────────────────────────────────

const LAYER = 70
const SCANNER_LAYER = 90


const EMOJI = ['🛒', '🧀', '🥛', '🧈', '🥚', '🍞', '🥩', '🍗', '🐟', '🌾', '🍝', '🥫', '🥦', '🍎', '🫐', '🥜', '🍫', '🍪', '🍦', '🍯', '🥤', '🧃', '☕', '🍵']

const FIELDS = ['kcal', 'protein', 'carbs', 'sugar', 'fiber', 'fat', 'satFat', 'packGrams', 'portionGrams']
const str = (v) => (v == null || v === '' ? '' : String(v))

function toForm(src) {
  const d = src || {}
  const form = {
    name: d.name || '',
    brand: d.brand || '',
    emoji: d.emoji || '',
    unit: d.unit === 'мл' ? 'мл' : 'г',
    baseId: d.baseId || null,
    cat: d.cat || null,
    barcode: d.barcode || '',
    photo: d.photo || null,
    dbName: d.dbName || '',
  }
  for (const k of FIELDS) form[k] = str(d[k])
  return form
}

// Поле ввода числа: пустое — «не знаю», а не ноль.
function NumField({ label, value, onChange, placeholder = '0', nested, optional, inputMode = 'decimal' }) {
  return (
    <div
      className="field"
      style={nested ? { marginInlineStart: 18, borderInlineStart: '2px solid var(--border)', paddingInlineStart: 12 } : undefined}
    >
      <label>
        {label}
        {optional && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> {t('common.optional')}</span>}
      </label>
      <input
        className="input tabular"
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(sanitizeAmount(e.target.value))}
      />
    </div>
  )
}

// product — правка существующего; draft — черновик нового (со штрихкода, из
// экрана количества, пустой). onSaved(entry, { existing }) — после сохранения.
// pendingFill — обещание черновика с цифрами, которые ИИ прочитал с фото
// этикетки («Штрихкод: помощь ИИ»); они лягут только в пустые поля.
export default function ProductEditorSheet({ product, draft, note: startNote = null, pendingFill = null, onClose, onSaved, onDeleted }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const { products, saveProduct, removeProduct } = useStore()
  const editing = product?.id ? product : null

  const [initial] = useState(() => toForm(editing || productDraftFrom(draft || {}, {})))
  const [form, setForm] = useState(initial)
  const [emojiTouched, setEmojiTouched] = useState(Boolean(editing?.emoji))
  // Название и бренд, вписанные человеком, — его решение: ни повторный скан,
  // ни цифры, прочитанные ИИ, их не перетирают. Ref, а не state: заполнение
  // приходит из промиса, и state в его замыкании был бы вчерашним.
  const touched = useRef({ name: Boolean(editing), brand: Boolean(editing) })
  const [baseQuery, setBaseQuery] = useState('')
  const [baseSkip, setBaseSkip] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [note, setNote] = useState(startNote || (draft?.barcode && draft?.kcal == null ? (draft.title || draft.name ? 'noNutrition' : 'notInDb') : null))
  const [error, setError] = useState(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const namesReady = useSearchNames()
  const barcodeAI = useBarcodeAI()

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(null) }

  const base = baseFoodOf(form.baseId)

  // Похожие продукты базы — по названию, пока человек сам ничего не выбрал.
  const suggestions = useMemo(() => {
    if (form.baseId || baseSkip || baseQuery.trim()) return []
    const q = form.name.trim()
    if (q.length < 3) return []
    return searchLocal(q, { items: BASE_POOL }).slice(0, 3)
  }, [form.name, form.baseId, baseSkip, baseQuery, namesReady])

  const baseResults = useMemo(() => {
    const q = baseQuery.trim()
    if (q.length < 2) return []
    return searchLocal(q, { items: BASE_POOL }).slice(0, 6)
  }, [baseQuery, namesReady])

  const pickBase = (food) => {
    const patch = { baseId: food.foodId, cat: food.cat || form.cat }
    if (!emojiTouched && food.emoji) patch.emoji = food.emoji
    // Единица — от продукта базы, пока цифры не введены: сок — в мл.
    if (!form.kcal && food.unit) patch.unit = food.unit === 'мл' ? 'мл' : 'г'
    set(patch)
    setBaseQuery('')
  }

  // Цифры продукта базы — только в пустые поля. Своё, уже вписанное с
  // этикетки, не затираем.
  const useBaseValues = () => {
    if (!base) return
    const patch = {}
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'satFat', 'fiber']) {
      if (!form[k] && base[k] != null) patch[k] = str(base[k])
    }
    set(patch)
  }

  // Со штрихкода: найденное перекрывает пустое, а не наоборот — человек мог
  // уже вписать название по-своему. onlyEmpty — заполнить только пустые поля
  // (цифры, прочитанные ИИ, пока человек уже что-то вписывал).
  const fillFrom = (src, nextNote, { onlyEmpty = false } = {}) => {
    const scanned = toForm(productDraftFrom(src))
    setForm((f) => {
      const out = { ...f }
      for (const k of Object.keys(scanned)) {
        // Единицу берём, только если база её знает: «не найден» не должен
        // молча переключить напиток обратно на граммы.
        if (k === 'unit' && !src?.unit) continue
        if ((k === 'name' || k === 'brand') && touched.current[k] && f[k]) continue
        if (onlyEmpty && f[k] != null && f[k] !== '') continue
        const v = scanned[k]
        if (v != null && v !== '') out[k] = v
      }
      if (!emojiTouched && scanned.emoji) out.emoji = scanned.emoji
      return out
    })
    setNote(nextNote)
    setScanning(false)
  }

  // ИИ читает этикетку товара, у которого в базе нет состава (pendingFill
  // приходит из листа добавления), — форма уже открыта, цифры появятся сами.
  useEffect(() => {
    if (!pendingFill) return undefined
    let alive = true
    setNote('aiFilling')
    pendingFill.then((filled) => {
      if (!alive) return
      if (filled) fillFrom(filled, 'aiFilled', { onlyEmpty: true })
      else setNote((n) => (n === 'aiFilling' ? 'noNutrition' : n))
    })
    return () => { alive = false }
    // fillFrom — функция этого же рендера; повторять заполнение при её смене незачем.
  }, [pendingFill])

  // Свой скан в форме: товар из базы → ИИ проверяет его так же, как в листе
  // добавления; исправленное ложится в форму, человек видит пометку.
  const onScanFound = (food) => {
    fillFrom(food, 'filled')
    if (!barcodeAI.enabled || food.source !== 'off' || !food.barcode) return
    setNote('aiChecking')
    barcodeAI.check(food.barcode)
      .then((check) => {
        const res = applyCheck(food, check)
        if (!res.applied) setNote('aiUnsure')
        else if (res.changes.length) fillFrom(res.food, 'aiFixed')
        else setNote('aiOk')
      })
      .catch(() => setNote('filled'))
  }

  const onScanMissing = (d) => {
    fillFrom(d, d.title || d.name ? 'noNutrition' : 'notInDb')
    if (!barcodeAI.enabled || !d.barcode || !(d.title || d.name)) return
    setNote('aiFilling')
    barcodeAI.check(d.barcode)
      .then((check) => {
        const filled = fillDraft(d, check)
        if (filled) fillFrom(filled, 'aiFilled', { onlyEmpty: true })
        else setNote('noNutrition')
      })
      .catch(() => setNote('noNutrition'))
  }

  const barcode = cleanBarcode(form.barcode)
  const owner = barcode ? findProductByBarcode(products, barcode) : null
  const takenBy = owner && owner.id !== editing?.id ? owner : null

  const raw = useMemo(() => {
    const out = {
      name: form.name,
      brand: form.brand,
      emoji: form.emoji || base?.emoji || '🛒',
      unit: form.unit,
      cat: form.cat || base?.cat || null,
      baseId: form.baseId,
      barcode: form.barcode,
      dbName: form.dbName,
      photo: form.photo,
    }
    for (const k of FIELDS) out[k] = form[k] === '' ? null : form[k]
    if (editing) {
      out.id = editing.id
      if (editing.createdAt) out.createdAt = editing.createdAt
    }
    return out
  }, [form, base, editing])

  const check = useMemo(() => {
    const c = checkManualFood(
      { name: form.name, kcal: form.kcal, protein: form.protein, carbs: form.carbs, fat: form.fat, sugar: form.sugar === '' ? null : form.sugar, satFat: form.satFat === '' ? null : form.satFat },
      { unit: form.unit },
    )
    const errors = [...c.errors]
    if (form.kcal === '') errors.push(t('products.noKcal'))
    // «Все нули» здесь не про пустую форму: пока калорий нет, говорим только о них.
    const warnings = form.kcal === '' ? c.warnings.filter((w) => w !== t('manual.allZero')) : c.warnings
    return { errors, warnings, ok: errors.length === 0 }
  }, [form])

  const valid = check.ok && normalizeProduct(raw) != null

  const submit = () => {
    if (!valid) return
    const res = saveProduct(raw)
    if (res.full) { setError(t('products.full', { max: MAX_PRODUCTS })); return }
    if (!res.entry) return
    onSaved?.(res.entry, { existing: res.existing, updated: Boolean(editing || res.existing) })
    close()
  }

  const remove = () => {
    if (!editing) return
    removeProduct(editing.id)
    onDeleted?.(editing)
    close()
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const tryClose = () => { if (dirty) setConfirmExit(true); else close() }
  // Лист вложен в чужие листы (лист добавления): тап мимо него не должен
  // всплыть до родителя и закрыть всё разом.
  const onBackdrop = (e) => { e.stopPropagation(); tryClose() }

  // Подсказка с экрана «нет в базе» больше не нужна, как только человек
  // начал вписывать цифры.
  useEffect(() => { if (form.kcal && (note === 'notInDb' || note === 'noNutrition')) setNote(null) }, [form.kcal, note])

  const unit = unitLabel(form.unit)

  const sheet = (
    <div className="sheet-backdrop" {...backdropProps} onClick={onBackdrop} style={{ zIndex: LAYER }}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 16 }}>
          <h2 className="h2">{editing ? t('products.editTitle') : t('products.newTitle')}</h2>
          <button className="iconbtn" onClick={tryClose} aria-label={t('common.close')}>✕</button>
        </div>

        {confirmExit && (
          <div className="card" style={{ padding: 14, marginBottom: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            <p style={{ fontSize: 14.5, lineHeight: 1.5, margin: '0 0 12px' }}>
              {editing ? t('recipe.unsavedChanges') : t('products.unsaved')}
            </p>
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmExit(false)}>{t('recipe.stay')}</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={close}>{t('recipe.leave')}</button>
            </div>
          </div>
        )}

        <div className="row gap12" style={{ alignItems: 'center', marginBottom: 14 }}>
          <ProductThumb photo={form.photo} emoji={form.emoji || base?.emoji || '🛒'} />
          <button className="btn soft" style={{ flex: 1, height: 44, marginTop: 0 }} onClick={() => setScanning(true)}>
            📷 {t('products.fillByScan')}
          </button>
        </div>
        {note && (
          <p className="set-note" role="status" style={{ margin: '0 0 14px' }}>{t(`products.note.${note}`)}</p>
        )}

        <div className="field">
          <label>{t('template.name')}</label>
          <input
            className="input"
            placeholder={form.dbName || t('products.namePh')}
            value={form.name}
            onChange={(e) => { touched.current.name = true; set({ name: e.target.value }) }}
            // Название пришло из базы штрихкодов — касание выделяет его целиком:
            // своё название пишется сразу, без стирания чужого по букве.
            onFocus={(e) => { if (form.dbName && form.name === form.dbName) e.currentTarget.select() }}
          />
          {form.dbName && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '6px 0 0', lineHeight: 1.4 }}>
              {form.name.trim() && form.name.trim() !== form.dbName
                ? t('products.dbNameNote', { name: form.dbName })
                : t('products.nameFromDb')}
            </p>
          )}
        </div>
        <div className="field">
          <label>{t('products.brand')} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{t('common.optional')}</span></label>
          <input className="input" placeholder={t('products.brandPh')} value={form.brand} onChange={(e) => { touched.current.brand = true; set({ brand: e.target.value }) }} />
        </div>

        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={form.unit === 'г' ? 'on' : ''} onClick={() => set({ unit: 'г' })}>🍽️ {t('add.food')}</button>
          <button className={form.unit === 'мл' ? 'on' : ''} onClick={() => set({ unit: 'мл' })}>🥤 {t('add.drink')}</button>
        </div>

        {/* Разновидностью чего является продукт — связь с базой. */}
        <div className="field">
          <label>{t('products.base')}</label>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 8px', lineHeight: 1.4 }}>{t('products.baseHint')}</p>
          {base ? (
            <>
              <div className="meal-item" style={{ gap: 10, background: 'var(--surface-2)', borderRadius: 13, padding: '6px 6px 6px 12px' }}>
                <span className="meal-emoji">{base.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{foodName(base.name)}</span>
                  <span className="meal-meta">{t('add.kcalPer100', { n: base.kcal, unit: unitLabel(base.unit || 'г') })}</span>
                </span>
                <button
                  onClick={() => { set({ baseId: null }); setBaseSkip(true) }}
                  aria-label={t('products.unlinkAria', { name: foodName(base.name) })}
                  style={{ width: 44, height: 44, flex: '0 0 auto', color: 'var(--ink-3)', fontSize: 17 }}
                >✕</button>
              </div>
              <button
                className="tap44"
                onClick={useBaseValues}
                style={{ fontSize: 14, color: 'var(--primary)', fontWeight: 550, marginTop: 4 }}
              >{t('products.useBaseValues')}</button>
            </>
          ) : (
            <>
              {suggestions.length > 0 && (
                <div className="row wrap gap8" style={{ marginBottom: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t('products.suggest')}</span>
                  {suggestions.map((f) => (
                    <button key={f.foodId} className="chip" onClick={() => pickBase(f)}>{f.emoji} {foodName(f.name)}</button>
                  ))}
                </div>
              )}
              <input
                className="input"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder={t('products.basePh')}
                aria-label={t('products.base')}
                value={baseQuery}
                onChange={(e) => setBaseQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
              />
              {baseResults.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {baseResults.map((f) => (
                    <button
                      key={f.foodId}
                      onClick={() => pickBase(f)}
                      className="row between"
                      style={{ width: '100%', minHeight: 44, padding: '8px 4px', textAlign: 'start', gap: 10 }}
                    >
                      <span style={{ fontSize: 14.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.emoji} {foodName(f.name)}
                      </span>
                      <span style={{ color: 'var(--primary)', fontSize: 20, flex: '0 0 auto' }}>＋</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', margin: '6px 0 10px' }}>
          {t('products.per100', { unit })}
        </p>
        <NumField label={t('add.kcalField')} value={form.kcal} onChange={(v) => set({ kcal: v })} placeholder="250" inputMode="numeric" />
        <NumField label={t('add.proteinField')} value={form.protein} onChange={(v) => set({ protein: v })} />
        <NumField label={t('add.carbsField')} value={form.carbs} onChange={(v) => set({ carbs: v })} />
        <NumField label={t('add.sugarField')} value={form.sugar} onChange={(v) => set({ sugar: v })} nested optional />
        <NumField label={t('add.fiberField')} value={form.fiber} onChange={(v) => set({ fiber: v })} nested optional />
        <NumField label={t('add.fatField')} value={form.fat} onChange={(v) => set({ fat: v })} />
        <NumField label={t('add.satFatField')} value={form.satFat} onChange={(v) => set({ satFat: v })} nested optional />

        <div className="row gap8">
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumField label={t('products.pack', { unit })} value={form.packGrams} onChange={(v) => set({ packGrams: v })} placeholder="200" inputMode="numeric" optional />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumField label={t('products.portion', { unit })} value={form.portionGrams} onChange={(v) => set({ portionGrams: v })} placeholder="30" inputMode="numeric" optional />
          </div>
        </div>

        <div className="field">
          <label>{t('products.barcode')} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{t('common.optional')}</span></label>
          <input
            className="input tabular"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('products.barcodePh')}
            value={form.barcode}
            onChange={(e) => set({ barcode: e.target.value.replace(/[^\d]/g, '').slice(0, 14) })}
          />
          {form.barcode && !barcode && (
            <p style={{ fontSize: 13, color: 'var(--warn)', margin: '6px 0 0' }}>{t('products.barcodeBad')}</p>
          )}
          {takenBy && (
            <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.4 }}>
              {t('products.barcodeTaken', { name: productLabel(takenBy) })}
            </p>
          )}
        </div>

        <div className="field">
          <label>{t('recipe.icon')}</label>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {EMOJI.map((e) => {
              const on = (form.emoji || base?.emoji || '🛒') === e
              return (
                <button
                  key={e}
                  className={`chip ${on ? 'on' : ''}`}
                  style={{ fontSize: 18, flex: '0 0 auto', minWidth: 52 }}
                  aria-label={t('recipe.iconAria', { e })}
                  aria-pressed={on}
                  onClick={() => { set({ emoji: e }); setEmojiTouched(true) }}
                >{e}</button>
              )
            })}
          </div>
        </div>

        {(check.errors.length > 0 || check.warnings.length > 0 || error) && (
          <div role="status" aria-live="polite" style={{ marginBottom: 12 }}>
            {error && <p style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 6px' }}>{error}</p>}
            {(form.name || form.kcal) && check.errors.map((e, i) => (
              <p key={'e' + i} style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 6px', lineHeight: 1.4 }}>{e}</p>
            ))}
            {check.warnings.map((w, i) => (
              <p key={'w' + i} style={{ fontSize: 13, color: 'var(--warn)', margin: '0 0 6px', lineHeight: 1.4 }}>{t('add.checkWarn', { w })}</p>
            ))}
          </div>
        )}

        {valid && (
          <p className="tabular" style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 10px' }}>
            {productLabel(raw)} · {t('add.kcalPer100', { n: Math.round(Number(form.kcal) || 0), unit })} · {macroLabel(normalizeProduct(raw))}
          </p>
        )}

        <button className="btn" onClick={submit} disabled={!valid}>
          {editing ? t('recipe.saveChanges') : t('products.save')}
        </button>

        {editing && (confirmDelete ? (
          <div className="row gap12" style={{ marginTop: 16 }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button className="btn" style={{ flex: 1, background: 'var(--danger)' }} onClick={remove}>{t('common.delete')}</button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={() => setConfirmDelete(true)} style={{ fontSize: 14, color: 'var(--ink-3)', minHeight: 44, padding: '0 12px' }}>
              {t('products.delete')}
            </button>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '2px 0 0', lineHeight: 1.45 }}>{t('products.deleteNote')}</p>
          </div>
        ))}
      </div>

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner
            zIndex={SCANNER_LAYER}
            onClose={() => setScanning(false)}
            onFound={onScanFound}
            onMissing={onScanMissing}
            onManual={() => setScanning(false)}
          />
        </Suspense>
      )}
    </div>
  )
  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet
}
