import { useEffect, useState, type PointerEvent } from 'react'
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
const RIGHT = 30
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

function valueTicks(low: number, high: number) {
  const step = [1, 2, 5, 10, 20].find((s) => (high - low) / s <= 4) ?? 20
  const ticks: number[] = []
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) {
    ticks.push(v)
  }
  return ticks
}

type Metric = 'humidity' | 'temperature'
type Reading = Climate['current'][number]

const METRIC_UNIT: Record<Metric, string> = { humidity: '%', temperature: '°' }
const METRIC_LABEL: Record<Metric, string> = {
  humidity: 'לחות',
  temperature: 'טמפרטורה',
}

function Chart({ climate }: { climate: Climate }) {
  const { current, year, resolution } = climate
  const [picked, setPicked] = useState<number | null>(null)

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
  const x = (t: number) =>
    LEFT + ((t - start) / (end - start)) * (WIDTH - LEFT - RIGHT)

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (current.length === 0) {
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

  function scale(metric: Metric) {
    const values = (points: Reading[]) =>
      points.flatMap((p) => {
        const value = p[metric]
        return value === null ? [] : [{ t: p.t, value }]
      })
    const now = values(current)
    if (now.length === 0) {
      return null
    }
    const all = now.map((p) => p.value)
    const low = Math.floor(Math.min(...all) - 0.5)
    const high = Math.ceil(Math.max(...all) + 0.5)
    const y = (value: number) =>
      HEIGHT - BOTTOM - ((value - low) / (high - low)) * (HEIGHT - TOP - BOTTOM)
    return { metric, now, low, high, y }
  }

  const series = [scale('temperature'), scale('humidity')].flatMap((s) =>
    s ? [s] : [],
  )
  const [left, right] = series

  function drawLine(
    s: (typeof series)[number],
    points: typeof s.now,
    className: string,
  ) {
    if (points.length === 1) {
      return (
        <circle
          className={`dot ${className}`}
          cx={x(points[0].t)}
          cy={s.y(points[0].value)}
          r={3}
        />
      )
    }
    return (
      <polyline
        className={`line ${className}`}
        fill="none"
        points={points
          .map((p) => `${x(p.t).toFixed(1)},${s.y(p.value).toFixed(1)}`)
          .join(' ')}
      />
    )
  }

  const label = series
    .map(
      (s) =>
        `${METRIC_LABEL[s.metric]} בחדר, בין ${s.low} ל-${s.high}${METRIC_UNIT[s.metric]}`,
    )
    .join('. ')

  return (
    <>
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
      {left && (
        // Time runs left to right even in the right-to-left page.
        <svg
          style={{ direction: 'ltr' }}
          className="climate-chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={label}
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
          {valueTicks(left.low, left.high).map((v) => (
            <g key={v}>
              <line
                className="grid"
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={left.y(v)}
                y2={left.y(v)}
              />
              <text
                x={LEFT - 4}
                y={left.y(v) + 3}
                textAnchor="end"
                className="axis axis-temperature"
              >
                {v}°
              </text>
            </g>
          ))}
          {right &&
            valueTicks(right.low, right.high).map((v) => (
              <text
                key={v}
                x={WIDTH - RIGHT + 4}
                y={right.y(v) + 3}
                textAnchor="start"
                className="axis axis-humidity"
              >
                {v}%
              </text>
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
          {series.map((s) => (
            <g key={s.metric} className={`series series-${s.metric}`}>
              {drawLine(s, s.now, 'current')}
            </g>
          ))}
          {point && (
            <>
              <line
                className="guide"
                x1={x(point.t)}
                x2={x(point.t)}
                y1={TOP}
                y2={HEIGHT - BOTTOM}
              />
              {series.map((s) => {
                const value = point[s.metric]
                return (
                  value != null && (
                    <g key={s.metric} className={`series series-${s.metric}`}>
                      <circle
                        className="dot current picked"
                        cx={x(point.t)}
                        cy={s.y(value)}
                        r={5}
                      />
                    </g>
                  )
                )
              })}
            </>
          )}
        </svg>
      )}
      <p className="muted climate-legend">
        <span className="key key-temperature">טמפרטורה</span>
        {right && <span className="key key-humidity">לחות</span>}
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
        await setSensorRoom(id, roomId, devices?.find((d) => d.id === id)?.name)
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
        {climate && climate.current.length > 0 && (
          <table className="climate-averages">
            <caption className="muted">ממוצעים</caption>
            <thead>
              <tr>
                <th />
                <th>טמפרטורה</th>
                <th>לחות</th>
              </tr>
            </thead>
            <tbody>
              {climate.averages.map((a) => (
                <tr key={a.days}>
                  <th scope="row">{a.days} ימים</th>
                  <td>
                    {a.temperature === null ? (
                      '—'
                    ) : (
                      <bdi dir="ltr">{a.temperature}°</bdi>
                    )}
                  </td>
                  <td>
                    {a.humidity === null ? '—' : `${Math.round(a.humidity)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {climate && climate.current.length > 0 && (
          <p className="muted">
            {locationType !== 'indoor'
              ? 'לפי מידע מזג אוויר'
              : climate.sensor_name
                ? `לפי חיישן ${climate.sensor_name}`
                : 'לפי חיישן Sensibo'}
          </p>
        )}
      </div>
    </details>
  )
}

export default RoomClimate
