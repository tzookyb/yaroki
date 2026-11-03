import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Mark local dev so it can't be mistaken for prod. Removed from the prod build.
if (import.meta.env.DEV) {
  document.title = `local · ${document.title}`
  const badge = document.createElement('div')
  badge.className = 'dev-badge'
  badge.textContent = 'local'
  document.body.append(badge)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
