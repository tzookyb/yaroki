import type {
  HomeLocation,
  LocationType,
  Plant,
  PlantDetails,
  Room,
  RoomClimate,
  RoomDetails,
  RoomProfile,
  SensiboDevice,
  SkipReason,
  Task,
  TaskList,
} from '../shared/api'

export type {
  HomeLocation,
  Plant,
  PlantDetails,
  LocationType,
  Room,
  RoomClimate,
  RoomDetails,
  RoomProfile,
  SensiboDevice,
  SkipReason,
  Task,
  TaskList,
} from '../shared/api'

export class HttpError extends Error {
  status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new HttpError(response.status)
  }
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

export function signOutEverywhere() {
  return send('/api/logout-all', { method: 'POST' })
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

export function saveRoomProfile(id: number, profile: RoomProfile) {
  return request<RoomProfile>(`/api/rooms/${id}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
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

export function getPlant(id: string) {
  return request<PlantDetails>(`/api/plants/${id}`)
}

export function enrichPlant(id: number) {
  return request<Plant>(`/api/plants/${id}/enrich`, { method: 'POST' })
}

export function identifyPlant(id: number) {
  return request<Plant>(`/api/plants/${id}/identify`, { method: 'POST' })
}

export function reidentifyPlant(id: number) {
  return request<Plant>(`/api/plants/${id}/reidentify`, { method: 'POST' })
}

export function confirmPlant(id: number) {
  return request<Plant>(`/api/plants/${id}/confirm`, { method: 'POST' })
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

export function skipTask(task: Task, reason: SkipReason) {
  return send(`/api/plants/${task.plant_id}/tasks/${task.type}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}

export function unskipTask(task: Task) {
  return send(`/api/plants/${task.plant_id}/tasks/${task.type}/skip`, {
    method: 'DELETE',
  })
}

export function photoUrl(photoKey: string) {
  return `/api/photos/${photoKey}`
}

export function getRoomClimate(roomId: number) {
  return request<RoomClimate>(`/api/climate/rooms/${roomId}`)
}

export function setLocationType(roomId: number, locationType: LocationType) {
  return send(`/api/climate/rooms/${roomId}/location`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_type: locationType }),
  })
}

export function getSensors() {
  return request<SensiboDevice[]>('/api/climate/sensors')
}

export function setSensorRoom(
  sensiboId: string,
  roomId: number | null,
  name?: string,
) {
  return send(`/api/climate/sensors/${sensiboId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, name }),
  })
}

export function getHomeLocation() {
  return request<HomeLocation | null>('/api/climate/home')
}

export function searchPlaces(query: string, signal: AbortSignal) {
  return request<HomeLocation[]>(
    `/api/climate/places?q=${encodeURIComponent(query)}`,
    { signal },
  )
}

export function saveHomeLocation(home: HomeLocation) {
  return request<HomeLocation>('/api/climate/home', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(home),
  })
}

export async function getPushKey() {
  return (await request<{ key: string }>('/api/push/key')).key
}

export function savePushSubscription(subscription: PushSubscriptionJSON) {
  return send('/api/push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  })
}

export function deletePushSubscription(endpoint: string) {
  return send('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}

export function sendTestPush(endpoint: string) {
  return send('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}
