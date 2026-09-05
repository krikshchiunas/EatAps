// Отношение между двумя пользователями — ЧИСТАЯ часть.
//
// Без зависимостей и без импорта supabase.js: тот читает import.meta.env при
// импорте и падает под голым `node --test`. По той же причине отдельно живут
// pgErrors.js и friendView.js.
//
// Здесь описано, во что превращается ответ RPC get_relationship: набор булевых
// признаков → одно состояние, по которому экран рисует кнопки. Раньше состояний
// было три (друг / входящая / исходящая), и каждый экран раскладывал их сам.
//
// ОБНОВЛЕНИЕ 2026-08-26. Заявок в друзья больше нет. Дружба стала производной:
// подписаны друг на друга — значит друзья, отписался любой — дружба кончилась
// (миграция 2026-08-26_nickname_identity). Поэтому friend и mutualFollow здесь
// всегда совпадают, а полей про заявки не существует вовсе — не «всегда false»,
// а нет: мёртвое поле рано или поздно кто-нибудь начнёт проверять.

export const EMPTY_RELATIONSHIP = {
  following: false,
  followedBy: false,
  mutualFollow: false,
  friend: false,
  blocked: false,
  blockedBy: false,
  friendshipId: null,
}

// Строка из get_relationship (snake_case из Postgres) → форма для приложения.
export function toRelationship(row) {
  if (!row) return { ...EMPTY_RELATIONSHIP }
  const following = Boolean(row.following)
  const followedBy = Boolean(row.followed_by)
  // Дружбу считаем из подписок, а не из колонки friend, хотя сервер и отдаёт
  // их одинаковыми. Так клиент не может показать «вы друзья» там, где граф
  // говорит обратное, — даже если материализованная строка разойдётся с ним.
  const mutualFollow = following && followedBy
  return {
    following,
    followedBy,
    mutualFollow,
    friend: mutualFollow,
    blocked: Boolean(row.blocked),
    blockedBy: Boolean(row.blocked_by),
    friendshipId: row.friendship_id || null,
  }
}

// Что показывать на кнопке подписки — единственной кнопке связи, которая
// осталась. Она же управляет дружбой: подписка в ответ делает вас друзьями,
// отписка дружбу расторгает. Поэтому у взаимного состояния своя подпись —
// «Вы друзья», а не «Вы подписаны»: человек должен понимать, что именно
// он сейчас разорвёт.
export function followAction(rel) {
  if (rel.blocked) return { kind: 'unblock', label: 'Разблокировать', tone: 'danger' }
  if (rel.blockedBy) return null // человек нас заблокировал — кнопки нет вовсе
  if (rel.friend) return { kind: 'unfollow', label: 'Вы друзья', tone: 'quiet' }
  if (rel.following) return { kind: 'unfollow', label: 'Вы подписаны', tone: 'quiet' }
  if (rel.followedBy) return { kind: 'follow', label: 'Подписаться в ответ', tone: 'primary' }
  return { kind: 'follow', label: 'Подписаться', tone: 'primary' }
}

// Можно ли написать личное сообщение. Зеркало серверной политики messages, и
// оно обязано совпадать с ней буквально: переписка — привилегия дружбы, а
// дружба теперь означает взаимную подписку.
export function canMessage(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Видно ли дневник питания. Тот же круг, что и у переписки, — см. friend_state.
export function canViewDiary(rel) {
  return Boolean(rel.friend) && !rel.blocked && !rel.blockedBy
}

// Короткая подпись отношения под именем в списках. Отдельной строки про
// взаимную подписку здесь нет: это и есть дружба, и две подписи для одного
// состояния только путали бы.
export function relationshipLabel(rel) {
  if (rel.blocked) return 'Заблокирован'
  if (rel.friend) return 'Друг'
  if (rel.following) return 'Вы подписаны'
  if (rel.followedBy) return 'Подписан на вас'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// МАТРИЦА ДОСТУПА
//
// Записана здесь целиком, потому что до сих пор существовала только в головах
// и по кускам в четырёх SQL-функциях. Это ЗЕРКАЛО серверных правил, а не сами
// правила: единственная граница доступа — RLS и SECURITY DEFINER-функции в
// базе. Интерфейс спрашивает эту модель, чтобы честно объяснить человеку, что
// он видит и почему, — и никогда, чтобы что-то разрешить.
//
//   Ресурс              Я   Подписчик  Друг  Посторонний  Заблокирован
//   ───────────────────────────────────────────────────────────────────
//   Профиль, счётчики   ✓      ✓        ✓        ✓             ✗
//   Пост public         ✓      ✓        ✓        ✓             ✗
//   Пост followers      ✓      ✓        ✓        ✗             ✗
//   Пост friends        ✓      ✗        ✓        ✗             ✗
//   Пост private        ✓      ✗        ✗        ✗             ✗
//   Ответы и реакции    — по правам на сам пост —
//   Дневник питания     ✓      ✗        ✓        ✗             ✗
//   Личные сообщения    ✓      ✗        ✓        ✗             ✗
//   Список подписчиков  ✓      ✓        ✓        ✓             ✗
//
// «Подписчик» здесь — Я подписан на НЕГО (following), потому что вопрос всегда
// звучит «что вижу я». «Друг» — взаимная подписка. «Заблокирован» перекрывает
// всё остальное и работает в обе стороны: и когда блокировал я, и когда
// блокировали меня.
//
// Проверено тестами в relationship.test.js — по одной строке на клетку.

// Увижу ли я пост с такой видимостью у этого человека.
export function canViewPost(visibility, rel) {
  if (!rel) return false
  // Блокировка перекрывает всё, включая public. Тот же порядок проверок, что
  // в can_view_post на сервере: сначала блокировка, потом видимость.
  if (rel.blocked || rel.blockedBy) return false
  switch (visibility) {
    case 'public':    return true
    // Друг — тоже подписчик по определению (дружба = взаимная подписка),
    // поэтому отдельной ветки для него здесь не нужно.
    case 'followers': return Boolean(rel.following)
    case 'friends':   return Boolean(rel.friend)
    case 'private':   return false
    // Неизвестное значение трактуем как самое узкое: показать лишнее хуже,
    // чем не показать нужного.
    default:          return false
  }
}

// Уровни видимости поста — зеркало типа post_visibility в базе.
export const VISIBILITY = [
  { value: 'public',    label: 'Всем',          hint: 'Любой пользователь EatAps' },
  { value: 'followers', label: 'Подписчикам',   hint: 'Все, кто на вас подписан' },
  // «Принятые друзья» осталось от заявок, которых больше нет. Подпись обязана
  // называть нынешнее правило, иначе человек ищет в интерфейсе подтверждение
  // дружбы и не находит.
  { value: 'friends',   label: 'Только друзьям', hint: 'Те, с кем вы подписаны друг на друга' },
  { value: 'private',   label: 'Только мне',    hint: 'Никто, кроме вас' },
]

export const DEFAULT_VISIBILITY = 'followers'

export function visibilityLabel(value) {
  return VISIBILITY.find((v) => v.value === value)?.label || 'Подписчикам'
}
