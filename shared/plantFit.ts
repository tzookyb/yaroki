import type { Plant, RoomProfile } from './api'

export type Verdict = 'good' | 'warn' | 'bad'
export type Fit = {
  verdict: Verdict
  // Which way the room misses the plant's need. null when it fits.
  direction: 'low' | 'high' | null
  // Whether a sensor or weather reading decided it, or the room profile the owner filled in.
  source: 'reading' | 'profile'
}

export type Reading = { temperature: number; humidity: number | null }

const PLANT_LIGHT_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  bright_indirect: 2,
  direct: 3,
}
const ROOM_LIGHT_RANK: Record<string, number> = {
  low: 0,
  bright_indirect: 2,
  direct: 3,
}
const HUMIDITY_RANK: Record<string, number> = { dry: 0, normal: 1, humid: 2 }

// Relative humidity (%) that counts as each level.
const HUMIDITY_BANDS: Record<string, [number, number]> = {
  dry: [0, 40],
  normal: [40, 60],
  humid: [60, 100],
}
const HUMIDITY_WARN_MARGIN = 10
const TEMPERATURE_WARN_MARGIN = 3

function fit(
  verdict: Verdict,
  direction: Fit['direction'],
  source: Fit['source'],
): Fit {
  return { verdict, direction: verdict === 'good' ? null : direction, source }
}

// How far outside [min, max] a value is. Negative when below, positive when above, 0 when inside.
function overshoot(value: number, min: number, max: number) {
  return value < min ? value - min : value > max ? value - max : 0
}

function fromOvershoot(over: number, margin: number, source: Fit['source']) {
  const size = Math.abs(over)
  return fit(
    size === 0 ? 'good' : size <= margin ? 'warn' : 'bad',
    over < 0 ? 'low' : 'high',
    source,
  )
}

// What the room gives compared to what the plant needs. null when either side is unknown.
export function lightFit(
  plant: Pick<Plant, 'light_needs'>,
  room: Pick<RoomProfile, 'light_level'>,
): Fit | null {
  const needs = PLANT_LIGHT_RANK[plant.light_needs ?? '']
  const has = ROOM_LIGHT_RANK[room.light_level ?? '']
  if (needs === undefined || has === undefined) {
    return null
  }
  // One step short is borderline. One step above is fine, two would burn a plant that wants shade.
  const gap = has - needs
  const verdict: Verdict =
    gap === 0 || gap === 1 ? 'good' : gap === -1 || gap === 2 ? 'warn' : 'bad'
  return fit(verdict, gap < 0 ? 'low' : 'high', 'profile')
}

export function humidityFit(
  plant: Pick<Plant, 'humidity_needs'>,
  room: Pick<RoomProfile, 'humidity'>,
  reading?: Pick<Reading, 'humidity'> | null,
): Fit | null {
  const needs = plant.humidity_needs ?? ''
  if (reading?.humidity != null && HUMIDITY_BANDS[needs]) {
    const [min, max] = HUMIDITY_BANDS[needs]
    return fromOvershoot(
      overshoot(reading.humidity, min, max),
      HUMIDITY_WARN_MARGIN,
      'reading',
    )
  }
  const need = HUMIDITY_RANK[needs]
  const has = HUMIDITY_RANK[room.humidity ?? '']
  if (need === undefined || has === undefined) {
    return null
  }
  const gap = has - need
  return fit(
    gap === 0 ? 'good' : Math.abs(gap) === 1 ? 'warn' : 'bad',
    gap < 0 ? 'low' : 'high',
    'profile',
  )
}

export function temperatureFit(
  plant: Pick<Plant, 'temp_min' | 'temp_max'>,
  room: Pick<RoomProfile, 'temp_min' | 'temp_max'>,
  reading?: Pick<Reading, 'temperature'> | null,
): Fit | null {
  const { temp_min: needsMin, temp_max: needsMax } = plant
  if (needsMin === null || needsMax === null) {
    return null
  }
  if (reading) {
    return fromOvershoot(
      overshoot(reading.temperature, needsMin, needsMax),
      TEMPERATURE_WARN_MARGIN,
      'reading',
    )
  }
  const { temp_min: hasMin, temp_max: hasMax } = room
  if (hasMin === null && hasMax === null) {
    return null
  }
  // The worse of the two ends decides.
  const low = hasMin === null ? 0 : Math.min(0, hasMin - needsMin)
  const high = hasMax === null ? 0 : Math.max(0, hasMax - needsMax)
  return fromOvershoot(
    Math.abs(low) >= high ? low : high,
    TEMPERATURE_WARN_MARGIN,
    'profile',
  )
}
