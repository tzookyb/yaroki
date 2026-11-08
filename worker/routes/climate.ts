import type {
  ClimatePoint,
  ClimateResolution,
  RoomClimate,
  SensiboDevice,
} from '../../shared/api'
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

const DAY = 86400
// Up to this long a span of this year's data is drawn reading by reading, then daily averages, then weekly.
const RAW_MAX_DAYS = 3
const DAILY_MAX_DAYS = 90

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10
}

function yearStart(year: number) {
  return Date.UTC(year, 0, 1) / 1000
}

function bucketSql(resolution: ClimateResolution) {
  if (resolution === 'raw') {
    return { time: "CAST(strftime('%s', measured_at) AS INTEGER)", group: 'id' }
  }
  const key =
    resolution === 'day'
      ? "strftime('%Y-%m-%d', measured_at)"
      : "strftime('%Y-%W', measured_at)"
  return {
    time: "CAST(AVG(strftime('%s', measured_at)) AS INTEGER)",
    group: key,
  }
}

export const climateRoutes = createApp()
  .get('/rooms/:id', validate('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    const year = new Date().getUTCFullYear()
    const thisStart = yearStart(year)
    const prevStart = yearStart(year - 1)
    const span = await c.env.DB.prepare(
      `SELECT MIN(CAST(strftime('%s', measured_at) AS INTEGER)) AS first,
              MAX(CAST(strftime('%s', measured_at) AS INTEGER)) AS last
       FROM room_readings WHERE room_id = ? AND measured_at >= ?`,
    )
      .bind(id, `${year}-01-01`)
      .first<{ first: number | null; last: number | null }>()
    const days =
      span?.first != null && span.last != null
        ? (span.last - span.first) / DAY
        : 0
    const resolution: ClimateResolution =
      days <= RAW_MAX_DAYS ? 'raw' : days <= DAILY_MAX_DAYS ? 'day' : 'week'
    const { time, group } = bucketSql(resolution)
    // Last year is shifted into this year, so both lines share one time axis.
    const series = (from: string, to: string, shift: number) =>
      c.env.DB.prepare(
        `SELECT ${time} + ? AS t, AVG(temperature) AS temperature, AVG(humidity) AS humidity
         FROM room_readings
         WHERE room_id = ? AND measured_at >= ? AND measured_at < ?
         GROUP BY ${group}
         ORDER BY t`,
      )
        .bind(shift, id, from, to)
        .all<ClimatePoint>()
    const [current, previous, latest, sensors] = await Promise.all([
      series(`${year}-01-01`, `${year + 1}-01-01`, 0),
      series(`${year - 1}-01-01`, `${year}-01-01`, thisStart - prevStart),
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
    const clean = (points: ClimatePoint[]) =>
      points.map((p) => ({
        t: p.t,
        temperature: round(p.temperature) ?? 0,
        humidity: round(p.humidity),
      }))
    const body: RoomClimate = {
      sensor_count: sensors ?? 0,
      year,
      resolution,
      current: clean(current.results),
      previous: clean(previous.results),
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
      await c.env.DB.batch([
        c.env.DB.prepare(
          'DELETE FROM room_sensors WHERE room_id = ? AND sensibo_id != ?',
        ).bind(room_id, sensiboId),
        c.env.DB.prepare(
          `INSERT INTO room_sensors (sensibo_id, room_id) VALUES (?, ?)
           ON CONFLICT (sensibo_id) DO UPDATE SET room_id = excluded.room_id`,
        ).bind(sensiboId, room_id),
      ])
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
