import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTaskSkipped } from '../worker/tasks'
import {
  adjustWateringIntervals,
  decideInterval,
} from '../worker/wateringInterval'
import { addPlant, addWatering } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

function setNow(utc = '2026-06-30T09:00:00Z') {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(utc))
}

async function interval(plantId: number) {
  return env.DB.prepare('SELECT water_every_days FROM plants WHERE id = ?')
    .bind(plantId)
    .first<number>('water_every_days')
}

function logSkip(plantId: number, skippedOn: string, reason = 'wet_soil') {
  return env.DB.prepare(
    "INSERT INTO task_skip_log (plant_id, type, reason, skipped_on) VALUES (?, 'water', ?, ?)",
  )
    .bind(plantId, reason, skippedOn)
    .run()
}

describe('decideInterval', () => {
  const quiet = { current: 10, base: 10, wetSkips: 0, wateredOn: [] }

  it('changes nothing without evidence', () => {
    expect(decideInterval(quiet)).toBeNull()
  })

  it('lengthens by about 10% of the AI value after repeated wet-soil skips', () => {
    expect(decideInterval({ ...quiet, wetSkips: 2 })).toEqual({
      days: 11,
      cause: 'wet_soil_skips',
    })
  })

  it('shortens when most recent waterings came well before the due date', () => {
    const wateredOn = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22']
    expect(decideInterval({ ...quiet, wateredOn })).toEqual({
      days: 9,
      cause: 'early_waterings',
    })
  })

  it('treats watering one day early as on time', () => {
    const wateredOn = ['2026-06-01', '2026-06-10', '2026-06-19', '2026-06-28']
    expect(decideInterval({ ...quiet, wateredOn })).toBeNull()
  })

  it('does nothing when the signals disagree', () => {
    const wateredOn = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22']
    expect(decideInterval({ ...quiet, wateredOn, wetSkips: 3 })).toBeNull()
  })

  it('stays within half to double of the AI value', () => {
    expect(decideInterval({ ...quiet, current: 20, wetSkips: 2 })).toBeNull()
    const wateredOn = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']
    expect(decideInterval({ ...quiet, current: 5, wateredOn })).toBeNull()
  })

  it('steps at least one day for short intervals', () => {
    expect(
      decideInterval({ current: 3, base: 3, wetSkips: 2, wateredOn: [] })?.days,
    ).toBe(4)
  })
})

describe('adjustWateringIntervals', () => {
  it('lengthens a plant skipped twice for wet soil and records why', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: 10 })
    await logSkip(plantId, '2026-06-10')
    await logSkip(plantId, '2026-06-20')
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBe(11)
    const change = await env.DB.prepare(
      'SELECT from_days, to_days, cause, changed_on FROM water_interval_changes',
    ).first()
    expect(change).toEqual({
      from_days: 10,
      to_days: 11,
      cause: 'wet_soil_skips',
      changed_on: '2026-06-30',
    })
  })

  it('shortens a plant watered early again and again', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: 10 })
    for (const day of ['01', '08', '15', '22']) {
      await addWatering(plantId, `2026-06-${day} 08:00:00`)
    }
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBe(9)
  })

  it('waits two weeks between changes and ignores evidence it already used', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: 10 })
    await logSkip(plantId, '2026-06-10')
    await logSkip(plantId, '2026-06-20')
    await adjustWateringIntervals(env.DB)
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBe(11)

    setNow('2026-07-20T09:00:00Z')
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBe(11)
  })

  it('does not count other skip reasons or old skips', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: 10 })
    await logSkip(plantId, '2026-06-20', 'dormant')
    await logSkip(plantId, '2026-06-25')
    await logSkip(plantId, '2026-03-01')
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBe(10)
  })

  it('leaves plants without an interval alone', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: null })
    await logSkip(plantId, '2026-06-10')
    await logSkip(plantId, '2026-06-20')
    await adjustWateringIntervals(env.DB)
    expect(await interval(plantId)).toBeNull()
  })
})

describe('skip log', () => {
  const count = () =>
    env.DB.prepare('SELECT COUNT(*) AS count FROM task_skip_log').first<number>(
      'count',
    )

  it('keeps one skip per day, a skip on each day, and drops a cancelled one', async () => {
    setNow()
    const plantId = await addPlant({ water_every_days: 7 })
    await setTaskSkipped(env.DB, 'water', plantId, 'wet_soil')
    await setTaskSkipped(env.DB, 'water', plantId, 'away')
    expect(await count()).toBe(1)
    expect(
      await env.DB.prepare('SELECT reason FROM task_skip_log').first('reason'),
    ).toBe('away')

    setNow('2026-07-02T09:00:00Z')
    await setTaskSkipped(env.DB, 'water', plantId, 'wet_soil')
    expect(await count()).toBe(2)

    await setTaskSkipped(env.DB, 'water', plantId, null)
    expect(await count()).toBe(1)
  })
})
