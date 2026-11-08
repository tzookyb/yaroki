import * as Sentry from '@sentry/cloudflare'
import { secureHeaders } from 'hono/secure-headers'
import { createApp } from './app'
import { enrichPendingPlants } from './enrich'
import { climateRoutes } from './routes/climate'
import { photoRoutes } from './routes/photos'
import { plantRoutes } from './routes/plants'
import { pushRoutes } from './routes/push'
import { roomRoutes } from './routes/rooms'
import { publicRoutes, requireSession, sessionRoutes } from './routes/session'
import { taskRoutes } from './routes/tasks'
import { sendDueReminders } from './push'
import { collectReadings } from './readings'
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb } from '../shared/sentry'

const DAILY_WATERING_CHECK = '0 6 * * *'
const WEEKLY_AI_CARE_CHECK = '0 7 * * SUN'
const CLIMATE_READINGS = '0 */3 * * *'

// Order matters: routes mounted after requireSession need a signed-in device.
const api = createApp()
  .route('/', publicRoutes)
  .route('/', requireSession)
  .route('/', sessionRoutes)
  .route('/rooms', roomRoutes)
  .route('/climate', climateRoutes)
  .route('/plants', plantRoutes)
  .route('/tasks', taskRoutes)
  .route('/push', pushRoutes)
  .route('/photos', photoRoutes)

const app = createApp()
  // JSON and photos never need to run scripts or be framed.
  .use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  )
  .route('/api', api)
  .notFound((c) => c.json({ error: 'Not found' }, 404))
  .onError((error, c) => {
    console.error('Unhandled error', error)
    Sentry.captureException(error)
    return c.json({ error: 'Server error' }, 500)
  })

const handler = {
  fetch: app.fetch,

  async scheduled(controller, env) {
    switch (controller.cron) {
      case DAILY_WATERING_CHECK:
        // Independent jobs: a failure in one must not skip the other.
        await Promise.allSettled([
          sendDueReminders(env).catch((error) => {
            console.error('Watering reminders failed', error)
            Sentry.captureException(error)
          }),
          enrichPendingPlants(env),
        ])
        break
      case WEEKLY_AI_CARE_CHECK:
        // TODO: run the AI care check, push only if action is needed.
        console.log('weekly AI care check')
        break
      case CLIMATE_READINGS:
        await collectReadings(env)
        break
    }
  },
} satisfies ExportedHandler<Env>

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN || undefined,
    enabled: Boolean(env.SENTRY_DSN),
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeBreadcrumb: scrubBreadcrumb,
  }),
  handler,
)
