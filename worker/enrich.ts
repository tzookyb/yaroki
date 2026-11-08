import { ENRICH_VERSION, type RoomProfile } from '../shared/api'
import { describePlant } from './gemini'
import { latestReading } from './roomReading'
import { findReferenceImage } from './wikipedia'

// Fills in the AI data that plants identified before ENRICH_VERSION went up don't have yet.
// The name and species stay as they are. Returns whether anything was updated.
export async function enrichPlant(env: Env, id: number) {
  if (!env.GEMINI_API_KEY) {
    return false
  }
  const plant = await env.DB.prepare(
    `SELECT species, room_id, reference_image_url FROM plants
     WHERE id = ? AND enriched_version < ?`,
  )
    .bind(id, ENRICH_VERSION)
    .first<{
      species: string | null
      room_id: number | null
      reference_image_url: string | null
    }>()
  if (!plant?.species) {
    return false
  }

  const room = plant.room_id
    ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
        .bind(plant.room_id)
        .first<RoomProfile>()
    : null
  const needs = await describePlant(
    plant.species,
    env.GEMINI_API_KEY,
    room ?? undefined,
    (plant.room_id && (await latestReading(env.DB, plant.room_id))) ||
      undefined,
  )
  const referenceImage =
    plant.reference_image_url ?? (await findReferenceImage(plant.species))
  await env.DB.prepare(
    `UPDATE plants
     SET humidity_needs = ?, temp_min = ?, temp_max = ?, description = ?,
         care_notes = COALESCE(care_notes, ?), reference_image_url = ?,
         enriched_version = ?
     WHERE id = ?`,
  )
    .bind(
      needs.humidity_needs,
      needs.temp_min,
      needs.temp_max,
      needs.description,
      needs.care_notes,
      referenceImage,
      ENRICH_VERSION,
      id,
    )
    .run()
  return true
}

// A few per run, to stay inside the free Gemini quota. The rest wait for the next run.
const PLANTS_PER_RUN = 5

export async function enrichPendingPlants(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM plants
     WHERE species IS NOT NULL AND enriched_version < ?
     ORDER BY id LIMIT ?`,
  )
    .bind(ENRICH_VERSION, PLANTS_PER_RUN)
    .all<{ id: number }>()
  for (const { id } of results) {
    try {
      await enrichPlant(env, id)
    } catch (error) {
      console.error('Could not enrich plant', id, error)
    }
  }
}
