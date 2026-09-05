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

// Список друзей одним запросом: RPC отдаёт сразу карточку человека, поэтому
// второго обращения за именами больше не нужно.
//
// Форма строки — { id, name, avatar, username } — совпадает с той, что ждут
// экраны друзей и чат.
export async function listFriends(myId) {
  if (!supabase || !myId) return []
  const { data, error } = await supabase.rpc('list_friends', {
    p_user_id: myId, p_limit: 100, p_offset: 0,
  })
  if (error) {
    // Миграция ещё не прогнана — раздел просто пуст, а не сломан. Но молчать
    // здесь нельзя: без записи в консоли «друзья пропали» и «функции нет в
    // базе» выглядят одинаково, и искать причину человек идёт в интерфейс,
    // где её нет.
    if (isMissingRelation(error)) {
      console.error(
        'RPC list_friends недоступна — похоже, не прогнана миграция ' +
        'supabase/migrations/2026-08-26_nickname_identity.sql. Список друзей будет пуст.',
        error,
      )
      return []
    }
    throw error
  }
  return (data || []).map((r) => ({
    id: r.user_id,
    username: r.username,
    name: r.display_name || r.username,
    avatar: r.avatar_url,
    since: r.created_at,
  }))
}

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
  if (error) return { error: normalizeError(error).message }
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
  if (error) return { error: normalizeError(error).message }
  return { ok: data }
}

export async function deletePost(postId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('posts').delete().eq('id', postId)
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
  if (error) return { error: normalizeError(error).message }
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
  if (error) return { error: normalizeError(error).message }
  return { ok: data }
}

export async function deletePostComment(commentId) {
  if (!supabase) return { error: 'Нет подключения' }
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId)
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

export function uploadChatImage(userId, file) {
  return uploadImage('chat-images', userId, file)
}

export function uploadPostImage(userId, file) {
  return uploadImage('post-images', userId, file)
}

// ---------------- Непрочитанные сообщения ----------------
// Время последнего прочтения чата с каждым другом — localStorage.
const CHAT_READ_KEY = 'eataps:chat:read'

function getChatReadMap() {
  try { return JSON.parse(localStorage.getItem(CHAT_READ_KEY) || '{}') } catch { return {} }
}

export function markChatRead(friendId) {
  const map = getChatReadMap()
  map[friendId] = new Date().toISOString()
  // Вызывается на каждое входящее сообщение. В приватном режиме iOS Safari
  // setItem бросает — необёрнутый вызов ронял бы обработчик realtime-события.
  try { localStorage.setItem(CHAT_READ_KEY, JSON.stringify(map)) } catch {}
}

// ── «Удалить у меня» ──────────────────────────────────────────────────────────
// Сообщение остаётся в БД (у собеседника оно на месте), но скрыто на этом
// устройстве. Храним список id локально; при загрузке истории фильтруем.
// Отдельно от «удалить у всех» (DELETE в БД) — то придёт позже.
const CHAT_HIDDEN_KEY = 'eataps:chatHidden'

export function getHiddenMessageIds() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAT_HIDDEN_KEY) || '[]')) } catch { return new Set() }
}

// Скрыть сразу несколько сообщений (очистка переписки). Отдельная функция, а
// не цикл по hideMessageLocally: тот на каждый id заново разбирает и сериализует
// весь список, и очистка чата на три сотни сообщений превращалась в три сотни
// полных проходов по массиву из двух тысяч элементов.
export function hideMessagesLocally(ids) {
  const set = getHiddenMessageIds()
  for (const id of ids) set.add(String(id))
  // Держим список ограниченным, чтобы localStorage не разрастался бесконечно.
  const arr = [...set].slice(-2000)
  try { localStorage.setItem(CHAT_HIDDEN_KEY, JSON.stringify(arr)) } catch {}
}

export function hideMessageLocally(id) {
  hideMessagesLocally([id])
}

// Возвращает { [senderId]: count } — только сообщения моложе 30 дней.
//
// Фильтр read_at is null делает сервер: раньше сюда приезжала вся входящая
// переписка за месяц, и она пересчитывалась на клиенте при каждом новом
// сообщении. Теперь запрос ложится на частичный индекс messages_unread_idx и
// возвращает ровно непрочитанное — обычно единицы строк вместо тысяч.
// Локальная отметка остаётся вторым условием: она работает офлайн и переживает
// неудачный вызов mark_messages_read.
export async function fetchUnreadCounts(myId) {
  if (!supabase || !myId) return {}
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data } = await supabase
    .from('messages')
    .select('sender, created_at')
    .eq('recipient', myId)
    .is('read_at', null)
    .gt('created_at', cutoff)
  if (!data) return {}
  const readMap = getChatReadMap()
  const counts = {}
  for (const m of data) {
    const lastRead = readMap[m.sender] || null
    if (!lastRead || m.created_at > lastRead) {
      counts[m.sender] = (counts[m.sender] || 0) + 1
    }
  }
  return counts
}

