import { deletePushSubscription } from './api'

// The service worker is not registered by `npm run dev`, so push only works in a built app.
export async function getPushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function currentSubscription() {
  const registration = await getPushRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

// Used on sign-out, so a device that is signed out stops getting reminders. Best effort.
export async function unsubscribeThisDevice() {
  try {
    const subscription = await currentSubscription()
    if (subscription) {
      await deletePushSubscription(subscription.endpoint).catch(() => {})
      await subscription.unsubscribe()
    }
  } catch {}
}
