import type { LoginGuard } from './api'

// Shown to signed-in devices, since a block only affects new logins.
function LoginAlert({ guard }: { guard: LoginGuard }) {
  if (!guard.lockedAt && !guard.blockedToday) return null

  return (
    <div className="login-alert" role="alert">
      {guard.lockedAt ? (
        <p>
          הכניסה לאפליקציה נעולה: היו ניסיונות כניסה שגויים רבים יומיים ברצף. מכשירים
          חדשים לא יוכלו להתחבר עד לשחרור ידני.
        </p>
      ) : (
        <p>
          היום היו {guard.failedToday} ניסיונות כניסה שגויים, ולכן הכניסה חסומה עד הלילה
          (02:00 או 03:00). אם זה יקרה גם מחר, הכניסה תינעל עד לשחרור ידני.
        </p>
      )}
    </div>
  )
}

export default LoginAlert
