import type { RoomClimate } from '../shared/api'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectReadings } from '../worker/readings'
import { addRoom, api, json, signIn } from './helpers'

let session = ''

beforeEach(async () => {
  session = (await signIn()).token
})

afterEach(() => {
  vi.restoreAllMocks()
})

const PODS = {
  result: [
    {
      id: 'abcd1234',
      room: { name: 'Salon' },
      measurements: {
        temperature: 24.5,
        humidity: 51,
        time: { time: '2026-11-08T12:00:00.000000Z' },
      },
    },
    { id: 'offline1', room: { name: 'Bedroom' }, measurements: null },
  ],
}

// A Response is built per call, because a Worker can't read a body made in another request.
function mockFetch(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    const host = Object.keys(routes).find((h) => url.includes(h))
    if (!host) {
      return new Response('{}', { status: 404 })
    }
    return Response.json(routes[host])
  })
}

function put(path: string, body: unknown) {
  return api(path, { ...json(body), method: 'PUT' }, session)
}

async function readings(roomId: number) {
  const { results } = await env.DB.prepare(
    'SELECT source_id, measured_at, temperature, humidity FROM room_readings WHERE room_id = ? ORDER BY measured_at',
  )
    .bind(roomId)
    .all()
  return results
}

describe('sensors', () => {
  it('lists devices with the room they are mapped to', async () => {
    const roomId = await addRoom()
    mockFetch({ 'sensibo.com': PODS })
    await put('/climate/sensors/abcd1234', { room_id: roomId })

    const response = await api('/climate/sensors', {}, session)
    expect(await response.json()).toEqual([
      { id: 'abcd1234', name: 'Salon', room_id: roomId },
      { id: 'offline1', name: 'Bedroom', room_id: null },
    ])
  })

  it('answers 502 when Sensibo fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('no', { status: 500 }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await api('/climate/sensors', {}, session)
    expect(response.status).toBe(502)
  })

  it('moves a device to another room and unmaps it', async () => {
    const first = await addRoom('a')
    const second = await addRoom('b')
    await put('/climate/sensors/abcd1234', { room_id: first })
    await put('/climate/sensors/abcd1234', { room_id: second })
    const mapped = await env.DB.prepare(
      'SELECT room_id FROM room_sensors',
    ).all()
    expect(mapped.results).toEqual([{ room_id: second }])

    const response = await put('/climate/sensors/abcd1234', { room_id: null })
    expect(response.status).toBe(204)
    expect(
      (await env.DB.prepare('SELECT * FROM room_sensors').all()).results,
    ).toHaveLength(0)
  })

  it('keeps one sensor per room', async () => {
    const roomId = await addRoom()
    await put('/climate/sensors/abcd1234', { room_id: roomId })
    await put('/climate/sensors/offline1', { room_id: roomId })
    const mapped = await env.DB.prepare(
      'SELECT sensibo_id FROM room_sensors',
    ).all()
    expect(mapped.results).toEqual([{ sensibo_id: 'offline1' }])
  })

  it('rejects an unknown room and a bad device id', async () => {
    expect(
      (await put('/climate/sensors/abcd1234', { room_id: 999 })).status,
    ).toBe(404)
    expect(
      (await put('/climate/sensors/a%20b', { room_id: null })).status,
    ).toBe(400)
  })
})

async function setHome() {
  await env.DB.prepare(
    "INSERT INTO home_location (id, label, latitude, longitude) VALUES (1, 'x', 32.1, 34.8)",
  ).run()
}

