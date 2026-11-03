import { useEffect, useState, type FormEvent } from 'react'
import { ROOM_NAME_MAX_LENGTH } from '../shared/api'
import { createRoom, deleteRoom, getRooms, renameRoom, type Room } from './api'

// Lets the room list and room page refresh after a change made here.
export const ROOMS_CHANGED = 'rooms-changed'

function ManageRooms() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRooms()
      .then(setRooms)
      .catch(() => setError('לא הצלחנו לטעון את החדרים.'))
  }, [])

  async function refresh() {
    setRooms(await getRooms())
    window.dispatchEvent(new Event(ROOMS_CHANGED))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createRoom(name)
      await refresh()
      setName('')
    } catch {
      setError('לא הצלחנו להוסיף את החדר.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault()
    if (!renaming) {
      return
    }

    setError(null)
    try {
      await renameRoom(String(renaming.id), renaming.name)
      await refresh()
      setRenaming(null)
    } catch {
      setError('לא הצלחנו לשנות את השם.')
    }
  }

  async function handleDelete(room: Room) {
    const message =
      room.plant_count === 0
        ? `למחוק את החדר "${room.name}"?`
        : `למחוק את החדר "${room.name}" ואת כל הצמחים שבו (${room.plant_count}) עם התמונות שלהם? אי אפשר לבטל את הפעולה.`
    if (!window.confirm(message)) {
      return
    }

    setError(null)
    try {
      await deleteRoom(String(room.id))
      if (window.location.hash === `#/rooms/${room.id}`) {
        window.location.assign('#/')
      }
      await refresh()
    } catch {
      setError('לא הצלחנו למחוק את החדר.')
    }
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <ul className="rooms">
        {rooms?.map((room) => (
          <li key={room.id}>
            {renaming?.id === room.id ? (
              <form className="inline-form" onSubmit={handleRename}>
                <input
                  maxLength={ROOM_NAME_MAX_LENGTH}
                  aria-label="שם החדר"
                  autoFocus
                  value={renaming.name}
                  onChange={(event) =>
                    setRenaming({ id: room.id, name: event.target.value })
                  }
                />
                <button type="submit" disabled={!renaming.name.trim()}>
                  שמירה
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRenaming(null)}
                >
                  ביטול
                </button>
              </form>
            ) : (
              <div className="room-edit">
                <span>{room.name}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRenaming({ id: room.id, name: room.name })}
                >
                  שינוי שם
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleDelete(room)}
                >
                  מחיקה
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          maxLength={ROOM_NAME_MAX_LENGTH}
          aria-label="שם החדר"
          placeholder="סלון"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={saving || !name.trim()}>
          הוספת חדר
        </button>
      </form>
    </>
  )
}

export default ManageRooms
