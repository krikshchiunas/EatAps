// ─────────────────────────────────────────────────────────────────────────────
// Список языков: Настройки → Язык и шторка на первом экране анкеты.
//
// Главная строка — название языка на нём самом («Deutsch», «العربية»): человек,
// случайно включивший незнакомый язык, должен найти свой, не умея прочитать ни
// одной подписи вокруг. Вторая строка — то же название на текущем языке
// («Deutsch — Немецкий»), чтобы понятно было и тому, кто язык не знает.
//
// Доступность: role="listbox" с одним выбранным вариантом. Стрелки вверх/вниз
// (и Home/End) двигают фокус, Enter/пробел выбирает. Выбор применяется сразу:
// интерфейс, lang/dir страницы, форматы чисел и дат меняются без перезагрузки,
// состояние экрана и введённое в формы не теряются.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react'
import { LANGS, getLang, setLang, locale, t } from '../lib/i18n.js'
import { useLang } from '../lib/useLang.js'

// Название языка на текущем языке интерфейса (Intl.DisplayNames). Нет API —
// нет второй строки, без ошибок.
function localNames(current) {
  try {
    const dn = new Intl.DisplayNames([locale()], { type: 'language' })
    return (code) => (code === current ? '' : dn.of(code === 'pt' ? 'pt-BR' : code) || '')
  } catch {
    return () => ''
  }
}

export default function LanguageList({ onPicked }) {
  const current = useLang()
  const [pending, setPending] = useState(null)
  const [failed, setFailed] = useState(false)
  const [focus, setFocus] = useState(() => Math.max(0, LANGS.findIndex((l) => l.code === current)))
  const refs = useRef([])
  const localName = useMemo(() => localNames(current), [current])

  const pick = async (code) => {
    if (pending) return
    if (code === getLang()) { onPicked?.(code); return }
    setPending(code)
    setFailed(false)
    const ok = await setLang(code)
    setPending(null)
    if (ok) onPicked?.(code)
    else setFailed(true)
  }

  const move = (i) => {
    const next = (i + LANGS.length) % LANGS.length
    setFocus(next)
    refs.current[next]?.focus()
  }

  const onKeyDown = (e, i) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(LANGS.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(LANGS[i].code) }
  }

  return (
    <>
      <div role="listbox" aria-label={t('lang.title')} aria-busy={pending ? true : undefined}>
        {LANGS.map((l, i) => {
          const selected = current === l.code
          const sub = localName(l.code)
          return (
            <div
              key={l.code}
              ref={(el) => { refs.current[i] = el }}
              role="option"
              aria-selected={selected}
              aria-disabled={pending ? true : undefined}
              tabIndex={i === focus ? 0 : -1}
              className={`set-row lang-row${selected ? ' on' : ''}`}
              data-lang={l.code}
              onClick={() => { setFocus(i); pick(l.code) }}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="lang-row__names">
                <span lang={l.code} dir={l.dir || 'ltr'} className="lang-row__native">{l.name}</span>
                {sub && <span className="lang-row__local">{sub}</span>}
              </span>
              <span className="set-val lang-row__mark" aria-hidden="true">
                {pending === l.code ? '…' : selected ? '✓' : ''}
              </span>
            </div>
          )
        })}
      </div>
      {failed && <p className="set-note" role="alert" style={{ color: 'var(--danger)' }}>{t('lang.loadFailed')}</p>}
    </>
  )
}
