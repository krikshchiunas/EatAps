import { signedUrl } from './storageUrl.js'
import { createClient } from '@supabase/supabase-js'
import { pickSyncable } from './syncModel.js'
import { projectFriendState } from './friendView.js'
import { normalizeError } from './authErrors.js'
import { isMissingColumn } from './pgErrors.js'
import { log } from './log.js'
import { newId } from './uuid.js'
import { DEFAULT_VISIBILITY } from './relationship.js'
import { createRealtimeHub } from './realtime.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(url && anon)

// Хранилище сессии. Оборачиваем localStorage, потому что в приватном режиме
// iOS Safari и при запрете сторонних данных setItem бросает исключение — без
// обёртки это падение уходит внутрь supabase-js и ломает восстановление
// сессии. Ключи те же самые, поэтому уже существующие сессии продолжают
// читаться; при недоступном localStorage деградируем до памяти (сессия живёт
// до закрытия вкладки, но приложение работает).
const memoryStore = new Map()
const safeStorage = {
  getItem(key) {
    try {
      const v = localStorage.getItem(key)
      if (v !== null) return v
    } catch {}
    return memoryStore.has(key) ? memoryStore.get(key) : null
  },
  setItem(key, value) {
    memoryStore.set(key, value)
    try { localStorage.setItem(key, value) } catch {}
  },
  removeItem(key) {
    memoryStore.delete(key)
    try { localStorage.removeItem(key) } catch {}
  },
}

// Единственный клиент на всё приложение. Модуль импортируется отовсюду, но
// createClient вызывается ровно один раз — второй клиент означал бы два
// независимых auto-refresh-таймера на одну сессию, которые перебивают токены
// друг друга.
//
// storageKey НЕ переопределяем намеренно: смена ключа разлогинила бы всех
// существующих пользователей. Блокировку многовкладочного refresh (navigator
// .locks) supabase-js включает сам, когда API доступен, — это то, что нужно:
// обновляет токен одна вкладка, остальные подхватывают результат.
export const supabase = supabaseEnabled
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: safeStorage,
      },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-client-info': 'eataps-web' } },
    })
  : null

// Единый реестр realtime-каналов. Все подписки приложения идут через него —
// см. realtime.js: supabase-js на одну тему отдаёт один и тот же канал и
// БРОСАЕТ при повторном .on('postgres_changes'), поэтому два компонента на
// одной теме роняли приложение.
export const realtime = createRealtimeHub(supabase)

export { pickSyncable }

// ---------------- Состояние приложения (app_state) ----------------
// Читаем строку состояния. revision — версия, на которой основаны все
// последующие правки; её обязательно передавать обратно в saveAppState.
// null означает «строки ещё нет» (новый аккаунт).
export async function pullState(userId) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('app_state')
    .select('state, updated_at, revision')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { state: data.state, updatedAt: data.updated_at, revision: Number(data.revision) || 0 }
}

