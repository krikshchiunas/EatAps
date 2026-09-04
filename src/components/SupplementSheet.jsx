import { useMemo, useState } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import {
  SUPPLEMENTS, SUPP_GROUPS, POPULAR_SUPPLEMENTS,
  searchSupplements, scaleProvides, makeCustomSupplement, doseLabel,
  doseFields, providesFromFields, unitProvides, unitDose, needsDoseSetup, hasOwnDose,
} from '../lib/supplements.js'
import { MICRONUTRIENTS, MICRO_GROUPS, formatMicro } from '../lib/micronutrients.js'
import { previewSupplement } from '../lib/microSummary.js'
import { sanitizeAmount } from '../lib/foods.js'
import { stackItemFromSupplement } from '../lib/suppStack.js'
import { plural } from '../lib/text.js'

// ─────────────────────────────────────────────────────────────────────────────
// Лист добавления добавки.
//
// Главное решение экрана: ПОКАЗЫВАТЬ ПОСЛЕДСТВИЯ ДО ПРИЁМА, а не после.
// Человек берёт капсулу в руку и хочет знать, надо ли её вообще пить сегодня.
// Поэтому под выбранной добавкой стоит прикидка: «витамин C станет 756 из 500 —
// перебор», «витамин D закроет норму». Считает её previewSupplement по своду
// текущего дня, то есть с уже учтённой едой.
//
// Второе решение: своя добавка собирается ЗДЕСЬ ЖЕ, а не в настройках. Каталог
// из ста двадцати банок всё равно не покроет аптечную полку, и человек, не
// нашедший свою, должен выйти отсюда с записью, а не с пустыми руками.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }

