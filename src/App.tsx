import { useEffect, useState, useSyncExternalStore } from 'react'
import { isSignedIn } from './api'
import AppHeader from './AppHeader'
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

  useEffect(() => {
    isSignedIn()
      .then(setSignedIn)
      .catch(() => setSignedIn(false))
  }, [])

  if (signedIn === null) {
    return null
  }

  return (
    <main>
      {signedIn && <AppHeader onSignOut={() => setSignedIn(false)} />}
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
