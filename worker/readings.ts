import { fetchSensiboDevices } from './sensibo'
import {
  fetchCurrentWeather,
  fetchWeatherHistory,
  homePlace,
  type WeatherReading,
} from './weather'

export const WEATHER_SOURCE = 'weather'
const HISTORY_YEARS = 2

export function saveReadings(
  db: D1Database,
  roomId: number,
  sourceId: string,
  readings: WeatherReading[],
) {
  if (readings.length === 0) {
    return
  }
  // One statement for all rows, because D1 limits a batch to 100 statements.
  return db
    .prepare(
      `INSERT OR IGNORE INTO room_readings (room_id, source_id, measured_at, temperature, humidity)
       SELECT ?, ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]')
       FROM json_each(?)`,
    )
    .bind(
      roomId,
      sourceId,
      JSON.stringify(
        readings.map((r) => [r.measured_at, r.temperature, r.humidity]),
      ),
    )
    .run()
}

async function collectSensibo(env: Env) {
  const { results: sensors } = await env.DB.prepare(
    'SELECT sensibo_id, room_id FROM room_sensors',
  ).all<{ sensibo_id: string; room_id: number }>()
  if (sensors.length === 0) {
    return
  }
  const devices = await fetchSensiboDevices(env.SENSIBO_API_KEY)
  for (const sensor of sensors) {
    const device = devices.find((d) => d.id === sensor.sensibo_id)
    if (device?.temperature == null || !device.measured_at) {
      continue
    }
    await saveReadings(env.DB, sensor.room_id, sensor.sensibo_id, [
      {
        measured_at: device.measured_at,
        temperature: device.temperature,
        humidity: device.humidity,
      },
    ])
  }
}

async function collectWeather(env: Env) {
  const place = await homePlace(env.DB)
  const { results: rooms } = await env.DB.prepare(
    "SELECT id FROM rooms WHERE location_type != 'indoor'",
  ).all<{ id: number }>()
  if (!place || rooms.length === 0) {
    return
  }
  const reading = await fetchCurrentWeather(place)
  for (const room of rooms) {
    await saveReadings(env.DB, room.id, WEATHER_SOURCE, [reading])
  }
}

// Each source fails alone, so a Sensibo outage doesn't stop the weather readings.
export async function collectReadings(env: Env) {
  const jobs: [string, Promise<void>][] = []
  if (env.SENSIBO_API_KEY) {
    jobs.push(['sensibo', collectSensibo(env)])
  }
  jobs.push(['weather', collectWeather(env)])
  for (const [name, job] of jobs) {
    try {
      await job
    } catch (error) {
      console.error(`Collecting ${name} readings failed`, error)
    }
  }
}

function dateText(date: Date) {
  return date.toISOString().slice(0, 10)
}

export async function backfillWeather(env: Env, roomId: number) {
  const place = await homePlace(env.DB)
  if (!place) {
    return
  }
  const existing = await env.DB.prepare(
    'SELECT 1 FROM room_readings WHERE room_id = ? AND source_id = ? LIMIT 1',
  )
    .bind(roomId, WEATHER_SOURCE)
    .first()
  if (existing) {
    return
  }
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const start = new Date(end)
  start.setUTCFullYear(start.getUTCFullYear() - HISTORY_YEARS)
  await saveReadings(
    env.DB,
    roomId,
    WEATHER_SOURCE,
    await fetchWeatherHistory(place, dateText(start), dateText(end)),
  )
}
