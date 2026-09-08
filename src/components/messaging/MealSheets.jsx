// Карточка приёма пищи: подробный просмотр и выбор для отправки.
//
// Обе шторки живут вместе, потому что описывают одно и то же — приём пищи в
// переписке, — и правятся всегда парой: добавили поле в отправку, значит надо
// показать его и в просмотре.
import { useStore } from '../../store.jsx'
import { useSheetDrag } from '../../lib/useSheetDrag.js'
import { getMealSections, foodsForMeal } from '../../lib/meals.js'
import { mealCardFromGroup, normalizeMealCard } from '../../lib/mealCard.js'
import { dayLabel } from '../../lib/chatFormat.js'

// ── подробный просмотр карточки еды (тап по карточке в сообщении) ─────────────
export function MealCardSheet({ meal: raw, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)
  const meal = normalizeMealCard(raw)
  const items = meal.items || []
  const macros = [
    { key: 'protein', label: 'Белки', v: meal.protein },
    { key: 'fat', label: 'Жиры', v: meal.fat },
    { key: 'carbs', label: 'Углеводы', v: meal.carbs },
  ]
  const hasMacros = macros.some((m) => m.v != null)
  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 88 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />

        <div className="mealsheet-head">
          <span className="mealsheet-emoji">{meal.emoji || '🍽'}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mealsheet-title">{meal.label}</div>
            <div className="mealsheet-when">{meal.date ? dayLabel(meal.date + 'T12:00:00') : ''}</div>
          </div>
          <div className="mealsheet-kcal">
            <b>{meal.kcal}</b><span>ккал</span>
          </div>
        </div>

        {hasMacros && (
          <div className="mealsheet-macros">
            {macros.map((m) => (
              <div key={m.key} className="mealsheet-macro">
                <div className="mealsheet-macro-v">{m.v ?? 0}<span>г</span></div>
                <div className="mealsheet-macro-l">{m.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* У поднятых старых записей состав — это сам заголовок; секцию прячем. */}
        {!(items.length === 1 && items[0].name === meal.label) && (
        <>
        <div className="mealsheet-listlabel">Состав</div>
        <ul className="mealsheet-list">
          {items.map((it, i) => (
            <li key={i}>
              <span className="mealsheet-item-name">{it.emoji ? it.emoji + ' ' : ''}{it.name}</span>
              <span className="mealsheet-item-right">
                {it.grams ? <span className="mealsheet-item-g">{it.grams} {it.unit || 'г'}</span> : null}
                <span className="mealsheet-item-k">{it.kcal} ккал</span>
              </span>
            </li>
          ))}
        </ul>
        </>
        )}
      </div>
    </div>
  )
}

// ── выбор приёма пищи для отправки ────────────────────────────────────────────
// Показываем дни с записями (сегодня и назад), внутри — группы по типам приёма.
// Отправляем группу целиком: тогда в карточке осмыслен «список продуктов».
export function MealPickerSheet({ onClose, onPick }) {
  const { days } = useStore()
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose)

  // Дни с едой, свежие сверху, максимум неделя — дальше пролистывать неудобно.
  const dayKeys = Object.keys(days || {})
    .filter((k) => (days[k]?.meals || []).length > 0)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 7)

  // Секции берём из meals.js, а не группируем по legacy-полю type: иначе
  // пользовательские приёмы («Второй завтрак», «После тренировки») и «Без
  // категории» просто не появились бы в списке и их нельзя было бы отправить.
  const groupsOf = (key) => {
    const day = days[key]
    return getMealSections(day)
      .map((s) => ({ section: s, items: foodsForMeal(day, s.id) }))
      .filter((g) => g.items.length > 0)
  }

  const pick = (key, group) => {
    onPick(mealCardFromGroup({ section: group.section, date: key, meals: group.items }))
    close()
  }

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 85 }}>
      <div className="sheet" {...sheetProps} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 18 }}>Отправить приём пищи</h2>
          <button className="iconbtn" onClick={close} aria-label="Закрыть">✕</button>
        </div>

        {dayKeys.length === 0 ? (
          <p className="muted" style={{ fontSize: 14, padding: '10px 0 16px' }}>
            Пока нечего отправить — сначала запишите приём пищи в дневник.
          </p>
        ) : (
          <div className="mealpick-scroll">
            {dayKeys.map((key) => (
              <div key={key} className="mealpick-day">
                <div className="mealpick-daylabel">{dayLabel(key + 'T12:00:00')}</div>
                {groupsOf(key).map((g) => (
                  <button key={g.section.id} className="mealpick-row" onClick={() => pick(key, g)}>
                    <span className="mealpick-emoji">{g.section.emoji}</span>
                    <span className="mealpick-meta">
                      <span className="mealpick-name">{g.section.label}</span>
                      <span className="mealpick-sub">
                        {g.items.map((m) => m.name).join(', ')}
                      </span>
                    </span>
                    <span className="mealpick-kcal">
                      {Math.round(g.items.reduce((s, m) => s + (+m.kcal || 0), 0))}
                      <span className="mealpick-kcal-u"> ккал</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

