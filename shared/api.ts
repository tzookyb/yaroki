// Types and limits shared by the Worker (worker/) and the app (src/), so both sides agree on the API.

export const ROOM_NAME_MAX_LENGTH = 40

// Raise it when the AI starts saving new data about plants, so existing plants are filled in too.
export const ENRICH_VERSION = 1

export const WINDOW_DIRECTIONS = [
  'north',
  'east',
  'south',
  'west',
  'none',
] as const
export const ROOM_LIGHT_LEVELS = ['direct', 'bright_indirect', 'low'] as const
export const HUMIDITY_LEVELS = ['dry', 'normal', 'humid'] as const
export const LOCATION_TYPES = ['indoor', 'outside_window', 'garden'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]
export const ROOM_TEMP_MIN = 0
export const ROOM_TEMP_MAX = 45

// Flags are 0 or 1, as SQLite stores them.
export type RoomProfile = {
  window_direction: (typeof WINDOW_DIRECTIONS)[number] | null
  light_level: (typeof ROOM_LIGHT_LEVELS)[number] | null
  humidity: (typeof HUMIDITY_LEVELS)[number] | null
  temp_min: number | null
  temp_max: number | null
  near_draft: 0 | 1
  near_ac: 0 | 1
  near_heater: 0 | 1
}

// Newest measurement from the last 3 days, from a sensor or the outdoor weather.
export type RoomReading = { temperature: number; humidity: number | null }

export type Room = RoomProfile & {
  id: number
  name: string
  location_type: LocationType
  plant_count: number
  latest_reading?: RoomReading | null
}

export type Plant = {
  id: number
  room_id: number | null
  name: string | null
  photo_key: string | null
  english_name: string | null
  species: string | null
  category: string | null
  light_needs: string | null
  water_every_days: number | null
  humidity_needs: (typeof HUMIDITY_LEVELS)[number] | null
  temp_min: number | null
  temp_max: number | null
  description: string | null
  reference_image_url: string | null
  enriched_version: number
  care_notes: string | null
}

export type PlantDetails = Plant & {
  room: RoomProfile | null
  latest_reading: RoomReading | null
}

export type RoomDetails = Omit<Room, 'plant_count'> & {
  plants: Plant[]
}

// Why a task was skipped. How long each one postpones the task is decided in worker/tasks.ts.
export const SKIP_REASONS = ['wet_soil', 'dormant', 'away', 'other'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export type Task = {
  type: string
  plant_id: number
  plant_name: string | null
  photo_key: string | null
  room_id: number | null
  room_name: string | null
  // YYYY-MM-DD in Asia/Jerusalem. For a task done today, this is the next due date.
  due_date: string
  done_today: boolean
  // Set while the task is postponed by a skip. `due_date` is then the day it comes back.
  skip_reason: SkipReason | null
}

export type TaskList = {
  today: string
  tasks: Task[]
}

export type ClimateResolution = 'raw' | 'day' | 'week'

export type ClimatePoint = {
  // Unix seconds. Last year's points are shifted a year forward to share this year's axis.
  t: number
  temperature: number
  humidity: number | null
}

export type RoomClimate = {
  // Sensibo devices linked to the room. Most rooms have none, and then show no readings.
  sensor_count: number
  year: number
  // Chosen by how much data this year has: single readings, daily averages, then weekly averages.
  resolution: ClimateResolution
  current: ClimatePoint[]
  previous: ClimatePoint[]
  latest: {
    temperature: number
    humidity: number | null
    measured_at: string
  } | null
}

export type SensiboDevice = {
  id: string
  name: string
  room_id: number | null
}

export type HomeLocation = {
  label: string
  latitude: number
  longitude: number
}
