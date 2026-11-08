import { z } from 'zod'
import {
  ENRICH_VERSION,
  type Plant,
  type PlantDetails,
  type RoomProfile,
} from '../../shared/api'
import { createApp, validate } from '../app'
import { enrichPlant } from '../enrich'
import { identifyPlant } from '../gemini'
import { findReferenceImage } from '../wikipedia'
import { idParam, skipBody } from '../schemas'
import { setTaskDone, setTaskSkipped } from '../tasks'

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
    // Old readings (a broken sensor, a room switched to outdoor) say nothing about now.
    const latestReading = plant.room_id
      ? await c.env.DB.prepare(
          `SELECT temperature, humidity FROM room_readings
           WHERE room_id = ? AND measured_at >= date('now', '-3 days')
           ORDER BY measured_at DESC LIMIT 1`,
        )
          .bind(plant.room_id)
          .first<NonNullable<PlantDetails['latest_reading']>>()
      : null
    const details: PlantDetails = {
      ...plant,
      room,
      latest_reading: latestReading,
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
    const { id } = c.req.valid('param')
    if (!c.env.GEMINI_API_KEY) {
      return c.json({ error: 'AI is not set up' }, 503)
    }
    const plant = await c.env.DB.prepare(
      'SELECT photo_key, room_id FROM plants WHERE id = ?',
    )
      .bind(id)
      .first<{ photo_key: string | null; room_id: number | null }>()
    const photo = plant?.photo_key && (await c.env.PHOTOS.get(plant.photo_key))
    if (!photo) {
      return c.json({ error: 'Plant not found' }, 404)
    }
    const room = plant.room_id
      ? await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
          .bind(plant.room_id)
          .first<RoomProfile>()
      : null
    let identification
    try {
      identification = await identifyPlant(
        await photo.arrayBuffer(),
        c.env.GEMINI_API_KEY,
        room ?? undefined,
      )
    } catch (error) {
      console.error('Could not identify plant', error)
      return c.json({ error: 'AI request failed' }, 502)
    }
    if (!identification) {
      return c.json({ error: 'No plant in photo' }, 422)
    }
    const referenceImage = await findReferenceImage(identification.species)
    const updated = await c.env.DB.prepare(
      `UPDATE plants
       SET name = ?, species = ?, common_name = ?, english_name = ?, category = ?,
           light_needs = ?, water_every_days = ?, humidity_needs = ?, temp_min = ?,
           temp_max = ?, description = ?, reference_image_url = ?, care_notes = ?,
           enriched_version = ?
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
        identification.humidity_needs,
        identification.temp_min,
        identification.temp_max,
        identification.description,
        referenceImage,
        identification.care_notes,
        ENRICH_VERSION,
        id,
      )
      .first()
    return c.json(updated)
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
