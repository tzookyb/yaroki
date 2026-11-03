const COOKIE_NAME = 'session'
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
    encoder.encode('yaroki-session'),
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
        'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
      },
    },
  )
}

// Both checks fail when APP_PASSWORD is unset, so a missing secret locks the API.
export async function isSignedIn(request: Request, env: Env) {
  if (!env.APP_PASSWORD) return false
  const token = request.headers
    .get('Cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  if (!token) return false
  return isEqual(token, await sessionToken(env.APP_PASSWORD))
}

export async function signIn(request: Request, env: Env) {
  const { success } = await env.LOGIN_LIMIT.limit({ key: 'login' })
  if (!success) {
    return Response.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const body = await request.json<{ password?: unknown }>().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (
    !env.APP_PASSWORD ||
    !password ||
    !(await isEqual(password, env.APP_PASSWORD))
  ) {
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
