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

  return (
    <>
      <h1>חדרים</h1>
      {error && <p role="alert">{error}</p>}
      {rooms?.length === 0 && <p>עדיין אין חדרים. הוסיפו את הראשון למטה.</p>}
      <ul className="rooms">
        {rooms?.map((room) => (
          <li key={room.id}>
            <a href={`#/rooms/${room.id}`}>
              <span>{room.name}</span>
              <span className="muted">
                {room.plant_count === 1
                  ? 'צמח אחד'
                  : `${room.plant_count} צמחים`}
              </span>
            </a>
          </li>
        ))}
      </ul>
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
    </>
  )
}

export default RoomsPage
