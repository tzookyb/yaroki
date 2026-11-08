import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  learnHourFromHistory,
  learnHourWithAi,
  medianHour,
  sendReminderIfTime,
} from '../worker/reminderTime'
import { addPlant, addWatering } from './helpers'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

afterEach(() => {
  vi.restoreAllMocks()
})

// Jerusalem is UTC+2 in January, so 2027-01-10T18:30Z is 20:30 there.
async function addWaterings(utcTimes: string[]) {
  const plant = await addPlant({ water_every_days: 7 })
  for (const time of utcTimes) {
    await addWatering(plant, time)
  }
}

function scheduleRow() {
  return env.DB.prepare(
    'SELECT hour, source, last_sent FROM reminder_schedule WHERE id = 1',
  ).first<{ hour: number; source: string; last_sent: string | null }>()
}

describe('learning from history', () => {
  it('takes the median hour of recent waterings', async () => {
    await addWaterings([
      '2027-01-01 18:10:00',
      '2027-01-02 18:40:00',
      '2027-01-03 18:20:00',
      '2027-01-04 06:00:00',
      '2027-01-05 18:50:00',
    ])
    await learnHourFromHistory(env.DB)
    expect(await scheduleRow()).toMatchObject({ hour: 20, source: 'history' })
  })

  it('keeps the default until there is enough history', async () => {
    await addWaterings(['2027-01-01 18:10:00', '2027-01-02 18:10:00'])
    await learnHourFromHistory(env.DB)
    expect(await scheduleRow()).toBeNull()
  })

  it('never goes outside the allowed hours', async () => {
    await addWaterings(Array(6).fill('2027-01-01 20:30:00'))
    await learnHourFromHistory(env.DB)
    expect(await scheduleRow()).toMatchObject({ hour: 21 })
  })

  it('does not overwrite an hour the AI chose', async () => {
    await env.DB.prepare(
      "INSERT INTO reminder_schedule (id, hour, source) VALUES (1, 9, 'ai')",
    ).run()
    await addWaterings(Array(6).fill('2027-01-01 18:10:00'))
    await learnHourFromHistory(env.DB)
    expect(await scheduleRow()).toMatchObject({ hour: 9, source: 'ai' })
  })

  it('finds the median', () => {
    expect(medianHour([9, 20, 8])).toBe(9)
  })
})

describe('learning with the AI', () => {
  function mockGemini(hour: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify({ hour }) }] } },
            ],
          }),
        ),
    )
  }

  it('saves the hour the AI suggests, within the limits', async () => {
    await addWaterings(Array(6).fill('2027-01-01 18:10:00'))
    const fetchMock = mockGemini(3)
    await learnHourWithAi(env)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await scheduleRow()).toMatchObject({ hour: 7, source: 'ai' })
  })

  it('ignores an unusable answer', async () => {
    await addWaterings(Array(6).fill('2027-01-01 18:10:00'))
    mockGemini('evening')
    await learnHourWithAi(env)
    expect(await scheduleRow()).toBeNull()
  })

  it('does not call the AI without enough history', async () => {
    const fetchMock = mockGemini(9)
    await learnHourWithAi(env)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sending in the learned hour', () => {
  async function setup(hour: number) {
    await addPlant({ water_every_days: 7 })
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint, keys) VALUES (?, ?)',
    )
      .bind(ENDPOINT, '{}')
      .run()
    await env.DB.prepare(
      "INSERT INTO reminder_schedule (id, hour, source) VALUES (1, ?, 'history')",
    )
      .bind(hour)
      .run()
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 201 }))
  }

  it('waits for the hour', async () => {
    const fetchMock = await setup(20)
    await sendReminderIfTime(env, new Date('2027-01-10T16:30:00Z'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends once per day', async () => {
    const fetchMock = await setup(20)
    await sendReminderIfTime(env, new Date('2027-01-10T18:00:00Z'))
    await sendReminderIfTime(env, new Date('2027-01-10T19:00:00Z'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends again the next day', async () => {
    const fetchMock = await setup(20)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-10T18:00:00Z'))
    await sendReminderIfTime(env)
    vi.setSystemTime(new Date('2027-01-11T18:00:00Z'))
    await sendReminderIfTime(env, new Date())
    vi.useRealTimers()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
