import { useEffect, useState, type FormEvent } from 'react'
import RoomSettings from './RoomSettings'
import { ROOM_NAME_MAX_LENGTH } from '../shared/api'
import { deleteRoom, getRooms, renameRoom, type Room } from './api'

// Lets the room list and room page refresh after a change made here.
export const ROOMS_CHANGED = 'rooms-changed'

function ManageRooms() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [setup, setSetup] = useState<number | 'new' | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      getRooms()
        .then(setRooms)
        .catch(() => setError('לא הצלחנו לטעון את החדרים.'))
    }
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [])

  function refresh() {
    window.dispatchEvent(new Event(ROOMS_CHANGED))
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault()
    if (!renaming) {
      return
    }

    setError(null)
    try {
      await renameRoom(String(renaming.id), renaming.name)
      refresh()
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
      refresh()
    } catch {
      setError('לא הצלחנו למחוק את החדר.')
    }
  }

  if (setup !== null) {
    return (
      <>
        <button
          type="button"
          className="link-button"
          onClick={() => setSetup(null)}
        >
          → חזרה לחדרים
        </button>
        <RoomSettings target={setup} onCreated={setSetup} />
      </>
    )
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
                  aria-label={`תנאי החדר ${room.name}`}
                  onClick={() => setSetup(room.id)}
                >
                  ⚙&#xFE0E;
                </button>
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
      <button type="button" onClick={() => setSetup('new')}>
        הוספת חדר
      </button>
    </>
  )
}

export default ManageRooms
