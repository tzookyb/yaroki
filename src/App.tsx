import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSession, type LoginGuard } from './api'
import LoginAlert from './LoginAlert'
import LoginPage from './LoginPage'
import RoomPage from './RoomPage'
import RoomsPage from './RoomsPage'

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash)
  const roomId = hash.match(/^#\/rooms\/(\d+)$/)?.[1]
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [loginGuard, setLoginGuard] = useState<LoginGuard | null>(null)

  useEffect(() => {
    getSession()
      .then((guard) => {
        setLoginGuard(guard)
        setSignedIn(guard !== null)
      })
      .catch(() => setSignedIn(false))
  }, [])

  if (signedIn === null) return null

  return (
    <main>
      {signedIn && loginGuard && <LoginAlert guard={loginGuard} />}
      {!signedIn ? (
        <LoginPage onSignIn={() => setSignedIn(true)} />
      ) : roomId ? (
        <RoomPage key={roomId} id={roomId} />
      ) : (
        <RoomsPage />
      )}
    </main>
  )
}

export default App
