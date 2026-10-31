import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  addPlant,
  deletePlant,
  deleteRoom,
  getRoom,
  identifyPlant,
  photoUrl,
  renameRoom,
  type Plant,
  type RoomDetails,
} from './api'
import { resizePhoto } from './photo'

const CATEGORY_LABELS: Record<string, string> = {
  foliage: 'צמח עלים',
  flowering: 'צמח פורח',
  succulent: 'סוקולנט',
  cactus: 'קקטוס',
  herb: 'תבלין',
  fern: 'שרך',
  palm: 'דקל',
  vine: 'מטפס',
  tree: 'עץ',
  other: 'אחר',
}

const LIGHT_LABELS: Record<string, string> = {
  low: 'אור נמוך',
  medium: 'אור בינוני',
  bright_indirect: 'אור בהיר לא ישיר',
  direct: 'שמש ישירה',
}

function wateringLabel(days: number) {
  return days === 1 ? 'השקיה כל יום' : `השקיה כל ${days} ימים`
}

function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomDetails | null>(null)
  const [adding, setAdding] = useState(false)
  const [identifying, setIdentifying] = useState<number[]>([])
  const [newName, setNewName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRoom(id)
      .then(setRoom)
      .catch(() => setError('לא הצלחנו לטעון את החדר.'))
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
    if (!file) return

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
    if (!window.confirm(message)) return

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

  async function handleRename(event: FormEvent) {
    event.preventDefault()
    if (!newName) return

    setError(null)
    try {
      const { name } = await renameRoom(id, newName)
      setRoom((current) => current && { ...current, name })
      setNewName(null)
    } catch {
      setError('לא הצלחנו לשנות את השם.')
    }
  }

  async function handleDeleteRoom() {
    if (!room) return
    const message =
      room.plants.length === 0
        ? `למחוק את החדר "${room.name}"?`
        : `למחוק את החדר "${room.name}" ואת כל הצמחים שבו (${room.plants.length}) עם התמונות שלהם? אי אפשר לבטל את הפעולה.`
    if (!window.confirm(message)) return

    setError(null)
    try {
      await deleteRoom(id)
      window.location.hash = '#/'
    } catch {
      setError('לא הצלחנו למחוק את החדר.')
    }
  }

  return (
    <>
      <a href="#/">→ חדרים</a>
      <h1>{room?.name}</h1>
      {error && <p role="alert">{error}</p>}
      {room &&
        (newName === null ? (
          <div className="room-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setNewName(room.name)}
            >
              שינוי שם
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleDeleteRoom}
            >
              מחיקת חדר
            </button>
          </div>
        ) : (
          <form className="inline-form room-actions" onSubmit={handleRename}>
            <input
              aria-label="שם החדר"
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" disabled={!newName.trim()}>
              שמירה
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setNewName(null)}
            >
              ביטול
            </button>
          </form>
        ))}
      {room?.plants.length === 0 && <p>אין עדיין צמחים בחדר הזה.</p>}
      {room && (
        <>
          <ul className="plants">
            {room.plants.map(
              (plant) =>
                plant.photo_key && (
                  <li key={plant.id}>
                    <div className="plant-photo">
                      <img
                        src={photoUrl(plant.photo_key)}
                        alt={plant.name ?? 'צמח ללא שם'}
                      />
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
                          <strong>{plant.name}</strong>
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
          <div className="photo-actions">
            <label className="button">
              {adding ? 'מוסיפים…' : 'צילום'}
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
              בחירת תמונה
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
