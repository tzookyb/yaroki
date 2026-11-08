import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, json, signIn } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sign-in', () => {
  it('gives a session cookie for the right password', async () => {
    const { response, token } = await signIn()
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toMatch(
      /HttpOnly; Secure; SameSite=Strict/,
    )
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await api('/session', {}, token)).status).toBe(200)
  })

  it('stores only a hash of the token', async () => {
    const { token } = await signIn()
    const { results } = await env.DB.prepare(
      'SELECT token_hash FROM sessions',
    ).all<{ token_hash: string }>()
    expect(results).toHaveLength(1)
    expect(results[0].token_hash).not.toBe(token)
  })

  it('refuses a wrong password', async () => {
    const { response, token } = await signIn('wrong-password')
    expect(response.status).toBe(401)
    expect(token).toBe('')
  })

  it('refuses a missing or empty password', async () => {
    expect((await api('/login', json({}))).status).toBe(400)
    expect((await api('/login', json({ password: '' }))).status).toBe(400)
  })

  it('gives each sign-in its own session', async () => {
    const first = await signIn()
    const second = await signIn()
    expect(first.token).not.toBe(second.token)
  })

  it('rate limits sign-in attempts from one IP', async () => {
    const attempt = () =>
      api('/login', {
        ...json({ password: 'wrong-password' }),
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
      })
    const statuses = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await attempt()).status)
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401))
    expect(statuses.at(-1)).toBe(429)
  })
})

describe('sessions', () => {
  it('refuses an expired session', async () => {
    const { token } = await signIn()
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = datetime('now', '-1 minute')",
    ).run()
    expect((await api('/session', {}, token)).status).toBe(401)
  })

  it('refuses a made-up token', async () => {
    expect((await api('/session', {}, 'a'.repeat(64))).status).toBe(401)
  })

  it('signs out only this device', async () => {
    const phone = await signIn()
    const laptop = await signIn()
    const response = await api('/logout', { method: 'POST' }, phone.token)
    expect(response.headers.get('Set-Cookie')).toMatch(/Max-Age=0/)
    expect((await api('/session', {}, phone.token)).status).toBe(401)
    expect((await api('/session', {}, laptop.token)).status).toBe(200)
  })

  it('signs out every device', async () => {
    const phone = await signIn()
    const laptop = await signIn()
    await api('/logout-all', { method: 'POST' }, phone.token)
    expect((await api('/session', {}, phone.token)).status).toBe(401)
    expect((await api('/session', {}, laptop.token)).status).toBe(401)
  })

  it('locks the API when APP_PASSWORD is missing, even for signed-in devices', async () => {
    const { token } = await signIn()
    vi.spyOn(env, 'APP_PASSWORD', 'get').mockReturnValue('')
    expect((await api('/session', {}, token)).status).toBe(401)
    expect((await signIn('')).response.status).toBe(400)
  })
})

describe('route guard', () => {
  // Every API route. A new route must be added here, and must need a session.
  const protectedRoutes = [
    ['GET', '/session'],
    ['POST', '/logout'],
    ['POST', '/logout-all'],
    ['GET', '/rooms'],
    ['POST', '/rooms'],
    ['GET', '/rooms/1'],
    ['PATCH', '/rooms/1'],
    ['PUT', '/rooms/1/profile'],
    ['DELETE', '/rooms/1'],
    ['POST', '/rooms/1/plants'],
    ['GET', '/plants'],
    ['DELETE', '/plants/1'],
    ['GET', '/plants/1'],
    ['POST', '/plants/1/identify'],
    ['POST', '/plants/1/tasks/water/done'],
    ['DELETE', '/plants/1/tasks/water/done'],
    ['GET', '/climate/rooms/1'],
    ['PUT', '/climate/rooms/1/location'],
    ['GET', '/climate/home'],
    ['PUT', '/climate/home'],
    ['GET', '/climate/places?q=abc'],
    ['GET', '/climate/sensors'],
    ['PUT', '/climate/sensors/abc'],
    ['GET', '/tasks'],
    ['GET', '/photos/plants/x.webp'],
  ]

  it.each(protectedRoutes)('%s %s needs a session', async (method, path) => {
    expect((await api(path, { method })).status).toBe(401)
  })

  it('leaves only health and login open', async () => {
    expect((await api('/health')).status).toBe(200)
  })
})
