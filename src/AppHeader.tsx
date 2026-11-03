import { useState } from 'react'
import { pullProd, signOut } from './api'

function AppHeader({ onSignOut }: { onSignOut: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    setError(null)
    try {
      await signOut()
      onSignOut()
    } catch {
      setError('לא הצלחנו להתנתק.')
    }
  }

  async function handlePullProd() {
    if (
      !window.confirm(
        'להחליף את כל הנתונים המקומיים בעותק של הפרודקשן? הפרודקשן לא משתנה.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await pullProd()
      window.location.reload()
    } catch {
      setError('המשיכה נכשלה. הפרטים בטרמינל של npm run dev.')
      setBusy(false)
    }
  }

  return (
    <header className="app-header">
      <a href="#/" className="app-title">
        <span aria-hidden="true">🌱</span> הצמחים שלי
      </a>
      <button
        type="button"
        className="icon-button settings-button"
        aria-label="הגדרות"
        popoverTarget="settings-menu"
      >
        ⚙&#xFE0E;
      </button>
      <div id="settings-menu" className="settings-menu" popover="auto">
        <button type="button" className="secondary" onClick={handleSignOut}>
          התנתקות
        </button>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={handlePullProd}
          >
            {busy ? 'מושך נתונים...' : 'משיכת נתונים מהפרודקשן (מקומי בלבד)'}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </header>
  )
}

export default AppHeader
