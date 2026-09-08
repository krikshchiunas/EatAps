// Нижняя шторка со списком действий — одна на всё приложение.
//
// Раньше такой список существовал в двух видах: выпадающее меню у карточки
// друга (.friend-menu) и контекстное меню сообщения (.ctx-sheet). Оба
// показывают одно и то же — «что можно сделать с этим объектом», — но
// выглядели и вели себя по-разному, и каждое новое меню приходилось выбирать
// между ними. Теперь выбор один.
//
// Иконки — обводкой, той же толщины, что и везде: путь SVG передаётся строкой
// и режется по ' M', чтобы описывать несколько линий одной константой.
import { useSheetDrag } from '../../lib/useSheetDrag.js'

export function SheetIcon({ d }) {
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  )
}

// Набор путей, из которых собраны все меню социальной части. Держим их рядом:
// иначе одна и та же иконка рисуется в трёх файлах тремя разными кривыми.
export const ICONS = {
  mute:        'M11 5 6 9H2v6h4l5 4V5z M23 9l-6 6 M17 9l6 6',
  unmute:      'M11 5 6 9H2v6h4l5 4V5z M16 8.5a5 5 0 0 1 0 7 M19 5.5a9 9 0 0 1 0 13',
  star:        'M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z',
  restrict:    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8 12h8',
  unfollow:    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 11h-6',
  follow:      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6',
  removeUser:  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 8l5 5 M22 8l-5 5',
  block:       'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5.6 5.6l12.8 12.8',
  report:      'M4 21V4h11l-.8 3.4H20l-1.2 5.2H8.2L7.4 21z',
  share:       'M12 16V4 M8 8l4-4 4 4 M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4',
  diary:       'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17h14',
  message:     'M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.4-5A8 8 0 1 1 21 12z',
  archive:     'M3 7h18v3H3z M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9 M10 14h4',
  trash:       'M4 7h16 M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
  reply:       'M9 15l-5-5 5-5 M4 10h9a7 7 0 0 1 7 7v3',
  forward:     'M15 15l5-5-5-5 M20 10h-9a7 7 0 0 0-7 7v3',
  copy:        'M9 9h10v12H9z M5 15V3h10',
  unsend:      'M4 7h16 M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
  hide:        'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M3 3l18 18',
  people:      'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5 M16 5.5a3.5 3.5 0 0 1 0 7 M18 15c2.6.5 4 2.3 4 5',
  exit:        'M14 20H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8 M18 15l3-3-3-3 M21 12H10',
  edit:        'M4 20h4L20 8l-4-4L4 16z',
  info:        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.5',
  search:      'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  image:       'M4 5h16v14H4z M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3 M5 17l5-5 4 4 2-2 3 3',
}

// items: [{ key, label, icon, danger, hint, disabled, run }]
// Разделители не рисуем: опасные пункты и так отделены цветом и отступом.
export default function ActionSheet({ title, subtitle, items, onClose }) {
  const { sheetProps, backdropProps, close } = useSheetDrag(onClose, { openMs: 220 })
  const visible = (items || []).filter(Boolean)

  return (
    <div className="sheet-backdrop" {...backdropProps} onClick={close} style={{ zIndex: 80 }}>
      <div
        className="sheet ctx-sheet"
        {...sheetProps}
        onClick={(e) => e.stopPropagation()}
        role="menu"
        aria-label={title || 'Действия'}
      >
        <div className="grabber" />
        {title && (
          <div className="ctx-preview" style={{ borderLeftColor: 'var(--accent)' }}>
            <div style={{ fontWeight: 640, color: 'var(--ink)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, marginTop: 2 }}>{subtitle}</div>}
          </div>
        )}
        {visible.map((a, i) => (
          <button
            key={a.key}
            role="menuitem"
            className={`ctx-item${a.danger ? ' danger' : ''}`}
            style={{ '--i': i, ...(a.danger ? { color: 'var(--danger)' } : null) }}
            disabled={a.disabled}
            onClick={() => { close(); a.run?.() }}
          >
            <SheetIcon d={a.icon} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block' }}>{a.label}</span>
              {a.hint && (
                <span className="muted" style={{ fontSize: 12.5, display: 'block', marginTop: 1, lineHeight: 1.35 }}>
                  {a.hint}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
