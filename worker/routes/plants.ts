import { z } from 'zod'
import type { Plant } from '../../shared/api'
import { createApp, validate } from '../app'
import { identifyPlant } from '../gemini'
import { idParam } from '../schemas'
import { setTaskDone } from '../tasks'

const taskParam = idParam.extend({ type: z.string().regex(/^\w+$/) })

export const plantRoutes = createApp()
  .get('/', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM plants ORDER BY created_at DESC',
    ).all<Plant>()
    return c.json(results)
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
    const { id } = c.req.valid('param')
    if (!c.env.GEMINI_API_KEY) {
      return c.json({ error: 'AI is not set up' }, 503)
    }
    const plant = await c.env.DB.prepare(
      'SELECT photo_key FROM plants WHERE id = ?',
    )
      .bind(id)
      .first<{ photo_key: string | null }>()
    const photo = plant?.photo_key && (await c.env.PHOTOS.get(plant.photo_key))
    if (!photo) {
      return c.json({ error: 'Plant not found' }, 404)
    }
    let identification
    try {
      identification = await identifyPlant(
        await photo.arrayBuffer(),
        c.env.GEMINI_API_KEY,
      )
    } catch (error) {
      console.error('Could not identify plant', error)
      return c.json({ error: 'AI request failed' }, 502)
    }
    if (!identification) {
      return c.json({ error: 'No plant in photo' }, 422)
    }
    const updated = await c.env.DB.prepare(
      `UPDATE plants
       SET name = ?, species = ?, common_name = ?, english_name = ?, category = ?,
           light_needs = ?, water_every_days = ?
       WHERE id = ?
       RETURNING *`,
    )
      .bind(
        identification.common_name,
        identification.species,
        identification.common_name,
        identification.english_name,
        identification.category,
        identification.light_needs,
        identification.water_every_days,
        id,
      )
      .first()
    return c.json(updated)
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
