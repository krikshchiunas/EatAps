import { useMemo, useState } from 'react'
import { buildMicroSummary, STATUS } from '../lib/microSummary.js'
import { formatMicro } from '../lib/micronutrients.js'
import { topSourcesFor } from '../lib/foodMicros.js'
import { doseLabel, scaleProvides } from '../lib/supplements.js'
import { sanitizeAmount } from '../lib/foods.js'
import { perUnitOf, stackKey, stackMicroKeys, suppEntryFromStack, takenMap, takenCount } from '../lib/suppStack.js'
import { plural } from '../lib/text.js'

// ─────────────────────────────────────────────────────────────────────────────
// Карточка добавок и микронутриентов на экране дня.
//
// Три вопроса, на которые она отвечает, в порядке важности:
//   1. «Я сегодня креатин выпил или забыл?» — стек с галочками наверху.
//   2. «Чего у меня слишком много?» — предупреждения видны ДАЖЕ В СВЁРНУТОМ
//      виде. Прятать «витамина A вдвое выше предела» под кнопку «развернуть»
//      бессмысленно: это единственное, ради чего стоило считать.
//   3. «Сколько чего набралось за день?» — таблица по группам, свёрнутая по
//      умолчанию.
//
// Почему по умолчанию свёрнуто. Развёрнутая карточка — это тридцать строк под
// приёмами пищи. Экран дня — про еду; добавки нужны раз в день и по своему
// поводу. Свёрнутое состояние показывает ровно то, что требует внимания.
// ─────────────────────────────────────────────────────────────────────────────

// Цвет и подпись статуса. Смысл несёт ТЕКСТ, цвет только усиливает: иначе
// человек с дальтонизмом не отличит «закрыто» от «перебора». Тот же принцип,
// что у пилюли качества углеводов.
const TONE = {
  [STATUS.NONE]: { color: 'var(--ink-3)', bar: 'var(--track)', word: 'нет' },
  [STATUS.LOW]: { color: 'var(--ink-2)', bar: 'var(--accent)', word: 'мало' },
  [STATUS.OK]: { color: 'var(--ink-2)', bar: 'var(--primary)', word: 'почти' },
  [STATUS.DONE]: { color: 'var(--good)', bar: 'var(--good)', word: 'норма' },
  [STATUS.OVER]: { color: 'var(--warn)', bar: 'var(--warn)', word: 'перебор' },
  [STATUS.LIMIT]: { color: 'var(--warn)', bar: 'var(--warn)', word: 'выше ориентира' },
  [STATUS.UL]: { color: 'var(--danger)', bar: 'var(--danger)', word: 'выше предела' },
}

// Подпись статуса словом. Общей таблицы тут мало, и вот почему.
//
// «Почти» у кофеина 160 из 400 читается как «ещё чуть-чуть и добьёшь» — то есть
// прямо противоположно смыслу: это предел, а не цель. У показателей «не
// превышать» подпись может быть только про то, вышли мы за ориентир или нет.
//
// А у веществ без нормы вообще (карнитин, коэнзим Q10, ликопин) «почти»
// сообщает «почти что?» — нормы у них не установлено, и сравнивать не с чем.
// Там честнее промолчать, чем изобрести оценку.
function statusWord(row) {
  if (row.def.kind === 'limit') {
    if (row.status === STATUS.UL || row.status === STATUS.LIMIT) return 'выше ориентира'
    return row.total > 0 ? 'в пределах' : 'нет'
  }
  if (row.target == null) return row.status === STATUS.UL ? 'выше предела' : ''
  return (TONE[row.status] || TONE[STATUS.NONE]).word
}

