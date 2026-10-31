import { isSignedIn, signIn } from './auth'
import { identifyPlant } from './gemini'

const DAILY_WATERING_CHECK = '0 6 * * *'
const WEEKLY_AI_CARE_CHECK = '0 7 * * SUN'

// Photos are resized to ~1024px WebP on the client, so these are only safety limits.
// Together they keep R2 under its free 10 GB, even if every photo is the largest allowed.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const MAX_PLANTS = 5000

const MAX_R2_DELETE_KEYS = 1000

async function readRoomName(request: Request) {
  const body = await request.json<{ name?: unknown }>().catch(() => null)
  return typeof body?.name === 'string' ? body.name.trim() : ''
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (request.method === 'GET' && pathname === '/api/health') {
      return Response.json({ ok: true })
    }

    if (request.method === 'POST' && pathname === '/api/login') {
      return signIn(request, env)
    }

    // Every route below this line needs a session.
    if (!(await isSignedIn(request, env))) {
      return Response.json({ error: 'Not signed in' }, { status: 401 })
    }

    if (request.method === 'GET' && pathname === '/api/session') {
      return Response.json({ ok: true })
    }

    if (request.method === 'GET' && pathname === '/api/plants') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM plants ORDER BY created_at DESC',
      ).all()
      return Response.json(results)
    }

    if (request.method === 'GET' && pathname === '/api/rooms') {
      const { results } = await env.DB.prepare(
        `SELECT rooms.*, COUNT(plants.id) AS plant_count
         FROM rooms
         LEFT JOIN plants ON plants.room_id = rooms.id
         GROUP BY rooms.id
         ORDER BY rooms.name COLLATE NOCASE`,
      ).all()
      return Response.json(results)
    }

    if (request.method === 'POST' && pathname === '/api/rooms') {
      const name = await readRoomName(request)
      if (!name) {
        return Response.json({ error: 'Name is required' }, { status: 400 })
      }
      const room = await env.DB.prepare(
        'INSERT INTO rooms (name) VALUES (?) RETURNING *',
      )
        .bind(name)
        .first()
      return Response.json(room, { status: 201 })
    }

    const roomId = pathname.match(/^\/api\/rooms\/(\d+)$/)?.[1]
    if (request.method === 'GET' && roomId) {
      const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
        .bind(roomId)
        .first()
      if (!room) {
        return Response.json({ error: 'Room not found' }, { status: 404 })
      }
      const { results: plants } = await env.DB.prepare(
        'SELECT * FROM plants WHERE room_id = ? ORDER BY created_at DESC, id DESC',
      )
        .bind(roomId)
        .all()
      return Response.json({ ...room, plants })
    }

    if (request.method === 'PATCH' && roomId) {
      const name = await readRoomName(request)
      if (!name) {
        return Response.json({ error: 'Name is required' }, { status: 400 })
      }
      const room = await env.DB.prepare(
        'UPDATE rooms SET name = ? WHERE id = ? RETURNING *',
      )
        .bind(name, roomId)
        .first()
      if (!room) {
        return Response.json({ error: 'Room not found' }, { status: 404 })
      }
      return Response.json(room)
    }

    if (request.method === 'DELETE' && roomId) {
      const { results: plants } = await env.DB.prepare(
        'SELECT photo_key FROM plants WHERE room_id = ? AND photo_key IS NOT NULL',
      )
        .bind(roomId)
        .all<{ photo_key: string }>()
      const photoKeys = plants.map((plant) => plant.photo_key)
      // Photos go first, so that a failure can be retried and never leaves one orphaned in R2.
      for (let i = 0; i < photoKeys.length; i += MAX_R2_DELETE_KEYS) {
        await env.PHOTOS.delete(photoKeys.slice(i, i + MAX_R2_DELETE_KEYS))
      }
      // Plants need their own delete, because room_id is ON DELETE SET NULL.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM plants WHERE room_id = ?').bind(roomId),
        env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId),
      ])
      return new Response(null, { status: 204 })
    }

    const plantRoomId = pathname.match(/^\/api\/rooms\/(\d+)\/plants$/)?.[1]
    if (request.method === 'POST' && plantRoomId) {
      if (request.headers.get('Content-Type') !== 'image/webp') {
        return Response.json(
          { error: 'Photo must be image/webp' },
          { status: 415 },
        )
      }
      const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?')
        .bind(plantRoomId)
        .first()
      if (!room) {
        return Response.json({ error: 'Room not found' }, { status: 404 })
      }
      const plantCount = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM plants',
      ).first<number>('count')
      if ((plantCount ?? 0) >= MAX_PLANTS) {
        return Response.json({ error: 'Storage limit reached' }, { status: 507 })
      }
      const photo = await request.arrayBuffer()
      if (photo.byteLength === 0 || photo.byteLength > MAX_PHOTO_BYTES) {
        return Response.json({ error: 'Invalid photo size' }, { status: 413 })
      }
      const photoKey = `plants/${crypto.randomUUID()}.webp`
      await env.PHOTOS.put(photoKey, photo, {
        httpMetadata: { contentType: 'image/webp' },
      })
      const plant = await env.DB.prepare(
        'INSERT INTO plants (room_id, photo_key) VALUES (?, ?) RETURNING *',
      )
        .bind(plantRoomId, photoKey)
        .first()
      return Response.json(plant, { status: 201 })
    }

    const plantId = pathname.match(/^\/api\/plants\/(\d+)$/)?.[1]
    if (request.method === 'DELETE' && plantId) {
      const plant = await env.DB.prepare(
        'SELECT photo_key FROM plants WHERE id = ?',
      )
        .bind(plantId)
        .first<{ photo_key: string | null }>()
      if (!plant) {
        return Response.json({ error: 'Plant not found' }, { status: 404 })
      }
      // The photo goes first, so that a failure can be retried and never leaves it orphaned in R2.
      if (plant.photo_key) await env.PHOTOS.delete(plant.photo_key)
      await env.DB.prepare('DELETE FROM plants WHERE id = ?')
        .bind(plantId)
        .run()
      return new Response(null, { status: 204 })
    }

    // Separate from adding a plant, so that a Gemini failure never loses the photo and can be retried.
    const identifyPlantId = pathname.match(
      /^\/api\/plants\/(\d+)\/identify$/,
    )?.[1]
    if (request.method === 'POST' && identifyPlantId) {
      if (!env.GEMINI_API_KEY) {
        return Response.json({ error: 'AI is not set up' }, { status: 503 })
      }
      const plant = await env.DB.prepare(
        'SELECT photo_key FROM plants WHERE id = ?',
      )
        .bind(identifyPlantId)
        .first<{ photo_key: string | null }>()
      const photo =
        plant?.photo_key && (await env.PHOTOS.get(plant.photo_key))
      if (!photo) {
        return Response.json({ error: 'Plant not found' }, { status: 404 })
      }
      let identification
      try {
        identification = await identifyPlant(
          await photo.arrayBuffer(),
          env.GEMINI_API_KEY,
        )
      } catch (error) {
        console.error('Could not identify plant', error)
        return Response.json({ error: 'AI request failed' }, { status: 502 })
      }
      if (!identification) {
        return Response.json({ error: 'No plant in photo' }, { status: 422 })
      }
      const updated = await env.DB.prepare(
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
          identifyPlantId,
        )
        .first()
      return Response.json(updated)
    }

    const photoKey = pathname.match(/^\/api\/photos\/(.+)$/)?.[1]
    if (request.method === 'GET' && photoKey) {
      const photo = await env.PHOTOS.get(decodeURIComponent(photoKey))
      if (!photo) {
        return Response.json({ error: 'Photo not found' }, { status: 404 })
      }
      const headers = new Headers()
      photo.writeHttpMetadata(headers)
      headers.set('ETag', photo.httpEtag)
      // Keys are random and photos are never overwritten. Private because they need a session.
      headers.set('Cache-Control', 'private, max-age=31536000, immutable')
      return new Response(photo.body, { headers })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },

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
