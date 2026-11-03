import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { ZodType } from 'zod'

export type AppEnv = { Bindings: Env }

export function createApp() {
  return new Hono<AppEnv>()
}

// zValidator with one error shape for every route, so no schema details leak to the client.
export function validate<T extends ZodType>(
  target: 'json' | 'param' | 'query',
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }
  })
}