export default function SupplementsCard({
  date, day, profile, supplements = [], microGoals = {},
  addSupp, removeSupp, editSupp, saveStackItem, removeStackItem, onOpenAdd, onOpenGoal, onToast,
}) {
  const [open, setOpen] = useState(false)
  const meals = day?.meals || []
  const supps = day?.supps || []

  const summary = useMemo(() => buildMicroSummary({
    meals,
    supps,
    profile,
    goals: microGoals,
    stackKeys: stackMicroKeys(supplements),
  }), [meals, supps, profile, microGoals, supplements])

  const taken = useMemo(() => takenMap(day), [day])

  // «Закрыто N из M» — по всем показателям, которые вообще нужно набирать.
  const done = summary.groups.reduce((s, g) => s + g.done, 0)
  const goal = summary.groups.reduce((s, g) => s + g.total, 0)

  const toggleStack = (item) => {
    const already = taken.get(stackKey(item))
    if (already) {
      removeSupp(date, already.id)
      onToast?.(`${item.name} — отметка снята`)
      return
    }
    const entry = suppEntryFromStack(item)
    if (!entry) return
    addSupp(date, entry)
    onToast?.(`${item.name} · ${doseLabel(entry.dose, entry.unit)}`)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
      >
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
          <span className="h2" style={{ fontSize: 17 }}>Добавки и витамины</span>
          {goal > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--surface-2)', padding: '4px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>
              норма закрыта у {done} из {goal}
            </span>
          )}
        </span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flex: '0 0 auto' }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {/* Предупреждения — вне складки. Свёрнутая карточка обязана показывать
          то, что требует решения прямо сейчас. */}
      {summary.alerts.length > 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          {summary.alerts.slice(0, open ? 8 : 3).map((a) => (
            <div
              key={`${a.key}:${a.level}`}
              style={{
                fontSize: 13, lineHeight: 1.45, padding: '9px 12px', borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)',
                color: a.level === 'high' ? 'var(--danger)' : a.level === 'mid' ? 'var(--warn)' : 'var(--ink-2)',
              }}
            >
              {a.level === 'high' ? '⚠️ ' : a.level === 'mid' ? '⚠️ ' : '💡 '}{a.text}
            </div>
          ))}
        </div>
      )}

      {/* Стек: то, ради чего карточку открывают чаще всего. Виден и в свёрнутом
          виде — «выпил / не выпил» это вопрос одного касания, а не двух. */}
      {supplements.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, marginBottom: 8 }}>Мой стек</div>
          <div className="stack" style={{ marginTop: 0 }}>
            {supplements.map((item) => {
              const on = taken.has(stackKey(item))
              const times = takenCount(day, item)
              return (
                // Строка — контейнер с ДВУМЯ кнопками, а не одна кнопка с
                // вложенной. Кнопка внутри кнопки — невалидная разметка: клик по
                // внутренней срабатывает дважды, а озвучка читает их как одну.
                <div
                  key={item.id}
                  className="row"
                  style={{
                    gap: 10, padding: '9px 12px', borderRadius: 'var(--r-sm)',
                    background: on ? 'var(--primary-weak)' : 'var(--surface-2)',
                  }}
                >
                <button
                  onClick={() => toggleStack(item)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', flex: '1 1 auto', minWidth: 0 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22, height: 22, flex: '0 0 auto', borderRadius: 7,
                      display: 'grid', placeItems: 'center', fontSize: 13,
                      border: on ? 'none' : '2px solid var(--border-strong)',
                      background: on ? 'var(--primary)' : 'transparent',
                      color: 'var(--on-primary)',
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 550, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.emoji} {item.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {doseLabel(item.dose, item.unit)}
                      {times > 1 ? ` · сегодня ${times} ${plural(times, 'раз', 'раза', 'раз')}` : ''}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: on ? 'var(--good)' : 'var(--ink-3)', flex: '0 0 auto' }}>
                    {on ? 'выпито' : 'отметить'}
                  </span>
                </button>
                {/* Убрать из стека можно только в развёрнутой карточке: в
                    свёрнутой рядом с галочкой «выпил» крестик слишком легко
                    задеть, а стирает он не отметку за день, а всю привычку. */}
                {open && (
                  <button
                    className="iconbtn"
                    style={{ width: 30, height: 30, fontSize: 14, flex: '0 0 auto' }}
                    onClick={() => { removeStackItem(item.id); onToast?.(`«${item.name}» убрана из стека`) }}
                    aria-label={`Убрать ${item.name} из стека`}
                    title="Убрать из стека"
                  >
                    ✕
                  </button>
                )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Разовые приёмы — то, чего нет в стеке. Показываем отдельно, иначе
          человек не поймёт, почему в стеке галочек меньше, чем строк ниже. */}
      <OneOffList
        date={date} supps={supps} supplements={supplements}
        removeSupp={removeSupp} editSupp={editSupp} saveStackItem={saveStackItem} onToast={onToast}
      />

      <div className="row gap8" style={{ marginTop: 12 }}>
        <button className="btn ghost" style={{ height: 44, fontSize: 15 }} onClick={onOpenAdd}>
          ＋ Добавить добавку
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 4 }}>
          <div className="divider" />
          {summary.groups.map((g) => (
            <MicroGroup key={g.key} group={g} meals={meals} onOpenGoal={onOpenGoal} />
          ))}
          <Disclaimer coverage={summary.coverage} />
        </div>
      )}
    </div>
  )
}

