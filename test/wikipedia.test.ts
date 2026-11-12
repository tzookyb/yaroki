import { afterEach, describe, expect, it, vi } from 'vitest'
import { findReferenceImage, findReferenceImages } from '../worker/wikipedia'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('findReferenceImage', () => {
  it('returns the thumbnail of the species page', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        thumbnail: { source: 'https://thumb.wikimedia.org/a.jpg' },
      }),
    )
    expect(await findReferenceImage('Ficus lyrata')).toBe(
      'https://thumb.wikimedia.org/a.jpg',
    )
    expect(String(fetch.mock.calls[0][0])).toContain('/Ficus_lyrata')
  })

  it('ignores an image that is not from Wikimedia', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ thumbnail: { source: 'https://evil.test/a.jpg' } }),
    )
    expect(await findReferenceImage('Ficus lyrata')).toBeNull()
  })

  it('returns null when there is no page or the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      async () => new Response('', { status: 404 }),
    )
    expect(await findReferenceImage('Nothing here')).toBeNull()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))
    expect(await findReferenceImage('Ficus lyrata')).toBeNull()
  })
})

describe('findReferenceImages', () => {
  it('puts the lead photo first and adds photos from the media list', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/media-list/')
        ? Response.json({
            items: [
              {
                type: 'image',
                title: 'File:Map.svg',
                srcset: [{ src: '//upload.wikimedia.org/map.svg' }],
              },
              {
                type: 'image',
                title: 'File:Leaf.jpg',
                srcset: [{ src: '//upload.wikimedia.org/leaf.jpg' }],
              },
              {
                type: 'image',
                title: 'File:Evil.jpg',
                srcset: [{ src: '//evil.test/evil.jpg' }],
              },
            ],
          })
        : Response.json({
            thumbnail: { source: 'https://thumb.wikimedia.org/a.jpg' },
          }),
    )
    expect(await findReferenceImages('Ficus lyrata')).toEqual([
      'https://thumb.wikimedia.org/a.jpg',
      'https://upload.wikimedia.org/leaf.jpg',
    ])
  })

  it('returns an empty list when nothing is found', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await findReferenceImages('Nothing')).toEqual([])
  })
})
