const COOKIE_NAME = 'session'
const CLEAR_COOKIE = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

const encoder = new TextEncoder()

async function isEqual(a: string, b: string) {
  // Hashing first gives equal lengths, which timingSafeEqual requires.
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  return crypto.subtle.timingSafeEqual(hashA, hashB)
}

// The token is derived from the password, so changing the secret signs out every device.
async function sessionToken(password: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode('plants-tracker-session'),
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function signOut() {
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': CLEAR_COOKIE,
      },
    },
  )
}

// Both checks fail when APP_PASSWORD is unset, so a missing secret locks the API.
export async function isSignedIn(request: Request, env: Env) {
  if (!env.APP_PASSWORD) {
    return false
  }
  const token = request.headers
    .get('Cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  if (!token) {
    return false
  }
  if (!(await isEqual(token, await sessionToken(env.APP_PASSWORD)))) {
    return false
  }
  // A lockout signs out every device, on its next request.
  const locked = await env.DB.prepare('SELECT 1 FROM login_lockout WHERE id = 1').first()
  return locked ? 'locked' : true
}

export function signOutResponse() {
  return Response.json(
    { error: 'Login blocked' },
    {
      status: 401,
      headers: {
        'Set-Cookie': CLEAR_COOKIE,
      },
    },
  )
}

// Short passwords are refused at login, so a weak secret can't be guessed.
// Vite sets DEV only under `npm run dev`, so local dev can use any password.
const MIN_PASSWORD_LENGTH = import.meta.env.DEV ? 1 : 20
// After this many failed logins in one UTC day, every login is refused until the next day.
// Two such days in a row sign out every device and lock login until the lockout row is
// deleted from the Cloudflare dashboard.
const DAILY_FAILURE_CAP = 20

function utcDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

async function getLoginGuard(env: Env) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT locked_at FROM login_lockout WHERE id = 1) AS locked_at,
       (SELECT count FROM login_failures WHERE day = ?1) AS today,
       (SELECT count FROM login_failures WHERE day = ?2) AS yesterday`,
  )
    .bind(utcDay(), utcDay(-1))
    .first<{ locked_at: string | null; today: number | null; yesterday: number | null }>()
  return {
    locked: Boolean(row?.locked_at),
    blockedToday: (row?.today ?? 0) >= DAILY_FAILURE_CAP,
    blockedYesterday: (row?.yesterday ?? 0) >= DAILY_FAILURE_CAP,
  }
}

async function recordFailure(env: Env, blockedYesterday: boolean) {
  const [, upsert] = await env.DB.batch<{ count: number }>([
    env.DB.prepare('DELETE FROM login_failures WHERE day < ?').bind(utcDay(-1)),
    env.DB.prepare(
      `INSERT INTO login_failures (day, count) VALUES (?, 1)
       ON CONFLICT (day) DO UPDATE SET count = count + 1
       RETURNING count`,
    ).bind(utcDay()),
  ])
  const count = upsert.results[0]?.count ?? 0
  if (count >= DAILY_FAILURE_CAP && blockedYesterday) {
    await env.DB.prepare('INSERT OR IGNORE INTO login_lockout (id) VALUES (1)').run()
  }
}

export async function signIn(request: Request, env: Env) {
  const { success } = await env.LOGIN_LIMIT.limit({ key: 'login' })
  if (!success) {
    return Response.json({ error: 'Too many attempts' }, { status: 429 })
  }

  if (!env.APP_PASSWORD || env.APP_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: 'Server password too short' }, { status: 503 })
  }

  // Checked before the password, so a blocked day refuses even the right password.
  const guard = await getLoginGuard(env)
  if (guard.locked || guard.blockedToday) {
    return Response.json({ error: 'Login blocked' }, { status: 423 })
  }

  const body = await request.json<{ password?: unknown }>().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password || !(await isEqual(password, env.APP_PASSWORD))) {
    await recordFailure(env, guard.blockedYesterday)
    return Response.json({ error: 'Wrong password' }, { status: 401 })
  }

  const token = await sessionToken(env.APP_PASSWORD)
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      },
    },
  )
}
