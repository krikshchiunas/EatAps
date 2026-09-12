// Кто прислал запрос. Отдельный модуль, а не часть stripe/_shared.js.
//
// Причина практическая: раньше эта функция жила рядом с инициализацией Stripe,
// и любой эндпоинт, которому нужно всего лишь узнать пользователя (поддержка,
// обратная связь), импортом тянул за собой весь SDK Stripe. На бессерверной
// платформе это оплачивается временем холодного старта КАЖДОГО такого вызова.
//
// Токен проверяется на сервере через service_role: подпись, срок и то, что
// пользователь всё ещё существует. Ничему, что пришло от клиента помимо
// самого токена, здесь не верят.
import { createClient } from '@supabase/supabase-js'

let _admin
export function admin() {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set')
  _admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}

export async function getUserFromRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  const token = String(auth).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await admin().auth.getUser(token)
  if (error) return null
  return data?.user || null
}
