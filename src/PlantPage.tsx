import { ENRICH_VERSION } from '../shared/api'
import { useEffect, useState } from 'react'
import {
  lightFit,
  humidityFit,
  temperatureFit,
  type Fit,
} from '../shared/plantFit'
import { getPlant, enrichPlant, type PlantDetails } from './api'
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
  const [enriching, setEnriching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let loaded: PlantDetails
      try {
        loaded = await getPlant(id)
      } catch {
        setError('לא הצלחנו לטעון את הצמח.')
        return
      }
      setPlant(loaded)
      // Fills in data that was added after this plant was identified, without renaming it.
      if (loaded.species && loaded.enriched_version < ENRICH_VERSION) {
        setEnriching(true)
        try {
          const updated = await enrichPlant(Number(id))
          if (!cancelled) {
            setPlant((current) => current && { ...current, ...updated })
          }
        } catch {
          // The data is filled in by the daily run if this fails.
        } finally {
          setEnriching(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

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
          {plant.reference_image_url ? (
            <figure className="reference-photo">
              <img src={plant.reference_image_url} alt="תמונה לדוגמה" />
              <figcaption>
                תמונה לדוגמה של {plant.name} (ויקיפדיה). אם זה לא נראה כמו הצמח
                שלך, הזיהוי כנראה שגוי.
              </figcaption>
            </figure>
          ) : (
            <p className="muted">לא מצאנו תמונה לדוגמה לצמח הזה.</p>
          )}
          {enriching && <p className="muted">מעדכנים פרטים על הצמח…</p>}
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
        </>
      )}
    </>
  )
}

export default PlantPage
