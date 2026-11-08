import { useState, type FormEvent } from 'react'
import {
  HUMIDITY_LEVELS,
  ROOM_LIGHT_LEVELS,
  ROOM_TEMP_MAX,
  ROOM_TEMP_MIN,
  WINDOW_DIRECTIONS,
} from '../shared/api'
import { HUMIDITY_LABELS } from './labels'
import InfoHint from './InfoHint'
import { saveRoomProfile, type RoomProfile } from './api'

const WINDOW_LABELS = {
  north: 'צפון',
  east: 'מזרח',
  south: 'דרום',
  west: 'מערב',
  none: 'אין חלון',
}
const LIGHT_LABELS = {
  direct: 'שמש ישירה',
  bright_indirect: 'אור בהיר לא ישיר',
  low: 'אור נמוך',
}

function Select<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T | null
  onChange: (value: T | null) => void
}) {
  return (
    <label>
      {label}
      <select
        value={value ?? ''}
        onChange={(event) => onChange((event.target.value || null) as T | null)}
      >
        <option value="">לא צוין</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  )
}

function toTemp(text: string) {
  return text === '' ? null : Number(text)
}

function RoomProfileForm({
  roomId,
  profile,
  onSaved,
}: {
  roomId: number
  profile: RoomProfile
  onSaved: (profile: RoomProfile) => void
}) {
  const [draft, setDraft] = useState(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function change(fields: Partial<RoomProfile>) {
    setDraft({ ...draft, ...fields })
    setSaved(false)
  }

  const tempsInverted =
    draft.temp_min !== null &&
    draft.temp_max !== null &&
    draft.temp_min > draft.temp_max

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await saveRoomProfile(roomId, draft))
      setSaved(true)
    } catch {
      setError('לא הצלחנו לשמור את תנאי החדר.')
    } finally {
      setSaving(false)
    }
  }

  const flags = [
    [
      'near_draft',
      'יש זרם אוויר',
      'אוויר שנע כל הזמן ליד הצמחים, למשל ליד דלת או חלון שנפתחים הרבה. זרם אוויר מייבש עלים ומקרר צמחים רגישים.',
    ],
    [
      'near_ac',
      'מזגן קרוב לצמחים',
      'המזגן נושף ישר על הצמחים, או נמצא במרחק של עד כמטר-שניים מהם. אוויר קר ויבש מזיק לרוב הצמחים.',
    ],
    [
      'near_heater',
      'תנור או רדיאטור קרוב לצמחים',
      'תנור, רדיאטור או מפזר חום נמצאים במרחק של עד כמטר-שניים מהצמחים. חום יבש מייבש את העלים ואת האדמה.',
    ],
  ] as const

  return (
    <details className="room-profile">
      <summary>תנאי החדר</summary>
      <form onSubmit={handleSubmit}>
        <Select
          label="כיוון החלון"
          options={WINDOW_DIRECTIONS}
          labels={WINDOW_LABELS}
          value={draft.window_direction}
          onChange={(window_direction) => change({ window_direction })}
        />
        <Select
          label="כמות אור"
          options={ROOM_LIGHT_LEVELS}
          labels={LIGHT_LABELS}
          value={draft.light_level}
          onChange={(light_level) => change({ light_level })}
        />
        <Select
          label="לחות"
          options={HUMIDITY_LEVELS}
          labels={HUMIDITY_LABELS}
          value={draft.humidity}
          onChange={(humidity) => change({ humidity })}
        />
        <div className="temp-range">
          <label>
            טמפרטורה מינימלית (°C)
            <input
              type="number"
              inputMode="numeric"
              min={ROOM_TEMP_MIN}
              max={ROOM_TEMP_MAX}
              value={draft.temp_min ?? ''}
              onChange={(event) =>
                change({ temp_min: toTemp(event.target.value) })
              }
            />
          </label>
          <label>
            מקסימלית (°C)
            <input
              type="number"
              inputMode="numeric"
              min={ROOM_TEMP_MIN}
              max={ROOM_TEMP_MAX}
              value={draft.temp_max ?? ''}
              onChange={(event) =>
                change({ temp_max: toTemp(event.target.value) })
              }
            />
          </label>
        </div>
        {flags.map(([key, label, hint]) => (
          <div key={key}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft[key] === 1}
                onChange={(event) =>
                  change({ [key]: event.target.checked ? 1 : 0 })
                }
              />
              {label}
              <InfoHint text={hint} />
            </label>
          </div>
        ))}
        {tempsInverted && <p role="alert">המינימום גבוה מהמקסימום.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={saving || tempsInverted}>
          {saving ? 'שומרים…' : saved ? 'נשמר ✓' : 'שמירה'}
        </button>
        <p className="muted">
          התנאים האלה נשלחים ל-AI כשמזהים צמח חדש בחדר, כדי שההמלצות יתאימו
          לחדר.
        </p>
      </form>
    </details>
  )
}

export default RoomProfileForm