describe('collecting readings', () => {
  it('stores a reading for a mapped device, once', async () => {
    const roomId = await addRoom()
    await env.DB.prepare(
      'INSERT INTO room_sensors (sensibo_id, room_id) VALUES (?, ?)',
    )
      .bind('abcd1234', roomId)
      .run()
    mockFetch({ 'sensibo.com': PODS })

    await collectReadings(env)
    await collectReadings(env)

    expect(await readings(roomId)).toEqual([
      {
        source_id: 'abcd1234',
        measured_at: '2026-11-08 12:00:00',
        temperature: 24.5,
        humidity: 51,
      },
    ])
  })

  it('keeps readings of devices that are not linked to a room for the home average', async () => {
    mockFetch({ 'sensibo.com': PODS })
    await collectReadings(env)
    const { results } = await env.DB.prepare(
      'SELECT source_id, temperature FROM home_readings',
    ).all()
    expect(results).toEqual([{ source_id: 'abcd1234', temperature: 24.5 }])
    const roomReadings = await env.DB.prepare(
      'SELECT 1 FROM room_readings',
    ).all()
    expect(roomReadings.results).toEqual([])
  })

  it('stores the weather for outdoor rooms only', async () => {
    await setHome()
    const garden = await addRoom('garden')
    const indoor = await addRoom('salon')
    await env.DB.prepare(
      "UPDATE rooms SET location_type = 'garden' WHERE id = ?",
    )
      .bind(garden)
      .run()
    mockFetch({
      'archive-api.open-meteo.com': {
        daily: {
          time: [],
          temperature_2m_mean: [],
          relative_humidity_2m_mean: [],
        },
      },
      'api.open-meteo.com': {
        current: {
          time: '2026-11-08T12:00',
          temperature_2m: 19.2,
          relative_humidity_2m: 60,
        },
      },
    })

    await collectReadings(env)

    expect(await readings(garden)).toEqual([
      {
        source_id: 'weather',
        measured_at: '2026-11-08 12:00:00',
        temperature: 19.2,
        humidity: 60,
      },
    ])
    expect(await readings(indoor)).toEqual([])
  })

  it('keeps going when one source fails', async () => {
    await setHome()
    const garden = await addRoom('garden')
    await env.DB.prepare(
      "UPDATE rooms SET location_type = 'garden' WHERE id = ?",
    )
      .bind(garden)
      .run()
    const roomId = await addRoom()
    await env.DB.prepare(
      'INSERT INTO room_sensors (sensibo_id, room_id) VALUES (?, ?)',
    )
      .bind('abcd1234', roomId)
      .run()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch({
      'api.open-meteo.com': {
        current: { time: '2026-11-08T12:00', temperature_2m: 19.2 },
      },
    })

    await collectReadings(env)

    expect(await readings(roomId)).toEqual([])
    expect(await readings(garden)).toHaveLength(1)
  })
})

