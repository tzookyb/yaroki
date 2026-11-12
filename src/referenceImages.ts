import type { Plant } from './api'

export function referenceImages(plant: Plant) {
  const parsed: unknown = JSON.parse(plant.reference_images || '[]')
  const urls = Array.isArray(parsed)
    ? parsed.filter((url): url is string => typeof url === 'string')
    : []
  return urls.length > 0 || !plant.reference_image_url
    ? urls
    : [plant.reference_image_url]
}
