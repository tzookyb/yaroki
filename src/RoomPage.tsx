import { useEffect, useState, type ChangeEvent } from 'react'
import { addPlant, getRoom, photoUrl, type RoomDetails } from './api'
import { resizePhoto } from './photo'

function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomDetails | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRoom(id)
      .then(setRoom)
      .catch(() => setError('Could not load this room.'))
  }, [id])

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear it so that picking the same photo again still fires a change.
    event.target.value = ''
    if (!file) return

    setAdding(true)
    setError(null)
    try {
      const plant = await addPlant(id, await resizePhoto(file))
      setRoom((current) =>
        current && { ...current, plants: [plant, ...current.plants] },
      )
    } catch {
      setError('Could not add the plant. Try another photo.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <a href="#/">← Rooms</a>
      <h1>{room?.name}</h1>
      {error && <p role="alert">{error}</p>}
      {room?.plants.length === 0 && <p>No plants in this room yet.</p>}
      {room && (
        <>
          <ul className="plants">
            {room.plants.map(
              (plant) =>
                plant.photo_key && (
                  <li key={plant.id}>
                    <img
                      src={photoUrl(plant.photo_key)}
                      alt={plant.name ?? 'Unnamed plant'}
                    />
                  </li>
                ),
            )}
          </ul>
          <div className="photo-actions">
            <label className="button">
              {adding ? 'Adding…' : 'Take photo'}
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                disabled={adding}
                onChange={handlePhoto}
              />
            </label>
            <label className="button secondary">
              Choose photo
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                disabled={adding}
                onChange={handlePhoto}
              />
            </label>
          </div>
        </>
      )}
    </>
  )
}

export default RoomPage
