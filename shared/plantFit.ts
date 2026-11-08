import type { Plant, RoomProfile } from './api'

export type Fit = 'ok' | 'low' | 'high' | null

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

// What the room gives compared to what the plant needs. null when either side is unknown.
export function lightFit(
  plant: Pick<Plant, 'light_needs'>,
  room: Pick<RoomProfile, 'light_level'>,
): Fit {
  const needs = PLANT_LIGHT_RANK[plant.light_needs ?? '']
  const has = ROOM_LIGHT_RANK[room.light_level ?? '']
  if (needs === undefined || has === undefined) {
    return null
  }
  if (has < needs) {
    return 'low'
  }
  // One step above is fine; two or more would burn a plant that wants shade.
  return has - needs >= 2 ? 'high' : 'ok'
}

export function humidityFit(
  plant: Pick<Plant, 'humidity_needs'>,
  room: Pick<RoomProfile, 'humidity'>,
): Fit {
  const needs = HUMIDITY_RANK[plant.humidity_needs ?? '']
  const has = HUMIDITY_RANK[room.humidity ?? '']
  if (needs === undefined || has === undefined) {
    return null
  }
  return has < needs ? 'low' : has > needs ? 'high' : 'ok'
}

export function temperatureFit(
  plant: Pick<Plant, 'temp_min' | 'temp_max'>,
  room: Pick<RoomProfile, 'temp_min' | 'temp_max'>,
): Fit {
  const { temp_min: needsMin, temp_max: needsMax } = plant
  const { temp_min: hasMin, temp_max: hasMax } = room
  if (needsMin === null || needsMax === null) {
    return null
  }
  if (hasMin !== null && hasMin < needsMin) {
    return 'low'
  }
  if (hasMax !== null && hasMax > needsMax) {
    return 'high'
  }
  return hasMin === null && hasMax === null ? null : 'ok'
}
