import { createApp } from '../app'
import { getTasks } from '../tasks'

export const taskRoutes = createApp().get('/', async (c) => {
  const all = c.req.query('all') !== undefined
  return c.json(await getTasks(c.env.DB, all))
})
