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
import { ROOMS_CHANGED } from './ManageRooms'

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

export function SensorPicker({
  roomId,
  onChanged,
}: {
  roomId: number
  onChanged: () => void
}) {
  const [devices, setDevices] = useState<SensiboDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSensors()
      .then(setDevices)
      .catch(() => setError('לא הצלחנו לטעון את מכשירי ה-Sensibo.'))
  }, [])

  async function choose(id: string) {
    const previous = devices?.find((d) => d.room_id === roomId)
    setSaving(true)
    setError(null)
    try {
      if (id === '') {
        if (previous) {
          await setSensorRoom(previous.id, null)
        }
      } else {
        await setSensorRoom(id, roomId)
      }
      setDevices(
        (current) =>
          current &&
          current.map((d) => ({
            ...d,
            room_id:
              d.id === id ? roomId : d.room_id === roomId ? null : d.room_id,
          })),
      )
      onChanged()
    } catch {
      setError('לא הצלחנו לשמור.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sensor-picker">
      {error && <p role="alert">{error}</p>}
      {!devices && !error && <p className="muted">טוען חיישנים…</p>}
      {devices?.length === 0 && <p className="muted">לא נמצאו מכשירים.</p>}
      {devices && devices.length > 0 && (
        <label>
          חיישן Sensibo
          <select
            value={devices.find((d) => d.room_id === roomId)?.id ?? ''}
            disabled={saving}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">ללא חיישן</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
                {device.room_id !== null && device.room_id !== roomId
                  ? ' (מחובר לחדר אחר)'
                  : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

export function RoomLocationSetup({
  roomId,
  locationType,
  onLocationChange,
}: {
  roomId: number
  locationType: LocationType
  onLocationChange: (locationType: LocationType) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function changeLocation(next: LocationType) {
    setSaving(true)
    setError(null)
    try {
      await setLocationType(roomId, next)
      onLocationChange(next)
    } catch {
      setError('לא הצלחנו לשמור.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="room-climate room-setup">
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
      {locationType === 'indoor' ? (
        <SensorPicker
          roomId={roomId}
          onChanged={() => window.dispatchEvent(new Event(ROOMS_CHANGED))}
        />
      ) : (
        <p className="muted">מזג האוויר נלקח משירות חיצוני לפי מיקום הבית.</p>
      )}
    </div>
  )
}

function RoomClimate({
  roomId,
  locationType,
}: {
  roomId: number
  locationType: LocationType
}) {
  const [climate, setClimate] = useState<Climate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      getRoomClimate(roomId)
        .then(setClimate)
        .catch(() => setError('לא הצלחנו לטעון את נתוני האקלים.'))
    }
    load()
    window.addEventListener(ROOMS_CHANGED, load)
    return () => window.removeEventListener(ROOMS_CHANGED, load)
  }, [roomId, locationType])

  return (
    <details className="room-profile room-climate">
      <summary>אקלים בחדר</summary>
      <div className="climate-body">
        {error && <p role="alert">{error}</p>}
        {climate?.latest && (
          <p>
            עכשיו: <bdi dir="ltr">{climate.latest.temperature}°</bdi>
            {climate.latest.humidity !== null &&
              `, לחות ${Math.round(climate.latest.humidity)}%`}
          </p>
        )}
        {climate && climate.weeks.length > 0 ? (
          <Chart weeks={climate.weeks} />
        ) : (
          climate &&
          (locationType !== 'indoor' || climate.sensor_count > 0) && (
            <p className="muted">
              עוד אין מדידות. הן נאספות אוטומטית כל כמה שעות.
            </p>
          )
        )}
        <p className="muted">את מיקום החדר וחיישן ה-Sensibo מגדירים בהגדרות.</p>
      </div>
    </details>
  )
}

export default RoomClimate
