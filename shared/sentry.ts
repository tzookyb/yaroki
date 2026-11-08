// No IP address, cookies (the session token), headers or bodies (the password) are sent.
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
}

// Sensibo takes its API key as a query parameter, so URLs in fetch breadcrumbs must lose theirs.
export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(
  breadcrumb: T,
): T {
  const url = breadcrumb.data?.url
  if (typeof url === 'string' && url.includes('?')) {
    return {
      ...breadcrumb,
      data: { ...breadcrumb.data, url: url.split('?')[0] },
    }
  }
  return breadcrumb
}
