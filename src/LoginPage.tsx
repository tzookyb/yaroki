import { useState, type FormEvent } from 'react'
import { signIn } from './api'

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
    } catch {
      setError('לא הצלחנו להתחבר. בדקו את הסיסמה ונסו שוב.')
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
