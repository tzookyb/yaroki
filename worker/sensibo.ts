import { z } from 'zod'

const PODS_URL = 'https://home.sensibo.com/api/v2/users/me/pods'
const TIMEOUT_MS = 10_000

const pods = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      room: z.object({ name: z.string() }).nullish(),
      measurements: z
        .object({
          temperature: z.number().nullish(),
          humidity: z.number().nullish(),
          time: z.object({ time: z.string() }).nullish(),
        })
        .nullish(),
    }),
  ),
})

export type SensiboReading = {
  id: string
  name: string
  temperature: number | null
  humidity: number | null
  measured_at: string | null
}

// The API only takes the key as a query parameter. scrubBreadcrumb keeps it out of Sentry.
export async function fetchSensiboDevices(
  apiKey: string,
): Promise<SensiboReading[]> {
  const url = new URL(PODS_URL)
  url.searchParams.set('fields', 'id,room,measurements')
  url.searchParams.set('apiKey', apiKey)
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Sensibo returned ${response.status}`)
  }
  return pods.parse(await response.json()).result.map((pod) => ({
    id: pod.id,
    name: pod.room?.name ?? pod.id,
    temperature: pod.measurements?.temperature ?? null,
    humidity: pod.measurements?.humidity ?? null,
    measured_at: pod.measurements?.time?.time
      ? toUtcText(pod.measurements.time.time)
      : null,
  }))
}

// Same shape as D1's datetime('now'), so readings sort and group like every other date in the DB.
function toUtcText(iso: string) {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}
