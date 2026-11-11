const TIMEOUT_MS = 5_000

// The summary API serves thumbnails from thumb.wikimedia.org, full images from upload.wikimedia.org.
function isWikimediaImage(url: string) {
  return (
    url.startsWith('https://thumb.wikimedia.org/') ||
    url.startsWith('https://upload.wikimedia.org/')
  )
}

// A reference photo is a nice-to-have, so every failure is just "no photo".
export async function findReferenceImage(species: string) {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(species.replaceAll(' ', '_'))}`,
      {
        headers: { 'User-Agent': 'Yaroki/1.0 (personal plant tracker)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      return null
    }
    const page = await response.json<{ thumbnail?: { source?: unknown } }>()
    const url = page.thumbnail?.source
    return typeof url === 'string' && isWikimediaImage(url) ? url : null
  } catch {
    return null
  }
}
