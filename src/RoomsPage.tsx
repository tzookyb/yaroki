import { useEffect, useState, type FormEvent } from 'react'
import { createRoom, getRooms, type Room } from './api'

function RoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRooms()
      .then(setRooms)
      .catch(() => setError('Could not load rooms.'))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createRoom(name)
      setRooms(await getRooms())
      setName('')
    } catch {
      setError('Could not add the room.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h1>Rooms</h1>
      {error && <p role="alert">{error}</p>}
      {rooms?.length === 0 && <p>No rooms yet. Add your first one below.</p>}
      <ul className="rooms">
        {rooms?.map((room) => (
          <li key={room.id}>
            <a href={`#/rooms/${room.id}`}>
              <span>{room.name}</span>
              <span className="muted">
                {room.plant_count}{' '}
                {room.plant_count === 1 ? 'plant' : 'plants'}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <form className="add-room" onSubmit={handleSubmit}>
        <input
          aria-label="Room name"
          placeholder="Living room"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={saving || !name.trim()}>
          Add room
        </button>
      </form>
    </>
  )
}

export default RoomsPage
