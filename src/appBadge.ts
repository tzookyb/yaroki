// The badge on the installed app's icon. The OS draws it, so its color can't be set.
// Not supported everywhere, so failing quietly is fine.
export function setAppBadge(count: number) {
  try {
    if (count > 0) {
      navigator.setAppBadge?.(count)?.catch(() => {})
    } else {
      navigator.clearAppBadge?.()?.catch(() => {})
    }
  } catch {
    // Ignore.
  }
}
