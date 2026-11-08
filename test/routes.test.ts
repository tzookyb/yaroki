import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PHOTO_BYTES } from '../worker/limits'
import { addPlant, addRoom, addWatering, api, json, signIn } from './helpers'

let session = ''

beforeEach(async () => {
  session = (await signIn()).token
})

afterEach(() => {
  vi.restoreAllMocks()
})

function upload(roomId: number, body: BodyInit, type = 'image/webp') {
  return api(
    `/rooms/${roomId}/plants`,
    { method: 'POST', headers: { 'Content-Type': type }, body },
    session,
  )
}

async function count(table: string) {
  return env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<number>(
    'count',
  )
}

describe('rooms', () => {
  it('trims room names', async () => {
    const response = await api('/rooms', json({ name: '  מטבח  ' }), session)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ name: 'מטבח' })
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['over 40 characters', 'א'.repeat(41)],
    ['not a string', 42],
  ])('refuses a name that is %s', async (_, name) => {
    const response = await api('/rooms', json({ name }), session)
    expect(response.status).toBe(400)
    expect(await count('rooms')).toBe(0)
  })

  it('accepts a name of exactly 40 characters', async () => {
    const response = await api(
      '/rooms',
      json({ name: 'א'.repeat(40) }),
      session,
    )
    expect(response.status).toBe(201)
  })

  it('refuses a bad id and reports a missing room', async () => {
    expect((await api('/rooms/abc', {}, session)).status).toBe(400)
    expect((await api('/rooms/0', {}, session)).status).toBe(400)
    expect((await api('/rooms/999', {}, session)).status).toBe(404)
  })
})

describe('adding a plant', () => {
  it('stores the photo in R2 and the plant in D1', async () => {
    const room = await addRoom()
    const response = await upload(room, new Uint8Array([1, 2, 3]))
    expect(response.status).toBe(201)
    const plant = await response.json<{ photo_key: string }>()
    expect(plant.photo_key).toMatch(/^plants\/.+\.webp$/)
    expect(await env.PHOTOS.head(plant.photo_key)).not.toBeNull()
  })

  it('refuses a photo that is not WebP', async () => {
    const room = await addRoom()
    expect((await upload(room, new Uint8Array([1]), 'image/png')).status).toBe(
      415,
    )
  })

  it('refuses an empty or oversized photo', async () => {
    const room = await addRoom()
    expect((await upload(room, new Uint8Array())).status).toBe(413)
    expect(
      (await upload(room, new Uint8Array(MAX_PHOTO_BYTES + 1))).status,
    ).toBe(413)
    expect(await count('plants')).toBe(0)
  })

  it('reports a missing room', async () => {
    expect((await upload(999, new Uint8Array([1]))).status).toBe(404)
  })
})

describe('deleting', () => {
  it('removes a room with its plants, their photos and their events', async () => {
    const room = await addRoom()
    const otherRoom = await addRoom('מטבח')
    await env.PHOTOS.put('plants/a.webp', 'a')
    await env.PHOTOS.put('plants/b.webp', 'b')
    const plant = await addPlant({ room_id: room, photo_key: 'plants/a.webp' })
    await addPlant({ room_id: otherRoom, photo_key: 'plants/b.webp' })
    await addWatering(plant, '2026-01-01 09:00:00')

    expect(
      (await api(`/rooms/${room}`, { method: 'DELETE' }, session)).status,
    ).toBe(204)
    expect(await env.PHOTOS.head('plants/a.webp')).toBeNull()
    expect(await env.PHOTOS.head('plants/b.webp')).not.toBeNull()
    expect(await count('plants')).toBe(1)
    expect(await count('events')).toBe(0)
    expect(await count('rooms')).toBe(1)
  })

  it('keeps the database rows when R2 fails, so the delete can be retried', async () => {
    const room = await addRoom()
    await addPlant({ room_id: room, photo_key: 'plants/a.webp' })
    vi.spyOn(env.PHOTOS, 'delete').mockRejectedValue(new Error('R2 down'))

    const response = await api(`/rooms/${room}`, { method: 'DELETE' }, session)
    expect(response.status).toBe(500)
    expect(await count('plants')).toBe(1)
    expect(await count('rooms')).toBe(1)
  })

  it('removes a plant with its photo and events', async () => {
    await env.PHOTOS.put('plants/a.webp', 'a')
    const plant = await addPlant({ photo_key: 'plants/a.webp' })
    await addWatering(plant, '2026-01-01 09:00:00')

    expect(
      (await api(`/plants/${plant}`, { method: 'DELETE' }, session)).status,
    ).toBe(204)
    expect(await env.PHOTOS.head('plants/a.webp')).toBeNull()
    expect(await count('events')).toBe(0)
    expect(
      (await api(`/plants/${plant}`, { method: 'DELETE' }, session)).status,
    ).toBe(404)
  })
})

