// Types and limits shared by the Worker (worker/) and the app (src/), so both sides agree on the API.

export const ROOM_NAME_MAX_LENGTH = 40

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

export type Room = RoomProfile & {
  id: number
  name: string
  location_type: LocationType
  plant_count: number
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
  care_notes: string | null
}

export type PlantDetails = Plant & { room: RoomProfile | null }

export type RoomDetails = Omit<Room, 'plant_count'> & {
  plants: Plant[]
}

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
}

export type TaskList = {
  today: string
  tasks: Task[]
}

export type ClimateWeek = {
  year: number
  // Week of the year, 0 to 53, counting from the first Monday as SQLite's %W does.
  week: number
  temperature: number
  humidity: number | null
}

export type RoomClimate = {
  weeks: ClimateWeek[]
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
