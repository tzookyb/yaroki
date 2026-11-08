import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoomProfile } from '../shared/api'
import { describeRoom, identifyPlant } from '../worker/gemini'

const PHOTO = new Uint8Array([1, 2, 3]).buffer

const GOOD_ANSWER = {
  is_plant: true,
  species: ' Ficus lyrata ',
  common_name: 'פיקוס כינורי',
  english_name: 'Fiddle-leaf fig',
  category: 'tree',
  light_needs: 'bright_indirect',
  water_every_days: 7,
  care_notes: ' אור בהיר ללא שמש חמה. ',
}

// Replies to the Gemini call with `answer` as the model's JSON text. The real API is never called.
function mockGemini(answer: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    typeof answer === 'string'
                      ? answer
                      : JSON.stringify(answer),
                },
              ],
            },
          },
        ],
      }),
      { status },
    ),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

const EMPTY_ROOM: RoomProfile = {
  window_direction: null,
  light_level: null,
  humidity: null,
  temp_min: null,
  temp_max: null,
  near_draft: 0,
  near_ac: 0,
  near_heater: 0,
}

describe('describeRoom', () => {
  it('says nothing for a room with no details', () => {
    expect(describeRoom(EMPTY_ROOM)).toBe('')
  })

  it('lists only what was filled in', () => {
    const text = describeRoom({
      ...EMPTY_ROOM,
      window_direction: 'south',
      light_level: 'low',
      temp_min: 18,
      near_ac: 1,
    })
    expect(text).toContain('facing south')
    expect(text).toContain('low light')
    expect(text).toContain('18 to ? °C')
    expect(text).toContain('air conditioner')
    expect(text).not.toContain('Humidity')
    expect(text).not.toContain('in a draft')
  })
})

describe('identifyPlant', () => {
  it('returns cleaned-up fields for a plant', async () => {
    mockGemini(GOOD_ANSWER)
    expect(await identifyPlant(PHOTO, 'key')).toEqual({
      species: 'Ficus lyrata',
      common_name: 'פיקוס כינורי',
      english_name: 'Fiddle-leaf fig',
      category: 'tree',
      light_needs: 'bright_indirect',
      water_every_days: 7,
      care_notes: 'אור בהיר ללא שמש חמה.',
    })
  })

  it('sends the room conditions in the prompt', async () => {
    const fetch = mockGemini(GOOD_ANSWER)
    await identifyPlant(PHOTO, 'key', { ...EMPTY_ROOM, humidity: 'dry' })
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.contents[0].parts[0].text).toContain('Humidity: dry')
  })

  it('stores missing care notes as null', async () => {
    mockGemini({ ...GOOD_ANSWER, care_notes: undefined })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      care_notes: null,
    })
  })

  it('sends the key in a header, not the URL', async () => {
    const fetch = mockGemini(GOOD_ANSWER)
    await identifyPlant(PHOTO, 'secret-key')
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).not.toContain('secret-key')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('secret-key')
  })

  it('returns null when the photo shows no plant', async () => {
    mockGemini({ ...GOOD_ANSWER, is_plant: false })
    expect(await identifyPlant(PHOTO, 'key')).toBeNull()
  })

  it('falls back for an unknown category or light need', async () => {
    mockGemini({ ...GOOD_ANSWER, category: 'alien', light_needs: 'dark' })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      category: 'other',
      light_needs: 'medium',
    })
  })

  it('keeps the watering interval between 1 and 60 days', async () => {
    mockGemini({ ...GOOD_ANSWER, water_every_days: 0 })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      water_every_days: 1,
    })
    mockGemini({ ...GOOD_ANSWER, water_every_days: 400 })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      water_every_days: 60,
    })
    mockGemini({ ...GOOD_ANSWER, water_every_days: 6.6 })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      water_every_days: 7,
    })
  })

  it('stores a missing English name as null', async () => {
    mockGemini({ ...GOOD_ANSWER, english_name: '  ' })
    expect(await identifyPlant(PHOTO, 'key')).toMatchObject({
      english_name: null,
    })
  })

  it.each([
    ['an HTTP error', () => mockGemini(GOOD_ANSWER, 500)],
    ['text that is not JSON', () => mockGemini('not json')],
    ['no species', () => mockGemini({ ...GOOD_ANSWER, species: '' })],
    ['no Hebrew name', () => mockGemini({ ...GOOD_ANSWER, common_name: null })],
    [
      'no watering interval',
      () => mockGemini({ ...GOOD_ANSWER, water_every_days: 'often' }),
    ],
    [
      'no candidates',
      () =>
        vi
          .spyOn(globalThis, 'fetch')
          .mockResolvedValue(Response.json({ candidates: [] })),
    ],
    [
      'a timeout',
      () =>
        vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
    ],
  ])('throws on %s', async (_, mock) => {
    mock()
    await expect(identifyPlant(PHOTO, 'key')).rejects.toThrow()
  })
})
