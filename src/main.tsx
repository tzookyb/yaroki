import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorFallback from './ErrorFallback.tsx'
import { SENTRY_DATA_COLLECTION } from '../shared/sentry'

// Sentry stays off until VITE_SENTRY_DSN is set at build time, and never runs in local dev.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn && !import.meta.env.DEV) {
  Sentry.init({ dsn: sentryDsn, dataCollection: SENTRY_DATA_COLLECTION })
}

// Yellow favicon in local dev so it can't be mistaken for prod. Removed from the prod build.
if (import.meta.env.DEV) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f2c230"/>
  <path d="M256 392c0-70 0-120 0-168" fill="none" stroke="#2f6b3f" stroke-width="20" stroke-linecap="round"/>
  <path d="M256 280c-76 0-120-46-120-124 78 0 120 46 120 124z" fill="#2f6b3f"/>
  <path d="M256 228c0-66 40-104 112-104 0 68-40 104-112 104z" fill="#4f8a5c"/>
</svg>`
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"]')
    ?.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`)
}

// Sentry's ErrorBoundary is a normal React error boundary, and also reports the error when Sentry is on.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
