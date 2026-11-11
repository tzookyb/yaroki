import * as Sentry from '@sentry/cloudflare'
import { secureHeaders } from 'hono/secure-headers'
import { createApp } from './app'
import { backfillReferenceImages, enrichPendingPlants } from './enrich'
import { climateRoutes } from './routes/climate'
import { photoRoutes } from './routes/photos'
import { plantRoutes } from './routes/plants'
import { pushRoutes } from './routes/push'
import { roomRoutes } from './routes/rooms'
import { publicRoutes, requireSession, sessionRoutes } from './routes/session'
import { taskRoutes } from './routes/tasks'
import {
  learnHourFromHistory,
  learnHourWithAi,
  sendReminderIfTime,
} from './reminderTime'
import { collectReadings } from './readings'
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb } from '../shared/sentry'

// Runs every hour so the reminder can go out in the hour the owner usually waters.
const HOURLY_CHECK = '0 * * * *'
// 06:00 UTC is the daily slot for the jobs that need only one run a day.
const DAILY_UTC_HOUR = 6
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
      case HOURLY_CHECK: {
        // Independent jobs: a failure in one must not skip the others.
        const jobs = [sendReminderIfTime(env), backfillReferenceImages(env)]
        if (
          new Date(controller.scheduledTime).getUTCHours() === DAILY_UTC_HOUR
        ) {
          jobs.push(learnHourFromHistory(env.DB), enrichPendingPlants(env))
        }
        await Promise.allSettled(jobs)
        break
      }
      case WEEKLY_AI_CARE_CHECK:
        // TODO: run the AI care check, push only if action is needed.
        console.log('weekly AI care check')
        await learnHourWithAi(env).catch((error) => {
          console.error('Learning the reminder hour failed', error)
          Sentry.captureException(error)
        })
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
