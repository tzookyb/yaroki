import { ENRICH_VERSION } from '../shared/api'
import { useEffect, useState } from 'react'
import {
  lightFit,
  humidityFit,
  temperatureFit,
  type Fit,
} from '../shared/plantFit'
import {
  getPlant,
  enrichPlant,
  reidentifyPlant,
  type PlantDetails,
  type TaskList,
} from './api'
import {
  CATEGORY_LABELS,
  HUMIDITY_LABELS,
  LIGHT_LABELS,
  wateringLabel,
} from './labels'

const VERDICT_TEXT = {
  good: { icon: '✓', text: 'מתאים' },
  warn: { icon: '▲', text: 'גבולי' },
  bad: { icon: '✕', text: 'לא מתאים' },
} as const

function fitText(fit: Fit) {
  const { icon, text } = VERDICT_TEXT[fit.verdict]
  const direction =
    fit.direction === 'low'
      ? ': פחות מהנדרש'
      : fit.direction === 'high'
        ? ': יותר מהנדרש'
        : ''
  return `${icon} ${text}${direction}`
}

// Color is never the only signal: every state has its own icon and word.
function Need({
  label,
  value,
  fit,
  checked,
}: {
  label: string
  value: string | null
  fit: Fit | null
  checked: boolean
}) {
  if (!value) {
    return null
  }
  const verdict = checked ? (fit?.verdict ?? 'unknown') : 'none'
  return (
    <li className={`need need-${verdict}`}>
      <span className="need-label">{label}</span>
      <strong>{value}</strong>
      {checked &&
        (fit ? (
          <span className="fit">
            {fitText(fit)}
            <span className="fit-source">
              {fit.source === 'reading' ? 'לפי מדידה' : 'לפי פרופיל החדר'}
            </span>
          </span>
        ) : (
          <span className="fit">? אין מספיק נתונים על החדר</span>
        ))}
    </li>
  )
}

const TASK_TITLES: Record<string, string> = { water: 'השקיה' }

function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

function UpcomingTasks({ list: { tasks, today } }: { list: TaskList }) {
  if (tasks.length === 0) {
    return null
  }
  return (
    <>
      <h2>משימות</h2>
      <ul className="needs">
        {tasks.map((task) => {
          const title = TASK_TITLES[task.type] ?? task.type
          const overdue = !task.done_today && task.due_date < today
          return (
            <li key={task.type} className="need need-none">
              <span className="need-label">{title}</span>
              {task.done_today ? (
                <>
                  <strong>✓ בוצע היום</strong>
                  <span className="fit">הבא: {formatDate(task.due_date)}</span>
                </>
              ) : (
                <>
                  <strong className={overdue ? 'overdue' : undefined}>
                    {overdue ? 'באיחור, היה אמור ב' : 'עכשיו: '}
                    {formatDate(task.due_date)}
                  </strong>
                  <span className="fit">
                    אחריו: {formatDate(task.next_due_date)}
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function PlantPage({ id, fromHome }: { id: string; fromHome: boolean }) {
  const [plant, setPlant] = useState<PlantDetails | null>(null)
  const [enriching, setEnriching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reidentifying, setReidentifying] = useState(false)
  const [reidentifyError, setReidentifyError] = useState(false)

  async function reidentify() {
    setReidentifying(true)
    setReidentifyError(false)
    try {
      const updated = await reidentifyPlant(Number(id))
      setPlant((current) => current && { ...current, ...updated })
    } catch {
      setReidentifyError(true)
    } finally {
      setReidentifying(false)
    }
  }

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
  const reading = plant?.latest_reading
  const hasTemperature = plant?.temp_min != null && plant.temp_max != null

  return (
    <>
      <a
        href={!fromHome && plant?.room_id ? `#/rooms/${plant.room_id}` : '#/'}
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
          {plant.photo_key && plant.species && (
            <p>
              <button
                type="button"
                className="secondary"
                onClick={reidentify}
                disabled={reidentifying}
              >
                {reidentifying ? 'מזהים מחדש…' : 'זה לא הצמח הזה? זהה מחדש'}
              </button>
            </p>
          )}
          {reidentifyError && (
            <p role="alert">לא הצלחנו לזהות מחדש. נסו שוב עוד רגע.</p>
          )}
          {enriching && <p className="muted">מעדכנים פרטים על הצמח…</p>}
          {plant.description && <p>{plant.description}</p>}
          {plant.care_notes && <p className="care-notes">{plant.care_notes}</p>}
          <UpcomingTasks list={plant.tasks} />
          <h2>מה הצמח צריך</h2>
          <ul className="needs">
            <Need
              label="אור"
              value={plant.light_needs && LIGHT_LABELS[plant.light_needs]}
              fit={room ? lightFit(plant, room) : null}
              checked={!!room}
            />
            <Need
              label="לחות"
              value={
                plant.humidity_needs && HUMIDITY_LABELS[plant.humidity_needs]
              }
              fit={room ? humidityFit(plant, room, reading) : null}
              checked={!!room}
            />
            <Need
              label="טמפרטורה"
              value={
                hasTemperature ? `${plant.temp_min}–${plant.temp_max}°C` : null
              }
              fit={room ? temperatureFit(plant, room, reading) : null}
              checked={!!room}
            />
            <Need
              label="השקיה"
              value={
                plant.water_every_days
                  ? wateringLabel(plant.water_every_days)
                  : null
              }
              fit={null}
              checked={false}
            />
            <Need
              label="סוג"
              value={plant.category && CATEGORY_LABELS[plant.category]}
              fit={null}
              checked={false}
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
