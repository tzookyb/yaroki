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
  void import('./devFavicon').then(({ devFavicon }) => {
    document
      .querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?.setAttribute(
        'href',
        `data:image/svg+xml,${encodeURIComponent(devFavicon)}`,
      )
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
