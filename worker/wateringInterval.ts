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

// The owner rarely checks a plant before its task is due, so "watered early" almost never happens by itself.
// Instead, once a plant has been steady for a while and its room has turned warmer or drier than usual
// (so the soil probably dries faster), the interval is shortened one step as a probe. A wet-soil skip
// during the probe says it was too early and undoes it; watering on the earlier date confirms it.
const PROBE_QUIET_DAYS = 45
const PROBE_MIN_WATERINGS = 3
const WARMER_BY = 2
const DRIER_BY = 8
const RECENT_DAYS = 7
const BASELINE_DAYS = 30

export type Cause =
  | 'wet_soil_skips'
  | 'early_waterings'
  | 'probe'
  | 'probe_accepted'
  | 'probe_failed'

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

type Climate = { t: number | null; h: number | null }

// True when the last week is clearly warmer or drier than the month before it.
export function dryingFaster(recent: Climate, baseline: Climate) {
  const warmer =
    recent.t !== null &&
    baseline.t !== null &&
    recent.t - baseline.t >= WARMER_BY
  const drier =
    recent.h !== null &&
    baseline.h !== null &&
    baseline.h - recent.h >= DRIER_BY
  return warmer || drier
}

// The probe's shorter interval, or null when the plant has no room for one.
export function probeInterval(current: number, base: number) {
  const days = current - Math.max(1, Math.round(base * 0.1))
  return days >= Math.max(MIN_DAYS, Math.ceil(base / 2)) ? days : null
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

async function climateOf(
  db: D1Database,
  roomId: number | null,
  today: string,
): Promise<{ recent: Climate; baseline: Climate }> {
  const recentFrom = addDays(today, -RECENT_DAYS)
  const baselineFrom = addDays(today, -RECENT_DAYS - BASELINE_DAYS)
  // A room without readings of its own is judged by the house sensors.
  const sources: [string, number | null][] = [['home_readings', null]]
  if (roomId !== null) {
    sources.unshift(['room_readings', roomId])
  }
  for (const [table, id] of sources) {
    const row = await db
      .prepare(
        `SELECT AVG(CASE WHEN measured_at >= ?1 THEN temperature END) AS rt,
                AVG(CASE WHEN measured_at >= ?1 THEN humidity END) AS rh,
                AVG(CASE WHEN measured_at < ?1 THEN temperature END) AS bt,
                AVG(CASE WHEN measured_at < ?1 THEN humidity END) AS bh
         FROM ${table} WHERE measured_at >= ?2 ${id === null ? '' : 'AND room_id = ?3'}`,
      )
      .bind(
        ...(id === null
          ? [recentFrom, baselineFrom]
          : [recentFrom, baselineFrom, id]),
      )
      .first<{
        rt: number | null
        rh: number | null
        bt: number | null
        bh: number | null
      }>()
    if (row && row.rt !== null && row.bt !== null) {
      return {
        recent: { t: row.rt, h: row.rh },
        baseline: { t: row.bt, h: row.bh },
      }
    }
  }
  return { recent: { t: null, h: null }, baseline: { t: null, h: null } }
}

type PlantRow = {
  id: number
  room_id: number | null
  water_every_days: number
  ai_water_every_days: number
  water_probe_from: number | null
  last_change: string | null
}

function record(
  db: D1Database,
  plant: PlantRow,
  today: string,
  days: number,
  cause: Cause,
  probeFrom: number | null,
) {
  return db.batch([
    db
      .prepare(
        'UPDATE plants SET water_every_days = ?, water_probe_from = ? WHERE id = ?',
      )
      .bind(days, probeFrom, plant.id),
    db
      .prepare(
        `INSERT INTO water_interval_changes (plant_id, changed_on, from_days, to_days, cause)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(plant.id, today, plant.water_every_days, days, cause),
  ])
}

async function wateredDates(db: D1Database, plantId: number, after: string) {
  const { results } = await db
    .prepare(
      `SELECT created_at FROM events WHERE plant_id = ? AND type = 'watered' ORDER BY id`,
    )
    .bind(plantId)
    .all<{ created_at: string }>()
  return [
    ...new Set(
      results
        .map((event) => jerusalemDate(event.created_at))
        .filter((date) => date > after),
    ),
  ].sort()
}

async function skipCount(
  db: D1Database,
  plantId: number,
  after: string,
  wetOnly: boolean,
) {
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM task_skip_log
       WHERE plant_id = ? AND type = 'water' AND skipped_on > ?
       ${wetOnly ? "AND reason = 'wet_soil'" : ''}`,
    )
    .bind(plantId, after)
    .first<number>('count')
  return count ?? 0
}

// Daily. Adjusts each plant whose recent history asks for it.
export async function adjustWateringIntervals(db: D1Database) {
  const today = todayInJerusalem()
  const windowStart = addDays(today, -WINDOW_DAYS)
  const { results: plants } = await db
    .prepare(
      `SELECT id, room_id, water_every_days, ai_water_every_days, water_probe_from,
              (SELECT MAX(changed_on) FROM water_interval_changes WHERE plant_id = plants.id) AS last_change
       FROM plants WHERE water_every_days IS NOT NULL AND ai_water_every_days IS NOT NULL`,
    )
    .all<PlantRow>()

  for (const plant of plants) {
    const lastChange = plant.last_change

    if (plant.water_probe_from !== null && lastChange) {
      // Any wet-soil skip since the probe began means it was too early.
      if (await skipCount(db, plant.id, lastChange, true)) {
        await record(
          db,
          plant,
          today,
          plant.water_probe_from,
          'probe_failed',
          null,
        )
      } else if ((await wateredDates(db, plant.id, lastChange)).length > 0) {
        await record(
          db,
          plant,
          today,
          plant.water_every_days,
          'probe_accepted',
          null,
        )
      }
      continue
    }

    if (lastChange && lastChange > addDays(today, -COOLDOWN_DAYS)) {
      continue
    }
    const since =
      lastChange && lastChange > windowStart ? lastChange : windowStart
    const wateredOn = await wateredDates(db, plant.id, since)
    const change = decideInterval({
      current: plant.water_every_days,
      base: plant.ai_water_every_days,
      wetSkips: await skipCount(db, plant.id, since, true),
      wateredOn,
    })
    if (change) {
      await record(db, plant, today, change.days, change.cause, null)
      continue
    }

    const quiet = !lastChange || lastChange <= addDays(today, -PROBE_QUIET_DAYS)
    const probe = probeInterval(
      plant.water_every_days,
      plant.ai_water_every_days,
    )
    if (
      !quiet ||
      probe === null ||
      (await skipCount(
        db,
        plant.id,
        addDays(today, -PROBE_QUIET_DAYS),
        false,
      )) ||
      (await wateredDates(db, plant.id, addDays(today, -PROBE_QUIET_DAYS)))
        .length < PROBE_MIN_WATERINGS
    ) {
      continue
    }
    const { recent, baseline } = await climateOf(db, plant.room_id, today)
    if (dryingFaster(recent, baseline)) {
      await record(db, plant, today, probe, 'probe', plant.water_every_days)
    }
  }
}
