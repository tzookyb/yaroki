import { ENRICH_VERSION, type Plant, type RoomProfile } from '../shared/api'
import { identifyPlant } from './gemini'
import { latestReading } from './roomReading'
import { findReferenceImages } from './wikipedia'

type Outcome =
  { plant: Plant } | { error: string; status: 404 | 422 | 502 | 503 }

// With retry, the current species counts as wrong and the AI is asked for the closest other match.
export async function identifyAndSave(
  env: Env,
  id: number,
  retry: boolean,
): Promise<Outcome> {
  if (!env.GEMINI_API_KEY) {
    return { error: 'AI is not set up', status: 503 }
  }
  const plant = await env.DB.prepare(
    `SELECT photo_key, room_id, name, common_name, species, rejected_species
     FROM plants WHERE id = ?`,
  )
    .bind(id)
    .first<{
      photo_key: string | null
      room_id: number | null
      name: string | null
      common_name: string | null
      species: string | null
      rejected_species: string
    }>()
  const photo = plant?.photo_key && (await env.PHOTOS.get(plant.photo_key))
  if (!photo) {
    return { error: 'Plant not found', status: 404 }
  }
  const rejected: string[] = JSON.parse(plant.rejected_species)
  if (retry && plant.species && !rejected.includes(plant.species)) {
    rejected.push(plant.species)
  }
  const room = plant.room_id
    ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
        .bind(plant.room_id)
        .first<RoomProfile>()
    : null
  let identification
  try {
    identification = await identifyPlant(
      await photo.arrayBuffer(),
      env.GEMINI_API_KEY,
      room ?? undefined,
      (plant.room_id && (await latestReading(env.DB, plant.room_id))) ||
        undefined,
      retry ? rejected : undefined,
    )
  } catch (error) {
    console.error('Could not identify plant', error)
    return { error: 'AI request failed', status: 502 }
  }
  if (!identification) {
    return { error: 'No plant in photo', status: 422 }
  }
  const referenceImages = await findReferenceImages(identification.species)
  // A name the owner changed is kept. Only the name the AI gave is replaced.
  const name =
    retry && plant.name && plant.name !== plant.common_name
      ? plant.name
      : identification.common_name
  const updated = await env.DB.prepare(
    `UPDATE plants
     SET name = ?, species = ?, common_name = ?, english_name = ?, category = ?,
         light_needs = ?, water_every_days = ?, humidity_needs = ?, temp_min = ?,
         temp_max = ?, description = ?, reference_image_url = ?, reference_images = ?,
         care_notes = ?, enriched_version = ?, rejected_species = ?,
         identification_confirmed = 0
     WHERE id = ?
     RETURNING *`,
  )
    .bind(
      name,
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
      referenceImages[0] ?? null,
      JSON.stringify(referenceImages),
      identification.care_notes,
      ENRICH_VERSION,
      JSON.stringify(rejected),
      id,
    )
    .first<Plant>()
  return updated
    ? { plant: updated }
    : { error: 'Plant not found', status: 404 }
}
