// Регулярная уборка. Вызывается планировщиком Vercel (см. crons в vercel.json)
// и вручную владельцем.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЗАЧЕМ ОНА ЕСТЬ
//
// Две вещи нельзя доделать внутри пользовательского запроса, и обе копятся
// молча, если их не разгребать:
//
//   1. ОСИРОТЕВШИЕ ФАЙЛЫ. Раньше объект в хранилище не удалялся НИКОГДА: ни
//      при удалении записи, ни при отмене сообщения, ни при удалении аккаунта.
//      Человек нажимал «удалить всё», а его фотографии оставались на сервере.
//      Триггеры (миграция 2026-09-12_private_media) складывают пути в очередь,
//      но само удаление — сетевой вызов к хранилищу, и делать его из триггера
//      внутри транзакции пользователя нельзя.
//
//   2. ЗАВИСШИЕ РЕЗЕРВЫ AI. Если функция не дожила до расчёта (платформа убила
//      по таймауту, отвалилась база), списанный резерв остаётся на человеке.
//      Разницу между верхней оценкой и фактом надо вернуть.
//
// ─────────────────────────────────────────────────────────────────────────────
// ДОСТУП
//
// Точка публична по адресу, поэтому требует секрет. Планировщик Vercel шлёт
// `Authorization: Bearer $CRON_SECRET`; тот же секрет принимается в заголовке
// x-maintenance-token для ручного запуска. Без заданного секрета точка
// ОТКЛЮЧЕНА целиком — открытая уборка хуже неработающей.
import { createClient } from '@supabase/supabase-js'

const BUCKETS = new Set(['chat-images', 'post-images', 'dm-media'])
const BATCH = 200

let _admin
function admin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

// Сравнение секретов постоянным по времени способом. Разница здесь
// микроскопическая, но и стоит она одну строку.
function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[maintenance] CRON_SECRET не задан — уборка отключена')
    return res.status(503).json({ error: 'not configured' })
  }

  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const header = String(req.headers['x-maintenance-token'] || '').trim()
  if (!secretMatches(bearer, secret) && !secretMatches(header, secret)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const db = admin()
  const result = { storageDeleted: 0, storageFailed: 0, reservationsReturned: 0 }

  // ── 1. Файлы без владеющей строки ──────────────────────────────────────────
  try {
    const { data: queued, error } = await db
      .from('storage_cleanup_queue')
      .select('id, bucket, path')
      .order('created_at')
      .limit(BATCH)
    if (error) throw new Error(error.message)

    // Группируем по бакету: API хранилища удаляет пачкой, и одного вызова на
    // бакет достаточно вместо двухсот по одному.
    const byBucket = new Map()
    for (const row of queued || []) {
      if (!BUCKETS.has(row.bucket) || !row.path) continue
      if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, [])
      byBucket.get(row.bucket).push(row)
    }

    for (const [bucket, rows] of byBucket) {
      const paths = rows.map((r) => r.path)
      const { error: delErr } = await db.storage.from(bucket).remove(paths)
      if (delErr) {
        // Не удалили — строку в очереди НЕ трогаем: попробуем в следующий раз.
        console.error('[maintenance] удаление из хранилища не удалось', { bucket, count: paths.length, error: delErr.message })
        result.storageFailed += paths.length
        continue
      }
      // Убираем из очереди только то, что действительно удалено.
      const { error: clrErr } = await db
        .from('storage_cleanup_queue')
        .delete()
        .in('id', rows.map((r) => r.id))
      if (clrErr) console.error('[maintenance] очередь не очищена', clrErr.message)
      result.storageDeleted += paths.length
    }
  } catch (e) {
    console.error('[maintenance] уборка хранилища не выполнена', e.message)
    result.storageError = true
  }

  // ── 2. Зависшие резервы AI ─────────────────────────────────────────────────
  try {
    const { data, error } = await db.rpc('ai_reconcile', { p_older_than: '15 minutes' })
    if (error) throw new Error(error.message)
    result.reservationsReturned = Number(data) || 0
  } catch (e) {
    console.error('[maintenance] сверка резервов AI не выполнена', e.message)
    result.reconcileError = true
  }

  console.log('[maintenance] готово', result)
  return res.status(200).json({ ok: true, ...result })
}

export { secretMatches }
