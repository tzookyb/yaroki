import { useState, type FormEvent } from 'react'
import { HttpError, signIn } from './api'

const ERROR_TEXT_BY_STATUS: Record<number, string> = {
  423: 'Login blocked',
  429: 'יותר מדי ניסיונות כניסה. נסו שוב מאוחר יותר.',
  503: 'הסיסמה בשרת קצרה מדי. צריך סיסמה של 20 תווים לפחות.',
}

function errorText(error: unknown) {
  const status = error instanceof HttpError ? error.status : 0
  return ERROR_TEXT_BY_STATUS[status] ?? 'לא הצלחנו להתחבר. בדקו את הסיסמה ונסו שוב.'
}

function LoginPage({ onSignIn }: { onSignIn: () => void }) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await signIn(password)
      onSignIn()
    } catch (error) {
      setError(errorText(error))
      setSaving(false)
    }
  }

  return (
    <>
      <h1>מעקב צמחים</h1>
      {error && <p role="alert">{error}</p>}
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          aria-label="סיסמה"
          type="password"
          autoComplete="current-password"
          placeholder="סיסמה"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={saving || !password}>
          כניסה
        </button>
      </form>
    </>
  )
}

export default LoginPage
