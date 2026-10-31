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
      setError('Could not sign in. Check the password and try again.')
      setSaving(false)
    }
  }

  return (
    <>
      <h1>Plants Tracker</h1>
      {error && <p role="alert">{error}</p>}
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={saving || !password}>
          Sign in
        </button>
      </form>
    </>
  )
}

export default LoginPage