const PROFILE = {
  window_direction: 'south',
  light_level: 'bright_indirect',
  humidity: 'dry',
  temp_min: 18,
  temp_max: 28,
  near_draft: 0,
  near_ac: 1,
  near_heater: 0,
}

function putProfile(roomId: number, body: unknown) {
  return api(
    `/rooms/${roomId}/profile`,
    { ...json(body), method: 'PUT' },
    session,
  )
}

describe('room profile', () => {
  it('starts empty, then saves and returns the profile', async () => {
    const room = await addRoom()
    expect(
      await (await api(`/rooms/${room}`, {}, session)).json(),
    ).toMatchObject({ light_level: null, near_ac: 0 })

    const response = await putProfile(room, PROFILE)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject(PROFILE)
    expect(
      await (await api(`/rooms/${room}`, {}, session)).json(),
    ).toMatchObject(PROFILE)
  })

  it('lets every pick be cleared again', async () => {
    const room = await addRoom()
    await putProfile(room, PROFILE)
    const cleared = {
      ...PROFILE,
      window_direction: null,
      light_level: null,
      humidity: null,
      temp_min: null,
      temp_max: null,
    }
    expect(await (await putProfile(room, cleared)).json()).toMatchObject(
      cleared,
    )
  })

  it.each([
    ['an unknown light level', { light_level: 'blinding' }],
    ['a flag that is not 0 or 1', { near_ac: 2 }],
    ['a temperature that is too high', { temp_max: 80 }],
    ['a temperature with decimals', { temp_min: 18.5 }],
    ['a minimum above the maximum', { temp_min: 30, temp_max: 20 }],
  ])('refuses %s', async (_, change) => {
    const room = await addRoom()
    expect((await putProfile(room, { ...PROFILE, ...change })).status).toBe(400)
  })

  it('answers 404 for a room that does not exist', async () => {
    expect((await putProfile(999, PROFILE)).status).toBe(404)
  })
})

describe('plant details', () => {
  it('returns the plant with its room profile', async () => {
    const room = await addRoom()
    await putProfile(room, PROFILE)
    const plant = await addPlant({ room_id: room })
    const response = await api(`/plants/${plant}`, {}, session)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: plant,
      room: { light_level: 'bright_indirect', near_ac: 1 },
    })
  })

  it('returns the newest reading from the last 3 days, not older ones', async () => {
    const room = await addRoom()
    const plant = await addPlant({ room_id: room })
    const none = await (await api(`/plants/${plant}`, {}, session)).json()
    expect(none).toMatchObject({ latest_reading: null })
    await env.DB.prepare(
      `INSERT INTO room_readings (room_id, source_id, measured_at, temperature, humidity)
       VALUES (?, 'weather', date('now', '-10 days'), 5, 90),
              (?, 'weather', datetime('now', '-1 hours'), 21.5, 48)`,
    )
      .bind(room, room)
      .run()
    const body = await (await api(`/plants/${plant}`, {}, session)).json()
    expect(body).toMatchObject({
      latest_reading: { temperature: 21.5, humidity: 48 },
    })
  })

  it('includes the latest reading in the room list', async () => {
    const room = await addRoom()
    const before = await (await api('/rooms', {}, session)).json<any[]>()
    expect(before.find((r) => r.id === room)?.latest_reading).toBeNull()
    await env.DB.prepare(
      `INSERT INTO room_readings (room_id, source_id, measured_at, temperature, humidity)
       VALUES (?, 'weather', datetime('now', '-1 hours'), 21.5, 48)`,
    )
      .bind(room)
      .run()
    const after = await (await api('/rooms', {}, session)).json<any[]>()
    expect(after.find((r) => r.id === room)?.latest_reading).toEqual({
      temperature: 21.5,
      humidity: 48,
    })
  })

  it('returns room null for a plant without a room', async () => {
    const plant = await addPlant({})
    const body = await (await api(`/plants/${plant}`, {}, session)).json()
    expect(body).toMatchObject({ room: null })
  })

  it('answers 404 for a missing plant', async () => {
    expect((await api('/plants/999', {}, session)).status).toBe(404)
  })
})

