// Отношение между двумя пользователями — ЧИСТАЯ часть и ЕДИНСТВЕННЫЙ способ
// приложения понять, кто кому кто.
//
// Без зависимостей и без импорта supabase.js: тот читает import.meta.env при
// импорте и падает под голым `node --test`. По той же причине отдельно живут
// pgErrors.js и friendView.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ЭТО ОДИН ФАЙЛ, А НЕ ПЯТНАДЦАТЬ IF В КОМПОНЕНТАХ
//
// Связей между двумя людьми теперь девять штук — подписка, обратная подписка,
// просьба в одну и в другую сторону, близкие друзья, блокировка в обе стороны,
// ограничение, заглушение, — и от их сочетания зависит и надпись на кнопке, и
// содержимое меню, и то, что вообще показывать на экране. Пока каждый экран
// раскладывал это сам, они успевали разойтись на первой же новой связи.
//
// Здесь ответ один: строка RPC get_relationship → СОСТОЯНИЕ (одно слово) →
// кнопка и меню. Экраны спрашивают состояние и не выводят его сами.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО СЧИТАЕТСЯ ЗДЕСЬ, А ЧТО ПРИХОДИТ С СЕРВЕРА
//
// Здесь считается ТОЛЬКО то, что является определением, а не правом:
// «взаимная подписка» = подписан и подписан в ответ.
//
// Права — право писать, право видеть дневник, право видеть содержимое
// закрытого аккаунта — НЕ вычисляются. Они приходят готовыми полями. Считать
// их заново значило бы завести второе определение доступа рядом с серверным, и
// оно бы разошлось: ровно так уже вышло с дружбой, у которой определений было
// два сразу.
//
// Интерфейс спрашивает эту модель, чтобы честно объяснить человеку, что он
// видит и почему, — и никогда, чтобы что-то РАЗРЕШИТЬ. Единственная граница
// доступа — RLS и SECURITY DEFINER-функции в базе.

export const EMPTY_RELATIONSHIP = {
  isSelf: false,
  // Закрытый ли аккаунт у того, на кого смотрим.
  targetIsPrivate: false,

  following: false,      // я подписан на него
  followedBy: false,     // он подписан на меня
  mutualFollow: false,   // подписаны друг на друга («Друзья» в интерфейсе)
  requestSent: false,    // я попросился к нему в подписчики
  requestReceived: false,// он попросился ко мне

  // Я добавил его в близкие друзья. Обратного признака здесь нет и не будет:
  // чужой список близких друзей не отдаёт ни одна функция сервера.
  isCloseFriend: false,

  blocked: false,        // я заблокировал его
  blockedBy: false,      // он заблокировал меня
  restricted: false,     // я ограничил его (он об этом не знает)
  mutedPosts: false,
  mutedMessages: false,
  hasDiaryAccess: false, // я поимённо открыл ему свой дневник

  // Права. Приходят с сервера; по умолчанию — самые узкие: пока ответа нет,
  // интерфейс не обещает того, чего не знает.
  canViewContent: false,
  canViewDiary: false,
  canSeeActivity: false,
  messagePermission: 'denied', // 'direct' | 'request' | 'denied'
  conversation: 'pending',     // 'accepted' | 'pending' | 'declined'
}

const bool = (v) => Boolean(v)

