import { useEffect, useState } from 'react'
import {
  deletePushSubscription,
  getPushKey,
  HttpError,
  savePushSubscription,
  sendTestPush,
} from './api'
import { currentSubscription, getPushRegistration } from './push'

function base64urlToBytes(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

type State =
  'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on'

function PushSettings() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!(await getPushRegistration()) || !('Notification' in window)) {
        return 'unsupported'
      }
      if (Notification.permission === 'denied') {
        return 'denied'
      }
      return (await currentSubscription()) ? 'on' : 'off'
    }
    load()
      .then(setState)
      .catch(() => setState('unsupported'))
  }, [])

  async function enable() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      let key: string
      try {
        key = await getPushKey()
      } catch (cause) {
        if (cause instanceof HttpError && cause.status === 503) {
          setState('unconfigured')
          return
        }
        throw cause
      }
      if ((await Notification.requestPermission()) !== 'granted') {
        setState(Notification.permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await getPushRegistration()
      if (!registration) {
        setState('unsupported')
        return
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlToBytes(key),
      })
      try {
        await savePushSubscription(subscription.toJSON())
      } catch (cause) {
        // Without the server's copy the device would never get a reminder.
        await subscription.unsubscribe()
        throw cause
      }
      setState('on')
    } catch {
      setError('לא הצלחנו להפעיל התראות.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const subscription = await currentSubscription()
      if (subscription) {
        await deletePushSubscription(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setState('off')
    } catch {
      setError('לא הצלחנו לכבות את ההתראות.')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const subscription = await currentSubscription()
      if (!subscription) {
        setState('off')
        return
      }
      await sendTestPush(subscription.endpoint)
      setMessage('נשלחה התראת ניסיון.')
    } catch {
      setError('התראת הניסיון לא נשלחה.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="push-settings">
      <h2>התראות</h2>
      <p className="muted">
        כל בוקר תגיע התראה למכשיר הזה אם יש צמחים שצריך להשקות. ההגדרה נשמרת לכל
        מכשיר בנפרד.
      </p>
      {state === 'loading' && <p className="muted">טוען...</p>}
      {state === 'unsupported' && (
        <p>
          המכשיר או הדפדפן לא תומכים בהתראות. ייתכן שזו גרסת פיתוח, שבה אין
          אפליקציה מותקנת.
        </p>
      )}
      {state === 'unconfigured' && (
        <p>ההתראות עוד לא הוגדרו בשרת (מפתחות VAPID חסרים).</p>
      )}
      {state === 'denied' && (
        <p>ההתראות חסומות. אפשר לאפשר אותן בהגדרות האתר בדפדפן.</p>
      )}
      {state === 'off' && (
        <button type="button" disabled={busy} onClick={enable}>
          הפעלת התראות במכשיר הזה
        </button>
      )}
      {state === 'on' && (
        <>
          <p>ההתראות פועלות במכשיר הזה.</p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={sendTest}
          >
            שליחת התראת ניסיון
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={disable}
          >
            כיבוי התראות במכשיר הזה
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

export default PushSettings
