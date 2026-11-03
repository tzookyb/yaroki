import { isSignedIn, signIn, signOut, signOutEverywhere } from '../auth'
import { createApp, validate } from '../app'
import { loginBody } from '../schemas'

// Routes that work without a session.
export const publicRoutes = createApp()
  .get('/health', (c) => c.json({ ok: true }))
  .post('/login', validate('json', loginBody), (c) =>
    signIn(c.req.raw, c.env, c.req.valid('json').password),
  )

// Every route mounted after this middleware needs a session.
export const requireSession = createApp().use(async (c, next) => {
  if (!(await isSignedIn(c.req.raw, c.env))) {
    return c.json({ error: 'Not signed in' }, 401)
  }
  await next()
})

export const sessionRoutes = createApp()
  .get('/session', (c) => c.json({ ok: true }))
  .post('/logout', (c) => signOut(c.req.raw, c.env))
  .post('/logout-all', (c) => signOutEverywhere(c.env))
