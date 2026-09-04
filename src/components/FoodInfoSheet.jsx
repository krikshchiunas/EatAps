import { useMemo } from 'react'
import { useSheetDrag } from '../lib/useSheetDrag.js'
import { amountLabel, formatAmount } from '../lib/foods.js'
import { sumAdvanced, freeSugarShare, fiberRatioOf } from '../lib/nutrition.js'
import { estimateProteinQuality, usableProteinShare, PROTEIN_QUALITY_LOW } from '../lib/nutritionClassification.js'
import { microsForEntry, massOf } from '../lib/foodMicros.js'
import { MICRO_GROUPS, MICRONUTRIENTS, microTargets, formatMicro } from '../lib/micronutrients.js'

// ─────────────────────────────────────────────────────────────────────────────
// «Что внутри» — полный разбор ОДНОЙ съеденной записи.
//
// Дневник показывает четыре числа: калории и Б/Ж/У. Их достаточно, чтобы вести
// учёт, и совершенно недостаточно, чтобы ответить на простой вопрос — «а что я,
// собственно, съел?». Белок белку рознь (желатин не строит мышцы), углеводы
// бывают гречкой и колой, а витамины в дневнике до сих пор не показывались
// вовсе, хотя приложение их считает.
//
// Здесь показано всё, что известно про эту порцию, и ровно с той точностью, с
// какой известно:
//   • измеренное (пришло с этикеткой или из базы) — как есть;
//   • оценённое по типу продукта — со знаком «≈» и пометкой внизу;
//   • неизвестное — прочерком, а не нулём.
//
// Последнее принципиально. Ноль означает «этого в продукте нет», и в масле это
// правда, а в сканированной пачке без данных — нет. Подменять одно другим
// значит показывать выдумку с точностью до десятых.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Граммы по-русски: десятая доля и ЗАПЯТАЯ. Через шаблонную строку выходило
// «10.3 г» — точка, которой в русском тексте не бывает, и весь остальной
// дневник печатает запятую.
//
// Округляем до десятых, а не до целых: у колы клетчатки 0,53 г, и целое
// превращало её в честную на вид «1 г». Ноль тоже показываем как ноль —
// «клетчатки здесь нет» это ответ, а не пропуск.
const gram = (v) => `${formatAmount(Math.round(num(v) * 10) / 10)} г`

