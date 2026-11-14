// Imported by the generated service worker (see `importScripts` in vite.config.ts).
// The push carries no payload, so the open tasks are read from the API when it arrives.
const TITLE = 'ירוקי'
const FALLBACK_BODY = 'יש צמחים שמחכים לטיפול'

function plantsText(tasks) {
  return tasks.length === 1
    ? (tasks[0].plant_name ?? 'צמח')
    : `${tasks.length} צמחים`
}

async function reminderBody() {
  try {
    const response = await fetch('/api/tasks')
    if (!response.ok) {
      return FALLBACK_BODY
    }
    const { today, tasks } = await response.json()
    const due = (type) =>
      tasks.filter(
        (task) =>
          task.type === type && !task.done_today && task.due_date <= today,
      )
    const lines = []
    if (due('water').length > 0) {
      lines.push(`הגיע הזמן להשקות: ${plantsText(due('water'))}`)
    }
    if (due('mist').length > 0) {
      lines.push(`האוויר יבש, כדאי לרסס: ${plantsText(due('mist'))}`)
    }
    return lines.length > 0 ? lines.join('\n') : FALLBACK_BODY
  } catch {
    return FALLBACK_BODY
  }
}

// Chrome requires every push to show a notification, so this always shows one.
self.addEventListener('push', (event) => {
  event.waitUntil(
    reminderBody().then((body) =>
      self.registration.showNotification(TITLE, {
        body,
        icon: '/icon-192.png',
        lang: 'he',
        dir: 'rtl',
        tag: 'watering',
      }),
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) =>
        windows.length > 0 ? windows[0].focus() : self.clients.openWindow('/'),
      ),
  )
})