// ── Разовые приёмы за день ───────────────────────────────────────────────────
function OneOffList({ date, supps, supplements, removeSupp, editSupp, saveStackItem, onToast }) {
  const [editing, setEditing] = useState(null) // id записи, у которой правим дозу
  const stackKeys = new Set(supplements.map(stackKey))
  const rows = supps.filter((e) => !stackKeys.has(stackKey(e)))
  if (!rows.length) return null

  const pin = (e) => {
    // Добавка, принятая разово, часто оказывается регулярной. В стек уезжают
    // ПРИВЫЧНАЯ ДОЗА и состав одной единицы — по отдельности: только так
    // «3 таблетки» останутся тремя таблетками и при следующей отметке.
    const saved = saveStackItem({
      suppId: e.suppId, name: e.name, emoji: e.emoji, unit: e.unit,
      dose: e.dose, provides: perUnitOf(e),
    })
    onToast?.(saved ? `«${e.name}» теперь в стеке` : 'В стеке слишком много добавок')
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 550, marginBottom: 8 }}>Сегодня разово</div>
      <div className="stack" style={{ marginTop: 0 }}>
        {rows.map((e) => (
          editing === e.id
            ? <DoseEditor key={e.id} entry={e} onCancel={() => setEditing(null)} onSave={(dose) => { editSupp(date, reDose(e, dose)); setEditing(null) }} />
            : (
              <div key={e.id} className="row between" style={{ gap: 10, padding: '8px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}>
                <button onClick={() => setEditing(e.id)} style={{ minWidth: 0, flex: '1 1 auto', textAlign: 'left' }}>
                  <span style={{ fontSize: 14, fontWeight: 550, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.emoji} {e.name}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{doseLabel(e.dose, e.unit)} · изменить</span>
                </button>
                <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 15, flex: '0 0 auto' }} onClick={() => pin(e)} aria-label="Добавить в стек" title="Добавить в стек">📌</button>
                <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 15, flex: '0 0 auto' }} onClick={() => removeSupp(date, e.id)} aria-label={`Убрать ${e.name}`}>✕</button>
              </div>
            )
        ))}
      </div>
    </div>
  )
}

// Пересчёт записи под новую дозу.
//
// Состав в записи хранится УЖЕ умноженным на дозу (снимком, как у продуктов),
// поэтому новую величину нельзя получить из старой умножением — сначала надо
// вернуться к составу одной единицы. Делить на прежнюю дозу и умножать на
// новую в две операции значило бы копить ошибку округления на каждой правке.
function reDose(entry, dose) {
  return { ...entry, dose, provides: scaleProvides(perUnitOf(entry), dose) }
}

function DoseEditor({ entry, onSave, onCancel }) {
  const [value, setValue] = useState(String(entry.dose))
  const n = Number(String(value).replace(',', '.'))
  const ok = Number.isFinite(n) && n > 0
  return (
    <div className="row gap8" style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}>
      <span style={{ fontSize: 13, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.emoji} {entry.name}
      </span>
      <input
        className="input" type="text" inputMode="decimal" value={value}
        onChange={(ev) => setValue(sanitizeAmount(ev.target.value))}
        style={{ width: 78, flex: '0 0 auto', textAlign: 'right', height: 38 }}
        aria-label={`Сколько, ${entry.unit}`}
        autoFocus
      />
      <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: '0 0 auto' }}>{entry.unit}</span>
      <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 15, flex: '0 0 auto' }} onClick={() => ok && onSave(n)} disabled={!ok} aria-label="Сохранить">✓</button>
      <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 15, flex: '0 0 auto' }} onClick={onCancel} aria-label="Отменить">✕</button>
    </div>
  )
}

// ── Группа микронутриентов ───────────────────────────────────────────────────
function MicroGroup({ group, meals, onOpenGoal }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>{group.emoji} {group.label}</span>
        {group.total > 0 && (
          <span className="tabular" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{group.done} / {group.total}</span>
        )}
      </div>
      <div className="stack" style={{ marginTop: 0 }}>
        {group.rows.map((r) => <MicroRow key={r.key} row={r} meals={meals} onOpenGoal={onOpenGoal} />)}
      </div>
    </div>
  )
}

