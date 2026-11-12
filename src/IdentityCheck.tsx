import { useState } from 'react'
import { referenceImages } from './referenceImages'
import { confirmPlant, photoUrl, reidentifyPlant, type Plant } from './api'

// Lets the owner flip through photos of the identified species, compare them with their plant and
// either confirm the identification, which removes this, or ask for another guess.
export default function IdentityCheck({
  plant,
  onChange,
}: {
  plant: Plant
  onChange: (plant: Plant) => void
}) {
  const [busy, setBusy] = useState<'confirm' | 'reidentify' | null>(null)
  const [failed, setFailed] = useState(false)
  const images = referenceImages(plant)

  async function run(kind: 'confirm' | 'reidentify') {
    setBusy(kind)
    setFailed(false)
    try {
      onChange(
        await (kind === 'confirm' ? confirmPlant : reidentifyPlant)(plant.id),
      )
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="identity-check" aria-label="בדיקת זיהוי">
      <p>
        זיהינו: <strong>{plant.name}</strong>. מתאים לצמח שלך?
      </p>
      <div className="identity-photos">
        {plant.photo_key && (
          <figure>
            <img src={photoUrl(plant.photo_key)} alt="הצמח שלך" />
            <figcaption>הצמח שלך</figcaption>
          </figure>
        )}
        {images.map((url, index) => (
          <figure key={url}>
            <img src={url} alt={`תמונה לדוגמה ${index + 1}`} loading="lazy" />
            <figcaption>לדוגמה</figcaption>
          </figure>
        ))}
        {images.length === 0 && (
          <p className="muted">לא מצאנו תמונות לדוגמה לצמח הזה.</p>
        )}
      </div>
      <div className="identity-actions">
        <button type="button" disabled={!!busy} onClick={() => run('confirm')}>
          {busy === 'confirm' ? 'שומרים…' : '✓ זה הצמח'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => run('reidentify')}
        >
          {busy === 'reidentify' ? 'מזהים מחדש…' : 'זהה מחדש'}
        </button>
      </div>
      {failed && <p role="alert">משהו השתבש. נסו שוב עוד רגע.</p>}
    </section>
  )
}
