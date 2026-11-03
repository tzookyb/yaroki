const COOKIE_NAME = 'session'
const SESSION_DAYS = 365
const CLEAR_COOKIE = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`

// Short passwords are refused at login, so a weak secret can't be guessed.
// Vite sets DEV only under `npm run dev`, so local dev can use any password.
const MIN_PASSWORD_LENGTH = import.meta.env.DEV ? 1 : 20

const encoder = new TextEncoder()

function toHex(bytes: ArrayBuffer | Uint8Array) {
  return new Uint8Array(bytes).toHex()
}

async function sha256(text: string) {
  return crypto.subtle.digest('SHA-256', encoder.encode(text))
}

async function isEqual(a: string, b: string) {
  // Hashing first gives equal lengths, which timingSafeEqual requires.
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)])
  return crypto.subtle.timingSafeEqual(hashA, hashB)
}

function readSessionToken(request: Request) {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
}

// A missing APP_PASSWORD keeps the API locked, even for devices that signed in before.
export async function isSignedIn(request: Request, env: Env) {
  if (!env.APP_PASSWORD) {
    return false
  }
  const token = readSessionToken(request)
  if (!token) {
    return false
  }
  const session = await env.DB.prepare(
    "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')",
  )
    .bind(toHex(await sha256(token)))
    .first()
  return Boolean(session)
}

export async function signIn(request: Request, env: Env, password: string) {
  // Per IP, so someone else's wrong guesses never block the owner.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { success } = await env.LOGIN_LIMIT.limit({ key: ip })
  if (!success) {
    return Response.json({ error: 'Too many attempts' }, { status: 429 })
  }

  if (!env.APP_PASSWORD || env.APP_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: 'Server password too short' },
      { status: 503 },
    )
  }

  if (!(await isEqual(password, env.APP_PASSWORD))) {
    return Response.json({ error: 'Wrong password' }, { status: 401 })
  }

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_agent, expires_at)
       VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    ).bind(
      toHex(await sha256(token)),
      request.headers.get('User-Agent')?.slice(0, 200) ?? null,
    ),
  ])
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': `${COOKIE_NAME}=${token}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      },
    },
  )
}

// Signs out this device only.
export async function signOut(request: Request, env: Env) {
  const token = readSessionToken(request)
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(toHex(await sha256(token)))
      .run()
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': CLEAR_COOKIE } },
  )
}

// For a lost or stolen device: ends every session, this one included.
export async function signOutEverywhere(env: Env) {
  await env.DB.prepare('DELETE FROM sessions').run()
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': CLEAR_COOKIE } },
  )
}
