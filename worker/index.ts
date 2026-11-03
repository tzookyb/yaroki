import { secureHeaders } from 'hono/secure-headers'
import { createApp } from './app'
import { photoRoutes } from './routes/photos'
import { plantRoutes } from './routes/plants'
import { roomRoutes } from './routes/rooms'
import { publicRoutes, requireSession, sessionRoutes } from './routes/session'
import { taskRoutes } from './routes/tasks'

const DAILY_WATERING_CHECK = '0 6 * * *'
const WEEKLY_AI_CARE_CHECK = '0 7 * * SUN'

// Order matters: routes mounted after requireSession need a signed-in device.
const api = createApp()
  .route('/', publicRoutes)
  .route('/', requireSession)
  .route('/', sessionRoutes)
  .route('/rooms', roomRoutes)
  .route('/plants', plantRoutes)
  .route('/tasks', taskRoutes)
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
    return c.json({ error: 'Server error' }, 500)
  })

export default {
  fetch: app.fetch,

  async scheduled(controller) {
    switch (controller.cron) {
      case DAILY_WATERING_CHECK:
        // TODO: push watering reminders for plants that are due.
        console.log('daily watering check')
        break
      case WEEKLY_AI_CARE_CHECK:
        // TODO: run the AI care check, push only if action is needed.
        console.log('weekly AI care check')
        break
    }
  },
} satisfies ExportedHandler<Env>
