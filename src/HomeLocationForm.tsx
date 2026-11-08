import { useEffect, useState } from 'react'
import {
  getHomeLocation,
  saveHomeLocation,
  searchPlaces,
  type HomeLocation,
} from './api'

const MIN_QUERY = 3
const TYPING_PAUSE_MS = 400

function HomeLocationForm() {
  const [home, setHome] = useState<HomeLocation | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<HomeLocation[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHomeLocation()
      .then(setHome)
      .catch(() => setError('לא הצלחנו לטעון את כתובת הבית.'))
  }, [])

  const searchable = query.trim().length >= MIN_QUERY

  useEffect(() => {
    if (!searchable) {
      return
    }
    const controller = new AbortController()
    // Waits for a pause in typing, so the free search server gets one request per address.
    const timer = setTimeout(() => {
      setSearching(true)
      searchPlaces(query.trim(), controller.signal)
        .then((places) => {
          setOptions(places)
          setError(null)
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError('החיפוש לא זמין כרגע.')
          }
        })
        .finally(() => setSearching(false))
    }, TYPING_PAUSE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, searchable])

  async function choose(place: HomeLocation) {
    setSaving(true)
    setError(null)
    try {
      setHome(await saveHomeLocation(place))
      setQuery('')
      setOptions([])
    } catch {
      setError('לא הצלחנו לשמור את הכתובת.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="home-location">
      <h2>כתובת הבית</h2>
      <p className="muted">
        משמשת למזג האוויר של חדרים בחוץ ושל הגינה. מספיק מיקום בערך.
      </p>
      <p>{home ? <bdi>{home.label}</bdi> : 'עוד לא הוגדרה כתובת.'}</p>
      <label>
        חיפוש כתובת
        <input
          type="search"
          value={query}
          disabled={saving}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {searching && <p className="muted">מחפשים…</p>}
      {error && <p role="alert">{error}</p>}
      <ul className="place-options">
        {(searchable ? options : []).map((place) => (
          <li key={`${place.latitude},${place.longitude}`}>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => choose(place)}
            >
              <bdi>{place.label}</bdi>
            </button>
          </li>
        ))}
      </ul>
      {searchable && !searching && !error && options.length === 0 && (
        <p className="muted">לא נמצאו כתובות.</p>
      )}
    </div>
  )
}

export default HomeLocationForm
