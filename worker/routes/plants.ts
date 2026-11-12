import { z } from 'zod'
import {
  type Plant,
  type PlantDetails,
  type RoomProfile,
} from '../../shared/api'
import { createApp, validate } from '../app'
import { enrichPlant } from '../enrich'
import { identifyAndSave } from '../identify'
import { latestReading } from '../roomReading'
import { idParam, skipBody } from '../schemas'
import { getTasks, setTaskDone, setTaskSkipped } from '../tasks'

const taskParam = idParam.extend({ type: z.string().regex(/^\w+$/) })

export const plantRoutes = createApp()
  .get('/', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM plants ORDER BY created_at DESC',
    ).all<Plant>()
    return c.json(results)
  })

  .get('/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const plant = await c.env.DB.prepare('SELECT * FROM plants WHERE id = ?')
      .bind(id)
      .first<Plant>()
    if (!plant) {
      return c.json({ error: 'Plant not found' }, 404)
    }
    const room = plant.room_id
      ? await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
          .bind(plant.room_id)
          .first<RoomProfile>()
      : null
    const reading = plant.room_id
      ? await latestReading(c.env.DB, plant.room_id)
      : null
    const details: PlantDetails = {
      ...plant,
      room,
      latest_reading: reading,
      tasks: await getTasks(c.env.DB, true, id),
    }
    return c.json(details)
  })

  .delete('/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const plant = await c.env.DB.prepare(
      'SELECT photo_key FROM plants WHERE id = ?',
    )
      .bind(id)
      .first<{ photo_key: string | null }>()
    if (!plant) {
      return c.json({ error: 'Plant not found' }, 404)
    }
    // The photo goes first, so that a failure can be retried and never leaves it orphaned in R2.
    if (plant.photo_key) {
      await c.env.PHOTOS.delete(plant.photo_key)
    }
    await c.env.DB.prepare('DELETE FROM plants WHERE id = ?').bind(id).run()
    return c.body(null, 204)
  })

  // Separate from adding a plant, so that a Gemini failure never loses the photo and can be retried.
  .post('/:id/identify', validate('param', idParam), async (c) => {
    const result = await identifyAndSave(c.env, c.req.valid('param').id, false)
    return 'plant' in result
      ? c.json(result.plant)
      : c.json({ error: result.error }, result.status)
  })

  // The owner says the identification is wrong: ask again, excluding the species already rejected.
  .post('/:id/reidentify', validate('param', idParam), async (c) => {
    const result = await identifyAndSave(c.env, c.req.valid('param').id, true)
    return 'plant' in result
      ? c.json(result.plant)
      : c.json({ error: result.error }, result.status)
  })

  // The owner has checked the species against the reference photos, so re-identifying is no longer offered.
  .post('/:id/confirm', validate('param', idParam), async (c) => {
    const plant = await c.env.DB.prepare(
      'UPDATE plants SET identification_confirmed = 1 WHERE id = ? AND species IS NOT NULL RETURNING *',
    )
      .bind(c.req.valid('param').id)
      .first<Plant>()
    return plant ? c.json(plant) : c.json({ error: 'Plant not found' }, 404)
  })

  // Called by the plant page for plants that miss data added after they were identified.
  .post('/:id/enrich', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    if (!c.env.GEMINI_API_KEY) {
      return c.json({ error: 'AI is not set up' }, 503)
    }
    try {
      await enrichPlant(c.env, id)
    } catch (error) {
      console.error('Could not enrich plant', error)
      return c.json({ error: 'AI request failed' }, 502)
    }
    const plant = await c.env.DB.prepare('SELECT * FROM plants WHERE id = ?')
      .bind(id)
      .first<Plant>()
    return plant ? c.json(plant) : c.json({ error: 'Plant not found' }, 404)
  })

  .on(
    ['POST', 'DELETE'],
    '/:id/tasks/:type/done',
    validate('param', taskParam),
    async (c) => {
      const { id, type } = c.req.valid('param')
      const done = c.req.method === 'POST'
      if (!(await setTaskDone(c.env.DB, type, id, done))) {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.body(null, 204)
    },
  )

  .post(
    '/:id/tasks/:type/skip',
    validate('param', taskParam),
    validate('json', skipBody),
    async (c) => {
      const { id, type } = c.req.valid('param')
      const { reason } = c.req.valid('json')
      if (!(await setTaskSkipped(c.env.DB, type, id, reason))) {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.body(null, 204)
    },
  )

  .delete('/:id/tasks/:type/skip', validate('param', taskParam), async (c) => {
    const { id, type } = c.req.valid('param')
    if (!(await setTaskSkipped(c.env.DB, type, id, null))) {
      return c.json({ error: 'Task not found' }, 404)
    }
    return c.body(null, 204)
  })