// Запись состояния через compare-and-swap. Прямой upsert в таблицу закрыт на
// уровне прав (см. migrations/2026-08-06_account_sync.sql) — это единственный
// путь записи, поэтому «слепая» перезапись чужих правок невозможна в принципе.
//
// Возвращает { revision, updatedAt, state, conflict }. conflict = true значит:
// с момента чтения кто-то (другое устройство, другая вкладка) уже записал.
// Ничего не перезаписано; в state лежит актуальная серверная версия — слить и
// повторить должен вызывающий.
export async function saveAppState(state, baseRevision) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('save_app_state', {
    p_state: pickSyncable(state),
    p_base_revision: baseRevision > 0 ? baseRevision : null,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('save_app_state returned no row')
  return {
    revision: Number(row.out_revision) || 0,
    updatedAt: row.out_updated_at || null,
    state: row.out_state || null,
    conflict: Boolean(row.out_conflict),
  }
}

// Realtime на СВОЮ строку состояния: правка с другого устройства приезжает
// сюда. Канал именован по user id без Date.now() — имя стабильное, поэтому
// повторная подписка не плодит дубликаты, а StrictMode/Fast Refresh не
// оставляют висящих каналов.
export function subscribeToAppState(userId, onChange) {
  if (!supabase || !userId) return () => {}
  // Сбой при создании канала (заблокированный websocket, не включённый
  // Realtime, экзотическая сеть) не должен ронять запуск приложения:
  // синхронизация без Realtime работает — правки просто приезжают при
  // следующей сверке, а не мгновенно. Обработку сбоя взял на себя хаб.
  return realtime.subscribe(
    `app_state:${userId}`,
    (channel, emit) => channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'app_state', filter: `user_id=eq.${userId}` },
      emit,
    ),
    (payload) => {
      const row = payload.new
      if (!row || row.user_id !== userId) return
      onChange({
        revision: Number(row.revision) || 0,
        updatedAt: row.updated_at || null,
        // Крупные состояния realtime обрезает (лимит размера записи). Тогда
        // state приедет пустым — подписчик обязан дочитать строку сам.
        state: payload.errors?.length ? null : (row.state ?? null),
      })
    },
  )
}

// ---------------- Подписки Stripe ----------------
// Читаем строку подписки текущего пользователя. RLS пускает только к своей.
export async function pullSubscription(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return data || null
}

// Промокоды: действующие выдачи и гашение кода.
//
// Таблица самих кодов закрыта политикой целиком — читать её клиенту нельзя,
// иначе список действующих кодов выгружался бы одним запросом. Проверка и
// гашение идут через RPC redeem_promo, который работает от имени сервера.
export async function pullPromoGrants(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('promo_grants')
    .select('code, tier, granted_until')
    .eq('user_id', userId)
    .gt('granted_until', new Date().toISOString())
  if (error) return []
  return data || []
}

// Возвращает { ok, tier, until } или { ok: false, error }.
// Причина отказа — часть нормального сценария, поэтому приходит значением.
export async function redeemPromo(code) {
  if (!supabase) return { ok: false, error: 'offline' }
  const { data, error } = await supabase.rpc('redeem_promo', { p_code: String(code || '') })
  if (error) return { ok: false, error: 'failed' }
  return data || { ok: false, error: 'failed' }
}

// Расход токенов AI за текущий период. Читается при открытии вкладки AI —
// иначе остаток появлялся бы только после первого сообщения, и человек с
// исчерпанным лимитом узнавал бы об этом, уже написав вопрос.
export async function pullAiUsage(userId, period) {
  if (!supabase || !userId) return 0
  const { data, error } = await supabase
    .from('ai_usage')
    .select('spent_micro')
    .eq('user_id', userId)
    .eq('period', period)
    .maybeSingle()
  if (error) return 0
  return Number(data?.spent_micro || 0)
}

