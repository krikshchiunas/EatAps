// Кнопка связи. Единственное место, где решение «что нарисовать» берётся из
// relationship.js — сама она ничего не выводит из отдельных флагов.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧЕТЫРЕ ИСХОДА НАЖАТИЯ, И НИ ОДНОГО БОЛЬШЕ
//
//   follow         → сервер сам решает, подписка это или просьба. Клиент
//                    правила закрытого аккаунта НЕ ЗНАЕТ: знал бы — оно жило
//                    бы в двух местах и однажды разошлось;
//   cancelRequest  → отозвать свою просьбу;
//   menu           → открыть меню отношений. Не отписка: подписка, на которую
//                    нажали случайно, не должна исчезать от одного касания, а
//                    в меню лежит всё остальное — заглушение, близкие друзья,
//                    ограничение;
//   unblock        → снять блокировку.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОПТИМИСТИЧНОЕ ПЕРЕКЛЮЧЕНИЕ И ЕГО ГРАНИЦА
//
// Кнопка перекрашивается сразу: ждать ответа сервера, чтобы показать
// «Вы подписаны», значит показывать задержку там, где её быть не должно.
//
// Но у закрытого аккаунта угадать исход нельзя — «подписан» и «запрошено» это
// разные состояния. Поэтому предсказание строится по targetIsPrivate, а ОТВЕТ
// СЕРВЕРА его перезаписывает: если сервер сказал 'requested', а мы нарисовали
// «Вы подписаны», состояние поправится, не дожидаясь перезагрузки экрана.
//
// При ошибке — полный откат к состоянию до нажатия и текст ошибки под кнопкой.
import { useState } from 'react'
import { follow, cancelFollowRequest, unblock } from '../lib/social.js'
import { followAction } from '../lib/relationship.js'
import RelationshipSheet from './social/RelationshipSheet.jsx'

export default function FollowButton({
  userId, rel, onChange, onRefresh, size = 'normal',
  name = '', context = 'profile', onOpenChat = null,
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [menu, setMenu] = useState(false)

  const action = followAction(rel)
  if (!action) return null

  const run = async () => {
    if (busy) return
    if (action.kind === 'menu') { setMenu(true); return }

    setBusy(true)
    setErr(null)

    // Предсказание. У закрытого аккаунта подписка не создаётся — создаётся
    // просьба, и кнопка обязана сразу сказать именно это.
    const optimistic =
      action.kind === 'follow'
        ? (rel.targetIsPrivate
          ? { ...rel, requestSent: true }
          : { ...rel, following: true, mutualFollow: rel.followedBy, requestSent: false })
        : action.kind === 'cancelRequest' ? { ...rel, requestSent: false }
        : action.kind === 'unblock' ? { ...rel, blocked: false }
        : rel
    onChange?.(optimistic)

    const res =
      action.kind === 'follow'        ? await follow(userId) :
      action.kind === 'cancelRequest' ? await cancelFollowRequest(userId) :
                                        await unblock(userId)

    setBusy(false)
    if (res?.error) {
      setErr(res.error)
      onChange?.(rel) // откат
      return
    }

    // Сервер сказал, что получилось на самом деле. Если предсказание не
    // совпало (аккаунт закрыли или открыли между загрузкой экрана и нажатием),
    // поправляемся здесь, а не ждём перезагрузки.
    if (action.kind === 'follow') {
      if (res.ok === 'requested') onChange?.({ ...rel, requestSent: true, following: false })
      else if (res.ok === 'following') {
        onChange?.({ ...rel, following: true, mutualFollow: rel.followedBy, requestSent: false })
      }
    }
    if (action.kind === 'unblock') onRefresh?.()
  }

  const quiet = action.tone === 'quiet'
  const danger = action.tone === 'danger'

  return (
    // maxWidth обязателен. Кнопка живёт в строке списка рядом с именем, которое
    // растягивается на остаток (flex: 1). Текст ошибки под кнопкой ничем не был
    // ограничен, поэтому «Что-то пошло не так. Попробуйте ещё раз» растягивало
    // эту колонку на пол-экрана, а имя со ником сжимались до «ino…».
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch',
      gap: 4, flex: '0 0 auto', maxWidth: 170,
    }}>
      <button
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        aria-haspopup={action.kind === 'menu' ? 'menu' : undefined}
        className={`btn${quiet || danger ? ' ghost' : ''}`}
        style={{
          height: size === 'small' ? 32 : 40,
          padding: size === 'small' ? '0 14px' : '0 18px',
          fontSize: size === 'small' ? 13.5 : 15,
          whiteSpace: 'nowrap',
          ...(danger ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : null),
        }}
      >
        {busy ? '…' : action.label}
      </button>
      {err && (
        <span
          role="alert"
          style={{
            fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.3,
            whiteSpace: 'normal', wordBreak: 'break-word', textAlign: 'center',
          }}
        >
          {err}
        </span>
      )}

      {menu && (
        <RelationshipSheet
          userId={userId}
          name={name || 'этот человек'}
          rel={rel}
          context={context}
          onOpenChat={onOpenChat}
          onClose={() => setMenu(false)}
          onChanged={() => { setMenu(false); onRefresh?.() }}
        />
      )}
    </div>
  )
}
