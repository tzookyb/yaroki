import { useEffect, useState } from 'react'
import {
  lightFit,
  humidityFit,
  temperatureFit,
  type Fit,
} from '../shared/plantFit'
import { getPlant, identifyPlant, photoUrl, type PlantDetails } from './api'
import {
  CATEGORY_LABELS,
  HUMIDITY_LABELS,
  LIGHT_LABELS,
  wateringLabel,
} from './labels'

const FIT_TEXT: Record<Exclude<Fit, null>, string> = {
  ok: '✓ מתאים',
  low: '⚠ בחדר יש פחות מהנדרש',
  high: '⚠ בחדר יש יותר מהנדרש',
}

function Need({
  label,
  value,
  fit,
}: {
  label: string
  value: string | null
  fit: Fit
}) {
  if (!value) {
    return null
  }
  return (
    <li>
      <span className="need-label">{label}</span>
      <strong>{value}</strong>
      {fit && <span className={`fit fit-${fit}`}>{FIT_TEXT[fit]}</span>}
    </li>
  )
}

function PlantPage({ id }: { id: string }) {
  const [plant, setPlant] = useState<PlantDetails | null>(null)
  const [identifying, setIdentifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPlant(id)
      .then(setPlant)
      .catch(() => setError('לא הצלחנו לטעון את הצמח.'))
  }, [id])

  async function identifyAgain() {
    setIdentifying(true)
    setError(null)
    try {
      const updated = await identifyPlant(Number(id))
      setPlant((current) => current && { ...current, ...updated })
    } catch {
      setError('לא הצלחנו לזהות את הצמח.')
    } finally {
      setIdentifying(false)
    }
  }

  const room = plant?.room
  const hasTemperature = plant?.temp_min != null && plant.temp_max != null

  return (
    <>
      <a
        href={plant?.room_id ? `#/rooms/${plant.room_id}` : '#/'}
        className="back-link"
      >
        → חזרה
      </a>
      {error && <p role="alert">{error}</p>}
      {plant && (
        <>
          <h1>{plant.name ?? 'צמח ללא שם'}</h1>
          {plant.english_name && (
            <p className="muted">
              <bdi>{plant.english_name}</bdi>
              {plant.species && (
                <>
                  {' · '}
                  <bdi>{plant.species}</bdi>
                </>
              )}
            </p>
          )}
          <div className="plant-compare">
            {plant.photo_key && (
              <figure>
                <img src={photoUrl(plant.photo_key)} alt="התמונה שלך" />
                <figcaption>התמונה שלך</figcaption>
              </figure>
            )}
            {plant.reference_image_url && (
              <figure>
                <img src={plant.reference_image_url} alt="תמונה לדוגמה" />
                <figcaption>תמונה לדוגמה (ויקיפדיה)</figcaption>
              </figure>
            )}
          </div>
          {plant.description && <p>{plant.description}</p>}
          {plant.care_notes && <p className="care-notes">{plant.care_notes}</p>}
          <h2>מה הצמח צריך</h2>
          <ul className="needs">
            <Need
              label="אור"
              value={plant.light_needs && LIGHT_LABELS[plant.light_needs]}
              fit={room ? lightFit(plant, room) : null}
            />
            <Need
              label="לחות"
              value={
                plant.humidity_needs && HUMIDITY_LABELS[plant.humidity_needs]
              }
              fit={room ? humidityFit(plant, room) : null}
            />
            <Need
              label="טמפרטורה"
              value={
                hasTemperature ? `${plant.temp_min}–${plant.temp_max}°C` : null
              }
              fit={room ? temperatureFit(plant, room) : null}
            />
            <Need
              label="השקיה"
              value={
                plant.water_every_days
                  ? wateringLabel(plant.water_every_days)
                  : null
              }
              fit={null}
            />
            <Need
              label="סוג"
              value={plant.category && CATEGORY_LABELS[plant.category]}
              fit={null}
            />
          </ul>
          {!room && plant.room_id === null && (
            <p className="muted">
              הצמח לא משויך לחדר, אז אין השוואה לתנאי החדר.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={identifying}
            onClick={identifyAgain}
          >
            {identifying ? 'מזהים…' : 'זיהוי מחדש'}
          </button>
        </>
      )}
    </>
  )
}

export default PlantPage
