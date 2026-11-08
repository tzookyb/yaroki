import { useRef, useState } from 'react'
import { pullProd, signOut, signOutEverywhere } from './api'
import HomeLocationForm from './HomeLocationForm'
import ManageRooms from './ManageRooms'

const DRAWER_MS = 200

function AppHeader({ onSignOut }: { onSignOut: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'menu' | 'rooms' | 'home'>('menu')
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The drawer slides out while it is still open, then hides. Hiding first and animating
  // the exit with CSS showed the content out of place for a moment.
  function closeMenu() {
    setClosing(true)
    setTimeout(() => menu.current?.hidePopover(), DRAWER_MS)
  }

  async function handleSignOut() {
    setError(null)
    try {
      await signOut()
      onSignOut()
    } catch {
      setError('לא הצלחנו להתנתק.')
    }
  }

  async function handleSignOutEverywhere() {
    if (!window.confirm('להתנתק בכל המכשירים, כולל זה?')) {
      return
    }
    setError(null)
    try {
      await signOutEverywhere()
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
      <div
        id="settings-menu"
        ref={menu}
        className={closing ? 'settings-menu closing' : 'settings-menu'}
        popover="auto"
        onToggle={(event) => {
          if (event.newState === 'closed') {
            setView('menu')
            setClosing(false)
          }
        }}
      >
        <div className="settings-body">
          <div className="settings-header">
            {view === 'menu' ? (
              <h2>הגדרות</h2>
            ) : (
              <button
                type="button"
                className="icon-button back-button"
                onClick={() => setView('menu')}
              >
                → {view === 'rooms' ? 'ניהול חדרים' : 'כתובת הבית'}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="סגירה"
              onClick={closeMenu}
            >
              ✕&#xFE0E;
            </button>
          </div>
          {view === 'rooms' ? (
            <ManageRooms />
          ) : view === 'home' ? (
            <HomeLocationForm />
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => setView('rooms')}
              >
                ניהול חדרים
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setView('home')}
              >
                כתובת הבית
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleSignOut}
              >
                התנתקות
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleSignOutEverywhere}
              >
                התנתקות מכל המכשירים
              </button>
              {import.meta.env.DEV && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={handlePullProd}
                >
                  {busy
                    ? 'מושך נתונים...'
                    : 'משיכת נתונים מהפרודקשן (מקומי בלבד)'}
                </button>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default AppHeader
