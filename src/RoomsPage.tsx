import { useEffect, useState } from 'react'
import { getRooms, type Room } from './api'
import { ROOMS_CHANGED } from './ManageRooms'
import NextTasks from './NextTasks'

function RoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
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

  return (
    <>
      <NextTasks />
      <h1>חדרים</h1>
      {error && <p role="alert">{error}</p>}
      {rooms?.length === 0 && (
        <p>עדיין אין חדרים. אפשר להוסיף חדר מ"ניהול חדרים" בהגדרות.</p>
      )}
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
    </>
  )
}

export default RoomsPage
