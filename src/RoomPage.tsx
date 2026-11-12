import { useEffect, useState, type ChangeEvent } from 'react'
import {
  addPlant,
  deletePlant,
  getRoom,
  identifyPlant,
  photoUrl,
  type Plant,
  type RoomDetails,
} from './api'
import { CATEGORY_LABELS, LIGHT_LABELS, wateringLabel } from './labels'
import { ROOMS_CHANGED } from './ManageRooms'
import { resizePhoto } from './photo'
import IdentityCheck from './IdentityCheck'
import RoomClimate from './RoomClimate'

function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomDetails | null>(null)
  const [adding, setAdding] = useState(false)
  const [identifying, setIdentifying] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      getRoom(id)
        .then(setRoom)
        .catch(() => setError('לא הצלחנו לטעון את החדר.'))
    }
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [id])

  async function identify(plantId: number) {
    setIdentifying((current) => [...current, plantId])
    try {
      const plant = await identifyPlant(plantId)
      setRoom(
        (current) =>
          current && {
            ...current,
            plants: current.plants.map((other) =>
              other.id === plant.id ? plant : other,
            ),
          },
      )
    } catch {
      setError('לא הצלחנו לזהות את הצמח. אפשר לנסות שוב מהכפתור שמתחת לתמונה.')
    } finally {
      setIdentifying((current) => current.filter((other) => other !== plantId))
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear it so that picking the same photo again still fires a change.
    event.target.value = ''
    if (!file) {
      return
    }

    setAdding(true)
    setError(null)
    let plant: Plant
    try {
      plant = await addPlant(id, await resizePhoto(file))
      setRoom(
        (current) =>
          current && { ...current, plants: [plant, ...current.plants] },
      )
    } catch {
      setError('לא הצלחנו להוסיף את הצמח. נסו תמונה אחרת.')
      return
    } finally {
      setAdding(false)
    }
    await identify(plant.id)
  }

  async function handleDeletePlant(plant: Plant) {
    const message = `למחוק את ${plant.name ?? 'הצמח הזה'}? גם התמונה תימחק, ואי אפשר לבטל את הפעולה.`
    if (!window.confirm(message)) {
      return
    }

    setError(null)
    try {
      await deletePlant(plant.id)
      setRoom(
        (current) =>
          current && {
            ...current,
            plants: current.plants.filter((other) => other.id !== plant.id),
          },
      )
    } catch {
      setError('לא הצלחנו למחוק את הצמח.')
    }
  }

  return (
    <>
      <a href="#/" className="back-link">
        → חדרים
      </a>
      <div className="room-title">
        <h1>{room?.name}</h1>
        {room && (
          <label className="button" aria-disabled={adding}>
            {adding ? 'מוסיפים…' : 'הוספת צמח בצילום'}
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={adding}
              onChange={handlePhoto}
            />
          </label>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {room?.plants.length === 0 && <p>אין עדיין צמחים בחדר הזה.</p>}
      {room && (
        <>
          <RoomClimate roomId={room.id} locationType={room.location_type} />
          <ul className="plants">
            {room.plants.map(
              (plant) =>
                plant.photo_key && (
                  <li key={plant.id}>
                    <div className="plant-photo">
                      <a href={`#/plants/${plant.id}`}>
                        <img
                          src={photoUrl(plant.photo_key)}
                          alt={plant.name ?? 'צמח ללא שם'}
                        />
                      </a>
                      <button
                        type="button"
                        className="delete-plant"
                        aria-label={`מחיקת ${plant.name ?? 'הצמח'}`}
                        disabled={identifying.includes(plant.id)}
                        onClick={() => handleDeletePlant(plant)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="plant-info">
                      {plant.name ? (
                        <>
                          <a href={`#/plants/${plant.id}`}>
                            <strong>{plant.name}</strong>
                          </a>
                          {plant.english_name && (
                            <span className="muted english-name">
                              <bdi>{plant.english_name}</bdi>
                            </span>
                          )}
                          {plant.species && (
                            <span className="muted">
                              <bdi>{plant.species}</bdi>
                            </span>
                          )}
                          {plant.category && (
                            <span className="muted">
                              {CATEGORY_LABELS[plant.category]}
                            </span>
                          )}
                          {plant.water_every_days && (
                            <span className="muted">
                              {wateringLabel(plant.water_every_days)}
                            </span>
                          )}
                          {plant.light_needs && (
                            <span className="muted">
                              {LIGHT_LABELS[plant.light_needs]}
                            </span>
                          )}
                          {plant.care_notes && <span>{plant.care_notes}</span>}
                          {!plant.identification_confirmed && (
                            <IdentityCheck
                              plant={plant}
                              onChange={(updated) =>
                                setRoom(
                                  (current) =>
                                    current && {
                                      ...current,
                                      plants: current.plants.map((other) =>
                                        other.id === updated.id
                                          ? updated
                                          : other,
                                      ),
                                    },
                                )
                              }
                            />
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={identifying.includes(plant.id)}
                          onClick={() => {
                            setError(null)
                            identify(plant.id)
                          }}
                        >
                          {identifying.includes(plant.id) ? 'מזהים…' : 'זיהוי'}
                        </button>
                      )}
                    </div>
                  </li>
                ),
            )}
          </ul>
        </>
      )}
    </>
  )
}

export default RoomPage