export default function FoodInfoSheet({ food, profile, microGoals = {}, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  const data = useMemo(() => {
    if (!food) return null
    const adv = sumAdvanced([food])
    const micro = microsForEntry(food)
    const targets = microTargets(profile, microGoals)
    const pq = estimateProteinQuality(food)
    // Свободные сахара и клетчатку считаем здесь, а не через sumQuality: та
    // округляет до целых граммов ради экрана дня, а в разборе одной порции
    // округление до целого превращает 0,53 г клетчатки в колe в «1 г».
    const carbs = num(food.carbs)
    const freeSugar = carbs * freeSugarShare(food.name)
    const fiber = carbs * fiberRatioOf(food.name)
    return { adv, micro, targets, pq, freeSugar, fiber }
  }, [food, profile, microGoals])

  if (!food || !data) return null
  const { adv, micro, targets, pq, freeSugar, fiber } = data

  const protein = num(food.protein)
  const carbs = num(food.carbs)
  const fat = num(food.fat)
  const mass = massOf(food)

  // Есть ли вообще что показывать по микронутриентам.
  const groups = MICRO_GROUPS
    .map((g) => ({
      ...g,
      rows: MICRONUTRIENTS
        .filter((d) => d.group === g.key && num(micro.values[d.key]) > 0)
        .map((d) => ({ def: d, value: micro.values[d.key], target: targets[d.key] })),
    }))
    .filter((g) => g.rows.length > 0)

  const share = usableProteinShare(pq.diaas)

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close}>
      <div className="sheet sheet-tall" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />

        <div className="row between" style={{ marginBottom: 4, gap: 10 }}>
          <div className="row gap12" style={{ minWidth: 0, alignItems: 'center' }}>
            <span className="meal-emoji" style={{ width: 42, height: 42, fontSize: 20, flex: '0 0 auto' }}>{food.emoji || '🍽️'}</span>
            <div style={{ minWidth: 0 }}>
              <div className="h2" style={{ fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{food.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                {food.grams ? `${amountLabel(food.grams, food.unit || 'г')} · ` : ''}{Math.round(num(food.kcal))} ккал
              </div>
            </div>
          </div>
          <button className="iconbtn" onClick={close} aria-label="Закрыть" style={{ flex: '0 0 auto' }}>✕</button>
        </div>

        {/* ── Белки ─────────────────────────────────────────────────────────── */}
        <Section title="Белки" total={gram(protein)}>
          {protein > 0 ? (
            <>
              <Row
                label="Усвояемый белок"
                value={share != null ? gram(adv.qualityProtein) : '—'}
                sub={share != null
                  ? `${Math.round(share * 100)}% пойдёт на строительство тканей`
                  : 'по этому продукту сказать нечего'}
                tone={share != null && share < PROTEIN_QUALITY_LOW ? 'var(--warn)' : undefined}
              />
              {pq.diaas === 0 && (
                <Note>
                  В этом белке нет триптофана — на строительство тканей он не идёт совсем.
                  Так устроены коллаген и желатин: граммы на упаковке настоящие, пользы для мышц нет.
                </Note>
              )}
            </>
          ) : <Empty>Белка в этой порции нет.</Empty>}
        </Section>

        {/* ── Углеводы ──────────────────────────────────────────────────────── */}
        <Section title="Углеводы" total={gram(carbs)}>
          {carbs > 0 ? (
            <>
              <Row
                label="Сложные"
                value={`${adv.complexCarbConfidence !== 'measured' ? '≈' : ''}${gram(adv.complexCarb)}`}
                sub={adv.complexCarbConfidence === 'unknown'
                  ? 'состав неясен — к сложным не отнесены'
                  : `${Math.round((adv.complexCarb / carbs) * 100)}% углеводов порции`}
              />
              <Row
                label="Свободные сахара"
                value={`≈${gram(freeSugar)}`}
                sub={freeSugarShare(food.name) >= 0.8 ? 'почти всё — сахар' : freeSugarShare(food.name) === 0 ? 'сахара из цельного продукта, не свободные' : undefined}
                tone={freeSugar > carbs * 0.5 ? 'var(--warn)' : undefined}
              />
              <Row
                label="Клетчатка"
                value={`≈${gram(fiber)}`}
                sub={fiberRatioOf(food.name) >= 0.3 ? 'хороший источник' : undefined}
              />
            </>
          ) : <Empty>Углеводов в этой порции нет.</Empty>}
        </Section>

        {/* ── Жиры ──────────────────────────────────────────────────────────── */}
        <Section title="Жиры" total={gram(fat)}>
          {fat > 0 ? (
            <Row
              label="Насыщенные"
              value={adv.satFatConfidence === 'unknown' ? '—' : `${adv.satFatConfidence !== 'measured' ? '≈' : ''}${gram(adv.satFat)}`}
              sub={adv.satFatConfidence === 'measured' ? 'с этикетки'
                : adv.satFatConfidence === 'unknown' ? 'по этому продукту сказать нечего'
                  : `${Math.round((adv.satFat / fat) * 100)}% жиров порции`}
            />
          ) : <Empty>Жиров в этой порции нет.</Empty>}
        </Section>

        {/* ── Витамины, минералы и остальное ────────────────────────────────── */}
        {micro.confidence === 'unknown' ? (
          <div className="card" style={{ padding: 14, marginTop: 14, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Витамины и минералы</div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>
              {mass == null
                ? 'Не указан вес порции — посчитать содержание не от чего. Укажите граммы, и разбор появится.'
                : 'Этот продукт не удалось отнести ни к одной группе, поэтому его витамины и минералы не посчитаны. Лучше промолчать, чем показать выдуманные числа.'}
            </p>
          </div>
        ) : groups.length === 0 ? (
          <div className="card" style={{ padding: 14, marginTop: 14, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Витамины и минералы</div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>
              Заметного количества витаминов и минералов здесь нет — так бывает у сахара, масла и крепкого алкоголя.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <Section key={g.key} title={`${g.emoji} ${g.label}`}>
              {g.rows.map((r) => (
                <Row
                  key={r.def.key}
                  label={r.def.label}
                  value={formatMicro(r.value, r.def.unit)}
                  sub={r.target > 0 ? `${Math.round((r.value / r.target) * 100)}% дневной нормы` : undefined}
                  tone={r.target > 0 && r.value >= r.target ? 'var(--good)' : undefined}
                />
              ))}
            </Section>
          ))
        )}

        {/* ── Откуда числа ──────────────────────────────────────────────────── */}
        <p style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '18px 0 0' }}>
          Калории и Б/Ж/У — из карточки продукта.{' '}
          {micro.confidence === 'estimated' && 'Витамины и минералы — справочные значения для этого вида продукта. '}
          {micro.confidence === 'category' && 'Витамины и минералы — усреднённые по группе продуктов, точность ниже обычной. '}
          Знак «≈» стоит там, где значение оценено по типу продукта, а не взято с этикетки. Всё это
          показывает, сколько вещества было в съеденном, а не сколько усвоилось: это ориентир, а не
          медицинский показатель.
        </p>
      </div>
    </div>
  )
}

// ── Мелкие части ─────────────────────────────────────────────────────────────

function Section({ title, total, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="row between" style={{ marginBottom: 8, gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {total && <span className="tabular" style={{ fontSize: 14, fontWeight: 650, flex: '0 0 auto' }}>{total}</span>}
      </div>
      <div className="card" style={{ padding: '6px 14px', boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, sub, tone }) {
  return (
    <div className="row between" style={{ gap: 10, padding: '8px 0', alignItems: 'flex-start' }}>
      <span style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ fontSize: 13.5, display: 'block' }}>{label}</span>
        {sub && <span style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'block', marginTop: 1 }}>{sub}</span>}
      </span>
      <span className="tabular" style={{ fontSize: 13.5, fontWeight: 600, color: tone || 'var(--ink)', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )
}

const Empty = ({ children }) => (
  <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0', lineHeight: 1.45 }}>{children}</p>
)

const Note = ({ children }) => (
  <p style={{ fontSize: 12, color: 'var(--warn)', margin: '2px 0 10px', lineHeight: 1.45 }}>{children}</p>
)
