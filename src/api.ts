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
}

export type RoomDetails = Omit<Room, 'plant_count'> & {
  plants: Plant[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function isSignedIn() {
  const response = await fetch('/api/session')
  return response.ok
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

export function addPlant(roomId: string, photo: Blob) {
  return request<Plant>(`/api/rooms/${roomId}/plants`, {
    method: 'POST',
    headers: { 'Content-Type': photo.type },
    body: photo,
  })
}

export function photoUrl(photoKey: string) {
  return `/api/photos/${photoKey}`
}
