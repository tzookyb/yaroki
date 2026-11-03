// Used by Sentry in both the app and the Worker.
// No IP address, cookies (the session token), headers or bodies (the password) are sent.
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
}
