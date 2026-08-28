// POST /api/account/delete — удаление аккаунта (DSGVO Art. 17).
//
// Раньше удаление делал клиент: чистил свои строки через RLS и звал RPC
// delete_current_user(). Каскады auth.users уносили остальные таблицы, и это
// работало — но ровно для таблиц. Две вещи каскада не имеют, и обе оставались:
//
//   • ФОТОГРАФИИ. Файлы в chat-images/{uid}/ и post-images/{uid}/ не удалялись,
//     а оба бакета публичны на чтение. То есть каждое фото из личной переписки
//     оставалось доступно по прямой ссылке НАВСЕГДА — после того, как человек
//     удалил аккаунт. Ссылки формируются через getPublicUrl, то есть уже
//     разошлись по устройствам и кэшам.
//   • ПОДПИСКА STRIPE. Строка subscriptions уходила каскадом, а сама подписка
//     оставалась активной: человек удалил аккаунт и продолжал платить.
//
// Ни то, ни другое из браузера не чинится: удаление файлов чужой папки и отмена
// подписки требуют прав, которых у клиента нет и быть не должно. Поэтому
// удаление переехало на сервер целиком.
//
// Порядок важен: сначала необратимое для денег (Stripe), потом файлы, потом сам
// аккаунт. Если упадём на середине, человек не останется с активной подпиской и
// без аккаунта.
import { stripe, admin, getUserFromRequest } from '../stripe/_shared.js'
import { isAllowedOrigin } from '../stripe/origin.js'

const BUCKETS = ['chat-images', 'post-images']

// Storage.list отдаёт страницами. У обычного человека файлов десятки, но
// цикл нужен: без него у активного пользователя часть фотографий пережила бы
// удаление аккаунта — то есть баг проявился бы именно там, где он опаснее.
async function purgeBucket(db, bucket, uid) {
  let removed = 0
  for (let page = 0; page < 50; page++) {
    const { data, error } = await db.storage.from(bucket).list(uid, { limit: 100, offset: 0 })
    if (error) {
      console.error('[account/delete] list failed', { bucket, uid, error: error.message })
      return { removed, error: error.message }
    }
    if (!data?.length) break

    const paths = data.map((f) => `${uid}/${f.name}`)
    const { error: rmErr } = await db.storage.from(bucket).remove(paths)
    if (rmErr) {
      console.error('[account/delete] remove failed', { bucket, uid, error: rmErr.message })
      return { removed, error: rmErr.message }
    }
    removed += paths.length
    // offset намеренно не сдвигаем: удалённые файлы уходят из выдачи, и
    // следующая страница снова начинается с нуля.
    if (data.length < 100) break
  }
  return { removed }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const origin = req.headers.origin || req.headers.referer || ''
  if (!isAllowedOrigin(origin)) return res.status(403).json({ error: 'Forbidden' })

  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const uid = user.id
  let db
  try {
    db = admin()
  } catch (e) {
    console.error('[account/delete] db not configured', e.message)
    return res.status(500).json({ error: 'Не удалось удалить аккаунт' })
  }

  const warnings = []

  // 1. Подписка Stripe. Отменяем немедленно, а не в конце периода: человек
  // просит удалить аккаунт, значит доступ ему больше не нужен, а деньги за
  // остаток периода списаны и возвращаются по обычной процедуре возврата.
  try {
    const { data: sub } = await db
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', uid)
      .maybeSingle()

    if (sub?.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
      await stripe().subscriptions.cancel(sub.stripe_subscription_id)
    }
  } catch (e) {
    // Подписки может не быть вовсе, ключ Stripe может быть не задан на превью-
    // окружении, подписка могла быть отменена раньше. Ни один из этих случаев
    // не повод оставить человека с неудалённым аккаунтом — но в лог это
    // обязано попасть: незакрытая подписка означает списания.
    console.error('[account/delete] stripe cancel failed', { uid, error: e.message })
    warnings.push('stripe')
  }

  // 2. Файлы в публичных бакетах.
  for (const bucket of BUCKETS) {
    const { error } = await purgeBucket(db, bucket, uid)
    if (error) warnings.push(bucket)
  }

  // 3. Сам аккаунт. Штатный путь Auth-админки вместо прямого delete из
  // auth.users: он корректно снимает сессии и связанные identity.
  // Всё остальное (app_state, posts, follows, messages, notifications…) уходит
  // каскадом по on delete cascade.
  const { error } = await db.auth.admin.deleteUser(uid)
  if (error) {
    console.error('[account/delete] deleteUser failed', { uid, error: error.message })
    return res.status(500).json({ error: 'Не удалось удалить аккаунт', warnings })
  }

  return res.status(200).json({ ok: true, warnings })
}
