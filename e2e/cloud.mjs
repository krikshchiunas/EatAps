// Облако для E2E без настоящего Supabase.
//
// Отдельная сборка (npm run build:cloud → dist-cloud) знает адрес
// https://mock.supabase.test; все запросы к нему перехватывает Playwright и
// отвечает пустыми списками или тестовыми данными. Сессия вошедшего человека
// лежит в localStorage заранее — так открываются экраны, доступные только с
// аккаунтом: события, челленджи, друзья, лента, чат, подписка.
export const CLOUD_URL = 'https://mock.supabase.test'
export const USER_ID = '00000000-0000-4000-8000-000000000001'
const FRIEND_ID = '00000000-0000-4000-8000-000000000002'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.parse('2030-01-01') / 1000)
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, exp, role: 'authenticated', aud: 'authenticated' })}.e2e`
const user = {
  id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'lena@example.test',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
}
export const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user }

// Ответы по таблицам/функциям. Всё неизвестное — пустой список: экран
// показывает пустое состояние, и это тоже проверяется (на языке человека).
const now = '2026-03-18T10:00:00Z'
const FRIEND = { id: FRIEND_ID, user_id: FRIEND_ID, username: 'mila', display_name: 'Mila', name: 'Mila', avatar_url: null }
const TABLES = {
  profiles: [{ id: USER_ID, user_id: USER_ID, username: 'lena', display_name: 'Lena', avatar_url: null }],
  'rpc/list_friends': [FRIEND],
}

export async function mockCloud(page) {
  await page.route(`${CLOUD_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/(rest|auth|storage|functions)\/v1\//, '')
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (url.pathname.startsWith('/auth/v1/token')) return route.fulfill({ json: session })
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 })
    const body = TABLES[path] ?? []
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/0' } })
    // .single()/.maybeSingle() просят объект — отдаём первый элемент или null.
    const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (wantsObject) return body.length ? route.fulfill({ json: body[0] }) : route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } })
    return route.fulfill({ status: req.method() === 'GET' ? 200 : 201, json: body, headers: { 'content-range': `0-${Math.max(0, body.length - 1)}/${body.length}` } })
  })
  // Realtime (WebSocket) — молчаливый сервер: подключились и ждём.
  await page.routeWebSocket(/mock\.supabase\.test/, () => {})
}

export const sessionStorageKey = 'sb-mock-auth-token'
export { now, FRIEND }
