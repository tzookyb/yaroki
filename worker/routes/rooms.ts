import type { Plant, Room } from '../../shared/api'
import { createApp, validate } from '../app'
import { MAX_PHOTO_BYTES, MAX_PLANTS, MAX_R2_DELETE_KEYS } from '../limits'
import { idParam, roomBody } from '../schemas'

export const roomRoutes = createApp()
  .get('/', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT rooms.*, COUNT(plants.id) AS plant_count
       FROM rooms
       LEFT JOIN plants ON plants.room_id = rooms.id
       GROUP BY rooms.id
       ORDER BY rooms.name COLLATE NOCASE`,
    ).all<Room>()
    return c.json(results)
  })

  .post('/', validate('json', roomBody), async (c) => {
    const room = await c.env.DB.prepare(
      'INSERT INTO rooms (name) VALUES (?) RETURNING *',
    )
      .bind(c.req.valid('json').name)
      .first()
    return c.json(room, 201)
  })

  .get('/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
      .bind(id)
      .first()
    if (!room) {
      return c.json({ error: 'Room not found' }, 404)
    }
    const { results: plants } = await c.env.DB.prepare(
      'SELECT * FROM plants WHERE room_id = ? ORDER BY created_at DESC, id DESC',
    )
      .bind(id)
      .all<Plant>()
    return c.json({ ...room, plants })
  })

  .patch(
    '/:id',
    validate('param', idParam),
    validate('json', roomBody),
    async (c) => {
      const room = await c.env.DB.prepare(
        'UPDATE rooms SET name = ? WHERE id = ? RETURNING *',
      )
        .bind(c.req.valid('json').name, c.req.valid('param').id)
        .first()
      if (!room) {
        return c.json({ error: 'Room not found' }, 404)
      }
      return c.json(room)
    },
  )

  .delete('/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const { results: plants } = await c.env.DB.prepare(
      'SELECT photo_key FROM plants WHERE room_id = ? AND photo_key IS NOT NULL',
    )
      .bind(id)
      .all<{ photo_key: string }>()
    const photoKeys = plants.map((plant) => plant.photo_key)
    // Photos go first, so that a failure can be retried and never leaves one orphaned in R2.
    for (let i = 0; i < photoKeys.length; i += MAX_R2_DELETE_KEYS) {
      await c.env.PHOTOS.delete(photoKeys.slice(i, i + MAX_R2_DELETE_KEYS))
    }
    // Plants need their own delete, because room_id is ON DELETE SET NULL.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM plants WHERE room_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(id),
    ])
    return c.body(null, 204)
  })

  // The body is the photo itself, not JSON. The plant is named later by /plants/:id/identify.
  .post('/:id/plants', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    if (c.req.header('Content-Type') !== 'image/webp') {
      return c.json({ error: 'Photo must be image/webp' }, 415)
    }
    const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE id = ?')
      .bind(id)
      .first()
    if (!room) {
      return c.json({ error: 'Room not found' }, 404)
    }
    const plantCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM plants',
    ).first<number>('count')
    if ((plantCount ?? 0) >= MAX_PLANTS) {
      return c.json({ error: 'Storage limit reached' }, 507)
    }
    // Checked before reading, so an oversized upload is refused without buffering it.
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_PHOTO_BYTES) {
      return c.json({ error: 'Invalid photo size' }, 413)
    }
    const photo = await c.req.arrayBuffer()
    if (photo.byteLength === 0 || photo.byteLength > MAX_PHOTO_BYTES) {
      return c.json({ error: 'Invalid photo size' }, 413)
    }
    const photoKey = `plants/${crypto.randomUUID()}.webp`
    await c.env.PHOTOS.put(photoKey, photo, {
      httpMetadata: { contentType: 'image/webp' },
    })
    const plant = await c.env.DB.prepare(
      'INSERT INTO plants (room_id, photo_key) VALUES (?, ?) RETURNING *',
    )
      .bind(id, photoKey)
      .first()
    return c.json(plant, 201)
  })
