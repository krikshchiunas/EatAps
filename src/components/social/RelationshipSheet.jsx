// Меню отношений с человеком — единственное место, где собраны ВСЕ действия
// над связью: заглушение, близкие друзья, доступ к дневнику, ограничение,
// отписка, удаление подписчика, блокировка, жалоба.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ОДНО МЕНЮ, А НЕ КНОПКИ НА ЭКРАНАХ
//
// Каждое из этих действий раньше жило (или должно было бы жить) там, где его
// удобнее было приткнуть: «Убрать подписчика» — в списке подписчиков,
// «Заглушить» — в списке чатов, «Заблокировать» — в шапке профиля. Человек в
// итоге не знал, где искать: чтобы перестать видеть чьи-то записи, он шёл
// отписываться, потому что «Заглушить» лежало в другом разделе.
//
// Здесь состав пунктов считается из ОДНОГО отношения (relationship.js), и
// поэтому меню одинаковое, откуда бы его ни открыли.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ НЕ ПОКАЗЫВАЕТСЯ И ПОЧЕМУ
//
// «Убрать из близких друзей» видно только владельцу списка — то есть всегда
// нам, потому что чужой список близких друзей сервер не отдаёт никому.
// «Ограничить» намеренно без предупреждения о последствиях для собеседника:
// ограниченный человек не должен ничего заметить, и текст вроде «он больше не
// увидит, что вы в сети» в интерфейсе НЕ появляется у него — только у нас.
import { useState, useRef } from 'react'
import ActionSheet, { ICONS } from './ActionSheet.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import ReportSheet from './ReportSheet.jsx'
import {
  follow, unfollow, cancelFollowRequest, removeFollower, block, unblock,
  setRestricted, setMute, setCloseFriend, setDiaryAccess,
} from '../../lib/social.js'