// Realtime-подписка на изменения нашей строки — фронт мгновенно узнаёт, когда
// вебхук записал новый статус после оплаты/отмены.
export function subscribeToSubscription(userId, onChange) {
  if (!supabase || !userId) return () => {}
  return realtime.subscribe(
    `sub:${userId}`,
    (channel, emit) => channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` },
      emit,
    ),
    (payload) => onChange(payload.new || null),
  )
}

// ---------------- Друзья ----------------
// Друг — это взаимная подписка, и ничего больше. Заявок, подтверждений и
// «публичного ID для добавления» больше нет: чтобы подружиться, оба человека
// нажимают «Подписаться» на профиле друг друга (см. миграцию
// 2026-08-26_nickname_identity). Поэтому здесь остались только чтение списка и
// поиск карточки — сама связь создаётся через follow/unfollow в social.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Список взаимных подписок переехал в social.js (listMutuals): он про
// социальный граф, а не про соединение, и жить ему рядом с подписками, а не
// рядом с синхронизацией состояния.

// friend_briefs здесь больше не вызывается.
//
// Она читала имя и аватар ИЗ ЧУЖОГО app_state — то есть ради двух публичных
// полей заглядывала в самый чувствительный объект приложения, — и отдавала их
// только друзьям. С тех пор как имя и аватар стали публичной витриной
// (profiles.display_name/avatar_url, миграция 2026-08-25), это лишний путь к
// тем же данным: user_cards отдаёт их по обычным правилам видимости и работает
// для любого человека, а не только для друга.
//
// Сама функция в базе остаётся: на неё может опираться ещё не обновлённый
// клиент. Здесь просто нет второй реализации одного и того же.

// acceptFriend и removeFriendship удалены вместе с заявками: строку в
// friendships теперь создаёт и удаляет только сервер, по подпискам. «Удалить
// из друзей» — это unfollow из social.js.

// Прочитать состояние друга — только видимую часть (профиль без телесных
// показателей, дни, составные блюда). Отдаёт RPC friend_state, авторизация —
// проверка принятой дружбы внутри неё. projectFriendState — второй слой:
// лишнее не попадёт в приложение, даже если функция вернёт больше.
export async function pullFriendState(friendId) {
  if (!supabase || !friendId) return null

  const { data, error } = await supabase.rpc('friend_state', { p_user_id: friendId })
  if (!error) {
    if (!data) return null // нет строки либо дружба не принята
    return { state: projectFriendState(data), updatedAt: null }
  }

  // Миграция friend_privacy ещё не прогнана — читаем по старой политике,
  // но наружу всё равно отдаём только разрешённые поля.
  const legacy = await pullState(friendId)
  return legacy ? { ...legacy, state: projectFriendState(legacy.state) } : null
}

// Быстрый лукап имени и аватара по id — используется при пуше о новом
// сообщении. Идёт через ту же публичную карточку, что и все списки людей.
export async function fetchUserBrief(userId) {
  if (!supabase || !userId) return null
  try {
    const { data, error } = await supabase.rpc('user_cards', { p_user_ids: [userId] })
    if (error) return null
    const row = (data || [])[0]
    return row ? { name: row.display_name || row.username || null, avatar: row.avatar_url || null } : null
  } catch {
    // Имя в пуше — украшение. Без него уведомление всё равно придёт («Новое
    // сообщение»), и ронять обработчик входящего из-за этого нельзя.
    return null
  }
}

// ---------------- Мысли (posts) ----------------
// Отдельная таблица, а не app_state: см. migrations/2026-08-11_profile_and_thoughts.sql.
// Все чтения идут через RPC, потому что наружу отдаются только счётчики
// реакций — поимённый список отреагировавших не должен покидать сервер.

// Признак «миграция ещё не прогнана»: функции/таблицы нет. Тогда раздел просто
// недоступен — это не ошибка приложения и не повод показывать красный текст.
function isMissingRelation(error) {
  const code = error?.code
  return code === '42883' || code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
}

// Лента мыслей одного человека. Возвращает { posts, unavailable }.
export async function listPosts(userId, { limit = 20, before = null } = {}) {
  if (!supabase || !userId) return { posts: [] }
  const { data, error } = await supabase.rpc('list_posts', {
    p_user_id: userId,
    p_limit: limit,
    p_before: before,
  })
  if (error) {
    if (isMissingRelation(error)) return { posts: [], unavailable: true }
    throw error
  }
  return { posts: data || [] }
}

export async function createPost({ userId, text, imageUrl, visibility = DEFAULT_VISIBILITY }) {
  if (!supabase) return { error: 'Нет подключения' }
  const payload = {
    user_id: userId,
    text: text?.trim() ? text.trim() : null,
    image_url: imageUrl || null,
    visibility,
  }
  if (!payload.text && !payload.image_url) return { error: 'Пустая мысль' }
  let { data, error } = await supabase.from('posts').insert(payload).select('*').single()
  // Фронтенд задеплоен раньше миграции социального графа: колонки visibility
  // ещё нет. Публикация не должна из-за этого падать — повторяем без неё, и
  // пост уходит с прежней видимостью «только друзьям».
  if (error && isMissingColumn(error)) {
    delete payload.visibility
    ;({ data, error } = await supabase.from('posts').insert(payload).select('*').single())
  }
  if (error) { log.error('createPost', 'отказ сервера', error); return { error: normalizeError(error).message } }
  return { ok: { ...data, carrots: 0, broccoli: 0, my_reaction: null, comments_count: 0 } }
}

export async function updatePost(postId, { text, imageUrl }) {
  if (!supabase) return { error: 'Нет подключения' }
  const payload = {
    text: text?.trim() ? text.trim() : null,
    image_url: imageUrl || null,
  }
  if (!payload.text && !payload.image_url) return { error: 'Пустая мысль' }
  const { data, error } = await supabase.from('posts').update(payload).eq('id', postId).select('*').single()
  if (error) { log.error('updatePost', 'отказ сервера', error); return { error: normalizeError(error).message } }
  return { ok: data }
}

export async function deletePost(postId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  if (error) log.error('deletePost', 'отказ сервера', error)
  return error ? { error: normalizeError(error).message } : { ok: true }
}

// Реакция переключается на сервере по auth.uid() — ровно как в чате. Клиент
// не сообщает, кто он и что сейчас стоит: он просит «переключить на 🥕/🥦»,
// остальное решает состояние строки.
export async function togglePostReaction(postId, reaction) {
  if (!supabase) return { error: 'Нет подключения' }
  const { data, error } = await supabase.rpc('toggle_post_reaction', {
    p_post_id: postId,
    p_reaction: reaction,
  })
  if (error) { log.error('togglePostReaction', 'отказ сервера', error); return { error: normalizeError(error).message } }
  const row = Array.isArray(data) ? data[0] : data
  return { ok: row || null }
}

// Ветка ответов. Сервер отдаёт СНАЧАЛА НОВЫЕ (так работает курсор), а читают
// ветку сверху вниз — поэтому страницу переворачиваем здесь, в одном месте,
// а не в каждом компоненте.
//
// Возвращает { items, cursor }. cursor — пара (created_at, id) самого раннего
// ответа страницы; с ним грузятся более ранние. null означает «раньше ничего
// нет», и кнопка «показать ещё» не появляется.
export async function listPostComments(postId, { limit = 30, cursor = null } = {}) {
  if (!supabase || !postId) return { items: [], cursor: null }
  const { data, error } = await supabase.rpc('list_post_comments', {
    p_post_id: postId,
    p_limit: limit,
    p_before_at: cursor?.createdAt || null,
    p_before_id: cursor?.id || null,
  })
  if (error) {
    if (isMissingRelation(error)) return { items: [], cursor: null, unavailable: true }
    throw error
  }
  const rows = data || []
  const oldest = rows[rows.length - 1]
  return {
    items: [...rows].reverse(),
    // Курсор есть, только если страница пришла полной: иначе более ранних нет.
    cursor: rows.length === limit && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
  }
}

export async function addPostComment({ postId, userId, text }) {
  if (!supabase) return { error: 'Нет подключения' }
  const body = (text || '').trim()
  if (!body) return { error: 'Пустой ответ' }
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, user_id: userId, text: body })
    .select('id, post_id, user_id, text, created_at')
    .single()
  if (error) { log.error('addPostComment', 'отказ сервера', error); return { error: normalizeError(error).message } }
  return { ok: data }
}

export async function deletePostComment(commentId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId)
  if (error) log.error('deletePostComment', 'отказ сервера', error)
  return error ? { error: normalizeError(error).message } : { ok: true }
}

// ---------------- Чат ----------------
// Сжать фото до ~1280px по длинной стороне, JPEG q=0.8 — быстро уходит по сети.
async function compressImageFile(file, maxSize = 1280, quality = 0.8) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Это не изображение')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Не удалось прочитать фото'))
      i.src = url
    })
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    return await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error('Пустой блоб')), 'image/jpeg', quality))
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Заливка в бакет. Путь всегда начинается с папки пользователя — политики
// хранилища разрешают запись только туда (см. schema.sql и миграции).
async function uploadImage(bucket, userId, file) {
  if (!supabase) throw new Error('Нет подключения')
  const blob = await compressImageFile(file)
  const path = `${userId}/${newId()}.jpg`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

// Фото записи по-прежнему кладётся в post-images, но бакет теперь ЗАКРЫТ
// (миграция 2026-09-12_private_media). В строке записи сохраняется прежний
// адрес вида .../object/public/... — он остаётся стабильным ключом объекта,
// а показывается запись через подписанную ссылку (signedPostImage).
// Переписывать уже сохранённые адреса в базе ради красоты не стали: лишняя
// правка миллиона строк ради строки, которая всё равно разбирается кодом.
export function uploadPostImage(userId, file) {
  return uploadImage('post-images', userId, file)
}

// Вложения переписки в chat-images БОЛЬШЕ НЕ ЗАГРУЖАЮТСЯ: всё новое уходит в
// dm-media (см. lib/messaging.js uploadMedia), где путь начинается с id
// диалога и политика пускает только его участников. chat-images остался
// только на чтение старой истории.

// ── Подписанные ссылки на закрытые бакеты ───────────────────────────────────
// Постоянного публичного адреса у вложения больше нет. Разбор адреса и кэш
// подписей живут в lib/storageUrl.js — здесь только привязка к клиенту.
export function signedChatImage(url) {
  return signedUrl(supabase, 'chat-images', url)
}

export function signedPostImage(url) {
  return signedUrl(supabase, 'post-images', url)
}

// ---------------- Непрочитанные сообщения ----------------
// Время последнего прочтения чата с каждым другом — localStorage.
// ── Присутствие (онлайн/офлайн) ───────────────────────────────────────────────
// У каждого пользователя свой канал presence:user:{id}. Хозяин канала себя
// в нём «трекает», наблюдатели просто подключаются и читают состояние. Так
// присутствие видно только тем, кто спросил, а не всем сразу — в отличие от
// одного общего канала на всё приложение.

// Свой канал присутствия: «я в сети». Живёт один на всё приложение, поэтому
// через хаб — иначе два вызова startPresence (например, после смены аккаунта
// без размонтирования) встретились бы на одной теме.
export function startPresence(myId) {
  if (!supabase || !myId) return () => {}
  return realtime.subscribe(
    `presence:self:${myId}`,
    (channel) => (status) => {
      if (status === 'SUBSCRIBED') channel.track?.({ at: Date.now() })?.catch?.(() => {})
    },
    () => {},
  )
}

// Наблюдение за чужим присутствием. Один канал на наблюдаемого человека,
// сколько бы экранов на него ни смотрело: раньше второй наблюдатель получал
// тот же объект канала и падал на .on('presence') после subscribe().
export function watchPresence(userId, onChange) {
  if (!supabase || !userId) return () => {}
  return realtime.subscribe(
    `presence:watch:${userId}`,
    (channel, emit) => {
      const read = () => {
        const metas = channel.presenceState?.()?.[userId]
        emit(Array.isArray(metas) && metas.length > 0)
      }
      channel
        .on('presence', { event: 'sync' }, read)
        .on('presence', { event: 'join' }, read)
        .on('presence', { event: 'leave' }, read)
      return (status) => { if (status === 'SUBSCRIBED') read() }
    },
    onChange,
  )
}

// Отметка «был(а) в сети». Тихо ничего не делает, если миграция ещё не
// прогнана — статус тогда просто не показывается.
export async function touchLastSeen() {
  if (!supabase) return
  try { await supabase.rpc('touch_last_seen') } catch {}
}

// Отметка живёт в таблице presence (миграция 2026-08-06). Раньше она лежала в
// app_state, но heartbeat раз в минуту трогал строку состояния и по Realtime
// рассылал бы весь блоб на все устройства. Фолбэк на старую колонку оставлен
// для проектов, где миграция ещё не прогнана.
export async function fetchLastSeen(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.rpc('get_last_seen', { p_user_id: userId })
  if (!error) return data || null
  const legacy = await supabase
    .from('app_state').select('last_seen').eq('user_id', userId).maybeSingle()
  return legacy.data?.last_seen || null
}


// ── Переписка переехала в src/lib/messaging.js ────────────────────────────────
//
// Здесь она жила, пока сообщение адресовалось ЧЕЛОВЕКУ: пара (sender,
// recipient), непрочитанные считались выборкой за месяц, «печатает…» шло по
// паре идентификаторов. С появлением диалогов граница другая — сообщение
// принадлежит ДИАЛОГУ, а человек является его участником, — и держать новую
// модель в файле, где рядом лежит синхронизация дневника и присутствие, значило
// бы спрятать смену модели.
//
// Второй реализации отправки, чтения и счётчиков не осталось: старые функции
// удалены целиком, а не оставлены «на всякий случай». Две реализации одного и
// того же в этом проекте уже расходились (см. дружбу с двумя определениями), и
// повторять это не будем.
//
// В supabase.js осталось то, что про СОЕДИНЕНИЕ, а не про переписку:
// присутствие, «был(а) в сети» и загрузка картинок в публичные бакеты.

// DSGVO «право на удаление»: стираем данные из облака и удаляем сам аккаунт.
// Данные удаляем всегда (RLS: свои); аккаунт — через RPC delete_current_user
// (SECURITY DEFINER, см. schema.sql). Если RPC нет — возвращаем partial.
export async function deleteAccount(userId) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  // uid приходит из уже загруженной сессии — лишний сетевой getUser() здесь
  // только добавлял точку отказа. Подстраховываемся локальным чтением сессии.
  let uid = userId
  if (!uid) {
    const { data } = await supabase.auth.getSession()
    uid = data?.session?.user?.id
  }
  if (uid) {
    // Рвём подписки в обе стороны. Дружбу отдельно удалять не нужно и уже
    // нельзя: строку friendships пишет сервер по подпискам, и она уйдёт
    // триггером вместе с ними.
    await supabase.from('follows').delete().eq('follower_id', uid)
    await supabase.from('follows').delete().eq('following_id', uid)
    // Мысли, ответы и реакции стираем явно, хотя они и уходят каскадом вместе
    // с auth.users: если удаление самого аккаунта не пройдёт (partial), данные
    // человека всё равно не должны остаться видимыми его друзьям.
    // Порядок: сначала посты — вместе с ними каскадом уходят чужие ответы и
    // реакции на них, — потом собственные следы в чужих ветках.
    await supabase.from('posts').delete().eq('user_id', uid)
    await supabase.from('post_comments').delete().eq('user_id', uid)
    await supabase.from('post_reactions').delete().eq('user_id', uid)
    await supabase.from('app_state').delete().eq('user_id', uid)
  }
  const { error } = await supabase.rpc('delete_current_user')
  if (error) return { error: normalizeError(error).message, partial: true } // данные стёрты, аккаунт остался
  return { ok: true }
}

// Снять ВСЕ realtime-каналы. Вызывается при выходе и при смене пользователя:
// канал, оставшийся от прошлого аккаунта, доставлял бы чужие события в новую
// сессию (и держал бы сокет открытым).
export function removeAllRealtimeChannels() {
  if (!supabase) return
  // Сначала реестр (он снимает свои каналы и забывает записи), потом всё
  // остальное — на случай канала, заведённого мимо хаба.
  try { realtime.reset() } catch {}
  try {
    for (const ch of supabase.getChannels()) supabase.removeChannel(ch)
  } catch {}
}

// ── Тренеры и клиенты ────────────────────────────────────────────────────────
// Роль тренера выдаёт владелец проекта после заявки (см. api/support.js и
// телеграм-бота). Доступ к дневнику всегда отдаёт КЛИЕНТ: приглашение исходит
// от него, тренер лишь принимает. Обратный порядок означал бы, что чужой
// человек может подписаться на ваш дневник и ждать, пока вы не заметите.

// Я — одобренный тренер? Ответ решает, показывать ли вкладку «Мои клиенты».
export async function amICoach(userId) {
  if (!supabase || !userId) return false
  const { data } = await supabase.from('coaches').select('user_id').eq('user_id', userId).maybeSingle()
  return Boolean(data)
}

// Пригласить тренера по его нику.
//
// Через поиск это сделать нельзя: тренер — не обязательно тот, на кого вы
// подписаны, и приглашение отдаёт доступ к дневнику, поэтому имя тренера
// человек вводит осознанно и целиком. UUID принимаем по-прежнему — им
// пользуется поддержка, когда разбирает обращение.
export async function inviteCoach({ myId, targetId }) {
  if (!supabase) return { error: 'Нет подключения к серверу' }
  const raw = (targetId || '').trim().replace(/^@+/, '')

  let coach
  if (UUID_RE.test(raw)) {
    coach = raw.toLowerCase()
  } else if (/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
    const { data, error } = await supabase.rpc('find_user_by_username', {
      p_username: raw.toLowerCase(),
    })
    if (error) return { error: normalizeError(error).message }
    if (!data) return { error: 'Пользователь с таким ником не найден' }
    coach = data
  } else {
    return { error: 'Ник — от 3 до 20 символов: латиница, цифры, _' }
  }

  if (coach === myId) return { error: 'Это ваш собственный ник' }

  const { error } = await supabase.from('coach_links').insert({ coach, client: myId })
  if (error) {
    if (error.code === '23505') return { error: 'Приглашение этому тренеру уже отправлено' }
    // Политика insert требует, чтобы приглашаемый был в таблице coaches.
    // Отдельного кода у отказа RLS нет, поэтому объясняем самую вероятную причину.
    if (error.code === '42501') return { error: 'Этот пользователь не подтверждён как тренер' }
    return { error: error.message }
  }
  return { ok: 'Приглашение отправлено' }
}

// Связи текущего пользователя: где он клиент и где он тренер.
export async function listCoachLinks(myId) {
  if (!supabase || !myId) return { coaches: [], clients: [], invites: [] }
  const { data, error } = await supabase
    .from('coach_links')
    .select('id, coach, client, status, created_at')
    .or(`coach.eq.${myId},client.eq.${myId}`)
    .order('created_at', { ascending: false })
  if (error) throw error

  const coaches = [] // мои тренеры (я клиент)
  const clients = [] // мои клиенты (я тренер, связь принята)
  const invites = [] // приглашения мне как тренеру, ждут решения
  for (const r of data || []) {
    if (r.client === myId) coaches.push({ rowId: r.id, id: r.coach, status: r.status })
    else if (r.status === 'accepted') clients.push({ rowId: r.id, id: r.client })
    else invites.push({ rowId: r.id, id: r.client })
  }

  // Имена одним запросом — как в listFriendships.
  const ids = [...new Set([...coaches, ...clients, ...invites].map((x) => x.id))]
  if (ids.length) {
    const { data: rows } = await supabase
      .from('app_state')
      .select('user_id, fname:state->profile->>name, favatar:state->profile->>avatar')
      .in('user_id', ids)
    const byId = Object.fromEntries((rows || []).map((r) => [r.user_id, r]))
    for (const x of [...coaches, ...clients, ...invites]) {
      x.name = byId[x.id]?.fname
      x.avatar = byId[x.id]?.favatar
    }
  }
  return { coaches, clients, invites }
}

export async function acceptCoachLink(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('coach_links').update({ status: 'accepted' }).eq('id', rowId)
  return error ? { error: error.message } : { ok: true }
}

export async function removeCoachLink(rowId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('coach_links').delete().eq('id', rowId)
  return error ? { error: error.message } : { ok: true }
}

// ── Комментарии к дню ────────────────────────────────────────────────────────
export async function listDayComments(clientId, day) {
  if (!supabase || !clientId || !day) return []
  const { data, error } = await supabase
    .from('day_comments')
    .select('id, client, author, day, text, created_at')
    .eq('client', clientId)
    .eq('day', day)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addDayComment({ clientId, authorId, day, text }) {
  if (!supabase) return { error: 'Нет подключения' }
  const body = String(text || '').trim()
  if (!body) return { error: 'Пустой комментарий' }
  const { data, error } = await supabase
    .from('day_comments')
    .insert({ client: clientId, author: authorId, day, text: body.slice(0, 2000) })
    .select('id, client, author, day, text, created_at')
    .single()
  return error ? { error: error.message } : { ok: data }
}

export async function deleteDayComment(id) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('day_comments').delete().eq('id', id)
  return error ? { error: error.message } : { ok: true }
}

// Мой действующий бан (или null). Нужен интерфейсу, чтобы честно сказать,
// почему нельзя писать, вместо молчаливого отказа.
export async function fetchMyBan() {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('my_ban')
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  return row || null
}

// ── Челленджи ────────────────────────────────────────────────────────────────
// Прогресс каждый считает у себя из своего дневника (см. lib/challenges.js) и
// кладёт сюда только итог по дню. Читать чужие дневники ради лидерборда не
// нужно — и не следует: челлендж не повод раскрывать всю историю питания.

export async function listChallenges(myId) {
  if (!supabase || !myId) return []
  const { data: mem, error: e1 } = await supabase
    .from('challenge_members')
    .select('challenge')
    .eq('user_id', myId)
  if (e1) throw e1
  const ids = (mem || []).map((m) => m.challenge)
  if (!ids.length) return []

  const { data, error } = await supabase
    .from('challenges')
    .select('id, owner, title, kind, starts_on, ends_on, created_at')
    .in('id', ids)
    .order('starts_on', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createChallenge({ myId, title, kind, starts_on, ends_on }) {
  if (!supabase) return { error: 'Нет подключения' }
  const { data, error } = await supabase
    .from('challenges')
    .insert({ owner: myId, title: title.trim(), kind, starts_on, ends_on })
    .select('id, owner, title, kind, starts_on, ends_on')
    .single()
  if (error) return { error: error.message }

  // Создатель сразу участник: челлендж без автора выглядел бы как чужой.
  const { error: e2 } = await supabase.from('challenge_members').insert({ challenge: data.id, user_id: myId })
  if (e2) return { error: e2.message }
  return { ok: data }
}

export async function joinChallenge({ challengeId, myId }) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('challenge_members').insert({ challenge: challengeId, user_id: myId })
  if (error) {
    if (error.code === '23505') return { error: 'Вы уже участвуете' }
    if (error.code === '23503') return { error: 'Челлендж не найден' }
    return { error: error.message }
  }
  return { ok: true }
}

export async function leaveChallenge({ challengeId, myId }) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase
    .from('challenge_members').delete()
    .eq('challenge', challengeId).eq('user_id', myId)
  return error ? { error: error.message } : { ok: true }
}

export async function deleteChallenge(challengeId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('challenges').delete().eq('id', challengeId)
  return error ? { error: error.message } : { ok: true }
}

// Отправить свои зачётные дни. Пишем ВЕСЬ набор прошедших дней разом: так
// исправление задним числом (человек дописал вчерашний ужин) сразу отражается
// в лидерборде, а не остаётся навсегда незачтённым.
export async function pushChallengeDays({ challengeId, myId, elapsedDays, scoredDays }) {
  if (!supabase || !elapsedDays?.length) return { ok: true }
  const scored = new Set(scoredDays)
  const rows = elapsedDays.map((day) => ({
    challenge: challengeId,
    user_id: myId,
    day,
    scored: scored.has(day),
  }))
  const { error } = await supabase
    .from('challenge_days')
    .upsert(rows, { onConflict: 'challenge,user_id,day' })
  return error ? { error: error.message } : { ok: true }
}

// Лидерборд одним запросом (серверная функция, см. миграцию).
export async function challengeBoard(challengeId) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('challenge_board', { p_challenge: challengeId })
  if (error) return []
  return data || []
}
