import { useEffect, useState } from 'react'
import { getRooms, type Room } from './api'
import { RoomLocationSetup } from './RoomClimate'
import RoomProfileForm from './RoomProfileForm'
import { ROOMS_CHANGED } from './ManageRooms'

function RoomSettings() {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [roomId, setRoomId] = useState<number | null>(null)
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

  const room = rooms?.find((other) => other.id === roomId) ?? rooms?.[0]

  function update(fields: Partial<Room>) {
    setRooms(
      (current) =>
        current &&
        current.map((other) =>
          other.id === room?.id ? { ...other, ...fields } : other,
        ),
    )
  }

  return (
    <div className="room-setup">
      {error && <p role="alert">{error}</p>}
      {rooms?.length === 0 && <p>אין עדיין חדרים.</p>}
      {room && rooms && (
        <>
          <label className="room-profile">
            חדר
            <select
              value={room.id}
              onChange={(event) => setRoomId(Number(event.target.value))}
            >
              {rooms.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
          </label>
          <RoomLocationSetup
            key={`location-${room.id}`}
            roomId={room.id}
            locationType={room.location_type}
            onLocationChange={(location_type) => {
              update({ location_type })
              window.dispatchEvent(new Event(ROOMS_CHANGED))
            }}
          />
          <RoomProfileForm
            key={`profile-${room.id}`}
            roomId={room.id}
            profile={room}
            onSaved={(profile) => update(profile)}
          />
        </>
      )}
    </div>
  )
}

export default RoomSettings