function MicroRow({ row, meals, onOpenGoal }) {
  const [open, setOpen] = useState(false)
  const tone = TONE[row.status] || TONE[STATUS.NONE]
  const unit = row.def.unit

  // Полоску рисуем ТОЛЬКО там, где есть с чем сравнивать. Раньше строка без
  // нормы («L-карнитин 285 мг») получала полную полоску — она читалась как
  // «набрано полностью», хотя набирать было нечего.
  //
  // У показателей «не превышать» полоска означает «сколько израсходовано от
  // ориентира», у остальных — «сколько набрано от нормы».
  const hasBar = row.target > 0
  const pct = hasBar ? Math.min(100, (row.total / row.target) * 100) : 0
  // Доля еды внутри набранного — чтобы было видно, чем именно закрыто.
  const foodPct = row.total > 0 ? (row.fromFood / row.total) * 100 : 0

  const sources = open ? topSourcesFor(meals, row.key) : []

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', textAlign: 'left' }}>
        <div className="row between" style={{ gap: 10, marginBottom: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 550, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.def.label}
            {row.personal && <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}> · моя норма</span>}
          </span>
          <span className="tabular" style={{ fontSize: 13, color: tone.color, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
            {formatMicro(row.total)}{row.target != null ? ` / ${formatMicro(row.target)}` : ''} {unit}
          </span>
        </div>
        {/* Полоска из двух частей: сначала еда, потом добавки. Это и есть
            главный ответ карточки — чем именно закрыта норма. */}
        {hasBar && (
          <div style={{ height: 7, borderRadius: 5, background: 'var(--track)', overflow: 'hidden', display: 'flex' }}>
            <div style={{ height: '100%', width: `${(pct * foodPct) / 100}%`, background: tone.bar, transition: 'width 0.4s ease' }} />
            <div style={{ height: '100%', width: `${pct - (pct * foodPct) / 100}%`, background: tone.bar, opacity: 0.45, transition: 'width 0.4s ease' }} />
          </div>
        )}
        <div className="row between" style={{ marginTop: 4, gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.fromFood > 0 && `еда ${formatMicro(row.fromFood)}`}
            {row.fromFood > 0 && row.fromSupp > 0 && ' · '}
            {row.fromSupp > 0 && `добавки ${formatMicro(row.fromSupp)}`}
          </span>
          <span style={{ fontSize: 11, color: tone.color, flex: '0 0 auto' }}>{statusWord(row)}</span>
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>{row.def.about}</p>

          {/* Прямой ответ на вопрос «а мне ещё надо?» — в словах, а не в
              процентах: проценты человек всё равно переводит в «сколько». */}
          {row.def.kind !== 'limit' && row.target != null && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>
              {row.remaining > 0
                ? `Осталось добрать ${formatMicro(row.remaining, unit)}.`
                : `Норма закрыта, сверх неё ${formatMicro(-row.remaining, unit)}.`}
              {row.ul != null && (
                row.ulScope === 'supp'
                  ? ` Верхний предел для добавок — ${formatMicro(row.ul, unit)}; из таблеток сегодня ${formatMicro(row.ulUsed, unit)}.`
                  : ` Верхний предел — ${formatMicro(row.ul, unit)}.`
              )}
            </p>
          )}
          {row.def.kind === 'limit' && row.target != null && (
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 10px' }}>
              Ориентир — не больше {formatMicro(row.target, unit)} в сутки. Сегодня {formatMicro(row.total, unit)}.
            </p>
          )}

          {sources.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Больше всего дали</div>
              {sources.map((s, i) => (
                <div key={i} className="row between" style={{ fontSize: 12.5, padding: '2px 0' }}>
                  <span style={{ color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.emoji} {s.name}</span>
                  <span className="tabular" style={{ color: 'var(--ink-3)', flex: '0 0 auto' }}>{formatMicro(s.value, unit)}</span>
                </div>
              ))}
            </div>
          )}

          <button className="btn soft" style={{ height: 38, fontSize: 13.5 }} onClick={() => onOpenGoal?.(row.def.key)}>
            {row.personal ? 'Изменить мою норму' : 'Задать свою норму'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Честность итога ──────────────────────────────────────────────────────────
function Disclaimer({ coverage }) {
  const missed = coverage.total - coverage.covered
  return (
    <p style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: 0 }}>
      {missed > 0 && (
        <>
          {missed} {plural(missed, 'продукт', 'продукта', 'продуктов')} из {coverage.total} разобрать не удалось —
          их витамины и минералы в счёт не вошли. Обычно это товары со штрихкодом и записи, где не указан вес.{' '}
        </>
      )}
      Числа справочные: они показывают, сколько вещества было в съеденном, а не сколько усвоилось. Это ориентир,
      а не медицинский показатель, и дефицит по нему не определяют — для этого есть анализы.
    </p>
  )
}