// Realtime-подписка на ВСЕ входящие сообщения (для бейджа в BottomNav).
// Имя канала стабильное — как и у остальных подписок в этом файле. Клиент
// Realtime возвращает уже существующий канал с таким же именем, поэтому
// повторная подписка не плодит дубликаты; Date.now() в имени, наоборот,
// оставлял бы висеть по каналу на каждое пересоздание эффекта.
export function subscribeToIncoming(myId, onNew) {
  if (!supabase || !myId) return () => {}
  return realtime.subscribe(
    `incoming:${myId}`,
    (channel, emit) => channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient=eq.${myId}` },
      emit,
    ),
    onNew,
  )
}

const MSG_COLS = 'id, sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, created_at, read_at, reactions'
// Фолбэк на случай, если фронтенд с реакциями задеплоен раньше миграции
// 2026-08-08_chat_reactions.sql: колонки reactions в базе ещё нет. Без этого
// запрос с несуществующей колонкой возвращает ошибку целиком — не «reactions
// пустой», а «весь чат не открылся». Тот же принцип независимости от порядка
// деплоя, что и у остальных миграций в проекте, здесь был упущен при первой
// реализации — чиним, а не полагаемся на то, что SQL прогонят мгновенно.
const MSG_COLS_LEGACY = 'id, sender, recipient, text, image_url, meal_ref, reply_to, reply_snapshot, forwarded_name, created_at, read_at'

// Отметить прочитанными все входящие от собеседника (серверная функция —
// одним запросом, без гонок). Локальная метка остаётся для офлайн-бейджа.
export async function markMessagesRead(senderId) {
  if (!supabase || !senderId) return
  try { await supabase.rpc('mark_messages_read', { p_sender: senderId }) } catch {}
}

// Подписка на изменения МОИХ отправленных сообщений: прочтение собеседником
// (read_at) и его реакция на них (reactions). Ловим UPDATE, где sender = я.
// Нужен replica identity full на messages (см. schema.sql).
//
// Раньше событие фильтровалось условием `row.read_at` и реакция-без-прочтения
// молча терялась: непрочитанное сообщение, на которое поставили реакцию, не
// долетало до собеседника в реальном времени. Теперь отдаём строку целиком —
// вызывающий сам решает, что из неё изменилось.
export function subscribeToSentUpdates(myId, friendId, onUpdate) {
  if (!supabase || !myId) return () => {}
  // Тема без friendId: фильтр всё равно один и тот же (все МОИ сообщения), а
  // отдельный канал на каждого собеседника означал бы новую подписку с тем же
  // содержимым при каждом открытии другого чата.
  return realtime.subscribe(
    `sent:${myId}`,
    (channel, emit) => channel.on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender=eq.${myId}` },
      emit,
    ),
    (payload) => {
      const row = payload.new
      if (row?.recipient === friendId) onUpdate(row)
    },
  )
}

// Переключить реакцию на сообщении (сейчас — единственная, 🥕). Сервер решает
// добавить её или снять, по фактическому текущему состоянию строки: клиент
// всегда просит «переключить», а не «поставить»/«снять» — так двойной тап
// почти одновременно с двух устройств не разъезжается сильнее, чем на один
// лишний клик, который тут же поправит realtime-событие.
export async function toggleMessageReaction(messageId, emoji = '🥕') {
  if (!supabase) return { error: 'Нет подключения' }
  const { data, error } = await supabase.rpc('toggle_message_reaction', { p_message_id: messageId, p_emoji: emoji })
  if (error) return { error: normalizeError(error).message }
  return { ok: data }
}

