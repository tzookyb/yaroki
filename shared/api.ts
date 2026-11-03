// Types and limits shared by the Worker (worker/) and the app (src/), so both sides agree on the API.

export const ROOM_NAME_MAX_LENGTH = 40

export type Room = {
  id: number
  name: string
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
}

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
