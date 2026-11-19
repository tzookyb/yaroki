import { addDays, jerusalemDate, todayInJerusalem } from './tasks'

// The AI's watering interval is a first guess. What the owner does corrects it, slowly:
// repeatedly skipping because the soil is still wet means the interval is too short, and repeatedly
// watering well before the due date means it is too long. Other skip reasons say nothing about the plant.
const WINDOW_DAYS = 60
// A change needs time to show its effect before the next one, so a few odd weeks can't snowball.
const COOLDOWN_DAYS = 14
const WET_SKIPS_TO_LENGTHEN = 2
const EARLY_GAPS_TO_SHORTEN = 3
const GAPS_CONSIDERED = 4
// Watering one day early is normal, because tasks show a day ahead.
const EARLY_BY_DAYS = 2
const MIN_DAYS = 1
const MAX_DAYS = 60

export type Cause = 'wet_soil_skips' | 'early_waterings'

type Evidence = {
  current: number
  base: number
  wetSkips: number
  // Dates of waterings since the last change, oldest first, one per day.
  wateredOn: string[]
}

// The new interval and why, or null when nothing should change. Steps are ~10% of the AI's value
// and stay within half to double of it.
export function decideInterval({
  current,
  base,
  wetSkips,
  wateredOn,
}: Evidence): { days: number; cause: Cause } | null {
  const gaps = wateredOn
    .slice(1)
    .map((date, i) => daysBetween(wateredOn[i], date))
    .slice(-GAPS_CONSIDERED)
  const early = gaps.filter((gap) => gap <= current - EARLY_BY_DAYS).length
  const tooShort = wetSkips >= WET_SKIPS_TO_LENGTHEN
  const tooLong = early >= EARLY_GAPS_TO_SHORTEN
  // Opposing signals mean the routine is uneven, not that the interval is wrong.
  if (tooShort === tooLong) {
    return null
  }
  const step = Math.max(1, Math.round(base * 0.1))
  const min = Math.max(MIN_DAYS, Math.ceil(base / 2))
  const max = Math.min(MAX_DAYS, base * 2)
  const days = tooShort
    ? Math.min(max, current + step)
    : Math.max(min, current - step)
  return days === current
    ? null
    : { days, cause: tooShort ? 'wet_soil_skips' : 'early_waterings' }
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

// Daily. Adjusts each plant whose recent history asks for it.
export async function adjustWateringIntervals(db: D1Database) {
  const today = todayInJerusalem()
  const windowStart = addDays(today, -WINDOW_DAYS)
  const { results: plants } = await db
    .prepare(
      `SELECT id, water_every_days, ai_water_every_days,
              (SELECT MAX(changed_on) FROM water_interval_changes WHERE plant_id = plants.id) AS last_change
       FROM plants WHERE water_every_days IS NOT NULL AND ai_water_every_days IS NOT NULL`,
    )
    .all<{
      id: number
      water_every_days: number
      ai_water_every_days: number
      last_change: string | null
    }>()

  for (const plant of plants) {
    if (
      plant.last_change &&
      plant.last_change > addDays(today, -COOLDOWN_DAYS)
    ) {
      continue
    }
    const since =
      plant.last_change && plant.last_change > windowStart
        ? plant.last_change
        : windowStart
    const wetSkips = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM task_skip_log
         WHERE plant_id = ? AND type = 'water' AND reason = 'wet_soil' AND skipped_on > ?`,
      )
      .bind(plant.id, since)
      .first<number>('count')
    const { results: events } = await db
      .prepare(
        `SELECT created_at FROM events
         WHERE plant_id = ? AND type = 'watered' ORDER BY id`,
      )
      .bind(plant.id)
      .all<{ created_at: string }>()
    const wateredOn = [
      ...new Set(
        events
          .map((event) => jerusalemDate(event.created_at))
          .filter((date) => date > since),
      ),
    ].sort()

    const change = decideInterval({
      current: plant.water_every_days,
      base: plant.ai_water_every_days,
      wetSkips: wetSkips ?? 0,
      wateredOn,
    })
    if (!change) {
      continue
    }
    await db.batch([
      db
        .prepare('UPDATE plants SET water_every_days = ? WHERE id = ?')
        .bind(change.days, plant.id),
      db
        .prepare(
          `INSERT INTO water_interval_changes (plant_id, changed_on, from_days, to_days, cause)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          plant.id,
          today,
          plant.water_every_days,
          change.days,
          change.cause,
        ),
    ])
  }
}
