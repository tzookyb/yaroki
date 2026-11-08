import { useEffect, useState } from 'react'
import { LOCATION_TYPES } from '../shared/api'
import {
  getRoomClimate,
  getSensors,
  setLocationType,
  setSensorRoom,
  type LocationType,
  type RoomClimate as Climate,
  type SensiboDevice,
} from './api'

const LOCATION_LABELS: Record<LocationType, string> = {
  indoor: 'בתוך הבית',
  outside_window: 'מחוץ לחלון',
  garden: 'גינה',
}

const WIDTH = 320
const HEIGHT = 140
const WEEKS = 53
const PAD = 8

function Chart({ weeks }: { weeks: Climate['weeks'] }) {
  const years = [...new Set(weeks.map((w) => w.year))].sort()
  const temps = weeks.map((w) => w.temperature)
  const low = Math.floor(Math.min(...temps))
  const high = Math.ceil(Math.max(...temps))
  const span = Math.max(high - low, 1)
  const x = (week: number) => PAD + (week / WEEKS) * (WIDTH - 2 * PAD)
  const y = (temp: number) =>
    HEIGHT - PAD - ((temp - low) / span) * (HEIGHT - 2 * PAD)

  return (
    <>
      {/* Time runs left to right even in the right-to-left page. */}
      <svg
        style={{ direction: 'ltr' }}
        className="climate-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`ממוצע שבועי של הטמפרטורה, בין ${low} ל-${high} מעלות`}
      >
        <text x={0} y={PAD + 4} className="axis">
          {high}°
        </text>
        <text x={0} y={HEIGHT - PAD + 4} className="axis">
          {low}°
        </text>
        {years.map((year, i) => {
          const rank = years.length - 1 - i
          const points = weeks.filter((w) => w.year === year)
          return (
            <polyline
              key={year}
              className={`line line-${Math.min(rank, 2)}`}
              fill="none"
              points={points
                .map((w) => `${x(w.week)},${y(w.temperature)}`)
                .join(' ')}
            />
          )
        })}
      </svg>
      <p className="muted climate-legend">
        {years
          .map((year, i) => ({ year, rank: years.length - 1 - i }))
          .reverse()
          .map(({ year, rank }) => (
            <span key={year} className={`key key-${Math.min(rank, 2)}`}>
              {year}
            </span>
          ))}
      </p>
    </>
  )
}

function SensorPicker({ roomId }: { roomId: number }) {
  const [devices, setDevices] = useState<SensiboDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSensors()
      .then(setDevices)
      .catch(() => setError('לא הצלחנו לטעון את מכשירי ה-Sensibo.'))
  }, [])

  async function toggle(device: SensiboDevice) {
    const next = device.room_id === roomId ? null : roomId
    setError(null)
    try {
      await setSensorRoom(device.id, next)
      setDevices(
        (current) =>
          current &&
          current.map((d) =>
            d.id === device.id ? { ...d, room_id: next } : d,
          ),
      )
    } catch {
      setError('לא הצלחנו לשמור.')
    }
  }

  return (
    <div className="sensor-picker">
      <strong>חיישן Sensibo</strong>
      {error && <p role="alert">{error}</p>}
      {devices?.length === 0 && <p className="muted">לא נמצאו מכשירים.</p>}
      {devices?.map((device) => (
        <label key={device.id} className="checkbox">
          <input
            type="checkbox"
            checked={device.room_id === roomId}
            onChange={() => toggle(device)}
          />
          {device.name}
          {device.room_id !== null && device.room_id !== roomId && (
            <span className="muted"> (מחובר לחדר אחר)</span>
          )}
        </label>
      ))}
    </div>
  )
}

function RoomClimate({
  roomId,
  locationType,
  onLocationChange,
}: {
  roomId: number
  locationType: LocationType
  onLocationChange: (locationType: LocationType) => void
}) {
  const [climate, setClimate] = useState<Climate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    getRoomClimate(roomId)
      .then(setClimate)
      .catch(() => setError('לא הצלחנו לטעון את נתוני האקלים.'))
  }

  useEffect(load, [roomId])

  async function changeLocation(next: LocationType) {
    setSaving(true)
    setError(null)
    try {
      await setLocationType(roomId, next)
      onLocationChange(next)
      load()
    } catch {
      setError('לא הצלחנו לשמור.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="room-profile room-climate">
      <summary>אקלים בחדר</summary>
      <div className="climate-body">
        <label>
          מיקום החדר
          <select
            value={locationType}
            disabled={saving}
            onChange={(event) =>
              changeLocation(event.target.value as LocationType)
            }
          >
            {LOCATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {LOCATION_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        {climate?.latest && (
          <p>
            עכשיו: {climate.latest.temperature}°
            {climate.latest.humidity !== null &&
              `, לחות ${Math.round(climate.latest.humidity)}%`}
          </p>
        )}
        {climate && climate.weeks.length > 0 ? (
          <Chart weeks={climate.weeks} />
        ) : (
          climate && (
            <p className="muted">
              עוד אין מדידות. הן נאספות אוטומטית כל כמה שעות.
            </p>
          )
        )}
        {locationType === 'indoor' ? (
          <SensorPicker roomId={roomId} />
        ) : (
          <p className="muted">מזג האוויר נלקח משירות חיצוני לפי מיקום הבית.</p>
        )}
      </div>
    </details>
  )
}

export default RoomClimate
