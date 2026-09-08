// Экран одного «моего» списка: близкие друзья, заблокированные, ограниченные,
// заглушённые, поимённый доступ к дневнику.
//
// Один компонент на пять списков — потому что это буквально один и тот же
// список с разной подписью и разной кнопкой в строке. Пять отдельных экранов
// разошлись бы в мелочах ровно так, как раньше разошлись пять копий строки
// человека в вёрстке.
//
// Добавление в список идёт ЧЕРЕЗ ПОИСК, а не через «выберите из подписчиков»:
// в близкие друзья можно добавить кого угодно, подписка для этого не нужна, и
// подсовывать подписчиков значило бы намекать на несуществующее правило.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import {
  listRelation, setCloseFriend, setRestricted, setMute, unblock, setDiaryAccess,
} from '../../lib/social.js'
import PeopleList from '../PeopleList.jsx'
import UserSearch from '../UserSearch.jsx'
import PushScreen from '../PushScreen.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'

export const RELATION_SCREENS = {
  close_friends: {
    title: 'Близкие друзья',
    note: 'Односторонний список. Люди из него видят ваши записи «для близких друзей». Они об этом не узнают — уведомления о добавлении и удалении нет.',
    empty: 'Список пуст. Добавьте тех, с кем делитесь самым личным.',
    action: 'Убрать',
    canAdd: true,
    addLabel: 'Добавить в близкие друзья',
    set: (id, on) => setCloseFriend(id, on),
  },
  blocked: {
    title: 'Заблокированные',
    note: 'Заблокированный не видит ваш профиль и записи, не может подписаться и написать. Вы тоже не видите его.',
    empty: 'Вы никого не заблокировали.',
    action: 'Разблокировать',
    canAdd: false,
    set: (id, on) => (on ? Promise.resolve({ error: 'Блокировать можно из профиля' }) : unblock(id)),
  },
  restricted: {
    title: 'Ограниченные',
    note: 'Ограниченный человек ничего не узнаёт. Его сообщения попадают в «Запросы», а ваше присутствие и прочтение от него скрыты. Подписки и доступ к записям при этом не меняются.',
    empty: 'Вы никого не ограничили.',
    action: 'Снять',
    canAdd: true,
    addLabel: 'Ограничить человека',
    set: (id, on) => setRestricted(id, on),
  },
  muted: {
    title: 'Заглушённые',
    note: 'Заглушение видите только вы. Подписка остаётся, сообщения доходят — меняется лишь то, что показывают вам.',
    empty: 'Вы никого не заглушили.',
    action: 'Вернуть',
    canAdd: true,
    addLabel: 'Заглушить человека',
    set: (id, on) => setMute(id, { posts: on, messages: false }),
  },
  diary_access: {
    title: 'Доступ к дневнику',
    note: 'Поимённый доступ работает поверх общей настройки: эти люди видят дневник, даже если круг задан уже.',
    empty: 'Никому не открыт поимённый доступ.',
    action: 'Закрыть',
    canAdd: true,
    addLabel: 'Открыть дневник человеку',
    set: (id, on) => setDiaryAccess(id, on),
  },
}

export default function RelationListScreen({ kind, onClose, onOpenProfile }) {
  const cfg = RELATION_SCREENS[kind]
  const { user } = useStore()
  const myId = user?.id || ''

  const [people, setPeople] = useState(null)
  const [err, setErr] = useState(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    try { setPeople(await listRelation(kind)) }
    catch (e) { setErr(e.message || 'Не удалось загрузить список'); setPeople([]) }
  }, [kind])

  useEffect(() => { load() }, [load])

  const remove = async (person) => {
    const prev = people
    setPeople((list) => (list || []).filter((p) => p.user_id !== person.user_id))
    const res = await cfg.set(person.user_id, false)
    if (res?.error) { setErr(res.error); setPeople(prev) }
  }

  const add = async (userId) => {
    setAdding(false)
    const res = await cfg.set(userId, true)
    if (res?.error) { setErr(res.error); return }
    load()
  }

  if (!cfg) return null

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>{cfg.title}</h1>
          </div>

          <p className="set-note" style={{ margin: '0 4px 16px' }}>{cfg.note}</p>

          {cfg.canAdd && (
            <button className="btn soft" style={{ marginBottom: 16 }} onClick={() => setAdding(true)}>
              {cfg.addLabel}
            </button>
          )}

          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

          <PeopleList
            people={people || []}
            loading={people === null}
            myId={myId}
            onOpen={onOpenProfile}
            empty={cfg.empty}
            searchable
            /* Кнопка подписки в этих списках только мешает: человек пришёл
               управлять конкретным списком, а не подписками. */
            showFollow={false}
            actions={(p) => (
              <button
                className="btn ghost"
                style={{ width: 'auto', height: 32, padding: '0 12px', fontSize: 13, flex: '0 0 auto' }}
                onClick={() => setConfirm({ person: p, text: confirmTextFor(kind, p) })}
              >
                {cfg.action}
              </button>
            )}
          />

          {adding && (
            <PushScreen onClose={() => setAdding(false)}>
              {(closeAdd) => (
                <div className="screen">
                  <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
                    <button className="iconbtn" onClick={closeAdd} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
                    <h1 className="h1" style={{ margin: 0, fontSize: 22 }}>{cfg.addLabel}</h1>
                  </div>
                  <UserSearch onOpenProfile={(id) => { closeAdd(); add(id) }} />
                </div>
              )}
            </PushScreen>
          )}

          {confirm && (
            <ConfirmDialog
              text={confirm.text}
              yesLabel={cfg.action}
              noLabel="Отмена"
              onYes={() => { const p = confirm.person; setConfirm(null); remove(p) }}
              onNo={() => setConfirm(null)}
            />
          )}
        </div>
      )}
    </PushScreen>
  )
}

function confirmTextFor(kind, p) {
  const name = p.display_name || p.username || 'этого человека'
  switch (kind) {
    case 'close_friends': return `Убрать ${name} из близких друзей? Он перестанет видеть записи для близких друзей и не узнает об этом.`
    case 'blocked':       return `Разблокировать ${name}? Подписки не восстановятся — подписаться заново придётся вручную.`
    case 'restricted':    return `Снять ограничение с ${name}? Его сообщения снова будут приходить в чаты.`
    case 'muted':         return `Показывать записи ${name} снова?`
    case 'diary_access':  return `Закрыть ${name} доступ к дневнику питания?`
    default:              return 'Продолжить?'
  }
}