// Отправка сообщения.
//
// clientId — ключ идемпотентности: клиент придумывает его ОДИН раз на
// сообщение и повторяет при каждой попытке. Сервер, увидев знакомый ключ,
// возвращает уже существующую строку вместо второй такой же. Без этого
// «отправил → сеть отвалилась → повторил» давало в переписке два одинаковых
// сообщения, причём ровно на плохой связи, где повтор и нужен.
//
// sender в запросе больше не передаётся: отправителя определяет сервер по
// auth.uid(). Параметр оставлен в сигнатуре для совместимости вызывающего
// кода и игнорируется — правило «сервер решает, кто действует» не должно
// зависеть от того, что клиент прислал правильное значение.
export async function sendChatMessage({
  recipient, text, imageUrl, mealRef, replyTo, replySnapshot, forwardedName, clientId,
}) {
  if (!supabase) return { error: 'Нет подключения' }
  const body = text?.trim() ? text.trim() : null
  if (!body && !imageUrl && !mealRef) return { error: 'Пустое сообщение' }

  const { data, error } = await supabase.rpc('send_message', {
    p_recipient: recipient,
    p_text: body,
    p_image_url: imageUrl || null,
    p_meal_ref: mealRef || null,
    p_reply_to: replyTo || null,
    p_reply_snapshot: replySnapshot || null,
    p_forwarded_name: forwardedName || null,
    p_client_id: clientId || null,
  })

  // База ещё без миграции 2026-09-05 — функции нет. Тогда шлём по-старому,
  // прямым INSERT: без идемпотентности, но переписка работает. Порядок
  // деплоя «фронтенд раньше SQL» в этом проекте нормален (см. isMissingColumn
  // в createPost), и чат не должен от него ломаться.
  if (error && isMissingRelation(error)) return legacySendChatMessage({
    recipient, text: body, imageUrl, mealRef, replyTo, replySnapshot, forwardedName,
  })
  if (error) return { error: normalizeError(error).message }
  const row = Array.isArray(data) ? data[0] : data
  // reactions приходит из базы как NULL, пока на сообщение никто не реагировал.
  // Спред `{ reactions: {}, ...row }` затирал бы значение по умолчанию этим
  // NULL, и обработчик двойного тапа получал бы null вместо объекта.
  return row ? { ok: { ...row, reactions: row.reactions || {} } } : { error: 'Сообщение не отправилось' }
}

// Путь для базы без send_message. Оставлен отдельной функцией, а не веткой
// внутри основной: так видно, что это запасной вариант, и его легко удалить,
// когда миграция прогнана везде.
async function legacySendChatMessage({ recipient, text, imageUrl, mealRef, replyTo, replySnapshot, forwardedName }) {
  const { data: sess } = await supabase.auth.getSession()
  const sender = sess?.session?.user?.id
  if (!sender) return { error: 'Нужно войти в аккаунт' }
  const payload = {
    sender,
    recipient,
    text: text || null,
    image_url: imageUrl || null,
    meal_ref: mealRef || null,
    reply_to: replyTo || null,
    reply_snapshot: replySnapshot || null,
    forwarded_name: forwardedName || null,
  }
  let { data, error } = await supabase.from('messages').insert(payload).select(MSG_COLS).single()
  if (error && isMissingColumn(error)) {
    // Колонка отсутствует → RETURNING падает на этапе планирования запроса,
    // сама вставка не проходит вовсе (не транзакция наполовину) — повторный
    // insert здесь не создаёт дубликат строки.
    ;({ data, error } = await supabase.from('messages').insert(payload).select(MSG_COLS_LEGACY).single())
    if (data) data = { ...data, reactions: {} }
  }
  if (error) return { error: normalizeError(error).message }
  return { ok: data }
}

// История переписки — страницами, начиная с конца.
//
// ЧТО ЗДЕСЬ БЫЛО СЛОМАНО. Прежний запрос звучал так:
//     .order('created_at', { ascending: true }).limit(300)
// то есть брал САМЫЕ СТАРЫЕ триста сообщений. Пока переписка короче трёхсот
// реплик, разницы не видно вовсе — поэтому ошибка и прожила незамеченной. А в
// длинной переписке человек открывал чат и не видел в нём ни одного свежего
// сообщения: экран показывал разговор годичной давности.
//
// Возвращает { items, cursor }: items в порядке чтения (старые сверху),
// cursor — на более ранние. null означает «дальше в прошлое ничего нет».
export async function listMessagesWith(myId, friendId, { limit = 60, cursor = null } = {}) {
  if (!supabase) return { items: [], cursor: null }
  const { data, error } = await supabase.rpc('list_messages', {
    p_peer: friendId,
    p_limit: limit,
    p_before_at: cursor?.createdAt || null,
    p_before_id: cursor?.id || null,
  })
  if (error) {
    if (isMissingRelation(error)) return legacyListMessagesWith(myId, friendId, limit)
    throw error
  }
  const rows = data || []
  const oldest = rows[rows.length - 1]
  const hidden = getHiddenMessageIds()
  return {
    items: [...rows].reverse()
      .map((m) => ({ ...m, reactions: m.reactions || {} }))
      .filter((m) => !hidden.has(String(m.id))),
    cursor: rows.length === limit && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
  }
}

