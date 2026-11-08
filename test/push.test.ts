import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDueReminders } from '../worker/push'
import { addPlant, api, json, signIn } from './helpers'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const subscription = {
  endpoint: ENDPOINT,
  keys: { p256dh: 'key', auth: 'auth' },
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM push_subscriptions').run()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function subscribe(token: string, body: unknown = subscription) {
  return api('/push/subscription', json(body), token)
}

async function subscriptionCount() {
  return env.DB.prepare(
    'SELECT COUNT(*) AS count FROM push_subscriptions',
  ).first<number>('count')
}

describe('subscriptions', () => {
  it('gives the public key to a signed-in device', async () => {
    const { token } = await signIn()
    const response = await api('/push/key', {}, token)
    expect(await response.json()).toEqual({ key: env.VAPID_PUBLIC_KEY })
  })

  it('saves a subscription once, even if sent twice', async () => {
    const { token } = await signIn()
    expect((await subscribe(token)).status).toBe(201)
    expect((await subscribe(token)).status).toBe(201)
    expect(await subscriptionCount()).toBe(1)
  })

  it('refuses an endpoint that is not a known push service', async () => {
    const { token } = await signIn()
    for (const endpoint of [
      'https://evil.example.com/push',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.com/x',
      'not a url',
    ]) {
      expect(
        (await subscribe(token, { ...subscription, endpoint })).status,
      ).toBe(400)
    }
    expect(await subscriptionCount()).toBe(0)
  })

  it('removes a subscription', async () => {
    const { token } = await signIn()
    await subscribe(token)
    const response = await api(
      '/push/unsubscribe',
      json({ endpoint: ENDPOINT }),
      token,
    )
    expect(response.status).toBe(200)
    expect(await subscriptionCount()).toBe(0)
  })

  it('drops all subscriptions when signing out everywhere', async () => {
    const { token } = await signIn()
    await subscribe(token)
    await api('/logout-all', { method: 'POST' }, token)
    expect(await subscriptionCount()).toBe(0)
  })
})

describe('daily reminders', () => {
  function mockPushService(status = 201) {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status }))
  }

  async function saveSubscription() {
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint, keys) VALUES (?, ?)',
    )
      .bind(ENDPOINT, '{}')
      .run()
  }

  it('sends a signed, empty push when a plant is due', async () => {
    await addPlant({ water_every_days: 7 })
    await saveSubscription()
    const fetchMock = mockPushService()
    await sendDueReminders(env)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toMatch(
      new RegExp(
        `^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_PUBLIC_KEY}$`,
      ),
    )
    expect(init?.body).toBeUndefined()
  })

  it('sends nothing when no plant is due', async () => {
    await addPlant({ water_every_days: null })
    await saveSubscription()
    const fetchMock = mockPushService()
    await sendDueReminders(env)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when push is not set up', async () => {
    await addPlant({ water_every_days: 7 })
    await saveSubscription()
    const fetchMock = mockPushService()
    vi.spyOn(env, 'VAPID_PRIVATE_KEY', 'get').mockReturnValue('')
    await sendDueReminders(env)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forgets a subscription the push service says is gone', async () => {
    await addPlant({ water_every_days: 7 })
    await saveSubscription()
    mockPushService(410)
    await sendDueReminders(env)
    expect(await subscriptionCount()).toBe(0)
  })

  it('keeps a subscription after a temporary failure', async () => {
    await addPlant({ water_every_days: 7 })
    await saveSubscription()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPushService(503)
    await sendDueReminders(env)
    expect(await subscriptionCount()).toBe(1)
  })
})

describe('test push', () => {
  it('sends to a known subscription and 404s for an unknown one', async () => {
    const { token } = await signIn()
    expect(
      (await api('/push/test', json({ endpoint: ENDPOINT }), token)).status,
    ).toBe(404)
    await subscribe(token)
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 201 }),
    )
    expect(
      (await api('/push/test', json({ endpoint: ENDPOINT }), token)).status,
    ).toBe(200)
  })
})
