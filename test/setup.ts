import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

// Storage is shared by the tests in a file, so each test starts from empty tables.
beforeEach(async () => {
  await env.DB.batch(
    [
      'events',
      'plants',
      'home_location',
      'room_readings',
      'room_sensors',
      'rooms',
      'sessions',
      'push_subscriptions',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  )
})