// База без list_messages. Читаем прямым запросом, но уже правильным концом:
// сначала новые, потом переворачиваем. Пагинации здесь нет — она и не нужна,
// это временный путь до прогона миграции.
async function legacyListMessagesWith(myId, friendId, limit) {
  const query = (cols) => supabase
    .from('messages')
    .select(cols)
    .or(`and(sender.eq.${myId},recipient.eq.${friendId}),and(sender.eq.${friendId},recipient.eq.${myId})`)
    .order('created_at', { ascending: false })
    .limit(limit)

  let { data, error } = await query(MSG_COLS)
  if (error && isMissingColumn(error)) {
    ;({ data, error } = await query(MSG_COLS_LEGACY))
    if (data) data = data.map((m) => ({ ...m, reactions: {} }))
  }
  if (error) throw error
  const hidden = getHiddenMessageIds()
  return {
    items: [...(data || [])].reverse().filter((m) => !hidden.has(String(m.id))),
    cursor: null,
  }
}

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

// ── Индикатор «печатает…» ─────────────────────────────────────────────────────
// Broadcast-канал (не postgres_changes): события эфемерные, в БД их писать
// незачем. Имя канала одинаковое с обеих сторон — сортируем пару id, иначе
// собеседники окажутся в разных каналах и не услышат друг друга.
export function createTypingChannel(myId, friendId, onTyping) {
  if (!supabase || !myId || !friendId) return { sendTyping: () => {}, unsubscribe: () => {} }
  const pair = [myId, friendId].sort().join('_')
  const name = `typing:${pair}`
  const off = realtime.subscribe(
    name,
    (channel, emit) => channel.on('broadcast', { event: 'typing' }, emit),
    ({ payload }) => {
      if (payload?.from === friendId) onTyping(payload.typing !== false)
    },
  )
  const sendTyping = (typing) => {
    realtime.send(name, { type: 'broadcast', event: 'typing', payload: { from: myId, typing } })
  }
  return { sendTyping, unsubscribe: off }
}

// Realtime-подписка на новые входящие сообщения от конкретного друга.
// onEvent(eventType, row) — 'INSERT' для новых сообщений от друга, 'UPDATE'
// для изменений в них (сейчас единственное такое изменение — реакция на
// сообщение друга; собственное прочтение мы не пишем через этот путь).
export function subscribeToChat(myId, friendId, onEvent) {
  if (!supabase || !myId) return () => {}
  // Как и у sent: фильтр «всё входящее мне» одинаков для любого собеседника,
  // поэтому тема общая, а отбор по конкретному другу — в слушателе.
  return realtime.subscribe(
    `chat:${myId}`,
    (channel, emit) => channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `recipient=eq.${myId}` },
      emit,
    ),
    (payload) => {
      const row = payload.new
      if (row?.sender === friendId && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE')) {
        onEvent(payload.eventType, row)
      }
    },
  )
}

// Последнее сообщение в каждом диалоге — для порядка в списке друзей.
//
// Раньше клиент выгружал последние 200 сообщений ПО ВСЕМ перепискам и
// группировал их у себя. Два изъяна, и оба видны на живом аккаунте: активная
// переписка с одним человеком вытесняла из выборки всех остальных (диалог с
// редким собеседником просто пропадал из сортировки), а по сети ехал текст
// двухсот сообщений ради двух десятков строк предпросмотра.
//
// RPC отдаёт ровно по одному последнему сообщению на диалог.
export async function listConversations(myId, limit = 100) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_conversations', { p_limit: limit })
  if (error) {
    if (isMissingRelation(error)) return legacyListConversations(myId)
    throw error
  }
  return (data || []).map((r) => ({
    id: r.peer_id,
    unread: r.unread_count || 0,
    last: {
      id: r.last_id,
      sender: r.last_sender,
      text: r.last_text,
      image_url: r.last_image,
      created_at: r.last_at,
    },
  }))
}

async function legacyListConversations(myId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender, recipient, text, image_url, created_at')
    .or(`sender.eq.${myId},recipient.eq.${myId}`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  const byPartner = new Map()
  for (const m of data || []) {
    const partner = m.sender === myId ? m.recipient : m.sender
    if (!byPartner.has(partner)) byPartner.set(partner, m)
  }
  return Array.from(byPartner, ([id, last]) => ({ id, last, unread: 0 }))
}

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
