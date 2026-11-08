import { z } from 'zod'
import type { HomeLocation } from '../shared/api'

const PHOTON_URL = 'https://photon.komoot.io/api/'
const TIMEOUT_MS = 8_000
const MAX_RESULTS = 5

const photon = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        name: z.string().nullish(),
        street: z.string().nullish(),
        housenumber: z.string().nullish(),
        city: z.string().nullish(),
        country: z.string().nullish(),
      }),
    }),
  ),
})

// The public Photon server has fair-use limits, which one person typing stays far below.
export async function searchPlaces(query: string): Promise<HomeLocation[]> {
  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', query)
  // Extra results, because Photon returns one per street segment and those share a label.
  url.searchParams.set('limit', String(MAX_RESULTS * 2))
  url.searchParams.set('lang', 'en')
  const response = await fetch(url, {
    headers: { 'User-Agent': 'yaroki-plant-tracker' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Photon returned ${response.status}`)
  }
  const places = new Map<string, HomeLocation>()
  for (const feature of photon.parse(await response.json()).features) {
    const { name, street, housenumber, city, country } = feature.properties
    const road = street ? [street, housenumber].filter(Boolean).join(' ') : null
    const label = [
      ...new Set([name, road, city, country].filter(Boolean)),
    ].join(', ')
    if (!places.has(label)) {
      places.set(label, {
        label,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      })
    }
  }
  return [...places.values()].slice(0, MAX_RESULTS)
}