describe('room location and climate', () => {
  it('backfills two years of weather when a room becomes outdoor', async () => {
    await setHome()
    const roomId = await addRoom()
    const spy = mockFetch({
      'archive-api.open-meteo.com': {
        daily: {
          time: ['2025-01-01', '2025-01-02', '2025-01-03'],
          temperature_2m_mean: [11, null, 13],
          relative_humidity_2m_mean: [70, 70, null],
        },
      },
    })

    const response = await put(`/climate/rooms/${roomId}/location`, {
      location_type: 'garden',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ location_type: 'garden' })
    expect(await readings(roomId)).toEqual([
      {
        source_id: 'weather',
        measured_at: '2025-01-01 12:00:00',
        temperature: 11,
        humidity: 70,
      },
      {
        source_id: 'weather',
        measured_at: '2025-01-03 12:00:00',
        temperature: 13,
        humidity: null,
      },
    ])

    await put(`/climate/rooms/${roomId}/location`, {
      location_type: 'outside_window',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('still switches the room when the weather service is down', async () => {
    const roomId = await addRoom()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('no', { status: 500 }),
    )
    const response = await put(`/climate/rooms/${roomId}/location`, {
      location_type: 'garden',
    })
    expect(response.status).toBe(200)
  })

  it('rejects an unknown location type and a missing room', async () => {
    const roomId = await addRoom()
    expect(
      (
        await put(`/climate/rooms/${roomId}/location`, {
          location_type: 'moon',
        })
      ).status,
    ).toBe(400)
    expect(
      (await put('/climate/rooms/999/location', { location_type: 'indoor' }))
        .status,
    ).toBe(404)
  })

  async function insert(
    roomId: number,
    rows: [string, number, number | null][],
  ) {
    for (const [at, temp, humidity] of rows) {
      await env.DB.prepare(
        "INSERT INTO room_readings (room_id, source_id, measured_at, temperature, humidity) VALUES (?, 's', ?, ?, ?)",
      )
        .bind(roomId, at, temp, humidity)
        .run()
    }
  }

  const at = (iso: string) => Date.parse(`${iso}Z`) / 1000

  it('returns single readings while this year has little data', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-08T12:00:00Z'),
    })
    const roomId = await addRoom()
    await insert(roomId, [
      ['2026-11-08 08:00:00', 20, 40],
      ['2026-11-08 09:00:00', 22, null],
    ])

    const body = (await (
      await api(`/climate/rooms/${roomId}`, {}, session)
    ).json()) as RoomClimate
    expect({ ...body, averages: undefined }).toEqual({
      sensor_count: 0,
      sensor_name: null,
      home_average: false,
      averages: undefined,
      year: 2026,
      resolution: 'raw',
      current: [
        { t: at('2026-11-08T08:00:00'), temperature: 20, humidity: 40 },
        { t: at('2026-11-08T09:00:00'), temperature: 22, humidity: null },
      ],
      latest: {
        temperature: 22,
        humidity: null,
        measured_at: '2026-11-08 09:00:00',
      },
    })
    vi.useRealTimers()
  })

  it('averages by day, then by week, as this year fills up', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-08T12:00:00Z'),
    })
    const roomId = await addRoom()
    await insert(roomId, [
      ['2026-11-01 06:00:00', 10, null],
      ['2026-11-01 18:00:00', 14, null],
      ['2026-11-08 12:00:00', 20, null],
    ])
    let body = (await (
      await api(`/climate/rooms/${roomId}`, {}, session)
    ).json()) as RoomClimate
    expect(body.resolution).toBe('day')
    expect(
      body.current.map((p: { temperature: number }) => p.temperature),
    ).toEqual([12, 20])

    await insert(roomId, [['2026-04-01 12:00:00', 16, null]])
    body = (await (
      await api(`/climate/rooms/${roomId}`, {}, session)
    ).json()) as RoomClimate
    expect(body.resolution).toBe('week')
    expect(body.current).toHaveLength(3)
    vi.useRealTimers()
  })

  it('averages the last 7, 30 and 90 days from what exists', async () => {
    const roomId = await addRoom()
    for (const [days, temperature, humidity] of [
      [2, 20, 40],
      [10, 30, null],
      [60, 10, 70],
      [200, 99, 99],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO room_readings (room_id, source_id, measured_at, temperature, humidity)
         VALUES (?, 'x', datetime('now', ?), ?, ?)`,
      )
        .bind(roomId, `-${days} days`, temperature, humidity)
        .run()
    }
    const body = (await (
      await api(`/climate/rooms/${roomId}`, {}, session)
    ).json()) as RoomClimate
    expect(body.averages).toEqual([
      { days: 7, temperature: 20, humidity: 40 },
      { days: 30, temperature: 25, humidity: 40 },
      { days: 90, temperature: 20, humidity: 55 },
    ])
  })

  it('shows the average of all sensors in an indoor room without its own', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-08T12:00:00Z'),
    })
    const kitchen = await addRoom('kitchen')
    for (const [source, time, temp, humidity] of [
      ['a', '2026-11-08 09:00:00', 20, 40],
      ['b', '2026-11-08 09:10:00', 24, 60],
      ['a', '2026-11-08 10:00:00', 22, 40],
      ['b', '2026-11-08 10:05:00', 26, 50],
    ] as const) {
      await env.DB.prepare(
        'INSERT INTO home_readings (source_id, measured_at, temperature, humidity) VALUES (?, ?, ?, ?)',
      )
        .bind(source, time, temp, humidity)
        .run()
    }
    const body = (await (
      await api(`/climate/rooms/${kitchen}`, {}, session)
    ).json()) as RoomClimate
    expect(body.home_average).toBe(true)
    expect(body.current.map((p) => p.temperature)).toEqual([22, 24])
    expect(body.latest).toMatchObject({ temperature: 24, humidity: 45 })
  })

  it('returns no points and no latest for a room without readings', async () => {
    const roomId = await addRoom()
    const response = await api(`/climate/rooms/${roomId}`, {}, session)
    expect(await response.json()).toMatchObject({
      sensor_count: 0,
      current: [],
      latest: null,
    })
  })

  it('deletes readings with their room', async () => {
    const roomId = await addRoom()
    await env.DB.prepare(
      "INSERT INTO room_readings (room_id, source_id, measured_at, temperature) VALUES (?, 's', '2026-01-01 00:00:00', 20)",
    )
      .bind(roomId)
      .run()
    await api(`/rooms/${roomId}`, { method: 'DELETE' }, session)
    expect(
      (await env.DB.prepare('SELECT * FROM room_readings').all()).results,
    ).toHaveLength(0)
  })
})

describe('home location', () => {
  const PHOTON = {
    features: [
      {
        geometry: { coordinates: [34.78, 32.08] },
        properties: {
          name: 'Dizengoff 50',
          street: 'Dizengoff Street',
          housenumber: '50',
          city: 'Tel Aviv',
          country: 'Israel',
        },
      },
      {
        geometry: { coordinates: [34.8, 32.1] },
        properties: { name: 'Tel Aviv', country: 'Israel' },
      },
      {
        geometry: { coordinates: [34.81, 32.11] },
        properties: { name: 'Tel Aviv', country: 'Israel' },
      },
    ],
  }

  it('is empty until it is set, then saved and read back', async () => {
    expect(await (await api('/climate/home', {}, session)).json()).toBeNull()
    const home = { label: 'Tel Aviv, Israel', latitude: 32.1, longitude: 34.8 }
    expect((await put('/climate/home', home)).status).toBe(200)
    expect(await (await api('/climate/home', {}, session)).json()).toEqual(home)
    await put('/climate/home', { ...home, label: 'Haifa' })
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM home_location',
      ).first<number>('n'),
    ).toBe(1)
  })

  it.each([
    { label: '', latitude: 1, longitude: 1 },
    { label: 'x', latitude: 91, longitude: 1 },
    { label: 'x', latitude: 1, longitude: 181 },
  ])('rejects %j', async (body) => {
    expect((await put('/climate/home', body)).status).toBe(400)
  })

  it('replaces the weather of outdoor rooms with the new place', async () => {
    const garden = await addRoom('garden')
    await env.DB.prepare(
      "UPDATE rooms SET location_type = 'garden' WHERE id = ?",
    )
      .bind(garden)
      .run()
    await env.DB.prepare(
      "INSERT INTO room_readings (room_id, source_id, measured_at, temperature) VALUES (?, 'weather', '2025-01-01 12:00:00', 5)",
    )
      .bind(garden)
      .run()
    mockFetch({
      'archive-api.open-meteo.com': {
        daily: {
          time: ['2025-02-01'],
          temperature_2m_mean: [30],
          relative_humidity_2m_mean: [40],
        },
      },
    })

    await put('/climate/home', {
      label: 'Eilat',
      latitude: 29.5,
      longitude: 34.9,
    })

    expect(await readings(garden)).toEqual([
      {
        source_id: 'weather',
        measured_at: '2025-02-01 12:00:00',
        temperature: 30,
        humidity: 40,
      },
    ])
  })

  it('searches addresses through Photon, one result per label', async () => {
    mockFetch({ 'photon.komoot.io': PHOTON })
    const response = await api('/climate/places?q=dizengoff', {}, session)
    expect(await response.json()).toEqual([
      {
        label: 'Dizengoff 50, Dizengoff Street 50, Tel Aviv, Israel',
        latitude: 32.08,
        longitude: 34.78,
      },
      { label: 'Tel Aviv, Israel', latitude: 32.1, longitude: 34.8 },
    ])
  })

  it('rejects a short query and answers 502 when Photon fails', async () => {
    expect((await api('/climate/places?q=ab', {}, session)).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('no', { status: 500 }),
    )
    expect((await api('/climate/places?q=abc', {}, session)).status).toBe(502)
  })
})
