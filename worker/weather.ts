import { z } from 'zod'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const TIMEOUT_MS = 10_000

export type WeatherReading = {
  measured_at: string
  temperature: number
  humidity: number | null
}

export type Place = { latitude: number; longitude: number }

export function homePlace(db: D1Database) {
  return db
    .prepare('SELECT latitude, longitude FROM home_location WHERE id = 1')
    .first<Place>()
}

async function get(base: string, place: Place, params: Record<string, string>) {
  const url = new URL(base)
  url.searchParams.set('latitude', String(place.latitude))
  url.searchParams.set('longitude', String(place.longitude))
  url.searchParams.set('timezone', 'UTC')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status}`)
  }
  return response.json()
}

const current = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number().nullish(),
  }),
})

export async function fetchCurrentWeather(
  place: Place,
): Promise<WeatherReading> {
  const { current: now } = current.parse(
    await get(FORECAST_URL, place, {
      current: 'temperature_2m,relative_humidity_2m',
    }),
  )
  return {
    // With timezone=UTC the time has no seconds and no zone, like 2026-11-08T15:00.
    measured_at: `${now.time.replace('T', ' ')}:00`,
    temperature: now.temperature_2m,
    humidity: now.relative_humidity_2m ?? null,
  }
}

const history = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_mean: z.array(z.number().nullable()),
    relative_humidity_2m_mean: z.array(z.number().nullable()),
  }),
})

// Daily means, stamped at noon UTC. Lets an outdoor room show past years right away.
export async function fetchWeatherHistory(
  place: Place,
  startDate: string,
  endDate: string,
): Promise<WeatherReading[]> {
  const { daily } = history.parse(
    await get(ARCHIVE_URL, place, {
      start_date: startDate,
      end_date: endDate,
      daily: 'temperature_2m_mean,relative_humidity_2m_mean',
    }),
  )
  const readings: WeatherReading[] = []
  daily.time.forEach((day, i) => {
    const temperature = daily.temperature_2m_mean[i]
    if (temperature !== null && temperature !== undefined) {
      readings.push({
        measured_at: `${day} 12:00:00`,
        temperature,
        humidity: daily.relative_humidity_2m_mean[i] ?? null,
      })
    }
  })
  return readings
}
