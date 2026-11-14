import * as Sentry from '@sentry/cloudflare'
import { dueTaskCount } from '../shared/taskBadge'
import { getTasks } from './tasks'

// Pushes carry no payload, so nothing needs encrypting: the service worker fetches the open tasks
// itself when the push arrives. That keeps the Worker well inside the free CPU limit.
const VAPID_SUBJECT = 'https://yaroki.plants-tracker.workers.dev'
const JWT_LIFETIME_S = 12 * 60 * 60
// A reminder that reaches the phone half a day late is only noise.
const TTL_S = 12 * 60 * 60
const SEND_TIMEOUT_MS = 8000

// The browsers' push services. Only these may be stored as an endpoint, because the Worker
// sends a signed request to whatever URL is saved.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
]

export function isPushServiceUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      PUSH_SERVICE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

export function vapidConfigured(env: Env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

function base64url(bytes: Uint8Array) {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
}

async function importSigningKey(env: Env) {
  const publicKey = Uint8Array.fromBase64(env.VAPID_PUBLIC_KEY, {
    alphabet: 'base64url',
  })
  // The raw public key is 0x04 followed by the 32-byte x and y coordinates.
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(publicKey.slice(1, 33)),
      y: base64url(publicKey.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

async function vapidHeader(
  env: Env,
  key: CryptoKey,
  endpoint: string,
  audiences: Map<string, string>,
) {
  const audience = new URL(endpoint).origin
  let jwt = audiences.get(audience)
  if (!jwt) {
    const encoder = new TextEncoder()
    const part = (value: object) =>
      base64url(encoder.encode(JSON.stringify(value)))
    const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + JWT_LIFETIME_S,
      sub: VAPID_SUBJECT,
    })}`
    // ECDSA in WebCrypto returns the raw r||s form that JWT expects.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(unsigned),
    )
    jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`
    audiences.set(audience, jwt)
  }
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
}

export type PushResult = 'sent' | 'gone' | 'failed'

async function sendPush(
  env: Env,
  key: CryptoKey,
  audiences: Map<string, string>,
  endpoint: string,
): Promise<PushResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(env, key, endpoint, audiences),
        TTL: String(TTL_S),
        Urgency: 'normal',
        'Content-Length': '0',
      },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    if (response.ok) {
      return 'sent'
    }
    // 404 and 410 mean the subscription was cancelled or expired for good.
    if (response.status === 404 || response.status === 410) {
      return 'gone'
    }
    console.error('Push service refused', response.status)
    return 'failed'
  } catch (error) {
    console.error('Push send failed', error)
    Sentry.captureException(error)
    return 'failed'
  }
}

export async function sendToEndpoints(env: Env, endpoints: string[]) {
  const key = await importSigningKey(env)
  const audiences = new Map<string, string>()
  const results = await Promise.all(
    endpoints.map((endpoint) => sendPush(env, key, audiences, endpoint)),
  )
  const gone = endpoints.filter((_, index) => results[index] === 'gone')
  if (gone.length > 0) {
    await env.DB.batch(
      gone.map((endpoint) =>
        env.DB.prepare(
          'DELETE FROM push_subscriptions WHERE endpoint = ?',
        ).bind(endpoint),
      ),
    )
  }
  return results
}

// Runs from the daily cron. Sends nothing when no care is due, or when push is not set up.
export async function sendDueReminders(env: Env) {
  if (!vapidConfigured(env)) {
    return
  }
  if (dueTaskCount(await getTasks(env.DB, false), 'water') === 0) {
    return
  }
  await pushToAll(env)
}

async function pushToAll(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT endpoint FROM push_subscriptions',
  ).all<{ endpoint: string }>()
  if (results.length > 0) {
    await sendToEndpoints(
      env,
      results.map((row) => row.endpoint),
    )
  }
}

// Runs after each climate collection. Pushes when a misting task is due that no push has announced yet:
// the first dry reading, and again each time the task comes back after being done. Once the air is no
// longer dry the memory of it is dropped, so the next dry spell announces itself too.
export async function sendMistingAlerts(env: Env) {
  const { today, tasks } = await getTasks(env.DB, true)
  const due = tasks.filter(
    (task) =>
      task.type === 'mist' && !task.done_today && task.due_date <= today,
  )
  const { results: alerted } = await env.DB.prepare(
    'SELECT plant_id, due_date FROM misting_alerts',
  ).all<{ plant_id: number; due_date: string }>()
  const announced = new Map(alerted.map((row) => [row.plant_id, row.due_date]))
  const fresh = due.filter(
    (task) => announced.get(task.plant_id) !== task.due_date,
  )

  const stillMistTask = new Set(
    tasks.filter((task) => task.type === 'mist').map((task) => task.plant_id),
  )
  const gone = alerted.filter((row) => !stillMistTask.has(row.plant_id))
  const statements = [
    ...gone.map((row) =>
      env.DB.prepare('DELETE FROM misting_alerts WHERE plant_id = ?').bind(
        row.plant_id,
      ),
    ),
    ...fresh.map((task) =>
      env.DB.prepare(
        `INSERT INTO misting_alerts (plant_id, due_date) VALUES (?, ?)
         ON CONFLICT (plant_id) DO UPDATE SET due_date = excluded.due_date`,
      ).bind(task.plant_id, task.due_date),
    ),
  ]
  if (statements.length > 0) {
    await env.DB.batch(statements)
  }
  if (fresh.length > 0 && vapidConfigured(env)) {
    await pushToAll(env)
  }
}
