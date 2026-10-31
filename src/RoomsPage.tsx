import { useEffect, useState, type FormEvent } from 'react'
import {
  createRoom,
  deleteRoom,
  getRooms,
  renameRoom,
  type Room,
} from './api'

function RoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRooms()
      .then(setRooms)
      .catch(() => setError('לא הצלחנו לטעון את החדרים.'))
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
      setError('לא הצלחנו להוסיף את החדר.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault()
    if (!renaming) return

    setError(null)
    try {
      await renameRoom(String(renaming.id), renaming.name)
      setRooms(await getRooms())
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
    if (!window.confirm(message)) return

    setError(null)
    try {
      await deleteRoom(String(room.id))
      setRooms(await getRooms())
    } catch {
      setError('לא הצלחנו למחוק את החדר.')
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>חדרים</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="עריכת חדרים"
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing)
            setRenaming(null)
          }}
        >
          ⚙&#xFE0E;
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {rooms?.length === 0 && <p>עדיין אין חדרים. הוסיפו את הראשון למטה.</p>}
      <ul className="rooms">
        {rooms?.map((room) => (
          <li key={room.id}>
            {!editing ? (
              <a href={`#/rooms/${room.id}`}>
                <span>{room.name}</span>
                <span className="muted">
                  {room.plant_count === 1
                    ? 'צמח אחד'
                    : `${room.plant_count} צמחים`}
                </span>
              </a>
            ) : renaming?.id === room.id ? (
              <form className="inline-form" onSubmit={handleRename}>
                <input
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
      {(editing || rooms?.length === 0) && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            aria-label="שם החדר"
            placeholder="סלון"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={saving || !name.trim()}>
            הוספת חדר
          </button>
        </form>
      )}
    </>
  )
}

export default RoomsPage