export default function SupplementSheet({ summary, suppDoses = {}, setSuppDose, onAdd, onPin, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(null)
  const [selected, setSelected] = useState(null)
  const [dose, setDose] = useState('1')
  const [custom, setCustom] = useState(false)
  // Шаг «что в одной таблетке». Открывается сам у добавок с плавающей
  // дозировкой, пока человек не указал свою, и по кнопке — у любых других.
  const [editingUnit, setEditingUnit] = useState(false)

  const list = useMemo(() => {
    if (q.trim()) return searchSupplements(q).slice(0, 40)
    if (group) return SUPPLEMENTS.filter((s) => s.group === group)
    return POPULAR_SUPPLEMENTS
  }, [q, group])

  const pick = (s) => {
    setSelected(s)
    setDose(String(unitDose(s, suppDoses)))
    // У рыбьего жира и мультивитаминов состав капсулы у каждого свой. Спрашиваем
    // один раз, при первом выборе, — дальше человек указывает только количество.
    setEditingUnit(needsDoseSetup(s, suppDoses))
  }

  const doseN = num(dose)
  // Состав ОДНОЙ единицы: сохранённый человеком либо типовой из каталога.
  const unit = selected ? unitProvides(selected, suppDoses) : {}
  const own = selected ? hasOwnDose(selected, suppDoses) : false
  const provides = selected ? scaleProvides(unit, doseN) : {}
  const preview = useMemo(
    () => (selected && summary ? previewSupplement(summary, provides) : []),
    [selected, summary, provides],
  )

  const submit = (alsoPin) => {
    if (!selected || !(doseN > 0)) return
    onAdd({
      suppId: selected.id || null,
      name: selected.name,
      emoji: selected.emoji,
      unit: selected.unit,
      dose: doseN,
      provides,
    })
    // В стек уезжает СВОЙ состав единицы, а не каталожный.
    if (alsoPin) onPin({ ...stackItemFromSupplement(selected, doseN), provides: unit })
    close()
  }

  if (custom) {
    return (
      <div className="sheet-backdrop" {...backdropProps} onClick={close}>
        <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
          <div className="grabber" />
          <CustomBuilder
            onBack={() => setCustom(false)}
            onDone={(supp) => { setCustom(false); pick(supp) }}
            onClose={close}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {/* Один заголовок на весь лист. Шаг «что в одной таблетке» раньше
            рисовал свой поверх этого, и человек видел «Сколько принято» над
            формой состава — то есть подпись не про то, что на экране. */}
        <div className="row between" style={{ marginBottom: 14, gap: 8 }}>
          <div className="row gap8" style={{ minWidth: 0, flex: '1 1 auto' }}>
            {selected && editingUnit && (
              <button
                className="iconbtn"
                onClick={() => (own || !selected.variable ? setEditingUnit(false) : setSelected(null))}
                aria-label="Назад"
              >←</button>
            )}
            <h2 className="h2" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {!selected ? 'Добавка' : editingUnit ? selected.name : 'Сколько принято'}
            </h2>
          </div>
          <button className="iconbtn" onClick={close} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
        </div>

        {selected && editingUnit ? (
          <UnitEditor
            supp={selected}
            saved={suppDoses}
            onSave={(p) => {
              setSuppDose?.(selected.id, { provides: p, dose: doseN > 0 ? doseN : (selected.defaultDose ?? 1) })
              setEditingUnit(false)
            }}
          />
        ) : selected ? (
          <>
            <div className="row gap12" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
              <span className="meal-emoji" style={{ width: 42, height: 42, fontSize: 20, flex: '0 0 auto' }}>{selected.emoji}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</div>
                {/* Типовую подпись с этикетки прячем, если человек указал свою
                    банку: «≈ 180 EPA + 120 DHA» рядом с его собственными 500/250
                    читается как спор приложения с самим собой. */}
                {selected.note && !own && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.4 }}>{selected.note}</div>
                )}
              </div>
              <button className="btn soft" style={{ width: 'auto', height: 34, padding: '0 12px', fontSize: 13, flex: '0 0 auto' }} onClick={() => setSelected(null)}>Другая</button>
            </div>

            {selected.warn && (
              <p style={{ fontSize: 13, color: 'var(--warn)', background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 'var(--r-sm)', lineHeight: 1.45, margin: '0 0 16px' }}>
                ⚠️ {selected.warn}
              </p>
            )}

            {/* Что в одной единице — всегда на виду и всегда правится: у
                каталожной записи это типовая банка, у уточнённой — своя. */}
            <button
              onClick={() => setEditingUnit(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', marginBottom: 16,
              }}
            >
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block' }}>
                  {own ? 'Ваша банка · в одной единице' : 'Типовая банка · в одной единице'}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 550, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {describeUnit(unit)}
                </span>
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--primary)', fontWeight: 600, flex: '0 0 auto' }}>изменить</span>
            </button>

            <div className="field">
              <label>Сколько ({selected.unit})</label>
              <input
                className="input" type="text" inputMode="decimal" value={dose}
                onChange={(e) => setDose(sanitizeAmount(e.target.value))}
                autoFocus
              />
              <div className="row gap8" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                {doseChoices(selected).map((d) => (
                  <button key={d} className={`chip ${doseN === d ? 'on' : ''}`} onClick={() => setDose(String(d))}>
                    {doseLabel(d, selected.unit)}
                  </button>
                ))}
              </div>
            </div>

            <PreviewList preview={preview} />

            <div className="row gap8" style={{ marginTop: 4 }}>
              <button className="btn" onClick={() => submit(false)} disabled={!(doseN > 0)}>Записать на сегодня</button>
            </div>
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => submit(true)} disabled={!(doseN > 0)}>
              Записать и добавить в мой стек
            </button>
          </>
        ) : (
          <>
            <input
              className="input" placeholder="Найти: креатин, магний, омега-3…"
              value={q} onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            {!q.trim() && (
              <div className="row gap8" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
                <button className={`chip ${!group ? 'on' : ''}`} onClick={() => setGroup(null)}>Популярное</button>
                {SUPP_GROUPS.map((g) => (
                  <button key={g.key} className={`chip ${group === g.key ? 'on' : ''}`} onClick={() => setGroup(g.key)}>
                    {g.emoji} {g.label}
                  </button>
                ))}
              </div>
            )}

            <div className="stack" style={{ marginTop: 0 }}>
              {list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}
                >
                  <span style={{ fontSize: 19, flex: '0 0 auto' }}>{s.emoji}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 550, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hasOwnDose(s, suppDoses) ? `ваша банка · ${describeUnit(suppDoses[s.id].provides)}` : mainSubstances(s)}
                    </span>
                  </span>
                </button>
              ))}
              {list.length === 0 && (
                <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, textAlign: 'center', padding: '18px 0' }}>
                  Такой добавки в каталоге нет — соберите свою, и она будет считаться наравне с остальными.
                </p>
              )}
            </div>

            <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setCustom(true)}>
              ＋ Своя добавка (с этикетки)
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Из чего состоит — двумя-тремя главными веществами. Полный список для
// мультивитаминов не влезет никуда и ничего не объяснит.
// Состав показываем НА ТИПОВУЮ ДОЗУ, а не на одну единицу. «Креатин 1 г» под
// названием «Креатин моногидрат» сбивает с толку: принимают его по пять, и
// именно пять запишутся в дневник.
function mainSubstances(s) {
  const keys = Object.keys(s.provides)
  const defs = MICRONUTRIENTS.filter((d) => keys.includes(d.key))
  if (defs.length > 4) return `${defs.length} ${plural(defs.length, 'вещество', 'вещества', 'веществ')}`
  const dosed = scaleProvides(s.provides, s.defaultDose ?? 1)
  return defs.map((d) => `${d.short} ${formatMicro(dosed[d.key], d.unit)}`).join(' · ')
}

