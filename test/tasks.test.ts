import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTasks,
  setTaskDone,
  setTaskSkipped,
  todayInJerusalem,
} from '../worker/tasks'
import { addPlant, addRoom, addWatering } from './helpers'

function setNow(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(utc))
}

afterEach(() => {
  vi.useRealTimers()
})

async function lastWatered(plantId: number) {
  return env.DB.prepare('SELECT last_watered FROM plants WHERE id = ?')
    .bind(plantId)
    .first<string | null>('last_watered')
}

async function wateringCount(plantId: number) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS count FROM events WHERE plant_id = ? AND type = 'watered'",
  )
    .bind(plantId)
    .first<number>('count')
}

function shiftDate(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(time).toISOString().slice(0, 10)
}

describe('due dates', () => {
  it('makes a plant that was never watered due today', async () => {
    setNow('2026-05-10T09:00:00Z')
    await addPlant({ water_every_days: 7 })
    const { today, tasks } = await getTasks(env.DB, true)
    expect(today).toBe('2026-05-10')
    expect(tasks).toMatchObject([{ type: 'water', due_date: '2026-05-10' }])
  })

  it('adds the interval to the last watering, across months and years', async () => {
    setNow('2026-01-20T09:00:00Z')
    const january = await addPlant({
      water_every_days: 7,
      last_watered: '2026-01-28',
    })
    const december = await addPlant({
      water_every_days: 5,
      last_watered: '2026-12-29',
    })
    const { tasks } = await getTasks(env.DB, true)
    const dueById = Object.fromEntries(
      tasks.map((task) => [task.plant_id, task.due_date]),
    )
    expect(dueById[january]).toBe('2026-02-04')
    expect(dueById[december]).toBe('2027-01-03')
  })

  it('does not drift a day when daylight saving time starts', async () => {
    setNow('2026-03-25T09:00:00Z')
    await addPlant({ water_every_days: 3, last_watered: '2026-03-26' })
    const { tasks } = await getTasks(env.DB, true)
    expect(tasks[0].due_date).toBe('2026-03-29')
  })

  it('gives no task to a plant without a watering interval', async () => {
    await addPlant({ water_every_days: null })
    const { tasks } = await getTasks(env.DB, true)
    expect(tasks).toEqual([])
  })
})

describe('today in Jerusalem', () => {
  it('is already tomorrow late at night UTC in winter (UTC+2)', () => {
    setNow('2026-01-01T22:30:00Z')
    expect(todayInJerusalem()).toBe('2026-01-02')
    setNow('2026-01-01T21:30:00Z')
    expect(todayInJerusalem()).toBe('2026-01-01')
  })

  it('is already tomorrow late at night UTC in summer (UTC+3)', () => {
    setNow('2026-07-01T21:30:00Z')
    expect(todayInJerusalem()).toBe('2026-07-02')
    setNow('2026-07-01T20:30:00Z')
    expect(todayInJerusalem()).toBe('2026-07-01')
  })

  it('follows the clock change days', () => {
    // Summer time starts Friday 2026-03-27 and ends Sunday 2026-10-25.
    setNow('2026-03-27T21:30:00Z')
    expect(todayInJerusalem()).toBe('2026-03-28')
    setNow('2026-10-25T21:30:00Z')
    expect(todayInJerusalem()).toBe('2026-10-25')
  })
})

// These use the real clock, because D1 stamps events with its own datetime('now').
describe('marking watering done and undoing it', () => {
  it('logs one event even when marked done twice in a day', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    expect(await setTaskDone(env.DB, 'water', plant, true)).toBe(true)
    expect(await setTaskDone(env.DB, 'water', plant, true)).toBe(true)
    expect(await lastWatered(plant)).toBe(todayInJerusalem())
    expect(await wateringCount(plant)).toBe(1)
  })

  it('goes back to the last earlier watering on undo', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const earlier = shiftDate(todayInJerusalem(), -3)
    await addWatering(plant, `${earlier} 09:00:00`)
    await setTaskDone(env.DB, 'water', plant, true)
    expect(await setTaskDone(env.DB, 'water', plant, false)).toBe(true)
    expect(await lastWatered(plant)).toBe(earlier)
    expect(await wateringCount(plant)).toBe(1)
  })

  it('counts an event logged late at night UTC as the next Jerusalem day', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    const utcDay = shiftDate(todayInJerusalem(), -5)
    await addWatering(plant, `${utcDay} 22:30:00`)
    await setTaskDone(env.DB, 'water', plant, true)
    await setTaskDone(env.DB, 'water', plant, false)
    expect(await lastWatered(plant)).toBe(shiftDate(utcDay, 1))
  })

  it('makes the plant due today again when undoing its only watering', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    await setTaskDone(env.DB, 'water', plant, true)
    await setTaskDone(env.DB, 'water', plant, false)
    expect(await lastWatered(plant)).toBeNull()
    const { tasks } = await getTasks(env.DB, false)
    expect(tasks).toMatchObject([
      { plant_id: plant, due_date: todayInJerusalem(), done_today: false },
    ])
  })

  it('refuses to undo a watering from an earlier day', async () => {
    const plant = await addPlant({
      water_every_days: 3,
      last_watered: shiftDate(todayInJerusalem(), -1),
    })
    expect(await setTaskDone(env.DB, 'water', plant, false)).toBe(false)
  })

  it('refuses an unknown task type or plant', async () => {
    const plant = await addPlant({ water_every_days: 3 })
    expect(await setTaskDone(env.DB, 'prune', plant, true)).toBe(false)
    expect(await setTaskDone(env.DB, 'toString', plant, true)).toBe(false)
    expect(await setTaskDone(env.DB, 'water', 9999, true)).toBe(false)
  })
})

