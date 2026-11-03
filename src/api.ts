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

export type RoomDetails = Omit<Room, 'plant_count'> & {
  plants: Plant[]
}

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await send(url, init)
  return response.json()
}

export async function isSignedIn() {
  const response = await fetch('/api/session')
  return response.ok
}

export function signOut() {
  return send('/api/logout', { method: 'POST' })
}

// Dev only: the route exists only in the Vite dev server, see vite.config.ts.
export function pullProd() {
  return send('/__dev/pull-prod', {
    method: 'POST',
    headers: { 'X-Dev-Action': '1' },
  })
}

export function signIn(password: string) {
  return request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export function getRooms() {
  return request<Room[]>('/api/rooms')
}

export function createRoom(name: string) {
  return request<Room>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function getRoom(id: string) {
  return request<RoomDetails>(`/api/rooms/${id}`)
}

export function renameRoom(id: string, name: string) {
  return request<Omit<Room, 'plant_count'>>(`/api/rooms/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function deleteRoom(id: string) {
  return send(`/api/rooms/${id}`, { method: 'DELETE' })
}

export function addPlant(roomId: string, photo: Blob) {
  return request<Plant>(`/api/rooms/${roomId}/plants`, {
    method: 'POST',
    headers: { 'Content-Type': photo.type },
    body: photo,
  })
}

export function identifyPlant(id: number) {
  return request<Plant>(`/api/plants/${id}/identify`, { method: 'POST' })
}

export function deletePlant(id: number) {
  return send(`/api/plants/${id}`, { method: 'DELETE' })
}

export function getTasks(all: boolean) {
  return request<TaskList>(all ? '/api/tasks?all' : '/api/tasks')
}

export function setTaskDone(task: Task, done: boolean) {
  return send(`/api/plants/${task.plant_id}/tasks/${task.type}/done`, {
    method: done ? 'POST' : 'DELETE',
  })
}

export function photoUrl(photoKey: string) {
  return `/api/photos/${photoKey}`
}