// Подсказки дозы вокруг типовой: половина, обычная, двойная. Для граммов
// шаги крупнее — креатин мерят не половинками.
function doseChoices(s) {
  const base = s.defaultDose ?? 1
  const set = s.unit === 'г' ? [base, base * 2] : [base, base * 2, base * 3]
  if (base > 1) set.unshift(base / 2)
  return [...new Set(set.map((n) => Math.round(n * 100) / 100))].filter((n) => n > 0).slice(0, 4)
}

// ── Прикидка: что станет после приёма ────────────────────────────────────────
// Состав единицы одной строкой: «D 50 мкг · K 100 мкг».
function describeUnit(provides) {
  const keys = Object.keys(provides || {})
  if (!keys.length) return 'состав не указан'
  const defs = MICRONUTRIENTS.filter((d) => keys.includes(d.key))
  if (defs.length > 4) return `${defs.length} ${plural(defs.length, 'вещество', 'вещества', 'веществ')}`
  return defs.map((d) => `${d.short} ${formatMicro(provides[d.key], d.unit)}`).join(' · ')
}

// ── Что в одной таблетке ─────────────────────────────────────────────────────
// Человек переписывает состав со своей банки, и приложение его запоминает.
// Дальше при каждом приёме он указывает только количество капсул.
function UnitEditor({ supp, saved, onSave }) {
  const fields = useMemo(() => doseFields(supp), [supp])
  const start = useMemo(() => {
    const cur = unitProvides(supp, saved)
    const out = {}
    for (const f of fields) {
      // Несколько полей на один ключ (EPA и DHA в омега-3) из суммы не
      // восстановить — там показываем типовые числа, а не делим 750 пополам.
      const many = fields.filter((x) => x.key === f.key).length > 1
      const v = many ? null : cur[f.key]
      out[f.id] = v != null ? String(v) : String(f.typical ?? '')
    }
    return out
  }, [supp, saved, fields])

  const [values, setValues] = useState(start)
  const provides = providesFromFields(fields, values)
  const ready = Object.keys(provides).length > 0

  return (
    <>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 4px' }}>
        Сколько в ОДНОЙ {supp.unit === 'г' || supp.unit === 'мл' ? `единице (${supp.unit})` : supp.unit === 'порция' ? 'порции' : supp.unit.replace(/а$/, 'е')}?
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45, margin: '0 0 16px' }}>
        {supp.variable
          ? 'У разных производителей дозировки сильно отличаются — перепишите со своей банки. Дальше будете указывать только количество.'
          : 'Числа подставлены типовые. Если на вашей банке другие — поправьте, приложение запомнит.'}
      </p>

      <div className="stack" style={{ marginTop: 0, marginBottom: 18 }}>
        {fields.map((f) => (
          <div key={f.id} className="row gap8">
            <span style={{ fontSize: 13.5, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
            <input
              className="input" type="text" inputMode="decimal" placeholder="0"
              value={values[f.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: sanitizeAmount(e.target.value) }))}
              style={{ width: 96, flex: '0 0 auto', textAlign: 'right', height: 42 }}
              aria-label={`${f.label}, ${f.unit}`}
            />
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 46, flex: '0 0 auto' }}>{f.unit}</span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={() => onSave(provides)} disabled={!ready}>Запомнить эту банку</button>
      {!ready && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '10px 0 0', lineHeight: 1.45 }}>
          Заполните хотя бы одно поле — иначе считать будет нечего.
        </p>
      )}
    </>
  )
}

