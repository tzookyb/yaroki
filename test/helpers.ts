import { env, exports } from 'cloudflare:workers'

export function api(path: string, init: RequestInit = {}, session?: string) {
  const headers = new Headers(init.headers)
  if (session) {
    headers.set('Cookie', `session=${session}`)
  }
  return exports.default.fetch(`https://app.test/api${path}`, {
    ...init,
    headers,
  })
}

export function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

let ipCounter = 0

// Each sign-in comes from its own IP, so tests never hit the rate limit by accident.
export async function signIn(password: string = env.APP_PASSWORD) {
  const response = await api('/login', {
    ...json({ password }),
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.0.0.${++ipCounter}`,
    },
  })
  const cookie = response.headers.get('Set-Cookie') ?? ''
  return { response, token: cookie.match(/^session=([^;]*)/)?.[1] ?? '' }
}

export async function addRoom(name = 'סלון') {
  const { results } = await env.DB.prepare(
    'INSERT INTO rooms (name) VALUES (?) RETURNING id',
  )
    .bind(name)
    .run<{ id: number }>()
  return results[0].id
}

export async function addPlant(fields: {
  room_id?: number | null
  name?: string
  water_every_days?: number | null
  last_watered?: string | null
  photo_key?: string | null
}) {
  const { results } = await env.DB.prepare(
    `INSERT INTO plants (room_id, name, water_every_days, last_watered, photo_key)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      fields.room_id ?? null,
      fields.name ?? 'פיקוס',
      fields.water_every_days ?? null,
      fields.last_watered ?? null,
      fields.photo_key ?? null,
    )
    .run<{ id: number }>()
  return results[0].id
}

// Adds a "watered" event at a UTC time, as D1's datetime('now') would store it.
export async function addWatering(plantId: number, utc: string) {
  await env.DB.prepare(
    "INSERT INTO events (plant_id, type, created_at) VALUES (?, 'watered', ?)",
  )
    .bind(plantId, utc)
    .run()
}
