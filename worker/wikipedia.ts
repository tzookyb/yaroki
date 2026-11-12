const TIMEOUT_MS = 5_000
const MAX_IMAGES = 4
const API = 'https://en.wikipedia.org/api/rest_v1/page'

// The summary API serves thumbnails from thumb.wikimedia.org, full images from upload.wikimedia.org.
function isWikimediaImage(url: string) {
  return (
    url.startsWith('https://thumb.wikimedia.org/') ||
    url.startsWith('https://upload.wikimedia.org/')
  )
}

async function fetchPage<T>(kind: 'summary' | 'media-list', species: string) {
  try {
    const response = await fetch(
      `${API}/${kind}/${encodeURIComponent(species.replaceAll(' ', '_'))}`,
      {
        headers: { 'User-Agent': 'Yaroki/1.0 (personal plant tracker)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    return response.ok ? await response.json<T>() : null
  } catch {
    return null
  }
}

// A reference photo is a nice-to-have, so every failure is just "no photo".
export async function findReferenceImage(species: string) {
  const page = await fetchPage<{ thumbnail?: { source?: unknown } }>(
    'summary',
    species,
  )
  const url = page?.thumbnail?.source
  return typeof url === 'string' && isWikimediaImage(url) ? url : null
}

type MediaItem = {
  type?: string
  title?: string
  srcset?: { src?: unknown }[]
}

// The page's lead photo first, then more photos from its media list (no icons or maps).
export async function findReferenceImages(species: string) {
  const [lead, media] = await Promise.all([
    findReferenceImage(species),
    fetchPage<{ items?: MediaItem[] }>('media-list', species),
  ])
  const urls = lead ? [lead] : []
  for (const item of media?.items ?? []) {
    const src = item.srcset?.[0]?.src
    if (
      item.type !== 'image' ||
      !/\.(jpe?g|png|webp)$/i.test(item.title ?? '') ||
      typeof src !== 'string'
    ) {
      continue
    }
    const url = src.startsWith('//') ? `https:${src}` : src
    if (isWikimediaImage(url) && !urls.includes(url)) {
      urls.push(url)
    }
  }
  return urls.slice(0, MAX_IMAGES)
}
