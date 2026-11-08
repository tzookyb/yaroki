import { useEffect, useRef, useState, type PointerEvent } from 'react'
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
const HEIGHT = 180
const LEFT = 30
const RIGHT = 8
const TOP = 10
const BOTTOM = 20
const HOUR = 3600
const DAY = 24 * HOUR
const TIME_ZONE = 'Asia/Jerusalem'

const hourFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dayFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'numeric',
})
const monthFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  month: 'short',
})
const fullFormat = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

type Tick = { t: number; label: string }

function timeTicks(start: number, end: number, year: number): Tick[] {
  const span = end - start
  if (span > 120 * DAY) {
    return Array.from({ length: 12 }, (_, month) => {
      const t = Date.UTC(year, month, 1) / 1000
      return { t, label: monthFormat.format(t * 1000) }
    }).filter((tick) => tick.t >= start && tick.t <= end)
  }
  const step =
    [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY].find(
      (candidate) => span / candidate <= 5,
    ) ?? 30 * DAY
  const ticks: Tick[] = []
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
    ticks.push({
      t,
      label: (step < DAY ? hourFormat : dayFormat).format(t * 1000),
    })
  }
  return ticks
}

function temperatureTicks(low: number, high: number) {
  const step = [1, 2, 5, 10, 20].find((s) => (high - low) / s <= 4) ?? 20
  const ticks: number[] = []
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) {
    ticks.push(v)
  }
  return ticks
}

function Chart({ climate }: { climate: Climate }) {
  const { current, previous, year, resolution } = climate
  const [picked, setPicked] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  let start: number
  let end: number
  if (resolution === 'week') {
    start = Date.UTC(year, 0, 1) / 1000
    end = Date.UTC(year + 1, 0, 1) / 1000
  } else {
    start = current[0]?.t ?? 0
    end = current[current.length - 1]?.t ?? 0
    // A lone point needs room around it, and the lines need a little margin.
    const pad = Math.max((end - start) * 0.03, 6 * HOUR)
    start -= pad
    end += pad
  }
  const shownPrevious = previous.filter((p) => p.t >= start && p.t <= end)
  const all = [...current, ...shownPrevious].map((p) => p.temperature)
  const low = Math.floor(Math.min(...all) - 0.5)
  const high = Math.ceil(Math.max(...all) + 0.5)
  const x = (t: number) =>
    LEFT + ((t - start) / (end - start)) * (WIDTH - LEFT - RIGHT)
  const y = (temp: number) =>
    HEIGHT - BOTTOM - ((temp - low) / (high - low)) * (HEIGHT - TOP - BOTTOM)
  const line = (points: Climate['current']) =>
    points
      .map((p) => `${x(p.t).toFixed(1)},${y(p.temperature).toFixed(1)}`)
      .join(' ')

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = svg.current?.getBoundingClientRect()
    if (!box || current.length === 0) {
      return
    }
    const px = ((event.clientX - box.left) / box.width) * WIDTH
    let best = 0
    for (let i = 1; i < current.length; i++) {
      if (Math.abs(x(current[i].t) - px) < Math.abs(x(current[best].t) - px)) {
        best = i
      }
    }
    setPicked(best)
  }

  const point = picked === null ? null : current[picked]
  const xTicks = timeTicks(start, end, year)

  return (
    <>
      {/* Time runs left to right even in the right-to-left page. */}
      <svg
        ref={svg}
        style={{ direction: 'ltr' }}
        className="climate-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`טמפרטורה בחדר השנה לעומת השנה שעברה, בין ${low} ל-${high} מעלות`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pick(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons > 0) {
            pick(event)
          }
        }}
        onPointerUp={() => setPicked(null)}
        onPointerCancel={() => setPicked(null)}
      >
        {temperatureTicks(low, high).map((v) => (
          <g key={v}>
            <line
              className="grid"
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={y(v)}
              y2={y(v)}
            />
            <text x={LEFT - 4} y={y(v) + 3} textAnchor="end" className="axis">
              {v}°
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={tick.t}>
            <line
              className="grid"
              x1={x(tick.t)}
              x2={x(tick.t)}
              y1={TOP}
              y2={HEIGHT - BOTTOM}
            />
            <text
              x={x(tick.t)}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="axis"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {shownPrevious.length > 1 && (
          <polyline
            className="line line-1"
            fill="none"
            points={line(shownPrevious)}
          />
        )}
        {current.length > 1 && (
          <polyline
            className="line line-0"
            fill="none"
            points={line(current)}
          />
        )}
        {shownPrevious.length === 1 && (
          <circle
            className="dot dot-1"
            cx={x(shownPrevious[0].t)}
            cy={y(shownPrevious[0].temperature)}
            r={2.5}
          />
        )}
        {current.length === 1 && (
          <circle
            className="dot dot-0"
            cx={x(current[0].t)}
            cy={y(current[0].temperature)}
            r={3}
          />
        )}
        {point && (
          <>
            <line
              className="guide"
              x1={x(point.t)}
              x2={x(point.t)}
              y1={TOP}
              y2={HEIGHT - BOTTOM}
            />
            <circle
              className="dot dot-0 picked"
              cx={x(point.t)}
              cy={y(point.temperature)}
              r={5}
            />
          </>
        )}
      </svg>
      <p className="muted climate-readout" aria-live="off">
        {point ? (
          <>
            <bdi dir="ltr">{point.temperature}°</bdi>
            {point.humidity !== null && `, לחות ${Math.round(point.humidity)}%`}
            {' · '}
            <bdi dir="ltr">{fullFormat.format(point.t * 1000)}</bdi>
          </>
        ) : (
          'גררו על הגרף כדי לראות מדידה'
        )}
      </p>
      <p className="muted climate-legend">
        <span className="key key-0">{year}</span>
        <span className="key key-1">{year - 1}</span>
        <span>
          {resolution === 'raw'
            ? 'מדידות בודדות'
            : resolution === 'day'
              ? 'ממוצע יומי'
              : 'ממוצע שבועי'}
        </span>
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
        {climate && climate.current.length > 0 ? (
          <Chart climate={climate} />
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
