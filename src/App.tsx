import { useEffect, useState } from 'react'

type Plant = {
  id: number
  name: string
  location: string | null
}

function App() {
  const [plants, setPlants] = useState<Plant[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/plants')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(setPlants)
      .catch(() => setError(true))
  }, [])

  return (
    <main>
      <h1>Plants Tracker</h1>
      {error && <p>Could not load plants.</p>}
      {plants?.length === 0 && <p>No plants yet.</p>}
      <ul>
        {plants?.map((plant) => (
          <li key={plant.id}>
            {plant.name}
            {plant.location && ` (${plant.location})`}
          </li>
        ))}
      </ul>
    </main>
  )
}

export default App