describe('identifying a plant', () => {
  it('saves what Gemini returns', async () => {
    await env.PHOTOS.put('plants/a.webp', new Uint8Array([1]))
    const plant = await addPlant({ photo_key: 'plants/a.webp' })
    // Built inside the call, because a Worker can't read a body made in another request.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('wikipedia.org')) {
        return Response.json({
          thumbnail: { source: 'https://upload.wikimedia.org/ficus.jpg' },
        })
      }
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    is_plant: true,
                    species: 'Ficus lyrata',
                    common_name: 'פיקוס כינורי',
                    english_name: 'Fiddle-leaf fig',
                    category: 'tree',
                    light_needs: 'bright_indirect',
                    water_every_days: 7,
                    humidity_needs: 'normal',
                    temp_min: 16,
                    temp_max: 27,
                    description: 'עץ בית גדול.',
                    care_notes: '',
                  }),
                },
              ],
            },
          },
        ],
      })
    })

    const response = await api(
      `/plants/${plant}/identify`,
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      name: 'פיקוס כינורי',
      species: 'Ficus lyrata',
      water_every_days: 7,
      humidity_needs: 'normal',
      temp_min: 16,
      temp_max: 27,
      description: 'עץ בית גדול.',
      reference_image_url: 'https://upload.wikimedia.org/ficus.jpg',
    })
  })

  it('tells Gemini about the room and saves the care notes', async () => {
    const room = await addRoom()
    await putProfile(room, PROFILE)
    await env.PHOTOS.put('plants/a.webp', new Uint8Array([1]))
    const plant = await addPlant({ photo_key: 'plants/a.webp', room_id: room })
    let prompt = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    is_plant: true,
                    species: 'Ficus lyrata',
                    common_name: 'פיקוס כינורי',
                    english_name: 'Fiddle-leaf fig',
                    category: 'tree',
                    light_needs: 'bright_indirect',
                    water_every_days: 7,
                    care_notes: 'הרחק מהמזגן',
                  }),
                },
              ],
            },
          },
        ],
      })
    })

    const response = await api(
      `/plants/${plant}/identify`,
      { method: 'POST' },
      session,
    )
    expect(prompt).toContain('facing south')
    expect(await response.json()).toMatchObject({ care_notes: 'הרחק מהמזגן' })
  })

  it('keeps the plant and answers 502 when Gemini fails', async () => {
    await env.PHOTOS.put('plants/a.webp', new Uint8Array([1]))
    const plant = await addPlant({ photo_key: 'plants/a.webp' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('quota', { status: 429 }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await api(
      `/plants/${plant}/identify`,
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(502)
    expect(await count('plants')).toBe(1)
  })
})

describe('tasks API', () => {
  it('marks watering done and undoes it', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const path = `/plants/${plant}/tasks/water/done`
    expect((await api(path, { method: 'POST' }, session)).status).toBe(204)
    expect((await api(path, { method: 'DELETE' }, session)).status).toBe(204)
    expect((await api(path, { method: 'DELETE' }, session)).status).toBe(404)
  })

  it('skips a task with a reason and undoes the skip', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const path = `/plants/${plant}/tasks/water/skip`
    expect(
      (await api(path, json({ reason: 'wet_soil' }), session)).status,
    ).toBe(204)
    expect((await api(path, { method: 'DELETE' }, session)).status).toBe(204)
  })

  it('refuses an unknown skip reason', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const response = await api(
      `/plants/${plant}/tasks/water/skip`,
      json({ reason: 'bored' }),
      session,
    )
    expect(response.status).toBe(400)
  })

  it('refuses a task type with odd characters', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const response = await api(
      `/plants/${plant}/tasks/wa-ter/done`,
      { method: 'POST' },
      session,
    )
    expect(response.status).toBe(400)
  })
})

describe('security headers', () => {
  it('sends a CSP that allows nothing on API responses', async () => {
    const response = await api('/health')
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
