import type { ClimateWeek, RoomClimate, SensiboDevice } from '../../shared/api'
import { createApp, validate } from '../app'
import { searchPlaces } from '../places'
import { WEATHER_SOURCE, backfillWeather } from '../readings'
import { fetchSensiboDevices } from '../sensibo'
import {
  homeLocationBody,
  idParam,
  locationBody,
  placeQuery,
  sensorBody,
  sensorParam,
} from '../schemas'

const GRAPH_YEARS = 3

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10
}

export const climateRoutes = createApp()
  .get('/rooms/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const [weeks, latest, sensors] = await Promise.all([
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
      c.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM room_sensors WHERE room_id = ?',
      )
        .bind(id)
        .first<number>('count'),
    ])
    const body: RoomClimate = {
      sensor_count: sensors ?? 0,
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

  .get('/home', async (c) => {
    return c.json(
      await c.env.DB.prepare(
        'SELECT label, latitude, longitude FROM home_location WHERE id = 1',
      ).first(),
    )
  })

  .get('/places', validate('query', placeQuery), async (c) => {
    try {
      return c.json(await searchPlaces(c.req.valid('query').q))
    } catch (error) {
      console.error('Address search failed', error)
      return c.json({ error: 'Address search failed' }, 502)
    }
  })

  .put('/home', validate('json', homeLocationBody), async (c) => {
    const home = c.req.valid('json')
    await c.env.DB.prepare(
      `INSERT INTO home_location (id, label, latitude, longitude) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET label = excluded.label,
         latitude = excluded.latitude, longitude = excluded.longitude`,
    )
      .bind(home.label, home.latitude, home.longitude)
      .run()
    // Weather from the old place is wrong now, so outdoor rooms start over from the new one.
    await c.env.DB.prepare('DELETE FROM room_readings WHERE source_id = ?')
      .bind(WEATHER_SOURCE)
      .run()
    const { results: rooms } = await c.env.DB.prepare(
      "SELECT id FROM rooms WHERE location_type != 'indoor'",
    ).all<{ id: number }>()
    for (const room of rooms) {
      try {
        await backfillWeather(c.env, room.id)
      } catch (error) {
        console.error('Weather backfill failed', error)
      }
    }
    return c.json(home)
  })