// Строка из get_relationship / relationships_with (snake_case из Postgres) →
// форма для приложения.
//
// Умеет читать и ответ СТАРОЙ базы (до 2026-09-09): там нет ни закрытых
// аккаунтов, ни просьб, а право писать приходило полем can_message. Это не
// вежливость к прошлому, а требование к порядку выкладки: фронтенд и SQL в
// этом проекте катятся независимо, и ни один из них не должен ломаться от
// того, что второй ещё не доехал.
export function toRelationship(row) {
  if (!row) return { ...EMPTY_RELATIONSHIP }

  const following = bool(row.following)
  const followedBy = bool(row.followed_by)
  // Считаем из подписок, а не из колонки mutual_follow, хотя сервер и отдаёт
  // их одинаковыми: так интерфейс не покажет «вы друзья» там, где граф
  // говорит обратное.
  const mutualFollow = following && followedBy
  const blocked = bool(row.blocked)
  const blockedBy = bool(row.blocked_by)

  // Старая база: право писать выражалось булевым can_message.
  const permission = row.message_permission
    || (row.can_message === undefined
      ? (mutualFollow && !blocked && !blockedBy ? 'direct' : 'denied')
      : (row.can_message ? (row.conversation === 'accepted' ? 'direct' : 'request') : 'denied'))

  return {
    isSelf: bool(row.is_self),
    targetIsPrivate: bool(row.target_is_private),

    following,
    followedBy,
    mutualFollow,
    requestSent: bool(row.request_sent),
    requestReceived: bool(row.request_received),
    isCloseFriend: bool(row.is_close_friend),

    blocked,
    blockedBy,
    restricted: bool(row.restricted),
    mutedPosts: bool(row.muted_posts),
    mutedMessages: bool(row.muted_messages),
    hasDiaryAccess: bool(row.has_diary_access),

    // На старой базе закрытых аккаунтов не бывает, поэтому «содержимое видно»
    // равно «нас не заблокировали».
    canViewContent: row.can_view_content === undefined
      ? !blocked && !blockedBy
      : bool(row.can_view_content),
    canViewDiary: row.can_view_diary === undefined
      ? mutualFollow && !blocked && !blockedBy
      : bool(row.can_view_diary),
    canSeeActivity: row.can_see_activity === undefined
      ? !blocked && !blockedBy
      : bool(row.can_see_activity),

    messagePermission: permission,
    conversation: row.conversation || (mutualFollow ? 'accepted' : 'pending'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// СОСТОЯНИЕ — одно слово вместо девяти флагов
//
// Порядок проверок здесь и есть приоритет связей, и он не случаен:
// блокировка сильнее просьбы, просьба сильнее подписки. Ровно в этом порядке
// человек и воспринимает ситуацию: «он меня заблокировал» отменяет вопрос
// «подписан ли я на него».
// ─────────────────────────────────────────────────────────────────────────────
export const STATE = {
  SELF: 'self',
  BLOCKED_BY_ME: 'blocked_by_me',
  BLOCKED_ME: 'blocked_me',
  REQUEST_SENT: 'request_sent',
  MUTUAL: 'mutual',
  FOLLOWING: 'following',
  FOLLOWED_BY: 'followed_by',
  NONE: 'none',
}

export function relationshipState(rel) {
  if (!rel) return STATE.NONE
  if (rel.isSelf) return STATE.SELF
  if (rel.blocked) return STATE.BLOCKED_BY_ME
  if (rel.blockedBy) return STATE.BLOCKED_ME
  if (rel.requestSent) return STATE.REQUEST_SENT
  if (rel.following && rel.followedBy) return STATE.MUTUAL
  if (rel.following) return STATE.FOLLOWING
  if (rel.followedBy) return STATE.FOLLOWED_BY
  return STATE.NONE
}

// Что нарисовать на главной кнопке связи.
//
// kind говорит, ЧТО произойдёт по нажатию, и вариантов ровно четыре:
//   follow         — подписаться (или попроситься, если аккаунт закрыт;
//                    решает сервер, а не кнопка);
//   cancelRequest  — отозвать свою просьбу;
//   menu           — открыть меню отношений. Именно меню, а не мгновенная
//                    отписка: подписка, на которую нажали случайно, не должна
//                    исчезать от одного касания, а в меню лежат заглушение,
//                    близкие друзья и ограничение, которых иначе негде взять;
//   unblock        — снять блокировку.
export function followAction(rel) {
  const state = relationshipState(rel)
  switch (state) {
    case STATE.SELF:          return null
    case STATE.BLOCKED_ME:    return null // он нас заблокировал — кнопки нет вовсе
    case STATE.BLOCKED_BY_ME: return { kind: 'unblock', label: 'Разблокировать', tone: 'danger' }
    case STATE.REQUEST_SENT:  return { kind: 'cancelRequest', label: 'Запрошено', tone: 'quiet' }
    case STATE.MUTUAL:        return { kind: 'menu', label: 'Вы друзья', tone: 'quiet' }
    case STATE.FOLLOWING:     return { kind: 'menu', label: 'Вы подписаны', tone: 'quiet' }
    case STATE.FOLLOWED_BY:   return { kind: 'follow', label: 'Подписаться в ответ', tone: 'primary' }
    default:                  return { kind: 'follow', label: 'Подписаться', tone: 'primary' }
  }
}

// Короткая подпись отношения под именем в списках.
export function relationshipLabel(rel) {
  if (!rel) return null
  if (rel.blocked) return 'Заблокирован'
  if (rel.requestSent) return 'Запрос отправлен'
  if (rel.requestReceived) return 'Просится в подписчики'
  if (rel.mutualFollow) return 'Взаимная подписка'
  if (rel.following) return 'Вы подписаны'
  if (rel.followedBy) return 'Подписан на вас'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// ПРАВА — только чтение серверного ответа
// ─────────────────────────────────────────────────────────────────────────────

// Можно ли вообще отправить сообщение (в чат или в «Запросы» — не важно).
export function canMessage(rel) {
  return Boolean(rel) && rel.messagePermission !== 'denied'
}

// Попадёт ли сообщение получателю в «Запросы», а не в чаты. Нужно, чтобы
// честно предупредить отправителя, а не молча удивить его тишиной в ответ.
export function messageGoesToRequests(rel) {
  if (!rel) return false
  if (rel.messagePermission === 'denied') return false
  return rel.messagePermission === 'request' && rel.conversation !== 'accepted'
}

// Видно ли содержимое профиля: записи, списки подписчиков и подписок.
// У открытого аккаунта — всем, у закрытого — только одобренным подписчикам.
export function canViewContent(rel) {
  return Boolean(rel?.canViewContent)
}

// Виден ли дневник питания. Круг задаёт владелец настройкой, и угадывать её
// здесь нечем — клиент чужих настроек не видит.
export function canViewDiary(rel) {
  return Boolean(rel?.canViewDiary)
}

// Заперт ли профиль замком: закрытый аккаунт, на который мы не подписаны.
export function isLocked(rel) {
  if (!rel || rel.isSelf) return false
  return Boolean(rel.targetIsPrivate) && !rel.canViewContent && !rel.blockedBy
}

// ─────────────────────────────────────────────────────────────────────────────
// МАТРИЦА ДОСТУПА
//
// ЗЕРКАЛО серверных правил, а не сами правила. Полная таблица с колонками
// «аноним / посторонний / подписчик / взаимно / близкий друг / ограниченный /
// заблокированный» живёт в docs/social-system.md; здесь — исполняемая её часть.
//
//   Ресурс                 Я  Подписчик  Взаимно  Близкий  Посторонний  Блок
//   ────────────────────────────────────────────────────────────────────────
//   Шапка профиля          ✓      ✓         ✓        ✓          ✓         ✗
//   Содержимое (открытый)  ✓      ✓         ✓        ✓          ✓         ✗
//   Содержимое (закрытый)  ✓      ✓         ✓        ✓          ✗         ✗
//   Пост public            ✓      ✓         ✓        ✓          ✓*        ✗
//   Пост followers         ✓      ✓         ✓        ✓*         ✗         ✗
//   Пост friends           ✓      ✗         ✓        ✓*         ✗         ✗
//   Пост close_friends     ✓      ✗         ✗        ✓          ✗         ✗
//   Пост private           ✓      ✗         ✗        ✗          ✗         ✗
//   Дневник                ✓   — по настройке владельца —                 ✗
//   Личные сообщения       ✓   — по правам на переписку —                 ✗
//
//   ✓* — при условии, что близкий друг ещё и подписчик: круги независимы.
//   Для закрытого аккаунта любая строка дополнительно требует одобренной
//   подписки — «Содержимое (закрытый)» перекрывает всё, что ниже.
//
// Проверено тестами в relationship.test.js — по одной проверке на клетку.

// Увижу ли я пост с такой видимостью у этого человека.
export function canViewPost(visibility, rel) {
  if (!rel) return false
  // Блокировка перекрывает всё, включая public. Тот же порядок проверок, что
  // в can_view_post на сервере: сначала блокировка, потом закрытость, потом
  // видимость самой записи.
  if (rel.blocked || rel.blockedBy) return false
  if (!rel.isSelf && rel.targetIsPrivate && !rel.canViewContent) return false
  switch (visibility) {
    case 'public':        return true
    // Взаимная подписка включает одностороннюю, поэтому отдельной ветки для
    // неё в 'followers' не нужно.
    case 'followers':     return Boolean(rel.following)
    case 'friends':       return Boolean(rel.mutualFollow)
    // Близкие друзья — отдельный круг, а не подмножество подписчиков: список
    // ведёт автор вручную и подписки не требует.
    case 'close_friends': return Boolean(rel.isCloseFriend)
    case 'private':       return false
    // Неизвестное значение трактуем как самое узкое: показать лишнее хуже,
    // чем не показать нужного.
    default:              return false
  }
}

// Уровни видимости записи — зеркало CHECK-ограничения posts_visibility_known.
export const VISIBILITY = [
  { value: 'public',        label: 'Всем',            hint: 'Любой пользователь EatAps' },
  { value: 'followers',     label: 'Подписчикам',     hint: 'Все, кто на вас подписан' },
  { value: 'friends',       label: 'Друзьям',         hint: 'Те, с кем вы подписаны друг на друга' },
  { value: 'close_friends', label: 'Близким друзьям', hint: 'Только ваш список близких друзей' },
  { value: 'private',       label: 'Только мне',      hint: 'Никто, кроме вас' },
]

export const DEFAULT_VISIBILITY = 'followers'

export function visibilityLabel(value) {
  return VISIBILITY.find((v) => v.value === value)?.label || 'Подписчикам'
}

// Права на переписку по категориям — зеркало profiles.msg_from_* и
// set_message_policy. Порядок значений от свободного к строгому.
export const MESSAGE_POLICY = [
  { value: 'direct',  label: 'Сразу в чаты',   hint: 'Сообщение приходит как обычное' },
  { value: 'request', label: 'В «Запросы»',     hint: 'Сначала вы решаете, отвечать ли' },
  { value: 'none',    label: 'Не принимать',    hint: 'Написать вам не смогут' },
]

export const MESSAGE_AUDIENCES = [
  { key: 'msg_from_following', label: 'На кого вы подписаны', hint: 'Люди, которых читаете вы' },
  { key: 'msg_from_followers', label: 'Ваши подписчики',      hint: 'Читают вас, но вы их — нет' },
  { key: 'msg_from_others',    label: 'Все остальные',        hint: 'Никак с вами не связаны' },
]

// Круг дневника — зеркало profiles_diary_visibility_known.
export const DIARY_AUDIENCES = [
  { key: 'public',        label: 'Всем',                 hint: 'Любой вошедший в приложение' },
  { key: 'followers',     label: 'Подписчикам',          hint: 'Все, кто на вас подписался' },
  { key: 'mutuals',       label: 'Взаимным подпискам',   hint: 'Только если вы подписаны друг на друга' },
  { key: 'close_friends', label: 'Близким друзьям',      hint: 'Только ваш список близких друзей' },
  { key: 'selected',      label: 'Выбранным людям',      hint: 'Поимённый список, который ведёте вы' },
  { key: 'private',       label: 'Никому',               hint: 'Дневник виден только вам' },
]

export const GROUP_INVITE_POLICY = [
  { value: 'everyone',  label: 'Кто угодно' },
  { value: 'following', label: 'Только те, на кого я подписан' },
  { value: 'none',      label: 'Никто' },
]
