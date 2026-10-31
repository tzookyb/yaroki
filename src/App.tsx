import { useSyncExternalStore } from 'react'
import RoomPage from './RoomPage'
import RoomsPage from './RoomsPage'

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash)
  const roomId = hash.match(/^#\/rooms\/(\d+)$/)?.[1]

  return (
    <main>{roomId ? <RoomPage key={roomId} id={roomId} /> : <RoomsPage />}</main>
  )
}

export default App
