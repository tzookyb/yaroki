const TIMEOUT_MS = 5_000

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
    return typeof url === 'string' &&
      url.startsWith('https://upload.wikimedia.org/')
      ? url
      : null
  } catch {
    return null
  }
}
