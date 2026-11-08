import { useEffect, useState, type FormEvent } from 'react'
import { ROOM_NAME_MAX_LENGTH } from '../shared/api'
import { createRoom, getRooms, type Room } from './api'
import { RoomLocationSetup } from './RoomClimate'
import RoomProfileForm from './RoomProfileForm'
import { ROOMS_CHANGED } from './ManageRooms'

function NewRoomForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const room = await createRoom(name)
      window.dispatchEvent(new Event(ROOMS_CHANGED))
      onCreated(room.id)
    } catch {
      setError('לא הצלחנו להוסיף את החדר.')
      setSaving(false)
    }
  }

  return (
    <form className="room-setup" onSubmit={handleSubmit}>
      <label>
        שם החדר
        <input
          maxLength={ROOM_NAME_MAX_LENGTH}
          placeholder="סלון"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={saving || !name.trim()}>
        {saving ? 'יוצרים…' : 'יצירת חדר'}
      </button>
      <p className="muted">
        אחרי היצירה אפשר להגדיר את תנאי החדר והחיישנים שלו.
      </p>
    </form>
  )
}

function RoomSetup({ roomId }: { roomId: number }) {
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRooms()
      .then((rooms) =>
        setRoom(rooms.find((other) => other.id === roomId) ?? null),
      )
      .catch(() => setError('לא הצלחנו לטעון את החדר.'))
  }, [roomId])

  return (
    <div className="room-setup">
      {error && <p role="alert">{error}</p>}
      {room && (
        <>
          <h3>{room.name}</h3>
          <RoomLocationSetup
            roomId={room.id}
            locationType={room.location_type}
            onLocationChange={(location_type) => {
              setRoom({ ...room, location_type })
              window.dispatchEvent(new Event(ROOMS_CHANGED))
            }}
          />
          <RoomProfileForm
            roomId={room.id}
            profile={room}
            onSaved={(profile) => setRoom({ ...room, ...profile })}
          />
        </>
      )}
    </div>
  )
}

// `target` is a room id, or 'new' for the add-room step.
function RoomSettings({
  target,
  onCreated,
}: {
  target: number | 'new'
  onCreated: (id: number) => void
}) {
  return target === 'new' ? (
    <NewRoomForm onCreated={onCreated} />
  ) : (
    <RoomSetup key={target} roomId={target} />
  )
}

export default RoomSettings
