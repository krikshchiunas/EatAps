// ─────────────────────────────────────────────────────────────────────────────
// Список языков: Настройки → Оформление и шторка на первом экране анкеты.
//
// Названия языков — каждое на самом языке («Deutsch», «العربية»), а не в
// переводе на текущий: человек, случайно включивший незнакомый язык, должен
// найти свой, не умея прочитать ни одной подписи вокруг.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { LANGS, getLang, setLang, t } from '../lib/i18n.js'
import { useLang } from '../lib/useLang.js'

export default function LanguageList({ onPicked }) {
  const current = useLang()
  const [pending, setPending] = useState(null)
  const [failed, setFailed] = useState(false)

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

  return (
    <>
      {LANGS.map((l) => (
        <button
          key={l.code}
          className="set-row"
          lang={l.code}
          dir={l.dir || 'ltr'}
          onClick={() => pick(l.code)}
          disabled={!!pending}
        >
          <span>{l.name}</span>
          <span className="set-val">{pending === l.code ? '…' : current === l.code ? '✓' : ''}</span>
        </button>
      ))}
      {failed && <p className="set-note" style={{ color: 'var(--danger)' }}>{t('lang.loadFailed')}</p>}
    </>
  )
}