describe('task list', () => {
  it('shows tasks up to tomorrow by default, and all of them with all', async () => {
    setNow('2026-05-10T09:00:00Z')
    const today = await addPlant({
      water_every_days: 2,
      last_watered: '2026-05-08',
    })
    const tomorrow = await addPlant({
      water_every_days: 2,
      last_watered: '2026-05-09',
    })
    const later = await addPlant({
      water_every_days: 7,
      last_watered: '2026-05-09',
    })
    const soon = await getTasks(env.DB, false)
    expect(soon.tasks.map((task) => task.plant_id)).toEqual([today, tomorrow])
    const all = await getTasks(env.DB, true)
    expect(all.tasks.map((task) => task.plant_id)).toEqual([
      today,
      tomorrow,
      later,
    ])
  })

  it('sorts open tasks by date, then room name, and keeps done ones last', async () => {
    const living = await addRoom('סלון')
    const bedroom = await addRoom('חדר שינה')
    const done = await addPlant({ room_id: bedroom, water_every_days: 1 })
    const inLiving = await addPlant({ room_id: living, water_every_days: 1 })
    const inBedroom = await addPlant({ room_id: bedroom, water_every_days: 1 })
    const overdue = await addPlant({
      room_id: living,
      water_every_days: 1,
      last_watered: shiftDate(todayInJerusalem(), -3),
    })
    await setTaskDone(env.DB, 'water', done, true)

    const { tasks } = await getTasks(env.DB, false)
    expect(tasks.map((task) => task.plant_id)).toEqual([
      overdue,
      inBedroom,
      inLiving,
      done,
    ])
    expect(tasks.at(-1)).toMatchObject({
      done_today: true,
      due_date: shiftDate(todayInJerusalem(), 1),
    })
  })
})

describe('skipping', () => {
  it('postpones the task by the reason, and brings it back after', async () => {
    setNow('2026-05-10T09:00:00Z')
    const plant = await addPlant({ water_every_days: 7 })
    expect(await setTaskSkipped(env.DB, 'water', plant, 'wet_soil')).toBe(true)
    const { tasks } = await getTasks(env.DB, true)
    expect(tasks).toMatchObject([
      { due_date: '2026-05-13', skip_reason: 'wet_soil' },
    ])
    expect((await getTasks(env.DB, false)).tasks).toHaveLength(0)

    setNow('2026-05-13T09:00:00Z')
    expect((await getTasks(env.DB, false)).tasks).toHaveLength(1)
  })

  it('replaces an earlier skip and can be undone', async () => {
    setNow('2026-05-10T09:00:00Z')
    const plant = await addPlant({ water_every_days: 7 })
    await setTaskSkipped(env.DB, 'water', plant, 'dormant')
    await setTaskSkipped(env.DB, 'water', plant, 'away')
    expect((await getTasks(env.DB, true)).tasks[0]).toMatchObject({
      due_date: '2026-05-11',
      skip_reason: 'away',
    })
    await setTaskSkipped(env.DB, 'water', plant, null)
    expect((await getTasks(env.DB, true)).tasks[0]).toMatchObject({
      due_date: '2026-05-10',
      skip_reason: null,
    })
  })

  it('stops counting once the plant is watered', async () => {
    setNow('2026-05-10T09:00:00Z')
    const plant = await addPlant({ water_every_days: 2 })
    await setTaskSkipped(env.DB, 'water', plant, 'dormant')
    setNow('2026-05-11T09:00:00Z')
    await setTaskDone(env.DB, 'water', plant, true)
    setNow('2026-05-12T09:00:00Z')
    expect((await getTasks(env.DB, true)).tasks[0]).toMatchObject({
      due_date: '2026-05-13',
      skip_reason: null,
    })
  })

  it('refuses a task that is done today or does not exist', async () => {
    setNow('2026-05-10T09:00:00Z')
    const plant = await addPlant({ water_every_days: 7 })
    await setTaskDone(env.DB, 'water', plant, true)
    expect(await setTaskSkipped(env.DB, 'water', plant, 'away')).toBe(false)
    expect(await setTaskSkipped(env.DB, 'water', 999, 'away')).toBe(false)
    expect(await setTaskSkipped(env.DB, 'prune', plant, 'away')).toBe(false)
  })
})