const VERDICT = {
  ul: { color: 'var(--danger)', text: 'выше верхнего предела' },
  excess: { color: 'var(--warn)', text: 'заметно выше нормы' },
  completes: { color: 'var(--good)', text: 'закроет норму' },
  fills: { color: 'var(--ink-3)', text: 'в пределах нормы' },
}

// Совет одной фразой. Важно не соврать о причине: «это уже набрано едой»
// верно, только если еда И ПРАВДА закрыла норму. Когда еда дала половину, а за
// верх перебрасывает как раз капсула, та же фраза звучит как обвинение обеду.
function adviceFor(p) {
  const closedByFood = p.target != null && p.fromFood >= p.target
  if (p.verdict === 'ul') {
    return closedByFood
      ? `${p.def.label} уйдёт выше верхнего предела, а норму уже закрыла еда — сегодня это лишнее.`
      : `${p.def.label} уйдёт выше верхнего предела. Столько за сутки получать не стоит.`
  }
  return closedByFood
    ? `${p.def.label}: норму сегодня уже закрыла еда — добавка сверху не нужна.`
    : `${p.def.label} уйдёт заметно выше вашей нормы.`
}

function PreviewList({ preview }) {
  if (!preview.length) return null
  const shown = preview.slice(0, 6)
  const rest = preview.length - shown.length
  // previewSupplement уже отсортировал: сначала предел, потом перебор.
  const worst = shown.find((p) => p.verdict === 'ul' || p.verdict === 'excess')
  return (
    <div className="card" style={{ padding: 14, marginBottom: 18, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, marginBottom: 10 }}>Станет за сегодня</div>
      {shown.map((p) => {
        const v = VERDICT[p.verdict] || VERDICT.fills
        return (
          <div key={p.key} className="row between" style={{ gap: 10, padding: '4px 0' }}>
            <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.def.label}</span>
            <span className="tabular" style={{ fontSize: 12.5, color: v.color, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              {formatMicro(p.before)} → {formatMicro(p.after)}{p.target != null ? ` / ${formatMicro(p.target)}` : ''} {p.def.unit}
            </span>
          </div>
        )
      })}
      {worst && (
        <p style={{ fontSize: 12, color: VERDICT[worst.verdict].color, margin: '10px 0 0', lineHeight: 1.45 }}>
          {adviceFor(worst)}
        </p>
      )}
      {rest > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>и ещё {rest}</div>}
    </div>
  )
}

// Единица в родительном падеже: «состав одной капсулы», а не «на одну капсула».
// Списка не избежать — русский падеж по строке не вывести, а склеивать
// «на одну» + слово в именительном нельзя ни с одним из этих слов.
const UNIT_OF = {
  'капсула': 'одной капсулы',
  'таблетка': 'одной таблетки',
  'порция': 'одной порции',
  'г': 'одного грамма',
  'мл': 'одного миллилитра',
  'капля': 'одной капли',
}

// ── Своя добавка ─────────────────────────────────────────────────────────────
// Ввод по этикетке: название, единица, и сколько чего в одной единице.
// Вещества выбираются из справочника, а не вводятся текстом: свободный текст
// невозможно сложить с едой, а ради этого всё и затевалось.
function CustomBuilder({ onBack, onDone, onClose }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('капсула')
  const [rows, setRows] = useState({}) // key → строка ввода
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pq, setPq] = useState('')

  const chosen = Object.keys(rows)
  const provides = {}
  for (const k of chosen) {
    const v = num(rows[k])
    if (v > 0) provides[k] = v
  }
  const ready = name.trim() && Object.keys(provides).length > 0

  const add = (key) => { setRows((r) => ({ ...r, [key]: '' })); setPickerOpen(false); setPq('') }
  const drop = (key) => setRows((r) => { const n = { ...r }; delete n[key]; return n })

  const options = useMemo(() => {
    const query = pq.trim().toLowerCase().replace(/ё/g, 'е')
    return MICRONUTRIENTS.filter((d) => {
      if (rows[d.key] != null) return false
      if (!query) return true
      return d.label.toLowerCase().replace(/ё/g, 'е').includes(query) || d.key.toLowerCase().includes(query)
    })
  }, [pq, rows])

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="row gap8">
          <button className="iconbtn" onClick={onBack} aria-label="Назад">←</button>
          <h2 className="h2">Своя добавка</h2>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 16px' }}>
        Перепишите с этикетки состав одной капсулы, ложки или таблетки — сколько принять, спросим потом.
      </p>

      <div className="field">
        <label>Название</label>
        <input className="input" placeholder="Напр. Комплекс из аптеки" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>

      <div className="field">
        <label>Единица приёма</label>
        <div className="row gap8" style={{ flexWrap: 'wrap' }}>
          {['капсула', 'таблетка', 'порция', 'г', 'мл', 'капля'].map((u) => (
            <button key={u} className={`chip ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>{u}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Что внутри {UNIT_OF[unit] || `одной единицы (${unit})`}</label>
        {chosen.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 10px' }}>Пока пусто — добавьте хотя бы одно вещество.</p>
        )}
        <div className="stack" style={{ marginTop: 0 }}>
          {chosen.map((key) => {
            const def = MICRONUTRIENTS.find((d) => d.key === key)
            return (
              <div key={key} className="row gap8">
                <span style={{ fontSize: 13.5, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.label}</span>
                <input
                  className="input" type="text" inputMode="decimal" placeholder="0"
                  value={rows[key]} onChange={(e) => setRows((r) => ({ ...r, [key]: sanitizeAmount(e.target.value) }))}
                  style={{ width: 92, flex: '0 0 auto', textAlign: 'right' }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)', width: 46, flex: '0 0 auto' }}>{def.unit}</span>
                <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 14, flex: '0 0 auto' }} onClick={() => drop(key)} aria-label={`Убрать ${def.label}`}>✕</button>
              </div>
            )
          })}
        </div>
        <button className="btn soft" style={{ height: 40, fontSize: 14, marginTop: 12 }} onClick={() => setPickerOpen((o) => !o)}>
          {pickerOpen ? 'Свернуть список' : '＋ Добавить вещество'}
        </button>
        {pickerOpen && (
          <div style={{ marginTop: 12 }}>
            <input className="input" placeholder="Найти вещество" value={pq} onChange={(e) => setPq(e.target.value)} style={{ marginBottom: 10 }} />
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {MICRO_GROUPS.map((g) => {
                const items = options.filter((d) => d.group === g.key)
                if (!items.length) return null
                return (
                  <div key={g.key} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>{g.emoji} {g.label}</div>
                    <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                      {items.map((d) => (
                        <button key={d.key} className="chip" onClick={() => add(d.key)}>{d.short}</button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button
        className="btn"
        disabled={!ready}
        onClick={() => {
          const supp = makeCustomSupplement({ name, unit, dose: 1, provides })
          if (supp) onDone(supp)
        }}
      >
        Дальше
      </button>
    </>
  )
}
