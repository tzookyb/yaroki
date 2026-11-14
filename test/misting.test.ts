import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMistingAlerts } from '../worker/push'
import { getTasks, setTaskDone, setTaskSkipped } from '../worker/tasks'
import { addRoom } from './helpers'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

function setNow(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(utc))
}

async function addPlant(
  roomId: number | null,
  humidityNeeds: string | null = 'humid',
) {
  const { results } = await env.DB.prepare(
    'INSERT INTO plants (room_id, name, humidity_needs) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(roomId, 'מונסטרה', humidityNeeds)
    .run<{ id: number }>()
  return results[0].id
}

// The reading time is relative to the real clock, because D1 compares it with its own datetime('now').
async function addHumidity(roomId: number, humidity: number) {
  await env.DB.prepare(
    `INSERT INTO room_readings (room_id, source_id, measured_at, temperature, humidity)
     VALUES (?, 'dev', datetime('now', '-1 hour'), 22, ?)`,
  )
    .bind(roomId, humidity)
    .run()
}

async function mistTasks() {
  const { tasks } = await getTasks(env.DB, true)
  return tasks.filter((task) => task.type === 'mist')
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(null, { status: 201 }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('misting task', () => {
  it('is due while the room is dry and the plant likes humid air', async () => {
    const room = await addRoom()
    const plant = await addPlant(room)
    await addHumidity(room, 42)
    expect(await mistTasks()).toMatchObject([
      { plant_id: plant, due_date: expect.any(String), done_today: false },
    ])
  })

  it('does not exist when the air is humid enough or unmeasured', async () => {
    const room = await addRoom()
    const unmeasured = await addRoom('מטבח')
    await addPlant(room)
    await addPlant(unmeasured)
    await addHumidity(room, 55)
    expect(await mistTasks()).toEqual([])
  })

  it('does not exist for plants that do not need humid air or are outdoors', async () => {
    const room = await addRoom()
    const garden = await addRoom('גינה')
    await env.DB.prepare(
      "UPDATE rooms SET location_type = 'garden' WHERE id = ?",
    )
      .bind(garden)
      .run()
    await addPlant(room, 'dry')
    await addPlant(room, 'normal')
    await addPlant(garden)
    await addHumidity(room, 30)
    await addHumidity(garden, 30)
    expect(await mistTasks()).toEqual([])
  })

  it('comes back after the interval while the air stays dry, and goes when it recovers', async () => {
    const room = await addRoom()
    const plant = await addPlant(room)
    await addHumidity(room, 40)
    setNow(new Date().toISOString())
    await setTaskDone(env.DB, 'mist', plant, true)
    const [done] = await mistTasks()
    expect(done.done_today).toBe(true)
    expect(done.due_date).toBe(
      new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    )

    setNow(new Date(Date.now() + 2 * 86_400_000).toISOString())
    const [again] = await mistTasks()
    expect(again.done_today).toBe(false)

    await env.DB.prepare('UPDATE room_readings SET humidity = 60').run()
    expect(await mistTasks()).toEqual([])
  })

  it('can be undone and skipped like other tasks', async () => {
    const room = await addRoom()
    const plant = await addPlant(room)
    await addHumidity(room, 40)
    await setTaskDone(env.DB, 'mist', plant, true)
    expect((await mistTasks())[0].done_today).toBe(true)
    expect(await setTaskDone(env.DB, 'mist', plant, false)).toBe(true)
    expect((await mistTasks())[0].done_today).toBe(false)
    expect(await setTaskSkipped(env.DB, 'mist', plant, 'away')).toBe(true)
    expect((await mistTasks())[0].skip_reason).toBe('away')
  })
})

describe('misting alerts', () => {
  async function subscribe() {
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint, keys) VALUES (?, ?)',
    )
      .bind(ENDPOINT, '{}')
      .run()
  }

  it('pushes once per due date, again after the task is done and due again, and re-arms when the air recovers', async () => {
    const room = await addRoom()
    const plant = await addPlant(room)
    await subscribe()
    await addHumidity(room, 40)

    await sendMistingAlerts(env)
    await sendMistingAlerts(env)
    expect(fetch).toHaveBeenCalledTimes(1)

    await setTaskDone(env.DB, 'mist', plant, true)
    await sendMistingAlerts(env)
    expect(fetch).toHaveBeenCalledTimes(1)

    setNow(new Date(Date.now() + 2 * 86_400_000).toISOString())
    await sendMistingAlerts(env)
    expect(fetch).toHaveBeenCalledTimes(2)

    await env.DB.prepare('UPDATE room_readings SET humidity = 60').run()
    await sendMistingAlerts(env)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM misting_alerts').first(
        'n',
      ),
    ).toBe(0)

    await env.DB.prepare('UPDATE room_readings SET humidity = 40').run()
    await sendMistingAlerts(env)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('sends nothing when no plant needs misting', async () => {
    const room = await addRoom()
    await addPlant(room, 'dry')
    await subscribe()
    await addHumidity(room, 30)
    await sendMistingAlerts(env)
    expect(fetch).not.toHaveBeenCalled()
  })
})
