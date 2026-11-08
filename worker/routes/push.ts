import { createApp, validate } from '../app'
import { MAX_PUSH_SUBSCRIPTIONS } from '../limits'
import { sendToEndpoints, vapidConfigured } from '../push'
import { pushEndpointBody, pushSubscriptionBody } from '../schemas'

export const pushRoutes = createApp()
  .get('/key', (c) => {
    if (!vapidConfigured(c.env)) {
      return c.json({ error: 'Push is not set up' }, 503)
    }
    return c.json({ key: c.env.VAPID_PUBLIC_KEY })
  })

  .post('/subscription', validate('json', pushSubscriptionBody), async (c) => {
    const { endpoint, keys } = c.req.valid('json')
    const known = await c.env.DB.prepare(
      'SELECT 1 AS found FROM push_subscriptions WHERE endpoint = ?',
    )
      .bind(endpoint)
      .first()
    if (!known) {
      const count = await c.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM push_subscriptions',
      ).first<number>('count')
      if ((count ?? 0) >= MAX_PUSH_SUBSCRIPTIONS) {
        return c.json({ error: 'Too many devices' }, 409)
      }
    }
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, keys) VALUES (?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET keys = excluded.keys`,
    )
      .bind(endpoint, JSON.stringify(keys))
      .run()
    return c.json({ ok: true }, 201)
  })

  .post('/unsubscribe', validate('json', pushEndpointBody), async (c) => {
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(c.req.valid('json').endpoint)
      .run()
    return c.json({ ok: true })
  })

  // Lets the owner check that a device really receives notifications, without waiting for morning.
  .post('/test', validate('json', pushEndpointBody), async (c) => {
    if (!vapidConfigured(c.env)) {
      return c.json({ error: 'Push is not set up' }, 503)
    }
    const { endpoint } = c.req.valid('json')
    const known = await c.env.DB.prepare(
      'SELECT 1 AS found FROM push_subscriptions WHERE endpoint = ?',
    )
      .bind(endpoint)
      .first()
    if (!known) {
      return c.json({ error: 'Not found' }, 404)
    }
    const [result] = await sendToEndpoints(c.env, [endpoint])
    return result === 'sent'
      ? c.json({ ok: true })
      : c.json({ error: 'Push failed' }, 502)
  })