export default function RelationshipSheet({
  userId, name, rel, onClose, onChanged,
  // Контекст открытия: в списке СВОИХ подписчиков появляется «Убрать из
  // подписчиков», в остальных местах убирать нечего.
  context = 'profile',
  onOpenChat = null,
  onShare = null,
}) {
  const [confirm, setConfirm] = useState(null)
  const [report, setReport] = useState(false)
  const [err, setErr] = useState(null)

  // ЗАКРЫТИЕ ШТОРКИ НЕ ДОЛЖНО УНОСИТЬ ТО, ЧТО ОНА ОТКРЫЛА.
  //
  // useSheetDrag сообщает о закрытии не сразу, а ПОСЛЕ анимации выезда — через
  // 200–400 мс. За это время нажатие уже успело показать подтверждение или
  // форму жалобы, и запоздавший onClose размонтировал их вместе с этим
  // компонентом: диалог «Заблокировать?» мигал четверть секунды и исчезал, не
  // сделав ничего.
  //
  // Флаг «передали эстафету» гасит это опоздавшее закрытие. Дальше компонент
  // закрывает себя сам — когда решение принято или отменено.
  const handedOff = useRef(false)
  const handOff = (fn) => { handedOff.current = true; fn() }
  const closeSheet = () => { if (!handedOff.current) onClose() }

  // Единственный путь действия: ошибка остаётся на экране, успех закрывает
  // шторку. Разводить эти два исхода по вызывающим значило бы получить меню,
  // которое в одном случае закрывается, а в другом нет.
  const run = async (fn) => {
    setErr(null)
    const res = await fn()
    if (res?.error) { setErr(res.error); return }
    onChanged?.()
  }

  const items = []

  if (onOpenChat && rel.messagePermission !== 'denied') {
    items.push({ key: 'message', label: 'Написать', icon: ICONS.message, run: onOpenChat })
  }
  if (onShare) {
    items.push({ key: 'share', label: 'Поделиться профилем', icon: ICONS.share, run: onShare })
  }

  if (!rel.blocked && !rel.blockedBy) {
    items.push({
      key: 'mute',
      label: rel.mutedPosts ? 'Показывать записи' : 'Скрыть записи',
      hint: rel.mutedPosts ? null : 'Подписка останется, он ничего не узнает',
      icon: rel.mutedPosts ? ICONS.unmute : ICONS.mute,
      run: () => run(() => setMute(userId, { posts: !rel.mutedPosts, messages: rel.mutedMessages })),
    })
    items.push({
      key: 'mute-msg',
      label: rel.mutedMessages ? 'Включить уведомления о сообщениях' : 'Заглушить сообщения',
      hint: rel.mutedMessages ? null : 'Сообщения будут приходить без звонка',
      icon: rel.mutedMessages ? ICONS.unmute : ICONS.mute,
      run: () => run(() => setMute(userId, { posts: rel.mutedPosts, messages: !rel.mutedMessages })),
    })
    items.push({
      key: 'close',
      label: rel.isCloseFriend ? 'Убрать из близких друзей' : 'Добавить в близкие друзья',
      hint: rel.isCloseFriend ? null : 'Он этого не увидит',
      icon: ICONS.star,
      run: () => run(() => setCloseFriend(userId, !rel.isCloseFriend)),
    })
    items.push({
      key: 'diary',
      label: rel.hasDiaryAccess ? 'Закрыть дневник питания' : 'Открыть дневник питания',
      hint: rel.hasDiaryAccess ? null : 'Поимённый доступ, поверх общей настройки',
      icon: ICONS.diary,
      run: () => run(() => setDiaryAccess(userId, !rel.hasDiaryAccess)),
    })
    items.push({
      key: 'restrict',
      label: rel.restricted ? 'Снять ограничение' : 'Ограничить',
      hint: rel.restricted ? null : 'Его сообщения уйдут в «Запросы», он не узнает',
      icon: ICONS.restrict,
      run: () => run(() => setRestricted(userId, !rel.restricted)),
    })
  }

  if (rel.requestSent) {
    items.push({
      key: 'cancel',
      label: 'Отменить запрос',
      icon: ICONS.removeUser,
      run: () => run(() => cancelFollowRequest(userId)),
    })
  } else if (rel.following) {
    items.push({
      key: 'unfollow',
      label: 'Отписаться',
      icon: ICONS.unfollow,
      danger: true,
      // Спрашиваем подтверждение только у взаимной подписки: там отписка
      // разрывает связь в обе стороны по смыслу («вы больше не друзья»), и
      // случайное нажатие обходится дороже.
      run: () => (rel.mutualFollow
        ? handOff(() => setConfirm({
          text: `Отписаться от ${name}? Вы перестанете быть друзьями и видеть записи для друзей.`,
          yes: () => run(() => unfollow(userId)),
        }))
        : run(() => unfollow(userId))),
    })
  } else if (!rel.blocked && !rel.blockedBy) {
    items.push({
      key: 'follow',
      label: rel.followedBy ? 'Подписаться в ответ' : 'Подписаться',
      icon: ICONS.follow,
      run: () => run(() => follow(userId)),
    })
  }

  // «Убрать из подписчиков» — только там, где мы и правда смотрим СВОИХ
  // подписчиков. В чужом списке эта кнопка убирала бы не то, что человек
  // думает.
  if (context === 'followers' && rel.followedBy) {
    items.push({
      key: 'remove-follower',
      label: 'Убрать из подписчиков',
      hint: 'Он не получит уведомления',
      icon: ICONS.removeUser,
      run: () => handOff(() => setConfirm({
        text: `Убрать ${name} из подписчиков? Он перестанет видеть ваши записи для подписчиков и не получит уведомления. Подписаться снова он сможет${rel.targetIsPrivate ? '' : ' в любой момент'}.`,
        yes: () => run(() => removeFollower(userId)),
      })),
    })
  }

  items.push({
    key: 'block',
    label: rel.blocked ? 'Разблокировать' : 'Заблокировать',
    icon: ICONS.block,
    danger: true,
    run: () => (rel.blocked
      ? run(() => unblock(userId))
      : handOff(() => setConfirm({
        text: `Заблокировать ${name}? Подписки в обе стороны, запросы и общие списки будут удалены. Он не сможет вас найти, написать и увидеть ваши записи.`,
        yes: () => run(() => block(userId)),
      }))),
  })

  items.push({
    key: 'report',
    label: 'Пожаловаться',
    icon: ICONS.report,
    danger: true,
    run: () => handOff(() => setReport(true)),
  })

  // Подтверждение и жалоба живут ПОВЕРХ шторки, поэтому саму шторку в этот
  // момент не рисуем: две наложенные модалки на телефоне не помещаются, а
  // нижняя всё равно недоступна.
  if (confirm) {
    return (
      <ConfirmDialog
        text={confirm.text}
        yesLabel="Подтвердить"
        noLabel="Отмена"
        // Сначала действие, потом закрытие. Наоборот было ошибкой: onClose
        // размонтировал эту шторку, и отказ сервера (нет сети, сработал лимит
        // частоты) уходил в setErr уже размонтированного компонента — то есть
        // человек видел, как «Заблокировать» закрылось, и считал, что
        // получилось, хотя не получилось ничего.
        onYes={async () => {
          const y = confirm.yes
          setConfirm(null)
          // Действие ДО закрытия: onChanged закроет меню сам при успехе, а
          // при отказе сервера ошибка останется на экране. Закрыв заранее, мы
          // потеряли бы её вместе с компонентом.
          await y()
          handedOff.current = false
        }}
        onNo={() => { setConfirm(null); onClose() }}
      />
    )
  }

  if (report) {
    return (
      <ReportSheet
        kind="user"
        targetId={userId}
        name={name}
        onClose={() => { setReport(false); onClose() }}
      />
    )
  }

  return (
    <>
      <ActionSheet
        title={name}
        subtitle={err || undefined}
        items={items}
        onClose={closeSheet}
      />
    </>
  )
}
