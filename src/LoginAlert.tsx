import { useState } from 'react'
import { unlockLogin, type LoginGuard } from './api'

// Shown to signed-in devices, since a block only affects new logins.
function LoginAlert({ guard }: { guard: LoginGuard }) {
  const [unlocked, setUnlocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  if (unlocked || (!guard.lockedAt && !guard.blockedToday)) return null

  async function handleUnlock() {
    setSaving(true)
    setError(false)
    try {
      await unlockLogin()
      setUnlocked(true)
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <div className="login-alert" role="alert">
      {guard.lockedAt ? (
        <p>
          הכניסה לאפליקציה נעולה: היו ניסיונות כניסה שגויים רבים יומיים ברצף. מכשירים
          חדשים לא יוכלו להתחבר עד שתשחררו.
        </p>
      ) : (
        <p>
          היום היו {guard.failedToday} ניסיונות כניסה שגויים, ולכן הכניסה חסומה עד הלילה
          (02:00 או 03:00). אם זה יקרה גם מחר, הכניסה תינעל עד שחרור ידני.
        </p>
      )}
      {error && <p>השחרור נכשל. נסו שוב.</p>}
      <button type="button" onClick={handleUnlock} disabled={saving}>
        שחרור הכניסה
      </button>
    </div>
  )
}

export default LoginAlert
