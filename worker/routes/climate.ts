import type { ClimateWeek, RoomClimate, SensiboDevice } from '../../shared/api'
import { createApp, validate } from '../app'
import { backfillWeather } from '../readings'
import { fetchSensiboDevices } from '../sensibo'
import { idParam, locationBody, sensorBody, sensorParam } from '../schemas'

const GRAPH_YEARS = 3

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10
}

export const climateRoutes = createApp()
  .get('/rooms/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const [weeks, latest] = await Promise.all([
      c.env.DB.prepare(
        `SELECT CAST(strftime('%Y', measured_at) AS INTEGER) AS year,
                CAST(strftime('%W', measured_at) AS INTEGER) AS week,
                AVG(temperature) AS temperature,
                AVG(humidity) AS humidity
         FROM room_readings
         WHERE room_id = ? AND measured_at >= date('now', ?)
         GROUP BY year, week
         ORDER BY year, week`,
      )
        .bind(id, `-${GRAPH_YEARS} years`)
        .all<ClimateWeek>(),
      c.env.DB.prepare(
        `SELECT temperature, humidity, measured_at FROM room_readings
         WHERE room_id = ? ORDER BY measured_at DESC LIMIT 1`,
      )
        .bind(id)
        .first<NonNullable<RoomClimate['latest']>>(),
    ])
    const body: RoomClimate = {
      weeks: weeks.results.map((w) => ({
        ...w,
        temperature: round(w.temperature) ?? 0,
        humidity: round(w.humidity),
      })),
      latest,
    }
    return c.json(body)
  })

  .put(
    '/rooms/:id/location',
    validate('param', idParam),
    validate('json', locationBody),
    async (c) => {
      const { id } = c.req.valid('param')
      const { location_type } = c.req.valid('json')
      const room = await c.env.DB.prepare(
        'UPDATE rooms SET location_type = ? WHERE id = ? RETURNING *',
      )
        .bind(location_type, id)
        .first()
      if (!room) {
        return c.json({ error: 'Room not found' }, 404)
      }
      if (location_type !== 'indoor') {
        try {
          await backfillWeather(c.env, id)
        } catch (error) {
          // The cron fills the graph over time, so the change itself still stands.
          console.error('Weather backfill failed', error)
        }
      }
      return c.json(room)
    },
  )

  .get('/sensors', async (c) => {
    if (!c.env.SENSIBO_API_KEY) {
      return c.json({ error: 'Sensibo is not set up' }, 503)
    }
    let devices
    try {
      devices = await fetchSensiboDevices(c.env.SENSIBO_API_KEY)
    } catch (error) {
      console.error('Sensibo request failed', error)
      return c.json({ error: 'Sensibo request failed' }, 502)
    }
    const { results: mapped } = await c.env.DB.prepare(
      'SELECT sensibo_id, room_id FROM room_sensors',
    ).all<{ sensibo_id: string; room_id: number }>()
    const roomOf = new Map(mapped.map((m) => [m.sensibo_id, m.room_id]))
    const body: SensiboDevice[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      room_id: roomOf.get(d.id) ?? null,
    }))
    return c.json(body)
  })

  .put(
    '/sensors/:sensiboId',
    validate('param', sensorParam),
    validate('json', sensorBody),
    async (c) => {
      const { sensiboId } = c.req.valid('param')
      const { room_id } = c.req.valid('json')
      if (room_id === null) {
        await c.env.DB.prepare('DELETE FROM room_sensors WHERE sensibo_id = ?')
          .bind(sensiboId)
          .run()
        return c.body(null, 204)
      }
      const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE id = ?')
        .bind(room_id)
        .first()
      if (!room) {
        return c.json({ error: 'Room not found' }, 404)
      }
      await c.env.DB.prepare(
        `INSERT INTO room_sensors (sensibo_id, room_id) VALUES (?, ?)
         ON CONFLICT (sensibo_id) DO UPDATE SET room_id = excluded.room_id`,
      )
        .bind(sensiboId, room_id)
        .run()
      return c.body(null, 204)
    },
  )
